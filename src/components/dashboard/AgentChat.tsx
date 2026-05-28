import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  { icon: "✦", text: "Show me my dashboard summary" },
  { icon: "❋", text: "Who are my hot leads right now?" },
  { icon: "✉", text: "How many unread messages do I have?" },
  { icon: "❖", text: "List my clients sorted by budget" },
];

/* A small olive sprig — calmer than a generic AI "spark". */
const Sprig = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 21V8" />
    <path d="M12 14c0-3 2-5.5 5-6 0 3-2 5.5-5 6z" />
    <path d="M12 10c0-2.5-1.7-4.6-4.2-5 0 2.5 1.7 4.6 4.2 5z" />
    <path d="M12 17c0-1.8 1.2-3.3 3-3.7 0 1.8-1.2 3.3-3 3.7z" />
  </svg>
);

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

  // Portal targets in the page header — title (left), credits + clear (right)
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTitleSlot(document.getElementById("copilot-title-slot"));
    setActionsSlot(document.getElementById("copilot-actions-slot"));
  }, []);

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
    // Once tokens start arriving, the tool has finished running — hide the loader
    setToolRunning(false);
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

  // ─── Enhanced Markdown renderer ────────────────────────────────────
  const renderInline = (text: string, keyPrefix: string = "i"): React.ReactNode[] => {
    // Process inline patterns: ***bold italic***, **bold**, *italic*, `code`, [link](url)
    const pattern = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
    const parts = text.split(pattern);
    return parts.map((seg, j) => {
      const key = `${keyPrefix}_${j}`;
      // Bold italic ***text***
      if (/^\*\*\*[^*]+\*\*\*$/.test(seg)) {
        return <strong key={key}><em>{seg.slice(3, -3)}</em></strong>;
      }
      // Bold **text**
      if (/^\*\*[^*]+\*\*$/.test(seg)) {
        return <strong key={key}>{seg.slice(2, -2)}</strong>;
      }
      // Italic *text*
      if (/^\*[^*]+\*$/.test(seg)) {
        return <em key={key}>{seg.slice(1, -1)}</em>;
      }
      // Inline code `text`
      if (/^`[^`]+`$/.test(seg)) {
        return <code key={key}>{seg.slice(1, -1)}</code>;
      }
      // Link [text](url)
      const linkMatch = seg.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        return <a key={key} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="copilot__link">{linkMatch[1]}</a>;
      }
      return seg ? <span key={key}>{seg}</span> : null;
    }).filter(Boolean);
  };

  const renderContent = (text: string) => {
    if (!text) return null;

    // Split on code blocks first (```...```)
    const codeBlockParts = text.split(/(```[\s\S]*?```)/g);

    return codeBlockParts.map((part, codeIdx) => {
      // Code block
      if (/^```[\s\S]*```$/.test(part)) {
        const inner = part.slice(3, -3);
        // Remove optional language tag from first line
        const firstNewline = inner.indexOf("\n");
        const content = firstNewline > -1 && /^[a-z]*$/.test(inner.slice(0, firstNewline).trim())
          ? inner.slice(firstNewline + 1)
          : inner;
        return <pre key={`cb_${codeIdx}`} className="copilot__code">{content}</pre>;
      }

      // Normal text — process line by line
      const lines = part.split("\n");
      const elements: React.ReactNode[] = [];
      let listBuffer: { type: "ul" | "ol"; items: React.ReactNode[] } | null = null;

      const flushList = () => {
        if (!listBuffer) return;
        const Tag = listBuffer.type === "ul" ? "ul" : "ol";
        elements.push(
          <Tag key={`list_${codeIdx}_${elements.length}`} className={`copilot__${listBuffer.type}`}>
            {listBuffer.items.map((item, li) => (
              <li key={li}>{item}</li>
            ))}
          </Tag>
        );
        listBuffer = null;
      };

      lines.forEach((line, lineIdx) => {
        const trimmed = line.trim();
        const lineKey = `${codeIdx}_${lineIdx}`;

        // Empty line — flush lists, add spacing
        if (!trimmed) {
          flushList();
          if (elements.length > 0) {
            elements.push(<div key={`sp_${lineKey}`} className="copilot__spacer" />);
          }
          return;
        }

        // Heading: # - ####
        const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
          flushList();
          const level = headingMatch[1].length;
          const headingClass = `copilot__h${level}`;
          elements.push(
            <div key={`h_${lineKey}`} className={headingClass}>
              {renderInline(headingMatch[2], lineKey)}
            </div>
          );
          return;
        }

        // Horizontal rule: --- or ***
        if (/^[-*]{3,}$/.test(trimmed)) {
          flushList();
          elements.push(<hr key={`hr_${lineKey}`} className="copilot__hr" />);
          return;
        }

        // Unordered list: - item or * item
        const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
        if (ulMatch) {
          if (!listBuffer || listBuffer.type !== "ul") {
            flushList();
            listBuffer = { type: "ul", items: [] };
          }
          listBuffer.items.push(renderInline(ulMatch[1], lineKey));
          return;
        }

        // Ordered list: 1. item
        const olMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
        if (olMatch) {
          if (!listBuffer || listBuffer.type !== "ol") {
            flushList();
            listBuffer = { type: "ol", items: [] };
          }
          listBuffer.items.push(renderInline(olMatch[1], lineKey));
          return;
        }

        // Regular paragraph text
        flushList();
        elements.push(
          <span key={`p_${lineKey}`} className="copilot__line">
            {renderInline(trimmed, lineKey)}
          </span>
        );
      });

      flushList();
      return <span key={`block_${codeIdx}`}>{elements}</span>;
    });
  };

  const headerTitle = (
    <>
      <div className="copilot__avatar" aria-hidden>
        <Sprig size={20} />
      </div>
      <div className="copilot__title-group">
        <span className="copilot__title">AI Copilot</span>
        <span className="copilot__subtitle">
          <span className="copilot__status-dot" />
          {credits?.tierLabel || "Free"} plan
        </span>
      </div>
    </>
  );

  const headerActions = (
    <>
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
    </>
  );

  return (
    <div className="copilot" id="copilot-chat">
      {titleSlot && createPortal(headerTitle, titleSlot)}
      {actionsSlot && createPortal(headerActions, actionsSlot)}

      {/* ─── Messages ─── */}
      <div className="copilot__messages">
        {messages.length === 0 && !busy ? (
          <div className="copilot__welcome">
            <div className="copilot__welcome-icon" aria-hidden>
              <Sprig size={32} />
            </div>
            <h2 className="copilot__welcome-title">
              Good to see you{user?.name ? `, ${user.name.split(" ")[0]}` : ""}. <em>How can I help?</em>
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
                  {m.role === "user" ? userInitials : <Sprig size={16} />}
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
              <div className="copilot__msg copilot__msg--assistant">
                <div className="copilot__msg-avatar">
                  <Sprig size={16} />
                </div>
                <div className="copilot__msg-body">
                  <div className="copilot__tool-running" role="status" aria-live="polite">
                    <span className="copilot__spinner" /> Running tool…
                  </div>
                </div>
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
                  <Sprig size={16} />
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
          <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line · Sensitive actions always ask first
        </div>
      </div>
    </div>
  );
}
