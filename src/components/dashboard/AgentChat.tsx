import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

interface PendingCall {
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  creditCost: number;
  description: string;
}

interface PendingConfirmation {
  // Batched shape (new)
  batched?: boolean;
  calls?: PendingCall[];
  groups?: { toolName: string; count: number; creditCost: number }[];
  totalCreditCost?: number;
  summary?: string;
  // Legacy single-call mirror (always present)
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

/** What the agent is currently doing — drives the single in-place activity line. */
type Activity =
  | { kind: "thinking" }
  | { kind: "tool"; toolName: string; index: number; total: number }
  | null;

type SseEvent =
  | { type: "start"; chatId?: string; credits?: number | null }
  | { type: "token"; delta: string }
  | { type: "status"; phase: "thinking" }
  | { type: "tools_started" }
  | { type: "tool_progress"; phase: "start" | "done"; index: number; total: number; toolName: string; ok?: boolean }
  | {
      type: "done";
      chatId?: string;
      response?: string;
      pendingConfirmation?: PendingConfirmation | null;
      sequenceResult?: { sequenceId: string; applied: boolean; builderUrl: string } | null;
      creditsRemaining?: number | null;
    }
  | { type: "error"; message?: string };

const STARTERS = [
  { icon: "✦", text: "Show me my dashboard summary" },
  { icon: "❋", text: "Who are my hot leads right now?" },
  { icon: "✉", text: "How many unread messages do I have?" },
  { icon: "❖", text: "List my clients sorted by budget" },
];

const SEQ_STARTERS = [
  { icon: "⚡", text: "Build a new-lead follow-up that texts then emails over 5 days" },
  { icon: "❋", text: "Create a post-showing follow-up that branches on buyer temperature" },
  { icon: "✉", text: "Make a 3-touch nurture drip for warm leads" },
  { icon: "❖", text: "Draft a contract-to-close sequence with deadline reminders" },
];

/* Human-friendly present-tense labels for the activity line (Claude-style). */
const TOOL_LABELS: Record<string, string> = {
  search_clients: "Searching your clients",
  get_client: "Looking up client",
  create_client: "Creating client",
  update_client: "Updating client",
  delete_client: "Deleting client",
  search_contacts: "Searching contacts",
  sync_contacts_from_clients: "Syncing contacts",
  create_contact: "Creating contact",
  update_contact: "Updating contact",
  delete_contact: "Deleting contact",
  sync_gmail: "Syncing Gmail",
  list_conversations: "Loading conversations",
  get_unread_count: "Checking unread messages",
  get_conversation: "Opening conversation",
  mark_conversation_read: "Marking as read",
  send_email: "Sending email",
  send_whatsapp: "Sending WhatsApp",
  delete_message: "Deleting message",
  delete_conversation: "Deleting conversation",
  list_inventory: "Browsing documents",
  get_inventory_item: "Opening item",
  get_breadcrumbs: "Locating folder",
  create_folder: "Creating folder",
  rename_inventory_item: "Renaming item",
  delete_inventory_item: "Deleting item",
  get_dashboard_summary: "Reading your dashboard",
  get_integration_status: "Checking integrations",
  get_gmail_auth_url: "Preparing Gmail link",
  disconnect_gmail: "Disconnecting Gmail",
  disconnect_whatsapp: "Disconnecting WhatsApp",
  get_profile: "Reading your profile",
  update_profile: "Updating profile",
};
function toolLabel(name?: string): string {
  if (!name) return "Working";
  return TOOL_LABELS[name] || name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

interface UsageEntry { toolName: string; cost: number; timestamp: string; }
interface Usage {
  history: UsageEntry[];
  credits: number | null;
  monthlyAllocation: number;
  unlimited: boolean;
  totalUsed: number;
}

function relativeTime(ts: string): string {
  const d = new Date(ts).getTime();
  if (!d) return "";
  const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

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

// ─── Markdown rendering (pure, module-scope so MessageBubble can memoize) ───
function renderInline(text: string, keyPrefix = "i"): React.ReactNode[] {
  const pattern = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(pattern);
  return parts.map((seg, j) => {
    const key = `${keyPrefix}_${j}`;
    if (/^\*\*\*[^*]+\*\*\*$/.test(seg)) return <strong key={key}><em>{seg.slice(3, -3)}</em></strong>;
    if (/^\*\*[^*]+\*\*$/.test(seg)) return <strong key={key}>{seg.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(seg)) return <em key={key}>{seg.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(seg)) return <code key={key}>{seg.slice(1, -1)}</code>;
    const linkMatch = seg.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return <a key={key} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="copilot__link">{linkMatch[1]}</a>;
    }
    return seg ? <span key={key}>{seg}</span> : null;
  }).filter(Boolean);
}

function renderContent(text: string): React.ReactNode {
  if (!text) return null;

  const codeBlockParts = text.split(/(```[\s\S]*?```)/g);

  return codeBlockParts.map((part, codeIdx) => {
    if (/^```[\s\S]*```$/.test(part)) {
      const inner = part.slice(3, -3);
      const firstNewline = inner.indexOf("\n");
      const content = firstNewline > -1 && /^[a-z]*$/.test(inner.slice(0, firstNewline).trim())
        ? inner.slice(firstNewline + 1)
        : inner;
      return <pre key={`cb_${codeIdx}`} className="copilot__code">{content}</pre>;
    }

    const lines = part.split("\n");
    const elements: React.ReactNode[] = [];
    let listBuffer: { type: "ul" | "ol"; items: React.ReactNode[] } | null = null;
    let tableBuffer: string[] | null = null;

    const flushList = () => {
      if (!listBuffer) return;
      const Tag = listBuffer.type === "ul" ? "ul" : "ol";
      elements.push(
        <Tag key={`list_${codeIdx}_${elements.length}`} className={`copilot__${listBuffer.type}`}>
          {listBuffer.items.map((item, li) => (<li key={li}>{item}</li>))}
        </Tag>,
      );
      listBuffer = null;
    };

    const flushTable = () => {
      if (!tableBuffer || tableBuffer.length < 2) { tableBuffer = null; return; }
      const parseRow = (row: string) =>
        row.split("|").map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length);
      const sepIdx = tableBuffer.findIndex((r) => /^\|[\s:]*-{2,}[\s:|]*/.test(r));
      let headerRows: string[] = [];
      let bodyRows: string[] = [];
      if (sepIdx > 0) {
        headerRows = tableBuffer.slice(0, sepIdx);
        bodyRows = tableBuffer.slice(sepIdx + 1);
      } else {
        headerRows = [tableBuffer[0]];
        bodyRows = tableBuffer.slice(1);
      }
      elements.push(
        <div key={`tbl_${codeIdx}_${elements.length}`} className="copilot__table-wrap">
          <table className="copilot__table">
            {headerRows.length > 0 && (
              <thead>
                {headerRows.map((hr, hi) => (
                  <tr key={hi}>
                    {parseRow(hr).map((cell, ci) => (<th key={ci}>{renderInline(cell, `th_${hi}_${ci}`)}</th>))}
                  </tr>
                ))}
              </thead>
            )}
            {bodyRows.length > 0 && (
              <tbody>
                {bodyRows.map((br, bi) => (
                  <tr key={bi}>
                    {parseRow(br).map((cell, ci) => (<td key={ci}>{renderInline(cell, `td_${bi}_${ci}`)}</td>))}
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>,
      );
      tableBuffer = null;
    };

    lines.forEach((line, lineIdx) => {
      const trimmed = line.trim();
      const lineKey = `${codeIdx}_${lineIdx}`;

      if (!trimmed) {
        flushList();
        flushTable();
        if (elements.length > 0) elements.push(<div key={`sp_${lineKey}`} className="copilot__spacer" />);
        return;
      }

      if (/^\|(.+\|)\s*$/.test(trimmed)) {
        flushList();
        if (!tableBuffer) tableBuffer = [];
        tableBuffer.push(trimmed);
        return;
      } else {
        flushTable();
      }

      const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (headingMatch) {
        flushList();
        const level = headingMatch[1].length;
        elements.push(
          <div key={`h_${lineKey}`} className={`copilot__h${level}`}>{renderInline(headingMatch[2], lineKey)}</div>,
        );
        return;
      }

      if (/^[-*]{3,}$/.test(trimmed)) {
        flushList();
        elements.push(<hr key={`hr_${lineKey}`} className="copilot__hr" />);
        return;
      }

      const bqMatch = trimmed.match(/^>\s*(.*)$/);
      if (bqMatch) {
        flushList();
        elements.push(<div key={`bq_${lineKey}`} className="copilot__blockquote">{renderInline(bqMatch[1], lineKey)}</div>);
        return;
      }

      const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
      if (ulMatch) {
        if (!listBuffer || listBuffer.type !== "ul") { flushList(); listBuffer = { type: "ul", items: [] }; }
        listBuffer.items.push(renderInline(ulMatch[1], lineKey));
        return;
      }

      const olMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
      if (olMatch) {
        if (!listBuffer || listBuffer.type !== "ol") { flushList(); listBuffer = { type: "ol", items: [] }; }
        listBuffer.items.push(renderInline(olMatch[1], lineKey));
        return;
      }

      flushList();
      elements.push(<span key={`p_${lineKey}`} className="copilot__line">{renderInline(trimmed, lineKey)}</span>);
    });

    flushList();
    flushTable();
    return <span key={`block_${codeIdx}`}>{elements}</span>;
  });
}

// ─── Memoized message bubble — only the streaming bubble re-renders ────────
const MessageBubble = memo(function MessageBubble({
  role, content, streaming, userInitials,
}: { role: Role; content: string; streaming?: boolean; userInitials: string }) {
  return (
    <div className={`copilot__msg copilot__msg--${role}`}>
      <div className="copilot__msg-avatar">
        {role === "user" ? userInitials : <Sprig size={16} />}
      </div>
      <div className="copilot__msg-body">
        <div className="copilot__msg-bubble">
          {content ? renderContent(content) : <span className="copilot__msg-muted">…</span>}
          {streaming && <span className="copilot__cursor" />}
        </div>
      </div>
    </div>
  );
});

export default function AgentChat({ variant = "page" }: { variant?: "page" | "bubble" }) {
  const { token, user } = useAuth();
  const {
    activeChatId, setActiveChatId, refreshChatList, createNewChat,
    mode, setMode, attachedSequence, setAttachedSequence,
  } = useCopilotChat();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false); // the "+" composer menu
  const plusWrapRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [activity, setActivity] = useState<Activity>(null);
  const [showConfirmItems, setShowConfirmItems] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const usageWrapRef = useRef<HTMLDivElement>(null);
  // Smoothly-revealed text for the in-flight assistant message.
  const [streamingText, setStreamingText] = useState("");

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadedChatRef = useRef<string | null>(null);
  // The chat we're actively sending into. When a brand-new chat is created
  // mid-send, activeChatId changes and would otherwise re-trigger the history
  // load effect — wiping the optimistic user message. This guards against that.
  const inFlightChatRef = useRef<string | null>(null);

  // Streaming reveal buffer (typewriter smoothing)
  const streamTargetRef = useRef("");   // everything received so far
  const streamShownRef = useRef("");     // what's currently revealed
  const rafRef = useRef<number | null>(null);

  // Portal targets in the page header
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTitleSlot(document.getElementById("copilot-title-slot"));
    setActionsSlot(document.getElementById("copilot-actions-slot"));
  }, []);

  // ─── Load history + credits when activeChatId changes ──────────────
  useEffect(() => {
    if (!token) return;

    // Don't reset/reload when activeChatId just caught up to the chat we're
    // already streaming into — that would erase the in-flight conversation.
    if (activeChatId && activeChatId === inFlightChatRef.current) {
      loadedChatRef.current = activeChatId;
      return;
    }

    setMessages([]);
    setPending(null);
    setActivity(null);
    setBusy(false);
    setStreamingText("");
    loadedChatRef.current = activeChatId;

    if (activeChatId) {
      fetch(`/api/agent/history?chatId=${activeChatId}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((d) => {
          if (loadedChatRef.current !== activeChatId) return;
          // If we've since started streaming into this chat (e.g. a brand-new chat created
          // mid-send), this stale/empty history response must NOT clobber the optimistic
          // user message we just added. This is the bubble's "user message vanished" bug.
          if (activeChatId === inFlightChatRef.current) return;
          if (Array.isArray(d?.messages)) {
            setMessages(
              d.messages
                .filter((m: { role: Role; content?: string }) =>
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

  // Cancel any pending animation frame on unmount.
  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  const refreshCredits = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch("/api/agent/credits", { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setCredits(await r.json());
    } catch { /* ignore */ }
  }, [token]);

  const loadUsage = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch("/api/agent/usage", { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setUsage(await r.json());
    } catch { /* ignore */ }
  }, [token]);

  const toggleUsage = () => {
    setUsageOpen((open) => {
      if (!open) loadUsage();
      return !open;
    });
  };

  // Close the usage popover on outside click / Escape.
  useEffect(() => {
    if (!usageOpen) return;
    const onDown = (e: MouseEvent) => {
      if (usageWrapRef.current && !usageWrapRef.current.contains(e.target as Node)) setUsageOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setUsageOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [usageOpen]);

  // Close the "+" composer menu on outside click / Escape.
  useEffect(() => {
    if (!plusOpen) return;
    const onDown = (e: MouseEvent) => {
      if (plusWrapRef.current && !plusWrapRef.current.contains(e.target as Node)) setPlusOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPlusOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [plusOpen]);

  // ─── Auto-scroll ─────────────────────────────────────────────────────
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending, busy, activity, streamingText]);

  // ─── Smooth streaming reveal ─────────────────────────────────────────
  // Tokens land in streamTargetRef; a rAF loop reveals them at a steady
  // cadence so bursts unfurl smoothly instead of dumping all at once.
  const pumpReveal = useCallback(() => {
    if (rafRef.current != null) return;
    const tick = () => {
      const target = streamTargetRef.current;
      const shown = streamShownRef.current;
      if (shown.length >= target.length) { rafRef.current = null; return; }
      const remaining = target.length - shown.length;
      // Reveal a steady minimum, but catch up faster when far behind.
      const step = Math.max(2, Math.ceil(remaining / 8));
      const next = target.slice(0, shown.length + step);
      streamShownRef.current = next;
      setStreamingText(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const appendToken = (delta: string) => {
    const id = streamIdRef.current;
    if (!id) return;
    // First token of the turn — the agent is now writing, so drop the
    // thinking/tool activity line and create the streaming bubble.
    setActivity(null);
    setMessages((prev) => {
      if (prev.some((m) => m.id === id)) return prev;
      return [...prev, { id, role: "assistant", content: "", timestamp: new Date().toISOString(), streaming: true }];
    });
    streamTargetRef.current += delta;
    pumpReveal();
  };

  const finalizeAssistant = (text?: string) => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    const id = streamIdRef.current;
    // Prefer the server's authoritative response if it's longer than what streamed.
    const streamed = streamTargetRef.current;
    const full = text && text.length > streamed.length ? text : streamed;

    streamTargetRef.current = "";
    streamShownRef.current = "";
    setStreamingText("");

    if (!id) {
      if (full) {
        setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: full, timestamp: new Date().toISOString() }]);
      }
      return;
    }
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id);
      if (idx === -1) {
        if (!full) return prev;
        return [...prev, { id, role: "assistant", content: full, timestamp: new Date().toISOString() }];
      }
      const next = [...prev];
      next[idx] = { ...next[idx], content: full, streaming: false, timestamp: new Date().toISOString() };
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

  // Shared SSE event handling for both send + confirm flows.
  const handleEvent = (ev: SseEvent, onDonePending?: (p: PendingConfirmation | null) => void) => {
    switch (ev.type) {
      case "status":
        if (!streamIdRef.current || streamTargetRef.current.length === 0) setActivity({ kind: "thinking" });
        break;
      case "tool_progress":
        if (ev.phase === "start") setActivity({ kind: "tool", toolName: ev.toolName, index: ev.index, total: ev.total });
        break;
      case "token":
        appendToken(ev.delta);
        break;
      case "done":
        finalizeAssistant(ev.response);
        setActivity(null);
        onDonePending?.(ev.pendingConfirmation ?? null);
        // The Sequences sub-agent saved/updated a draft → tell the page (builder reloads,
        // Sequences list refreshes) so the result lands where the user is working.
        if (ev.sequenceResult?.sequenceId) {
          window.dispatchEvent(new CustomEvent("sequence-generated", { detail: ev.sequenceResult }));
        }
        if (ev.creditsRemaining != null && credits) {
          setCredits({ ...credits, credits: ev.creditsRemaining, creditsDisplay: String(ev.creditsRemaining) });
        }
        // Keep the breakdown fresh if the user is watching it.
        if (usageOpen) loadUsage();
        break;
      case "error":
        finalizeAssistant(ev.message || "Something went wrong.");
        setActivity(null);
        break;
    }
  };

  // ─── Send a user message ─────────────────────────────────────────────
  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || busy || !token) return;

    let chatId = activeChatId;
    if (!chatId) {
      chatId = await createNewChat();
      if (!chatId) return;
    }
    // Mark this chat as in-flight BEFORE any setActiveChatId fires, so the
    // history-load effect won't wipe the optimistic messages we add below.
    inFlightChatRef.current = chatId;

    streamIdRef.current = uid();
    streamTargetRef.current = "";
    streamShownRef.current = "";
    setStreamingText("");
    setMessages((prev) => [...prev, { id: uid(), role: "user", content: text, timestamp: new Date().toISOString() }]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setBusy(true);
    setActivity({ kind: "thinking" });
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: text,
          chatId,
          mode,
          sequenceId: mode === "sequences" ? attachedSequence?.id : undefined,
        }),
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      await consumeSSE(res, (ev) => {
        if (ev.type === "start") {
          if (ev.chatId && ev.chatId !== activeChatId) setActiveChatId(ev.chatId);
          return;
        }
        handleEvent(ev, (p) => {
          setShowConfirmItems(false);
          setPending(p);
        });
        if (ev.type === "done") {
          refreshChatList();
          setTimeout(() => refreshChatList(), 3000);
        }
      });
    } catch (e) {
      const msg = e instanceof Error && e.name === "AbortError" ? "Stopped." : "Network error. Try again.";
      finalizeAssistant(msg);
      setActivity(null);
    } finally {
      setBusy(false);
      inFlightChatRef.current = null;
      refreshCredits();
    }
  };

  // ─── Confirm / cancel a pending sensitive action ─────────────────────
  const respondToConfirm = async (confirmed: boolean) => {
    if (!pending || busy || !token || !activeChatId) return;
    streamIdRef.current = uid();
    streamTargetRef.current = "";
    streamShownRef.current = "";
    setStreamingText("");
    setBusy(true);
    setActivity(confirmed ? { kind: "thinking" } : null);
    abortRef.current = new AbortController();

    const snapshot = pending;
    setPending(null);
    setShowConfirmItems(false);

    try {
      const res = await fetch("/api/agent/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          confirmed,
          chatId: activeChatId,
          mode,
          sequenceId: mode === "sequences" ? attachedSequence?.id : undefined,
        }),
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      await consumeSSE(res, (ev) => {
        if (ev.type === "error") {
          finalizeAssistant(ev.message || "Confirmation failed.");
          setActivity(null);
          setPending(snapshot);
          return;
        }
        handleEvent(ev, (p) => setPending(p));
      });
    } catch {
      finalizeAssistant("Network error during confirmation.");
      setActivity(null);
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
    setActivity(null);
  };

  // ─── Input affordances ───────────────────────────────────────────────
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
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

  // Derived confirmation display values
  const confirmCalls = pending?.calls ?? (pending ? [{
    toolCallId: pending.toolCallId, toolName: pending.toolName,
    toolArgs: pending.toolArgs, creditCost: pending.creditCost, description: pending.description,
  }] : []);
  const confirmCount = confirmCalls.length;
  const confirmCost = pending?.totalCreditCost ?? pending?.creditCost ?? 0;
  const confirmHeadline = confirmCount > 1
    ? (pending?.summary || `${confirmCount} actions`)
    : (pending?.description || "");

  const headerTitle = (
    <>
      <div className="copilot__avatar" aria-hidden><Sprig size={20} /></div>
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
      <div className="copilot__credits-wrap" ref={usageWrapRef}>
        <button
          className="copilot__credits"
          onClick={toggleUsage}
          title="View recent credit usage"
          aria-haspopup="dialog"
          aria-expanded={usageOpen}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
          </svg>
          <span className="copilot__credits-count">{credits?.creditsDisplay ?? "—"}</span>
          {!credits?.unlimited && credits?.monthlyAllocation ? `/${credits.monthlyAllocation}` : ""} credits
          <svg className="copilot__credits-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
               style={{ transform: usageOpen ? "rotate(180deg)" : "none" }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {usageOpen && (
          <div className="copilot__usage-pop" role="dialog" aria-label="Recent credit usage">
            <div className="copilot__usage-head">
              <span className="copilot__usage-title">Recent usage</span>
              <span className="copilot__usage-sub">
                {usage?.unlimited
                  ? `${usage?.totalUsed ?? 0} used · Unlimited`
                  : `${usage ? (usage.monthlyAllocation - (usage.credits ?? 0)) : 0} of ${usage?.monthlyAllocation ?? credits?.monthlyAllocation ?? 0} used this month`}
              </span>
            </div>
            {usage && usage.history.length > 0 ? (
              <ul className="copilot__usage-list">
                {usage.history.map((h, i) => (
                  <li key={i} className="copilot__usage-item">
                    <span className="copilot__usage-label">{toolLabel(h.toolName)}</span>
                    <span className="copilot__usage-time">{relativeTime(h.timestamp)}</span>
                    <span className="copilot__usage-cost">−{h.cost}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="copilot__usage-empty">
                {usage ? "No actions yet — credits are spent when the Copilot runs a tool." : "Loading…"}
              </div>
            )}
          </div>
        )}
      </div>
      <button className="copilot__clear-btn" onClick={clearAll} title="Clear conversation" aria-label="Clear conversation">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        </svg>
      </button>
    </>
  );

  const seqMode = mode === "sequences";
  const starters = seqMode ? SEQ_STARTERS : STARTERS;

  return (
    <div className={`copilot copilot--${variant}`} id="copilot-chat">
      {titleSlot && createPortal(headerTitle, titleSlot)}
      {actionsSlot && createPortal(headerActions, actionsSlot)}

      {/* ─── Messages ─── */}
      <div className="copilot__messages">
        {messages.length === 0 && !busy ? (
          <div className="copilot__welcome">
            <div className="copilot__welcome-icon" aria-hidden><Sprig size={32} /></div>
            <h2 className="copilot__welcome-title">
              {seqMode ? (
                <>Let's build a <em>sequence</em>.</>
              ) : (
                <>Good to see you{user?.name ? `, ${user.name.split(" ")[0]}` : ""}. <em>How can I help?</em></>
              )}
            </h2>
            <p className="copilot__welcome-desc">
              {seqMode
                ? "Describe the automation you want — I'll assemble it from the block catalog, validate it, and save a draft for you to review."
                : "I can manage clients, send messages, browse documents, run dashboards and more — just ask."}
            </p>
            {variant !== "bubble" && (
              <div className="copilot__suggestions">
                {starters.map((s) => (
                  <button key={s.text} className="copilot__suggestion" onClick={() => send(s.text)}>
                    <span className="copilot__suggestion-icon">{s.icon}</span>{s.text}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="copilot__thread">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                role={m.role}
                content={m.streaming ? streamingText : m.content}
                streaming={m.streaming}
                userInitials={userInitials}
              />
            ))}

            {/* Single in-place activity line (thinking / tool progress) */}
            {activity && (
              <div className="copilot__activity" role="status" aria-live="polite">
                <span className="copilot__activity-orb" aria-hidden />
                <span className="copilot__activity-text">
                  {activity.kind === "thinking" ? "Thinking" : toolLabel(activity.toolName)}
                  {activity.kind === "tool" && activity.total > 1 && (
                    <span className="copilot__activity-count"> · {activity.index} / {activity.total}</span>
                  )}
                </span>
              </div>
            )}

            {/* Batch confirmation card */}
            {pending && !busy && (
              <div className="copilot__confirm" role="dialog" aria-label="Confirmation required">
                <div className="copilot__confirm-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  Confirmation required
                  {confirmCount > 1 ? ` — ${confirmCount} actions` : ` — ${pending.toolName}`}
                  {confirmCost > 0 ? ` · ${confirmCost} credit${confirmCost !== 1 ? "s" : ""}` : ""}
                </div>

                <div className="copilot__confirm-desc">{renderContent(confirmHeadline)}</div>

                {confirmCount > 1 && (
                  <div className="copilot__confirm-batch">
                    <button
                      className="copilot__confirm-toggle"
                      onClick={() => setShowConfirmItems((v) => !v)}
                      aria-expanded={showConfirmItems}
                    >
                      {showConfirmItems ? "Hide" : "Review"} all {confirmCount} items
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                           strokeLinecap="round" strokeLinejoin="round"
                           style={{ transform: showConfirmItems ? "rotate(180deg)" : "none", transition: "transform .2s" }}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {showConfirmItems && (
                      <ol className="copilot__confirm-items">
                        {confirmCalls.map((c, i) => (
                          <li key={c.toolCallId || i} className="copilot__confirm-item">
                            {renderContent(c.description)}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}

                <div className="copilot__confirm-btns">
                  <button className="copilot__confirm-btn copilot__confirm-btn--yes" onClick={() => respondToConfirm(true)}>
                    {confirmCount > 1 ? `Approve all ${confirmCount}` : "Yes, proceed"}
                  </button>
                  <button className="copilot__confirm-btn copilot__confirm-btn--no" onClick={() => respondToConfirm(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* ─── Input ─── */}
      <div className="copilot__input-area">
        {mode === "sequences" && (
          <div className="copilot__chips">
            <span className="copilot__mode-pill">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              Sequences builder
              <button className="copilot__chip-x" onClick={() => setMode("copilot")} title="Exit Sequences builder" aria-label="Exit Sequences builder">✕</button>
            </span>
            {attachedSequence && (
              <span className="copilot__attach-chip" title={attachedSequence.name}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                </svg>
                Editing: <strong>{attachedSequence.name}</strong>
                <button className="copilot__chip-x" onClick={() => setAttachedSequence(null)} title="Detach sequence" aria-label="Detach sequence">✕</button>
              </span>
            )}
          </div>
        )}
        <div className="copilot__input-wrap">
          <div className="copilot__plus-wrap" ref={plusWrapRef}>
            <button
              className={`copilot__plus-btn${plusOpen ? " copilot__plus-btn--open" : ""}`}
              onClick={() => setPlusOpen((v) => !v)}
              title="Tools"
              aria-haspopup="menu"
              aria-expanded={plusOpen}
              aria-label="Composer tools"
              disabled={busy}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            {plusOpen && (
              <div className="copilot__plus-menu" role="menu">
                <button
                  className={`copilot__plus-item${mode === "sequences" ? " copilot__plus-item--active" : ""}`}
                  role="menuitemcheckbox"
                  aria-checked={mode === "sequences"}
                  onClick={() => { setMode(mode === "sequences" ? "copilot" : "sequences"); setPlusOpen(false); }}
                >
                  <span className="copilot__plus-item-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </span>
                  <span className="copilot__plus-item-text">
                    <span className="copilot__plus-item-title">Sequences builder</span>
                    <span className="copilot__plus-item-sub">Design an automation with AI</span>
                  </span>
                  {mode === "sequences" && (
                    <svg className="copilot__plus-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
                <button className="copilot__plus-item copilot__plus-item--soon" disabled>
                  <span className="copilot__plus-item-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                    </svg>
                  </span>
                  <span className="copilot__plus-item-text"><span className="copilot__plus-item-title">Attach image</span></span>
                  <span className="copilot__plus-soon">Soon</span>
                </button>
                <button className="copilot__plus-item copilot__plus-item--soon" disabled>
                  <span className="copilot__plus-item-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" /><polyline points="13 2 13 9 20 9" />
                    </svg>
                  </span>
                  <span className="copilot__plus-item-text"><span className="copilot__plus-item-title">Attach file</span></span>
                  <span className="copilot__plus-soon">Soon</span>
                </button>
              </div>
            )}
          </div>
          <textarea
            ref={inputRef}
            className="copilot__input"
            placeholder={
              pending
                ? "Confirm or cancel above…"
                : mode === "sequences"
                  ? "Describe the sequence…"
                  : "Ask me anything…"
            }
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
