import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../AuthContext";
import { useCopilotChat } from "./CopilotChatContext";
import "./AgentChat.css";

type Role = "user" | "assistant" | "tool";

interface ToolCall { id: string; name: string; args: Record<string, unknown>; }

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  toolCalls?: ToolCall[] | null;
  toolName?: string | null;
  timestamp: string;
  streaming?: boolean;
}

interface PendingConfirmation {
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  creditCost: number;
  description: string;
}

interface Credits {
  tier: string;
  tierLabel: string;
  price: string;
  credits: number | null;
  creditsDisplay: string;
  monthlyAllocation: number;
  unlimited: boolean;
}

type SseEvent =
  | { type: "start"; chatId?: string; credits?: number | null }
  | { type: "token"; delta: string }
  | { type: "tools_started" }
  | {
      type: "done";
      chatId?: string;
      response?: string;
      pendingConfirmation?: PendingConfirmation | null;
      creditsRemaining?: number | null;
    }
  | { type: "error"; message?: string };

const STARTERS = [
  { icon: "📊", text: "Show me my dashboard summary" },
  { icon: "🔥", text: "Who are my hot leads right now?" },
  { icon: "📧", text: "How many unread messages do I have?" },
  { icon: "👤", text: "List my clients sorted by budget" },
];

function uid() { return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

export default function AgentChat() {
  const { token, user } = useAuth();
  const { activeChatId, setActiveChatId, refreshChatList, createNewChat } = useCopilotChat();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [toolRunning, setToolRunning] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Track the chatId that was used to load history to avoid re-loading
  const loadedChatRef = useRef<string | null>(null);

  // ─── Load history + credits when activeChatId changes ──────────────
  useEffect(() => {
    if (!token) return;

    // Reset state for chat switch
    setMessages([]);
    setPending(null);
    setToolRunning(false);
    setBusy(false);
    loadedChatRef.current = activeChatId;

    if (activeChatId) {
      fetch(`/api/agent/history?chatId=${activeChatId}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((d) => {
          // Guard against stale responses if chat switched again
          if (loadedChatRef.current !== activeChatId) return;
          if (Array.isArray(d?.messages)) {
            setMessages(
              d.messages
                .filter((m: { role: Role; content?: string; toolCalls?: ToolCall[] | null }) =>
                  m.role === "user" || (m.role === "assistant" && (m.content || "").trim().length > 0))
                .map((m: { role: Role; content?: string; toolName?: string; timestamp?: string }) => ({
                  id: uid(),
                  role: m.role,
                  content: m.content || "",
                  toolName: m.toolName || null,
                  timestamp: m.timestamp || new Date().toISOString(),
                })),
            );
          }
          if (d?.pendingConfirmation) setPending(d.pendingConfirmation);
        })
        .catch(() => {});
    }

    refreshCredits();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeChatId]);

  const refreshCredits = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch("/api/agent/credits", { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setCredits(await r.json());
    } catch { /* ignore */ }
  }, [token]);

  // ─── Auto-scroll ─────────────────────────────────────────────────────
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending, busy, toolRunning]);

  // ─── Streaming helpers ───────────────────────────────────────────────
  const appendToken = (delta: string) => {
    const id = streamIdRef.current;
    if (!id) return;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id);
      if (idx === -1) {
        return [...prev, { id, role: "assistant", content: delta, timestamp: new Date().toISOString(), streaming: true }];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], content: (next[idx].content || "") + delta };
      return next;
    });
  };

  const finalizeAssistant = (text?: string) => {
    const id = streamIdRef.current;
    if (!id) {
      if (text) {
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: "assistant", content: text, timestamp: new Date().toISOString() },
        ]);
      }
      return;
    }
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id);
      if (idx === -1) {
        if (!text) return prev;
        return [
          ...prev,
          { id, role: "assistant", content: text, timestamp: new Date().toISOString() },
        ];
      }
      const next = [...prev];
      const cur = next[idx];
      next[idx] = {
        ...cur,
        content: text && text.length > (cur.content || "").length ? text : (cur.content || ""),
        streaming: false,
        timestamp: new Date().toISOString(),
      };
      return next;
    });
    streamIdRef.current = null;
  };

  const consumeSSE = async (res: Response, onEvent: (ev: SseEvent) => void) => {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try { onEvent(JSON.parse(payload) as SseEvent); } catch { /* ignore malformed */ }
      }
    }
  };

  // ─── Send a user message ─────────────────────────────────────────────
  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || busy || !token) return;

    // If no active chat, create one first
    let chatId = activeChatId;
    if (!chatId) {
      chatId = await createNewChat();
      if (!chatId) return;
    }

    streamIdRef.current = uid();
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: "user", content: text, timestamp: new Date().toISOString() },
    ]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setBusy(true);
    setToolRunning(false);
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text, chatId }),
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      await consumeSSE(res, (ev) => {
        switch (ev.type) {
          case "start":
            // If server created a new chat, update our active ID
            if (ev.chatId && ev.chatId !== activeChatId) {
              setActiveChatId(ev.chatId);
            }
            break;
          case "token":          appendToken(ev.delta); break;
          case "tools_started":  setToolRunning(true);  break;
          case "done":
            finalizeAssistant(ev.response);
            setToolRunning(false);
            if (ev.pendingConfirmation) setPending(ev.pendingConfirmation);
            else setPending(null);
            if (ev.creditsRemaining != null && credits) {
              setCredits({ ...credits, credits: ev.creditsRemaining, creditsDisplay: String(ev.creditsRemaining) });
            }
            // Refresh chat list to pick up auto-generated title
            refreshChatList();
            // Delayed re-fetch to catch async AI title generation
            setTimeout(() => refreshChatList(), 3000);
            break;
          case "error":
            finalizeAssistant(ev.message || "Something went wrong.");
            setToolRunning(false);
            break;
        }
      });
    } catch (e) {
      const msg = e instanceof Error && e.name === "AbortError"
        ? "Stopped."
        : "Network error. Try again.";
      finalizeAssistant(msg);
    } finally {
      setBusy(false);
      refreshCredits();
    }
  };

  // ─── Confirm / cancel a pending sensitive action ─────────────────────
  const respondToConfirm = async (confirmed: boolean) => {
    if (!pending || busy || !token || !activeChatId) return;
    streamIdRef.current = uid();
    setBusy(true);
    setToolRunning(false);
    abortRef.current = new AbortController();

    const snapshot = pending;
    setPending(null);

    try {
      const res = await fetch("/api/agent/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirmed, chatId: activeChatId }),
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      await consumeSSE(res, (ev) => {
        switch (ev.type) {
          case "token":          appendToken(ev.delta); break;
          case "tools_started":  setToolRunning(true);  break;
          case "done":
            finalizeAssistant(ev.response);
            setToolRunning(false);
            if (ev.pendingConfirmation) setPending(ev.pendingConfirmation);
            if (ev.creditsRemaining != null && credits) {
              setCredits({ ...credits, credits: ev.creditsRemaining, creditsDisplay: String(ev.creditsRemaining) });
            }
            break;
          case "error":
            finalizeAssistant(ev.message || "Confirmation failed.");
            setToolRunning(false);
            setPending(snapshot);
            break;
        }
      });
    } catch {
      finalizeAssistant("Network error during confirmation.");
      setPending(snapshot);
    } finally {
      setBusy(false);
      refreshCredits();
    }
  };

  const clearAll = async () => {
    if (!token || !activeChatId) return;
    await fetch(`/api/agent/history?chatId=${activeChatId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    setMessages([]);
    setPending(null);
  };

  const stop = () => {
    abortRef.current?.abort();
    setBusy(false);
    setToolRunning(false);
  };

  // ─── Input affordances ───────────────────────────────────────────────
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };
  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const userInitials = useMemo(() => {
    const n = user?.name || "U";
    return n.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
  }, [user?.name]);

  // ─── Markdown-lite renderer (bold, code, line breaks) ─────────────────
  const renderContent = (text: string) => {
    if (!text) return null;
    // Split on triple backticks for code blocks
    const parts = text.split(/```([\s\S]*?)```/g);
    return parts.map((part, idx) => {
      if (idx % 2 === 1) {
        return <pre key={idx} className="copilot__code">{part}</pre>;
      }
      // Inline: **bold** and `code`
      const inline = part.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((seg, j) => {
        if (/^\*\*[^*]+\*\*$/.test(seg)) {
          return <strong key={j}>{seg.slice(2, -2)}</strong>;
        }
        if (/^`[^`]+`$/.test(seg)) {
          return <code key={j}>{seg.slice(1, -1)}</code>;
        }
        return <span key={j}>{seg}</span>;
      });
      // Line breaks
      const lines: React.ReactNode[] = [];
      const splitOnNewlines = (nodes: React.ReactNode[]) => {
        let buf: React.ReactNode[] = [];
        nodes.forEach((n) => {
          if (typeof n === "string" || (n as { type?: string }).type === "span") {
            const txt = typeof n === "string" ? n : (n as { props?: { children?: string } }).props?.children || "";
            const segs = String(txt).split("\n");
            segs.forEach((s, k) => {
              if (k > 0) {
                lines.push(<span key={`l${lines.length}`}>{buf}</span>);
                lines.push(<br key={`br${lines.length}`} />);
                buf = [];
              }
              if (s) buf.push(s);
            });
          } else {
            buf.push(n);
          }
        });
        if (buf.length) lines.push(<span key={`l${lines.length}`}>{buf}</span>);
      };
      splitOnNewlines(inline);
      return <span key={idx}>{lines}</span>;
    });
  };

  return (
    <div className="copilot" id="copilot-chat">
      {/* ─── Header ─── */}
      <header className="copilot__header">
        <div className="copilot__header-left">
          <div className="copilot__avatar" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
            </svg>
          </div>
          <div className="copilot__title-group">
            <span className="copilot__title">AI Copilot</span>
            <span className="copilot__subtitle">
              <span className="copilot__status-dot" />
              {credits?.tierLabel || "Free"} plan
            </span>
          </div>
        </div>
        <div className="copilot__header-right">
          <div className="copilot__credits" title="Credits remaining this month">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span className="copilot__credits-count">{credits?.creditsDisplay ?? "—"}</span>
            {!credits?.unlimited && credits?.monthlyAllocation ? `/${credits.monthlyAllocation}` : ""} credits
          </div>
          <button className="copilot__clear-btn" onClick={clearAll} title="Clear conversation" aria-label="Clear conversation">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      </header>

      {/* ─── Messages ─── */}
      <div className="copilot__messages">
        {messages.length === 0 && !busy ? (
          <div className="copilot__welcome">
            <div className="copilot__welcome-icon" aria-hidden>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
              </svg>
            </div>
            <h2 className="copilot__welcome-title">
              Hi{user?.name ? `, ${user.name.split(" ")[0]}` : ""}! How can I help?
            </h2>
            <p className="copilot__welcome-desc">
              I can manage clients, send messages, browse documents, run dashboards and more — just ask.
            </p>
            <div className="copilot__suggestions">
              {STARTERS.map((s) => (
                <button key={s.text} className="copilot__suggestion" onClick={() => send(s.text)}>
                  <span className="copilot__suggestion-icon">{s.icon}</span>{s.text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <div key={m.id} className={`copilot__msg copilot__msg--${m.role}`}>
                <div className="copilot__msg-avatar">
                  {m.role === "user" ? userInitials : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
                    </svg>
                  )}
                </div>
                <div className="copilot__msg-body">
                  <div className="copilot__msg-bubble">
                    {m.content ? renderContent(m.content) : <span className="copilot__msg-muted">…</span>}
                    {m.streaming && <span className="copilot__cursor" />}
                  </div>
                </div>
              </div>
            ))}

            {toolRunning && (
              <div className="copilot__tool-running" role="status" aria-live="polite">
                <span className="copilot__spinner" /> Running tool…
              </div>
            )}

            {pending && !busy && (
              <div className="copilot__confirm" role="dialog" aria-label="Confirmation required">
                <div className="copilot__confirm-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  Confirmation required — {pending.toolName} ({pending.creditCost} credit{pending.creditCost !== 1 ? "s" : ""})
                </div>
                <div className="copilot__confirm-desc">{renderContent(pending.description)}</div>
                <div className="copilot__confirm-btns">
                  <button className="copilot__confirm-btn copilot__confirm-btn--yes" onClick={() => respondToConfirm(true)}>Yes, proceed</button>
                  <button className="copilot__confirm-btn copilot__confirm-btn--no" onClick={() => respondToConfirm(false)}>Cancel</button>
                </div>
              </div>
            )}

            {busy && !toolRunning && messages[messages.length - 1]?.role === "user" && (
              <div className="copilot__typing">
                <div className="copilot__msg-avatar copilot__msg--assistant">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
                  </svg>
                </div>
                <div className="copilot__typing-dots"><div /><div /><div /></div>
              </div>
            )}
          </>
        )}
        <div ref={endRef} />
      </div>

      {/* ─── Input ─── */}
      <div className="copilot__input-area">
        <div className="copilot__input-wrap">
          <textarea
            ref={inputRef}
            className="copilot__input"
            placeholder={pending ? "Confirm or cancel the pending action above…" : "Ask me anything about your CRM…"}
            value={input}
            onChange={onInput}
            onKeyDown={onKey}
            rows={1}
            disabled={busy || !!pending}
            aria-label="Chat message input"
            id="copilot-input"
          />
          <button className="copilot__voice-btn" title="Voice input — coming soon" disabled aria-label="Voice input coming soon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" /><path d="M19 10v2a7 7 0 01-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
          {busy ? (
            <button className="copilot__send-btn copilot__send-btn--stop" onClick={stop} title="Stop" aria-label="Stop generation">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            </button>
          ) : (
            <button
              className="copilot__send-btn"
              onClick={() => send()}
              disabled={!input.trim() || !!pending}
              title="Send"
              aria-label="Send message"
              id="copilot-send"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
        <div className="copilot__input-hint">
          Press Enter to send · Shift+Enter for a new line · Sensitive actions always ask first
        </div>
      </div>
    </div>
  );
}
