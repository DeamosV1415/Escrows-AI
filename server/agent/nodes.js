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
  const { models } = config.configurable;
  const user = await models.User.findById(state.userId).select("name email company").lean();
  const credits = await getBalanceInfo(models.CreditAccount, state.userId);

  const llm = new ChatOpenAI({
    model: modelForTier(state.userTier),
    temperature: 0.2,
    streaming: true,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const tools = registry.buildLLMTools();
  const llmWithTools = llm.bindTools(tools);

  const sys = new SystemMessage(
    buildSystemPrompt({
      toolSummary: registry.buildPromptSummary(),
      user: user || {},
      credits,
    }),
  );
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
  const ai = lastAIMessage(state.messages);
  const calls = ai?.tool_calls || [];
  const approved = new Set(state.approvedToolCallIds || []);

  for (const call of calls) {
    const tool = registry.get(call.name);
    if (!tool) continue;
    if (!tool.sensitive) continue;
    if (approved.has(call.id)) continue;

    const description = tool.buildDescription
      ? safeBuild(tool.buildDescription, call.args)
      : `Run **${tool.name}**?`;

    return {
      pendingConfirmation: {
        toolCallId: call.id,
        toolName: tool.name,
        toolArgs: call.args,
        creditCost: tool.creditCost,
        description,
      },
    };
  }

  // No sensitive unapproved calls — pre-check the combined credit cost so we
  // fail fast with a friendly message instead of partway through a batch.
  let totalCost = 0;
  for (const call of calls) {
    const t = registry.get(call.name);
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

function safeBuild(fn, args) {
  try { return fn(args || {}); }
  catch (e) { return `(could not render description: ${e.message})`; }
}

/**
 * TOOLS — runs every tool_call from the last AIMessage, atomically debits
 * credits per successful call, and appends a ToolMessage for each.
 */
export async function toolsNode(state, config) {
  const { models, gridfsBucket } = config.configurable;
  const ai = lastAIMessage(state.messages);
  const calls = ai?.tool_calls || [];
  const out = [];
  let lastBalance = state.creditsRemaining;

  for (const call of calls) {
    const tool = registry.get(call.name);
    if (!tool) {
      out.push(new ToolMessage({
        tool_call_id: call.id,
        name: call.name,
        content: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
      }));
      continue;
    }

    // Validate args defensively (the LLM is usually correct, but Zod catches drift).
    let parsed;
    try {
      parsed = tool.schema.parse(call.args || {});
    } catch (e) {
      out.push(new ToolMessage({
        tool_call_id: call.id,
        name: call.name,
        content: JSON.stringify({ error: `Invalid arguments: ${e.message}` }),
      }));
      continue;
    }

    // Pre-flight credit check for THIS specific tool.
    const pre = await hasCredits(models.CreditAccount, state.userId, tool.creditCost);
    if (!pre.ok) {
      out.push(new ToolMessage({
        tool_call_id: call.id,
        name: call.name,
        content: JSON.stringify({
          error: `Insufficient credits — needs ${tool.creditCost}, you have ${pre.balance}.`,
        }),
      }));
      continue;
    }

    // Execute.
    let result;
    try {
      result = await tool.handler(parsed, state.userId, { models, gridfsBucket });
    } catch (e) {
      out.push(new ToolMessage({
        tool_call_id: call.id,
        name: call.name,
        content: JSON.stringify({ error: e.message || "Tool execution failed" }),
      }));
      continue;
    }

    // Atomically debit AFTER success.
    const debit = await tryDebit(models.CreditAccount, state.userId, tool.name, tool.creditCost);
    if (debit.ok) lastBalance = debit.balance;

    out.push(new ToolMessage({
      tool_call_id: call.id,
      name: call.name,
      content: typeof result === "string" ? result : JSON.stringify(result),
    }));
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
