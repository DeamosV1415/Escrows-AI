import express from "express";
import {
  HumanMessage,
  AIMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import {
  getBalanceInfo,
  upgradePromptText,
} from "../agent/creditService.js";

/** SSE helper — keeps connection open and ships JSON-encoded events. */
function openSSE(res) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Content-Encoding", "identity");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  // Each SSE event is tiny. Without this, Nagle's algorithm waits for the
  // kernel to batch writes into a fuller TCP segment, which holds tokens
  // back until the request ends. setNoDelay forces every write to ship.
  res.socket?.setNoDelay(true);
  let closed = false;
  res.on("close", () => { closed = true; });
  return {
    send: (event) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      // Flush the internal Node/Express buffer so each SSE event reaches the
      // client (and any reverse proxy sitting in front) immediately.
      if (typeof res.flush === "function") res.flush();
    },
    end: () => { if (!closed) res.end(); },
    get closed() { return closed; },
  };
}

/** Convert a stored message into a LangChain message instance. */
function hydrate(stored) {
  if (stored.role === "user") return new HumanMessage(stored.content || "");
  if (stored.role === "assistant") {
    return new AIMessage({
      content: stored.content || "",
      tool_calls: (stored.toolCalls || []).map((c) => ({
        id: c.id,
        name: c.name,
        args: c.args || {},
      })),
    });
  }
  if (stored.role === "tool") {
    return new ToolMessage({
      tool_call_id: stored.toolCallId,
      name: stored.toolName || undefined,
      content: stored.content || "",
    });
  }
  return null;
}

/** Convert a LangChain message into our storage shape. */
function dehydrate(m) {
  const type = m?.getType?.() || m?._getType?.() || m?.type;
  if (type === "human") {
    return { role: "user", content: typeof m.content === "string" ? m.content : "", timestamp: new Date() };
  }
  if (type === "ai") {
    return {
      role: "assistant",
      content: typeof m.content === "string" ? m.content : "",
      toolCalls: (m.tool_calls || []).map((c) => ({ id: c.id, name: c.name, args: c.args || {} })),
      timestamp: new Date(),
    };
  }
  if (type === "tool") {
    return {
      role: "tool",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      toolCallId: m.tool_call_id,
      toolName: m.name || null,
      timestamp: new Date(),
    };
  }
  return null;
}

/** Strip trailing tool / assistant-with-tool-calls messages from history (used after a cancellation). */
function trimDanglingToolCalls(messages) {
  const out = [...messages];
  while (out.length) {
    const last = out[out.length - 1];
    if (last.role === "tool") { out.pop(); continue; }
    if (last.role === "assistant" && (last.toolCalls?.length || 0) > 0 && !last.content) {
      out.pop();
      continue;
    }
    break;
  }
  return out;
}

/**
 * Sanitize stored messages: deduplicate consecutive identical messages and
 * enforce OpenAI's structural invariants for tool-call sequences:
 *   - Every AIMessage with tool_calls must be immediately followed by
 *     ToolMessages for ALL of its tool_call_ids, before any other message.
 *   - Every ToolMessage must be directly preceded (possibly with other
 *     ToolMessages) by an AIMessage with a matching tool_call_id.
 *
 * Orphaned messages are dropped or patched (tool_calls stripped if the AI
 * message has text content). The very last AI(tool_calls) in the array is
 * preserved even if incomplete — it may be awaiting user confirmation.
 */
function sanitizeMessages(messages) {
  // 1) Deduplicate consecutive identical messages.
  const deduped = [];
  for (const m of messages) {
    const prev = deduped[deduped.length - 1];
    if (prev
      && prev.role === m.role
      && prev.content === m.content
      && JSON.stringify(prev.toolCalls || null) === JSON.stringify(m.toolCalls || null)
      && (prev.toolCallId || null) === (m.toolCallId || null)
    ) {
      continue; // skip duplicate
    }
    deduped.push(m);
  }

  // 2) Sequential walk — rebuild the array enforcing tool-call structure.
  const result = [];
  let i = 0;

  while (i < deduped.length) {
    const m = deduped[i];

    if (m.role === "assistant" && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
      // Look ahead for consecutive ToolMessages matching this AI's calls.
      const expectedIds = new Set(m.toolCalls.map((c) => c.id));
      const matched = [];
      let j = i + 1;
      while (j < deduped.length && deduped[j].role === "tool") {
        if (deduped[j].toolCallId && expectedIds.has(deduped[j].toolCallId)) {
          matched.push(deduped[j]);
          expectedIds.delete(deduped[j].toolCallId);
        }
        j++;
      }

      if (expectedIds.size === 0) {
        // Complete group — all tool_calls have responses. Keep everything.
        result.push(m);
        for (const tm of matched) result.push(tm);
      } else if (j >= deduped.length) {
        // This is at the tail of the conversation — could be a pending
        // confirmation. Preserve so the /confirm flow works correctly.
        result.push(m);
        for (const tm of matched) result.push(tm);
      } else {
        // Incomplete group mid-conversation — strip tool_calls.
        if ((m.content || "").trim()) {
          result.push({ ...m, toolCalls: [] });
        }
        // else: drop the contentless AI message entirely.
        // Any partial tool responses are also dropped (not pushed).
      }
      i = j; // advance past the AI message and all consecutive ToolMessages.
    } else if (m.role === "tool") {
      // Orphaned ToolMessage not preceded by an AI with matching tool_calls.
      i++; // drop it silently.
    } else {
      // User or plain assistant message — always keep.
      result.push(m);
      i++;
    }
  }

  return result;
}

/**
 * Run the compiled graph as an SSE stream, forwarding LLM token deltas
 * from the `agent` node, plus `tool_started`/`tool_finished` events.
 *
 * Returns `state.messages` containing ONLY the new messages produced this
 * turn (not the input messages). Other state fields (pendingConfirmation,
 * insufficientCredits, creditsRemaining, etc.) come from the root's final
 * accumulated state.
 */
async function runGraphStream({ graph, input, configurable, sse }) {
  const inputMessageCount = input.messages.length;
  let finalState = null;
  let tokensSent = false;

  const events = graph.streamEvents(input, { version: "v2", configurable });

  for await (const ev of events) {
    if (sse.closed) break;

    // Stream LLM token deltas from the agent node.
    if (ev.event === "on_chat_model_stream" && ev.metadata?.langgraph_node === "agent") {
      const delta = ev.data?.chunk?.content;
      if (typeof delta === "string" && delta.length) {
        sse.send({ type: "token", delta });
        tokensSent = true;
      }
      continue;
    }

    // Notify the client when the tools node starts.
    if (ev.event === "on_chain_start" && ev.metadata?.langgraph_node === "tools") {
      sse.send({ type: "tools_started" });
      continue;
    }

    // Capture the root's final state (the only reliable source of truth).
    if (ev.event === "on_chain_end" && (ev.parent_ids?.length || 0) === 0) {
      const out = ev.data?.output;
      if (out && typeof out === "object") {
        finalState = out;
      }
    }
  }

  // The root's final state contains ALL messages (input + new).
  // Slice off the input messages to get only what the graph produced.
  const newMessages = finalState?.messages?.slice(inputMessageCount) || [];

  return {
    state: {
      ...(finalState || {}),
      messages: newMessages,
    },
    tokensSent,
  };
}

/** Word-by-word fallback so confirmation / cancellation prompts still feel live. */
async function fakeStream(sse, text, delayMs = 18) {
  const chunks = text.match(/\S+\s*|\s+/g) || [text];
  for (const c of chunks) {
    if (sse.closed) return;
    sse.send({ type: "token", delta: c });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
}

/**
 * Generate a short title for a chat using the LLM (async, fire-and-forget).
 * Called after the first agent response on a new "New Chat".
 */
async function generateChatTitle(AgentConversation, chatId, userMessage, assistantReply = "") {
  try {
    const llm = new ChatOpenAI({
      model: "gpt-4.1-mini",
      temperature: 0.4,
      maxTokens: 30,
      openAIApiKey: process.env.OPENAI_API_KEY,
    });
    const convo = [
      { role: "system", content: "You name chat threads. From the user's first message, write a concise 3-6 word title that captures the topic. No quotes, no trailing punctuation, no prefixes like 'Title:'. Just the title." },
      { role: "user", content: userMessage.slice(0, 500) },
    ];
    // Include the assistant's reply for extra context when we have one.
    if (assistantReply) convo.push({ role: "assistant", content: assistantReply.slice(0, 300) });
    convo.push({ role: "user", content: "Give a short title for this conversation." });
    const result = await llm.invoke(convo);
    const title = (result.content || "").trim().replace(/^["']|["']$/g, "").slice(0, 80) || "New Chat";
    await AgentConversation.findByIdAndUpdate(chatId, { title });
    console.log(`[Auto-title] Chat ${chatId}: "${title}"`);
  } catch (err) {
    // Fallback: use first ~50 chars of the user message
    try {
      const fallback = userMessage.slice(0, 50) + (userMessage.length > 50 ? "…" : "");
      await AgentConversation.findByIdAndUpdate(chatId, { title: fallback });
      console.log(`[Auto-title fallback] Chat ${chatId}: "${fallback}"`);
    } catch { /* ignore */ }
  }
}

/** Find a save_sequence tool result among this turn's messages → surface to the client. */
function extractSequenceResult(messages) {
  for (const m of messages || []) {
    const type = m?.getType?.() || m?._getType?.() || m?.type;
    if (type !== "tool" || m.name !== "save_sequence") continue;
    try {
      const parsed = JSON.parse(typeof m.content === "string" ? m.content : JSON.stringify(m.content));
      if (parsed?.ok && parsed.sequenceId) {
        return { sequenceId: parsed.sequenceId, applied: !!parsed.applied, builderUrl: parsed.builderUrl };
      }
    } catch { /* ignore non-JSON tool output */ }
  }
  return null;
}

/**
 * @param graphs  Either a bare copilot graph (legacy) or { copilot, sequences } where
 *                `sequences` is the { graph, registry, buildSystemPrompt } sub-agent bundle.
 */
export default function createAgentRouter(graphs, models, gridfsBucket) {
  const router = express.Router();
  const { AgentConversation, CreditAccount } = models;

  // Normalize the graphs argument.
  const copilotGraph = graphs?.copilot || graphs;
  const sequencesAgent = graphs?.sequences || null;

  /** "sequences" only when that sub-agent exists AND the client asked for it. */
  function resolveMode(req) {
    return req.body?.mode === "sequences" && sequencesAgent ? "sequences" : "copilot";
  }

  /** Pick the graph + build the per-request `configurable` (registry/prompt/context). */
  async function buildRunContext(mode, userId, req, sse) {
    const base = { models, gridfsBucket, emit: (e) => sse.send(e) };
    if (mode === "sequences") {
      let sequenceContext = null;
      const sid = req.body?.sequenceId;
      if (sid) {
        try {
          const seq = await models.Sequence.findOne({ _id: sid, userId }).lean();
          if (seq) sequenceContext = { id: String(seq._id), name: seq.name, status: seq.status, graph: seq.graph };
        } catch { /* ignore malformed id — build fresh instead */ }
      }
      return {
        graph: sequencesAgent.graph,
        configurable: {
          ...base,
          registry: sequencesAgent.registry,
          buildSystemPrompt: sequencesAgent.buildSystemPrompt,
          sequenceContext,
        },
      };
    }
    return { graph: copilotGraph, configurable: base };
  }

  async function loadConversation(userId, chatId) {
    if (!chatId) {
      // Create a new conversation
      const convo = new AgentConversation({ userId, messages: [] });
      await convo.save();
      return convo;
    }
    const convo = await AgentConversation.findOne({ _id: chatId, userId });
    if (!convo) return null;
    // Sanitize on load: deduplicate, drop orphaned tool/AI messages, fix structure.
    const cleaned = sanitizeMessages(convo.messages);
    if (cleaned.length !== convo.messages.length
      || JSON.stringify(cleaned) !== JSON.stringify(convo.messages)) {
      convo.messages = cleaned;
      convo.markModified("messages");
      await convo.save();
    }
    return convo;
  }

  function trimHistory(convo, max = 80) {
    if (convo.messages.length > max) {
      convo.messages = convo.messages.slice(-max);
    }
  }

  // ─── GET /api/agent/chats — list all chats for user ─────────────────
  router.get("/chats", async (req, res) => {
    try {
      const chats = await AgentConversation.find({ userId: req.userId })
        .select("title updatedAt")
        .sort({ updatedAt: -1 })
        .lean();
      res.json({ chats: chats.map((c) => ({ _id: c._id, title: c.title || "New Chat", updatedAt: c.updatedAt })) });
    } catch (err) {
      console.error("[/agent/chats] error:", err);
      res.status(500).json({ error: "Failed to load chats." });
    }
  });

  // ─── POST /api/agent/chats/new — create a blank chat ────────────────
  router.post("/chats/new", async (req, res) => {
    try {
      const convo = new AgentConversation({ userId: req.userId, messages: [] });
      await convo.save();
      res.json({ _id: convo._id, title: convo.title, updatedAt: convo.updatedAt });
    } catch (err) {
      console.error("[/agent/chats/new] error:", err);
      res.status(500).json({ error: "Failed to create chat." });
    }
  });

  // ─── PATCH /api/agent/chats/:chatId — rename a chat ────────────────
  router.patch("/chats/:chatId", async (req, res) => {
    try {
      const title = String(req.body?.title || "").trim().slice(0, 80);
      if (!title) return res.status(400).json({ error: "Title is required." });
      const convo = await AgentConversation.findOneAndUpdate(
        { _id: req.params.chatId, userId: req.userId },
        { title },
        { new: true },
      );
      if (!convo) return res.status(404).json({ error: "Chat not found." });
      res.json({ _id: convo._id, title: convo.title });
    } catch (err) {
      console.error("[/agent/chats/:chatId PATCH] error:", err);
      res.status(500).json({ error: "Failed to rename chat." });
    }
  });

  // ─── DELETE /api/agent/chats/:chatId — delete a specific chat ───────
  router.delete("/chats/:chatId", async (req, res) => {
    try {
      const result = await AgentConversation.findOneAndDelete({ _id: req.params.chatId, userId: req.userId });
      if (!result) return res.status(404).json({ error: "Chat not found." });
      res.json({ success: true });
    } catch (err) {
      console.error("[/agent/chats/:chatId DELETE] error:", err);
      res.status(500).json({ error: "Failed to delete chat." });
    }
  });

  // ─── POST /api/agent/chat ─────────────────────────────────────────────
  router.post("/chat", async (req, res) => {
    const userId = req.userId;
    const message = String(req.body?.message || "").trim();
    const chatId = req.body?.chatId || null;
    if (!message) return res.status(400).json({ error: "Message is required." });

    let convo = await loadConversation(userId, chatId);
    if (!convo) return res.status(404).json({ error: "Chat not found." });

    const isFirstMessage = convo.messages.length === 0 && convo.title === "New Chat";

    // If a prior confirmation was abandoned, clear it before a fresh turn.
    if (convo.pendingConfirmation) {
      convo.pendingConfirmation = null;
      convo.messages = trimDanglingToolCalls(convo.messages);
    }
    convo.messages.push({ role: "user", content: message, timestamp: new Date() });
    await convo.save();

    // Name the thread from the first message immediately (like ChatGPT/Claude),
    // independent of whether the turn ends in text or a confirmation prompt.
    // Fire-and-forget; the client re-fetches the chat list to pick it up.
    if (isFirstMessage) {
      generateChatTitle(AgentConversation, convo._id, message).catch(() => {});
    }

    const creditInfo = await getBalanceInfo(CreditAccount, userId);

    const sse = openSSE(res);
    sse.send({ type: "start", chatId: convo._id, credits: creditInfo.credits === Infinity ? null : creditInfo.credits });

    try {
      const mode = resolveMode(req);
      const { graph: runGraph, configurable } = await buildRunContext(mode, userId, req, sse);
      const history = convo.messages.map(hydrate).filter(Boolean);
      const { state, tokensSent } = await runGraphStream({
        graph: runGraph,
        input: {
          messages: history,
          userId,
          userTier: creditInfo.tier,
          unlimited: creditInfo.unlimited,
          creditsRemaining: creditInfo.credits === Infinity ? Number.MAX_SAFE_INTEGER : creditInfo.credits,
          approvedToolCallIds: [],
          pendingConfirmation: null,
          insufficientCredits: null,
        },
        configurable,
        sse,
      });

      // Persist any AI / tool messages the graph produced this turn.
      for (const m of state.messages || []) {
        const d = dehydrate(m);
        if (d) convo.messages.push(d);
      }

      let finalText = "";
      const lastStored = convo.messages[convo.messages.length - 1];
      if (lastStored?.role === "assistant" && !(lastStored.toolCalls?.length)) {
        finalText = lastStored.content || "";
      }

      // Handle "insufficient credits" branch — surface a clear message.
      if (state.insufficientCredits) {
        const text = upgradePromptText(creditInfo.tier);
        convo.messages.push({ role: "assistant", content: text, timestamp: new Date() });
        if (!tokensSent) await fakeStream(sse, text);
        convo.pendingConfirmation = null;
        trimHistory(convo);
        await convo.save();
        sse.send({
          type: "done",
          chatId: convo._id,
          response: text,
          creditsRemaining: creditInfo.credits === Infinity ? null : creditInfo.credits,
          pendingConfirmation: null,
        });
        return sse.end();
      }

      // Pending confirmation — surface to user, wait for /confirm.
      if (state.pendingConfirmation) {
        convo.pendingConfirmation = state.pendingConfirmation;
        if (!tokensSent && state.pendingConfirmation.description) {
          await fakeStream(sse, state.pendingConfirmation.description);
        }
        trimHistory(convo);
        await convo.save();
        const fresh = await getBalanceInfo(CreditAccount, userId);
        sse.send({
          type: "done",
          chatId: convo._id,
          response: finalText || state.pendingConfirmation.description,
          pendingConfirmation: state.pendingConfirmation,
          creditsRemaining: fresh.credits === Infinity ? null : fresh.credits,
        });
        return sse.end();
      }

      // Normal turn done.
      convo.pendingConfirmation = null;
      if (!tokensSent && finalText) await fakeStream(sse, finalText);
      trimHistory(convo);
      await convo.save();

      const fresh = await getBalanceInfo(CreditAccount, userId);
      sse.send({
        type: "done",
        chatId: convo._id,
        response: finalText,
        pendingConfirmation: null,
        sequenceResult: extractSequenceResult(state.messages),
        creditsRemaining: fresh.credits === Infinity ? null : fresh.credits,
      });
      sse.end();
    } catch (err) {
      console.error("[/agent/chat] error:", err);
      sse.send({ type: "error", message: err.message || "Agent failed." });
      sse.end();
    }
  });

  // ─── POST /api/agent/confirm ──────────────────────────────────────────
  router.post("/confirm", async (req, res) => {
    const userId = req.userId;
    const confirmed = !!req.body?.confirmed;
    const chatId = req.body?.chatId || null;

    if (!chatId) return res.status(400).json({ error: "chatId is required." });
    const convo = await loadConversation(userId, chatId);
    if (!convo) return res.status(404).json({ error: "Chat not found." });

    const pending = convo.pendingConfirmation;
    if (!pending) return res.status(400).json({ error: "No pending confirmation." });

    const sse = openSSE(res);
    sse.send({ type: "start" });

    if (!confirmed) {
      // Strip the AIMessage with the unanswered tool_call so the model
      // doesn't get re-asked to execute it next turn.
      convo.messages = trimDanglingToolCalls(convo.messages);
      const text = "✋ Cancelled. Nothing was changed.";
      convo.messages.push({ role: "assistant", content: text, timestamp: new Date() });
      convo.pendingConfirmation = null;
      await convo.save();
      await fakeStream(sse, text);
      const fresh = await getBalanceInfo(CreditAccount, userId);
      sse.send({
        type: "done",
        response: text,
        pendingConfirmation: null,
        creditsRemaining: fresh.credits === Infinity ? null : fresh.credits,
      });
      return sse.end();
    }

    try {
      const creditInfo = await getBalanceInfo(CreditAccount, userId);
      const mode = resolveMode(req);
      const { graph: runGraph, configurable } = await buildRunContext(mode, userId, req, sse);
      const history = convo.messages.map(hydrate).filter(Boolean);
      const { state, tokensSent } = await runGraphStream({
        graph: runGraph,
        input: {
          messages: history,
          userId,
          userTier: creditInfo.tier,
          unlimited: creditInfo.unlimited,
          creditsRemaining: creditInfo.credits === Infinity ? Number.MAX_SAFE_INTEGER : creditInfo.credits,
          // Approve EVERY call in the batch at once so one click runs all of
          // them — not one confirmation per call.
          approvedToolCallIds: Array.isArray(pending.calls) && pending.calls.length
            ? pending.calls.map((c) => c.toolCallId)
            : [pending.toolCallId],
          pendingConfirmation: null,
          insufficientCredits: null,
        },
        configurable,
        sse,
      });

      for (const m of state.messages || []) {
        const d = dehydrate(m);
        if (d) convo.messages.push(d);
      }

      let finalText = "";
      const lastStored = convo.messages[convo.messages.length - 1];
      if (lastStored?.role === "assistant" && !(lastStored.toolCalls?.length)) {
        finalText = lastStored.content || "";
      }

      // Confirmation triggered ANOTHER sensitive tool (rare — the LLM
      // decided to chain a second sensitive step). Surface it as well.
      if (state.pendingConfirmation) {
        convo.pendingConfirmation = state.pendingConfirmation;
        if (!tokensSent && state.pendingConfirmation.description) {
          await fakeStream(sse, state.pendingConfirmation.description);
        }
        trimHistory(convo);
        await convo.save();
        const fresh = await getBalanceInfo(CreditAccount, userId);
        sse.send({
          type: "done",
          response: finalText || state.pendingConfirmation.description,
          pendingConfirmation: state.pendingConfirmation,
          creditsRemaining: fresh.credits === Infinity ? null : fresh.credits,
        });
        return sse.end();
      }

      if (state.insufficientCredits) {
        const text = upgradePromptText(creditInfo.tier);
        convo.messages.push({ role: "assistant", content: text, timestamp: new Date() });
        if (!tokensSent) await fakeStream(sse, text);
        convo.pendingConfirmation = null;
        trimHistory(convo);
        await convo.save();
        sse.send({ type: "done", response: text, pendingConfirmation: null });
        return sse.end();
      }

      convo.pendingConfirmation = null;
      if (!tokensSent && finalText) await fakeStream(sse, finalText);
      trimHistory(convo);
      await convo.save();

      const fresh = await getBalanceInfo(CreditAccount, userId);
      sse.send({
        type: "done",
        response: finalText,
        pendingConfirmation: null,
        sequenceResult: extractSequenceResult(state.messages),
        creditsRemaining: fresh.credits === Infinity ? null : fresh.credits,
      });
      sse.end();
    } catch (err) {
      console.error("[/agent/confirm] error:", err);
      sse.send({ type: "error", message: err.message || "Confirmation failed." });
      sse.end();
    }
  });

  // ─── GET /api/agent/history ───────────────────────────────────────────
  router.get("/history", async (req, res) => {
    const chatId = req.query.chatId;
    if (!chatId) return res.json({ messages: [], pendingConfirmation: null });
    const convo = await AgentConversation.findOne({ _id: chatId, userId: req.userId }).lean();
    if (!convo) return res.json({ messages: [], pendingConfirmation: null });
    const cleaned = sanitizeMessages(convo.messages || []);
    res.json({
      messages: cleaned.map((m) => ({
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls || null,
        toolName: m.toolName || null,
        timestamp: m.timestamp,
      })),
      pendingConfirmation: convo.pendingConfirmation || null,
    });
  });

  // ─── DELETE /api/agent/history ────────────────────────────────────────
  router.delete("/history", async (req, res) => {
    const chatId = req.query.chatId;
    if (!chatId) return res.status(400).json({ error: "chatId is required." });
    await AgentConversation.findOneAndUpdate(
      { _id: chatId, userId: req.userId },
      { $set: { messages: [], pendingConfirmation: null } },
      { upsert: false },
    );
    res.json({ success: true });
  });

  // ─── GET /api/agent/credits ───────────────────────────────────────────
  router.get("/credits", async (req, res) => {
    const info = await getBalanceInfo(CreditAccount, req.userId);
    res.json({
      tier: info.tier,
      tierLabel: info.tierLabel,
      price: info.price,
      credits: info.unlimited ? null : info.credits,
      creditsDisplay: info.creditsDisplay,
      monthlyAllocation: info.monthlyAllocation,
      unlimited: info.unlimited,
      totalUsed: info.totalUsed,
      lastRefill: info.lastRefill,
    });
  });

  // ─── GET /api/agent/usage — recent per-action credit breakdown ────────
  router.get("/usage", async (req, res) => {
    try {
      const acct = await CreditAccount
        .findOne({ userId: req.userId })
        .select("history credits monthlyAllocation unlimited totalUsed lastRefill")
        .lean();

      // Newest first, capped to the most recent entries.
      const history = (acct?.history || [])
        .slice(-30)
        .reverse()
        .map((h) => ({ toolName: h.toolName, cost: h.cost, timestamp: h.timestamp }));

      res.json({
        history,
        credits: acct?.unlimited ? null : (acct?.credits ?? 0),
        monthlyAllocation: acct?.monthlyAllocation ?? 0,
        unlimited: !!acct?.unlimited,
        totalUsed: acct?.totalUsed ?? 0,
        lastRefill: acct?.lastRefill ?? null,
      });
    } catch (err) {
      console.error("[/agent/usage] error:", err);
      res.status(500).json({ error: "Failed to load usage." });
    }
  });

  return router;
}
