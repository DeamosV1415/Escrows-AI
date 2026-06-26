import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, ToolMessage, SystemMessage } from "@langchain/core/messages";
import registry from "./registry.js";
import { buildSystemPrompt } from "./prompts.js";
import { tryDebit, hasCredits, getBalanceInfo } from "./creditService.js";

function modelForTier(tier) {
  return tier === "free" ? "gpt-4.1-mini" : "gpt-4.1";
}

function lastAIMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const type = m?.getType?.() || m?._getType?.() || m?.type;
    if (type === "ai") return m;
  }
  return null;
}

/**
 * ROUTER — picks the entry node.
 * If the last AI message already has tool_calls (we're resuming after the
 * model emitted calls in a previous turn), jump straight to the confirm gate.
 * Otherwise, run the LLM.
 */
export function routerNode() {
  return {};
}

export function routeFromRouter(state) {
  const ai = lastAIMessage(state.messages);
  if (ai?.tool_calls?.length) return "confirm_gate";
  return "agent";
}

/**
 * AGENT — invokes the LLM with bound tools and appends an AIMessage.
 * Streams tokens via streamEvents subscribers automatically.
 */
export async function agentNode(state, config) {
  const { models, emit } = config.configurable;
  // The graph is registry-agnostic: the copilot passes nothing (falls back to the
  // global registry + default prompt), the sequences sub-agent passes its own
  // tool registry + a `buildSystemPrompt` override via configurable.
  const reg = config.configurable.registry || registry;
  const promptOverride = config.configurable.buildSystemPrompt;
  // Surface a Claude-style "thinking" status while the LLM call is in flight.
  // Tokens (or a tool_progress event) will replace it as soon as they arrive.
  emit?.({ type: "status", phase: "thinking" });
  const user = await models.User.findById(state.userId).select("name email company phone").lean();
  const credits = await getBalanceInfo(models.CreditAccount, state.userId);

  const llm = new ChatOpenAI({
    model: modelForTier(state.userTier),
    temperature: 0.2,
    streaming: true,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const tools = reg.buildLLMTools();
  const llmWithTools = llm.bindTools(tools);

  const sysText = promptOverride
    ? promptOverride({ registry: reg, user: user || {}, credits, configurable: config.configurable })
    : buildSystemPrompt({ toolSummary: reg.buildPromptSummary(), user: user || {}, credits });
  const sys = new SystemMessage(sysText);
  const reply = await llmWithTools.invoke([sys, ...state.messages]);
  return { messages: [reply] };
}

export function routeFromAgent(state) {
  const ai = lastAIMessage(state.messages);
  if (ai?.tool_calls?.length) return "confirm_gate";
  return "end";
}

/**
 * CONFIRM GATE — if the LLM emitted tool calls, decide whether any are
 * sensitive and not yet approved. If so, pause and surface the first one
 * to the user. Otherwise, fall through to the tools node.
 */
export async function confirmGateNode(state, config) {
  const { models } = config.configurable;
  const reg = config.configurable.registry || registry;
  const ai = lastAIMessage(state.messages);
  const calls = ai?.tool_calls || [];
  const approved = new Set(state.approvedToolCallIds || []);

  // Collect EVERY sensitive, not-yet-approved call so the whole batch can be
  // confirmed in a single card — rather than one prompt per call, which made
  // "create 10 clients" turn into ten confirmation loops.
  const pendingCalls = [];
  for (const call of calls) {
    const tool = reg.get(call.name);
    if (!tool) continue;
    if (!tool.sensitive) continue;
    if (approved.has(call.id)) continue;

    let description;
    if (tool.buildDescription) {
      // buildDescription may be async — it can look up human names (client,
      // contact, item) so the confirmation never shows a raw Mongo id.
      try { description = await tool.buildDescription(call.args || {}, { models, userId: state.userId }); }
      catch (e) { description = `(could not render description: ${e.message})`; }
    } else {
      description = `Run **${tool.name}**?`;
    }

    pendingCalls.push({
      toolCallId: call.id,
      toolName: tool.name,
      toolArgs: call.args,
      creditCost: tool.creditCost,
      description,
    });
  }

  if (pendingCalls.length) {
    // Group by tool name ("same nature") for a clean one-line headline.
    const groupMap = new Map();
    for (const c of pendingCalls) {
      const g = groupMap.get(c.toolName) || { toolName: c.toolName, count: 0, creditCost: 0 };
      g.count += 1;
      g.creditCost += c.creditCost;
      groupMap.set(c.toolName, g);
    }
    const groups = Array.from(groupMap.values());
    const totalCreditCost = pendingCalls.reduce((s, c) => s + c.creditCost, 0);
    const first = pendingCalls[0];

    return {
      pendingConfirmation: {
        batched: true,
        calls: pendingCalls,
        groups,
        totalCreditCost,
        summary: buildBatchSummary(groups),
        // Legacy single-call mirror so older clients keep working.
        toolCallId: first.toolCallId,
        toolName: first.toolName,
        toolArgs: first.toolArgs,
        creditCost: first.creditCost,
        description: pendingCalls.length === 1 ? first.description : buildBatchSummary(groups),
      },
    };
  }

  // No sensitive unapproved calls — pre-check the combined credit cost so we
  // fail fast with a friendly message instead of partway through a batch.
  let totalCost = 0;
  for (const call of calls) {
    const t = reg.get(call.name);
    if (t) totalCost += t.creditCost;
  }
  if (totalCost > 0) {
    const check = await hasCredits(models.CreditAccount, state.userId, totalCost);
    if (!check.ok) {
      return { insufficientCredits: { needed: totalCost, balance: check.balance } };
    }
    return { creditsRemaining: check.balance };
  }
  return {};
}

export function routeFromConfirmGate(state) {
  if (state.pendingConfirmation) return "end";
  if (state.insufficientCredits) return "end";
  return "tools";
}

/**
 * Turn grouped tool calls into a human headline, e.g.
 *   [{create_client x10}]                  → "Create 10 clients"
 *   [{delete_client x3}, {send_email x2}]  → "Delete 3 clients and send 2 emails"
 * Generic: verb = first segment of the tool name, noun = the rest.
 */
function buildBatchSummary(groups) {
  const phrase = (g, lead) => {
    const [verb, ...nounParts] = g.toolName.split("_");
    let noun = nounParts.join(" ") || "item";
    if (g.count !== 1) noun += "s";
    const v = lead ? verb.charAt(0).toUpperCase() + verb.slice(1) : verb;
    return `${v} ${g.count} ${noun}`;
  };
  if (groups.length === 1) return `${phrase(groups[0], true)}?`;
  const parts = groups.map((g, i) => phrase(g, i === 0));
  const last = parts.pop();
  return `${parts.join(", ")} and ${last}?`;
}

/**
 * TOOLS — runs every tool_call from the last AIMessage, atomically debits
 * credits per successful call, and appends a ToolMessage for each.
 */
export async function toolsNode(state, config) {
  const { models, gridfsBucket, emit } = config.configurable;
  const reg = config.configurable.registry || registry;
  const ai = lastAIMessage(state.messages);
  const calls = ai?.tool_calls || [];
  const total = calls.length;
  const out = [];
  let lastBalance = state.creditsRemaining;

  const fail = (call, error) =>
    new ToolMessage({ tool_call_id: call.id, name: call.name, content: JSON.stringify({ error }) });

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const index = i + 1;
    const tool = reg.get(call.name);

    // Tell the client which step we're on so the UI can show "Creating client (3 / 10)".
    emit?.({ type: "tool_progress", phase: "start", index, total, toolName: call.name });

    let msg;
    let ok = false;

    if (!tool) {
      msg = fail(call, `Unknown tool: ${call.name}`);
    } else {
      // Validate args defensively (the LLM is usually correct, but Zod catches drift).
      let parsed;
      try {
        parsed = tool.schema.parse(call.args || {});
      } catch (e) {
        msg = fail(call, `Invalid arguments: ${e.message}`);
      }

      // Pre-flight credit check for THIS specific tool.
      if (!msg) {
        const pre = await hasCredits(models.CreditAccount, state.userId, tool.creditCost);
        if (!pre.ok) {
          msg = fail(call, `Insufficient credits — needs ${tool.creditCost}, you have ${pre.balance}.`);
        }
      }

      // Execute + atomically debit AFTER success.
      if (!msg) {
        try {
          const result = await tool.handler(parsed, state.userId, { models, gridfsBucket });
          const debit = await tryDebit(models.CreditAccount, state.userId, tool.name, tool.creditCost);
          if (debit.ok) lastBalance = debit.balance;
          ok = true;
          msg = new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            content: typeof result === "string" ? result : JSON.stringify(result),
          });
        } catch (e) {
          msg = fail(call, e.message || "Tool execution failed");
        }
      }
    }

    out.push(msg);
    emit?.({ type: "tool_progress", phase: "done", index, total, toolName: call.name, ok });
  }

  return {
    messages: out,
    creditsRemaining: lastBalance,
    // Once tool calls are dispatched, clear approvals so a re-prompt of the
    // same tool needs fresh confirmation.
    approvedToolCallIds: [],
    pendingConfirmation: null,
  };
}
