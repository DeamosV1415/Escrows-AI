import express from "express";
import {
  HumanMessage,
  AIMessage,
  ToolMessage,
} from "@langchain/core/messages";
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

export default function createAgentRouter(graph, models, gridfsBucket) {
  const router = express.Router();
  const { AgentConversation, CreditAccount } = models;

  async function loadConversation(userId) {
    let convo = await AgentConversation.findOne({ userId });
    if (!convo) convo = new AgentConversation({ userId, messages: [] });
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

  // ─── POST /api/agent/chat ─────────────────────────────────────────────
  router.post("/chat", async (req, res) => {
    const userId = req.userId;
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "Message is required." });

    const convo = await loadConversation(userId);
    // If a prior confirmation was abandoned, clear it before a fresh turn.
    if (convo.pendingConfirmation) {
      convo.pendingConfirmation = null;
      convo.messages = trimDanglingToolCalls(convo.messages);
    }
    convo.messages.push({ role: "user", content: message, timestamp: new Date() });
    await convo.save();

    const creditInfo = await getBalanceInfo(CreditAccount, userId);

    const sse = openSSE(res);
    sse.send({ type: "start", credits: creditInfo.credits === Infinity ? null : creditInfo.credits });

    try {
      const history = convo.messages.map(hydrate).filter(Boolean);
      const { state, tokensSent } = await runGraphStream({
        graph,
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
        configurable: { models, gridfsBucket },
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
        response: finalText,
        pendingConfirmation: null,
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

    const convo = await loadConversation(userId);
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
      const history = convo.messages.map(hydrate).filter(Boolean);
      const { state, tokensSent } = await runGraphStream({
        graph,
        input: {
          messages: history,
          userId,
          userTier: creditInfo.tier,
          unlimited: creditInfo.unlimited,
          creditsRemaining: creditInfo.credits === Infinity ? Number.MAX_SAFE_INTEGER : creditInfo.credits,
          approvedToolCallIds: [pending.toolCallId],
          pendingConfirmation: null,
          insufficientCredits: null,
        },
        configurable: { models, gridfsBucket },
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
    const convo = await AgentConversation.findOne({ userId: req.userId }).lean();
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
    await AgentConversation.findOneAndUpdate(
      { userId: req.userId },
      { $set: { messages: [], pendingConfirmation: null } },
      { upsert: true },
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

  return router;
}
