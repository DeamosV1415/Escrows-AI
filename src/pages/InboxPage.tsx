import React, {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../components/AuthContext";
import * as XLSX from "xlsx";
import "./InboxPage.css";

/* WhatsApp self-serve onboarding is gated until Meta business verification
   clears review. Backend (connect/disconnect/webhooks) stays wired up; flip
   to false once approved. Keep in sync with SettingsPage's WHATSAPP_COMING_SOON. */
const WHATSAPP_COMING_SOON = false;

/* ─── Types ─── */

type Channel = "gmail" | "whatsapp" | "sms";

interface Attachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

interface Message {
  id: string;
  text: string;
  sent: boolean;
  time: string;
  subject?: string;
  attachments?: Attachment[];
}

interface Conversation {
  id: string;
  contactName: string;
  contactEmail?: string;
  contactPhone?: string;
  channel: Channel;
  lastMessage: string;
  lastTime: string;
  unread: number;
  priority: boolean;
  messages: Message[];
}

interface TrackedContact {
  id: string;
  name: string;
  email: string;
  phone: string;
  source: "client" | "imported";
  channels: { gmail: boolean; whatsapp: boolean; sms: boolean };
}

const CHANNEL_LABELS: Record<Channel, string> = {
  gmail: "Gmail",
  whatsapp: "WhatsApp",
  sms: "SMS",
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/* ─── Icon components ─── */

const GmailMiniIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

const WhatsAppMiniIcon = () => (
  // Full WhatsApp mark (speech bubble + phone) so it's instantly recognizable.
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
  </svg>
);

const SmsMiniIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  </svg>
);

const channelMiniIcons: Record<Channel, React.ReactNode> = {
  gmail: <GmailMiniIcon />,
  whatsapp: <WhatsAppMiniIcon />,
  sms: <SmsMiniIcon />,
};

/* ═══════════════════════════════════════════════════
   InboxPage Component
   ═══════════════════════════════════════════════════ */

const InboxPage: React.FC = () => {
  const { token } = useAuth();

  /* ─── State ─── */
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<Channel | "all">("all");
  const [showUnread, setShowUnread] = useState(false);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  // Conversation id requested by the global header search, opened once it loads.
  const [pendingConvId, setPendingConvId] = useState<string | null>(null);
  const location = useLocation();
  const [replyText, setReplyText] = useState("");
  const [subject, setSubject] = useState(""); // Gmail subject line (separate from body)
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showConnectModal, setShowConnectModal] = useState(false);

  // Contacts panel
  const [showContactsPanel, setShowContactsPanel] = useState(false);
  const [contactsTab, setContactsTab] = useState<"tracked" | "import">(
    "tracked",
  );
  const [contactsSearch, setContactsSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<
    "all" | "client" | "imported"
  >("all");
  const [importDragOver, setImportDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    total: number;
    created: number;
    skipped: number;
    errors: string[];
  } | null>(null);
  const [panelWidth, setPanelWidth] = useState(Math.round(window.innerWidth * 0.68));
  const isResizing = useRef(false);

  // Real connection status from API
  const [connections, setConnections] = useState<{
    gmail: { connected: boolean; email: string | null };
    whatsapp: { connected: boolean; phone: string | null };
  }>({
    gmail: { connected: false, email: null },
    whatsapp: { connected: false, phone: null },
  });
  const [connectLoading, setConnectLoading] = useState(false);

  // WhatsApp connect form
  const [showWaForm, setShowWaForm] = useState(false);
  const [waPhoneNumberId, setWaPhoneNumberId] = useState("");
  const [waAccessToken, setWaAccessToken] = useState("");
  const [waError, setWaError] = useState("");

  // Contacts CRUD state
  const [trackedContacts, setTrackedContacts] = useState<TrackedContact[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", email: "", phone: "" });
  const [addError, setAddError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", phone: "" });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Message delete state
  const [deleteMsgId, setDeleteMsgId] = useState<string | null>(null);
  const [deleteConvId, setDeleteConvId] = useState<string | null>(null);
  const [sendingReply, setSendingReply] = useState(false);

  // Draft compose state — for DM button (does NOT add to conversation list)
  const [draftCompose, setDraftCompose] = useState<{
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    channel: Channel;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ─── Fetch connection status ─── */
  const fetchConnectionStatus = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/integrations/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConnections(data);
      }
    } catch (err) {
      console.error("Failed to fetch connection status:", err);
    }
  }, [token]);

  /* ─── Fetch tracked contacts ─── */
  const fetchContacts = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/contacts", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTrackedContacts(
          data.map((c: any) => ({
            id: c._id,
            name: c.name,
            email: c.email,
            phone: c.phone || "",
            source: c.source,
            channels: c.channels || { gmail: false, whatsapp: false, sms: false },
          }))
        );
      }
    } catch (err) {
      console.error("Failed to fetch contacts:", err);
    }
  }, [token]);

  /* ─── Fetch conversations from API ─── */
  const fetchConversations = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/messages/conversations", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConversations((prev) => {
          // Preserve in-memory messages for the currently open chat
          const prevMap = new Map(prev.map((c) => [c.id, c]));
          return data.map((c: any) => {
            const id = c.contactIdentifier || c._id;
            const existing = prevMap.get(id);
            const lastTime = c.lastTime
              ? new Date(c.lastTime).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "";
            return {
              id,
              contactName: c.contactName || c.contactIdentifier || "Unknown",
              contactEmail: c.channel === "gmail" ? c.contactIdentifier : undefined,
              contactPhone: c.channel === "whatsapp" ? c.contactIdentifier : undefined,
              channel: c.channel as Channel,
              lastMessage: c.lastMessage || c.lastSubject || "",
              lastTime,
              unread: c.unreadCount || 0,
              priority: false,
              threadId: c.threadId,
              lastSubject: c.lastSubject || "",
              messages: existing?.messages || [],
            };
          });
        });
      }
    } catch (err) {
      console.error("Failed to fetch conversations:", err);
    }
  }, [token]);

  // Gmail sync — manual only (via Sync button)
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const triggerSync = useCallback(async () => {
    if (!token || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    // Never let the spinner hang on a slow/stalled Gmail call — bail after 30s.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      await fetch("/api/messages/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      await fetchConversations();
    } catch {
      // silently fail (includes the 30s timeout abort)
    } finally {
      clearTimeout(timeout);
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [token, fetchConversations]);

  /* ─── Load (or reload) the messages for one conversation ─── */
  const loadMessages = useCallback(
    async (id: string) => {
      if (!token) return;
      try {
        const res = await fetch(`/api/messages/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const msgs = await res.json();
          const mapped: Message[] = msgs.map((m: any) => ({
            id: m._id,
            text: m.body || "",
            sent: m.direction === "outbound",
            time: m.timestamp
              ? new Date(m.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "",
            subject: m.subject || undefined,
            attachments: m.attachments || [],
          }));
          setConversations((prev) =>
            prev.map((c) => (c.id === id ? { ...c, messages: mapped } : c)),
          );
        }
      } catch (err) {
        console.error("Failed to fetch messages:", err);
      }
    },
    [token],
  );

  useEffect(() => {
    fetchConnectionStatus();
    fetchContacts();
    fetchConversations();
  }, [fetchConnectionStatus, fetchContacts, fetchConversations]);

  /* ─── Poll for new conversations every 60s ─── */
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(fetchConversations, 60000);
    return () => clearInterval(interval);
  }, [token, fetchConversations]);

  /* ─── Pull fresh mail when the inbox opens ─── */
  // The backend auto-syncs on its own clock every few minutes, so we only need a
  // one-off pull on mount here. The manual "Sync" button (triggerSync) remains
  // available for an on-demand pull.
  useEffect(() => {
    if (!token) return;
    triggerSync();
  }, [token, triggerSync]);

  /* ─── Real-time updates via SSE (server pushes new messages live) ─── */
  // Keep a ref to the open chat so the long-lived stream handler always sees the
  // current value without resubscribing on every chat switch.
  const activeChatRef = useRef<string | null>(null);
  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    if (!token) return;
    const es = new EventSource(
      `/api/messages/stream?token=${encodeURIComponent(token)}`,
    );
    es.onmessage = (e) => {
      let evt: { type?: string; contactIdentifier?: string } = {};
      try {
        evt = JSON.parse(e.data);
      } catch {
        return;
      }
      if (evt.type !== "new-message") return;
      // Refresh the conversation list (updates previews, ordering, unread badges).
      fetchConversations();
      // If the affected conversation is open, append the new message live.
      if (evt.contactIdentifier && evt.contactIdentifier === activeChatRef.current) {
        loadMessages(activeChatRef.current);
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 150);
      }
    };
    // On error the browser auto-reconnects (honoring the server's `retry`).
    return () => es.close();
  }, [token, fetchConversations, loadMessages]);

  /* ─── Contacts CRUD ─── */
  const handleAddContact = async () => {
    if (!token || !addForm.name.trim() || !addForm.email.trim()) {
      setAddError("Name and email are required.");
      return;
    }
    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(addForm.email.trim())) {
      setAddError("Please enter a valid email (e.g. name@company.com).");
      return;
    }
    // Phone validation if provided
    if (addForm.phone.trim()) {
      const digits = addForm.phone.replace(/\D/g, "");
      if (digits.length < 7) {
        setAddError("Phone number must have at least 7 digits.");
        return;
      }
    }
    setAddError("");
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchContacts();
        setAddForm({ name: "", email: "", phone: "" });
        setShowAddForm(false);
      } else {
        setAddError(data.error || "Failed to add contact.");
      }
    } catch {
      setAddError("Network error.");
    }
  };

  const handleEditContact = async (id: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/contacts/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        await fetchContacts();
        setEditingId(null);
      }
    } catch (err) {
      console.error("Failed to update contact:", err);
    }
  };

  const handleDeleteContact = async (id: string) => {
    if (!token) return;
    try {
      await fetch(`/api/contacts/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchContacts();
      setDeleteConfirmId(null);
    } catch (err) {
      console.error("Failed to delete contact:", err);
    }
  };

  /* ─── Import contacts from CSV / Excel ─── */
  const processImportFile = async (file: File) => {
    if (!token) return;
    setImporting(true);
    setImportResult(null);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      if (rows.length === 0) {
        setImportResult({ total: 0, created: 0, skipped: 0, errors: ["The file is empty or has no data rows."] });
        setImporting(false);
        return;
      }

      // Normalize header names (case-insensitive, trimmed)
      const normalize = (key: string) => key.trim().toLowerCase().replace(/[^a-z]/g, "");
      const findCol = (row: Record<string, unknown>, ...candidates: string[]) => {
        for (const key of Object.keys(row)) {
          const n = normalize(key);
          if (candidates.some((c) => n === c || n.startsWith(c))) {
            return String(row[key] ?? "").trim();
          }
        }
        return "";
      };

      let created = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = findCol(row, "name", "fullname", "full name", "contactname");
        const email = findCol(row, "email", "emailaddress", "mail");
        const phone = findCol(row, "phone", "phonenumber", "mobile", "tel", "cell");

        if (!name || !email) {
          skipped++;
          if (!name && !email) {
            errors.push(`Row ${i + 2}: Missing name and email — skipped.`);
          } else if (!name) {
            errors.push(`Row ${i + 2}: Missing name — skipped.`);
          } else {
            errors.push(`Row ${i + 2}: Missing email — skipped.`);
          }
          continue;
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(email)) {
          skipped++;
          errors.push(`Row ${i + 2}: Invalid email "${email}" — skipped.`);
          continue;
        }

        try {
          const res = await fetch("/api/contacts", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ name, email, phone }),
          });

          if (res.ok) {
            created++;
          } else if (res.status === 409) {
            skipped++;
          } else {
            const errData = await res.json().catch(() => ({}));
            skipped++;
            errors.push(`Row ${i + 2} (${email}): ${(errData as { error?: string }).error || "Failed"}`);
          }
        } catch {
          skipped++;
          errors.push(`Row ${i + 2} (${email}): Network error.`);
        }
      }

      setImportResult({ total: rows.length, created, skipped, errors: errors.slice(0, 10) });
      if (created > 0) {
        await fetchContacts();
      }
    } catch (err) {
      console.error("Import failed:", err);
      setImportResult({ total: 0, created: 0, skipped: 0, errors: ["Failed to parse file. Make sure it is a valid CSV or Excel file."] });
    } finally {
      setImporting(false);
      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleImportFile = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !["csv", "xlsx", "xls"].includes(ext)) {
      setImportResult({ total: 0, created: 0, skipped: 0, errors: ["Unsupported file format. Please use .csv, .xlsx, or .xls."] });
      return;
    }
    processImportFile(file);
  };

  /* ─── Listen for Gmail OAuth popup message ─── */
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "GMAIL_CONNECTED") {
        fetchConnectionStatus();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [fetchConnectionStatus]);

  /* ─── Deep-link from the global header search ─── */
  useEffect(() => {
    const state = location.state as { conversationId?: string; search?: string } | null;
    if (!state) return;
    if (state.search) setSearch(state.search);
    if (state.conversationId) setPendingConvId(state.conversationId);
    window.history.replaceState({}, ""); // don't re-apply on refresh
  }, [location.state]);

  // Open the requested conversation once it has loaded into the list.
  useEffect(() => {
    if (!pendingConvId) return;
    if (conversations.some((c) => c.id === pendingConvId)) {
      openChat(pendingConvId);
      setPendingConvId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingConvId, conversations]);

  /* ─── Listen for header button events ─── */
  useEffect(() => {
    const onContacts = () => setShowContactsPanel(true);
    const onConnect = () => setShowConnectModal(true);
    window.addEventListener("inbox-contacts", onContacts);
    window.addEventListener("inbox-connect", onConnect);
    return () => {
      window.removeEventListener("inbox-contacts", onContacts);
      window.removeEventListener("inbox-connect", onConnect);
    };
  }, []);

  /* ─── Derived data ─── */
  const filtered = useMemo(() => {
    let list = conversations;
    if (channelFilter !== "all") {
      list = list.filter((c) => c.channel === channelFilter);
    }
    if (showUnread) {
      list = list.filter((c) => c.unread > 0);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.contactName.toLowerCase().includes(q) ||
          c.lastMessage.toLowerCase().includes(q) ||
          (c.contactEmail && c.contactEmail.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [conversations, channelFilter, showUnread, search]);

  const activeConv = conversations.find((c) => c.id === activeChat) || null;

  // Virtual conversation object for draft compose (DM button with no prior conversation)
  const displayConv: Conversation | null = activeConv || (draftCompose ? {
    id:
      draftCompose.channel === "whatsapp"
        ? (draftCompose.contactPhone || "").replace(/\D/g, "")
        : draftCompose.contactEmail,
    contactName: draftCompose.contactName,
    contactEmail: draftCompose.contactEmail,
    contactPhone: draftCompose.contactPhone,
    channel: draftCompose.channel,
    lastMessage: "",
    lastTime: "Now",
    unread: 0,
    priority: false,
    messages: [],
  } : null);

  // Prefill the Gmail subject when switching conversations: keep the thread's subject
  // on a reply, blank for a brand-new compose. Keyed on the conversation id so it does
  // not clobber what the user is typing while staying on the same thread.
  useEffect(() => {
    if (displayConv?.channel === "gmail") {
      setSubject((displayConv as { lastSubject?: string }).lastSubject || "");
    } else {
      setSubject("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayConv?.id, displayConv?.channel]);

  const counts = useMemo(() => {
    return {
      all: conversations.length,
      gmail: conversations.filter((c) => c.channel === "gmail").length,
      whatsapp: conversations.filter((c) => c.channel === "whatsapp").length,
      sms: conversations.filter((c) => c.channel === "sms").length,
      unread: conversations.filter((c) => c.unread > 0).length,
    };
  }, [conversations]);

  // Filtered tracked contacts
  const filteredContacts = useMemo(() => {
    let list = trackedContacts;
    if (sourceFilter !== "all") {
      list = list.filter((c) => c.source === sourceFilter);
    }
    if (contactsSearch.trim()) {
      const q = contactsSearch.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.phone.includes(q),
      );
    }
    return list;
  }, [trackedContacts, contactsSearch, sourceFilter]);

  const sourceCounts = useMemo(
    () => ({
      all: trackedContacts.length,
      client: trackedContacts.filter((c) => c.source === "client").length,
      imported: trackedContacts.filter((c) => c.source === "imported").length,
    }),
    [trackedContacts],
  );

  // Resize handler
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startWidth = panelWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isResizing.current) return;
        const delta = startX - ev.clientX;
        const newWidth = Math.min(
          Math.max(startWidth + delta, 400),
          window.innerWidth * 0.9,
        );
        setPanelWidth(newWidth);
      };

      const onMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [panelWidth],
  );

  /* ─── Handlers ─── */

  const openChat = async (id: string) => {
    setActiveChat(id);
    setDraftCompose(null); // Clear any draft when opening a real conversation
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)),
    );

    // Mark messages as read on the server (persists across refreshes)
    if (token) {
      try {
        await fetch(`/api/messages/read/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // non-critical, continue loading messages
      }
    }

    // Fetch actual messages from API
    if (!token) return;
    await loadMessages(id);

    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  const handleSend = async () => {
    const targetConv = displayConv;
    if (!replyText.trim() || !targetConv || !token) return;
    setSendingReply(true);
    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          contactIdentifier:
            targetConv.channel === "whatsapp"
              ? (targetConv.contactPhone || targetConv.id || "").replace(/\D/g, "")
              : targetConv.contactEmail || targetConv.id,
          body: replyText.trim(),
          channel: targetConv.channel,
          subject:
            targetConv.channel === "gmail"
              ? subject.trim() || (targetConv as any).lastSubject || undefined
              : undefined,
          threadId: (targetConv as any).threadId || undefined,
          contactName: targetConv.contactName,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const sentMsg = data.message;
        const newMsg: Message = {
          id: sentMsg._id || `msg-${Date.now()}`,
          text: sentMsg.body || replyText.trim(),
          sent: true,
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          subject: sentMsg.subject || undefined,
        };

        if (draftCompose) {
          // Draft compose: message sent successfully — refresh conversations and open the new one
          setDraftCompose(null);
          setReplyText("");
          await fetchConversations();
          setActiveChat(
            targetConv.channel === "whatsapp"
              ? (targetConv.contactPhone || targetConv.id || "").replace(/\D/g, "")
              : targetConv.contactEmail || targetConv.id,
          );
        } else {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === activeChat
                ? {
                    ...c,
                    messages: [...c.messages, newMsg],
                    lastMessage: newMsg.text,
                    lastTime: "Just now",
                  }
                : c,
            ),
          );
          setReplyText("");
        }
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 50);
      } else {
        const errData = await res.json().catch(() => ({}));
        console.error("Send failed:", errData.error);
        alert(errData.error || "Failed to send message.");
      }
    } catch (err) {
      console.error("Failed to send message:", err);
      alert("Network error. Please try again.");
    } finally {
      setSendingReply(false);
    }
  };

  /* ─── Start a DM on a specific channel from the contacts panel ───
     Opens the existing conversation for that channel if there is one,
     otherwise drops into a fresh compose draft on the chosen channel. */
  const startDM = (
    contact: { id: string; name: string; email: string; phone: string },
    channel: Channel,
  ) => {
    setShowContactsPanel(false);

    // WhatsApp is keyed by the digits of the phone number (matching the wa_id
    // we store on inbound); Gmail is keyed by the email address.
    const identifier =
      channel === "whatsapp" ? (contact.phone || "").replace(/\D/g, "") : contact.email;
    if (!identifier) return;

    const existingConv = conversations.find((c) => {
      if (c.channel !== channel) return false;
      if (channel === "whatsapp") {
        return ((c.contactPhone || c.id || "").replace(/\D/g, "")) === identifier;
      }
      return c.contactEmail === contact.email || c.id === contact.email;
    });

    if (existingConv) {
      openChat(existingConv.id);
    } else {
      setActiveChat(null);
      setDraftCompose({
        contactName: contact.name,
        contactEmail: contact.email,
        contactPhone: contact.phone,
        channel,
      });
    }
  };

  /* ─── Delete message / conversation ─── */
  const handleDeleteMessage = async (msgId: string) => {
    if (!token || !activeChat) return;
    try {
      const res = await fetch(`/api/messages/${msgId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeChat
              ? { ...c, messages: c.messages.filter((m) => m.id !== msgId) }
              : c,
          ),
        );
        setDeleteMsgId(null);
        // If that was the last message, refresh conversations list
        const conv = conversations.find((c) => c.id === activeChat);
        if (conv && conv.messages.length <= 1) {
          await fetchConversations();
          setActiveChat(null);
        }
      }
    } catch (err) {
      console.error("Failed to delete message:", err);
    }
  };

  const handleDeleteConversation = async (contactIdentifier: string) => {
    if (!token) return;
    try {
      const res = await fetch(
        `/api/messages/conversation/${encodeURIComponent(contactIdentifier)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (res.ok) {
        setActiveChat(null);
        setDeleteConvId(null);
        await fetchConversations();
      }
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /* ─── Gmail Connect / Disconnect ─── */
  const connectGmail = async () => {
    if (!token) return;
    setConnectLoading(true);
    try {
      const res = await fetch("/api/integrations/gmail/auth-url", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.url) {
        // Open OAuth popup
        const popup = window.open(
          data.url,
          "Gmail Authorization",
          "width=600,height=700,left=200,top=100",
        );
        // Poll for popup close (fallback if postMessage doesn't fire)
        const timer = setInterval(() => {
          if (popup?.closed) {
            clearInterval(timer);
            fetchConnectionStatus();
          }
        }, 1000);
      }
    } catch (err) {
      console.error("Failed to get Gmail auth URL:", err);
    } finally {
      setConnectLoading(false);
    }
  };

  const disconnectGmail = async () => {
    if (!token) return;
    setConnectLoading(true);
    try {
      await fetch("/api/integrations/gmail/disconnect", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchConnectionStatus();
    } catch (err) {
      console.error("Failed to disconnect Gmail:", err);
    } finally {
      setConnectLoading(false);
    }
  };

  /* ─── WhatsApp Connect / Disconnect ─── */
  const connectWhatsApp = async () => {
    if (!token || !waPhoneNumberId.trim() || !waAccessToken.trim()) {
      setWaError("Both fields are required.");
      return;
    }
    setConnectLoading(true);
    setWaError("");
    try {
      const res = await fetch("/api/integrations/whatsapp/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          phoneNumberId: waPhoneNumberId.trim(),
          accessToken: waAccessToken.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchConnectionStatus();
        setShowWaForm(false);
        setWaPhoneNumberId("");
        setWaAccessToken("");
      } else {
        setWaError(data.error || "Connection failed.");
      }
    } catch (err) {
      console.error("Failed to connect WhatsApp:", err);
      setWaError("Network error. Please try again.");
    } finally {
      setConnectLoading(false);
    }
  };

  const disconnectWhatsApp = async () => {
    if (!token) return;
    setConnectLoading(true);
    try {
      await fetch("/api/integrations/whatsapp/disconnect", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchConnectionStatus();
    } catch (err) {
      console.error("Failed to disconnect WhatsApp:", err);
    } finally {
      setConnectLoading(false);
    }
  };

  /* ─── Render ─── */
  return (
    <>
    <div className="inbox">
      {/* ── Top Bar ── */}
      <div className="inbox__topbar">
        <div className="inbox__topbar-left">
          <h1 className="inbox__title">Inbox</h1>
          <span className="inbox__subtitle">
            {counts.unread} unread · {counts.all} conversations
          </span>
        </div>
        <div className="inbox__topbar-actions">
          <button
            className="inbox__sync-btn"
            onClick={triggerSync}
            disabled={syncing}
            title="Sync Gmail"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={syncing ? "inbox__sync-icon--spinning" : ""}
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            {syncing ? "Syncing..." : "Sync"}
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div
        className={`inbox__body ${activeChat ? "inbox__body--chat-open" : ""}`}
      >
        {/* ── Left: Chat List ── */}
        <div className="inbox__list">
          <div className="inbox__list-header">
            {/* Search */}
            <div className="inbox__search">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="inbox__search-input"
                placeholder="Search conversations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Filter Pills */}
            <div className="inbox__filters">
              <button
                className={`inbox__filter-pill ${channelFilter === "all" && !showUnread ? "inbox__filter-pill--active" : ""}`}
                onClick={() => {
                  setChannelFilter("all");
                  setShowUnread(false);
                }}
              >
                All
                <span className="inbox__filter-count">{counts.all}</span>
              </button>
              <button
                className={`inbox__filter-pill inbox__filter-pill--gmail ${channelFilter === "gmail" ? "inbox__filter-pill--active" : ""}`}
                onClick={() =>
                  setChannelFilter(channelFilter === "gmail" ? "all" : "gmail")
                }
              >
                Gmail
                <span className="inbox__filter-count">{counts.gmail}</span>
              </button>
              <button
                className={`inbox__filter-pill inbox__filter-pill--whatsapp ${channelFilter === "whatsapp" ? "inbox__filter-pill--active" : ""}`}
                onClick={() =>
                  setChannelFilter(
                    channelFilter === "whatsapp" ? "all" : "whatsapp",
                  )
                }
              >
                WhatsApp
                <span className="inbox__filter-count">{counts.whatsapp}</span>
              </button>
              <button
                className={`inbox__filter-pill inbox__filter-pill--sms ${channelFilter === "sms" ? "inbox__filter-pill--active" : ""}`}
                onClick={() =>
                  setChannelFilter(channelFilter === "sms" ? "all" : "sms")
                }
              >
                SMS
                <span className="inbox__filter-count">{counts.sms}</span>
              </button>
              <button
                className={`inbox__filter-pill inbox__filter-pill--unread ${showUnread ? "inbox__filter-pill--active" : ""}`}
                onClick={() => setShowUnread(!showUnread)}
              >
                Unread
                <span className="inbox__filter-count">{counts.unread}</span>
              </button>
            </div>
          </div>

          {/* Chat Items */}
          <div className="inbox__chats">
            {filtered.length === 0 ? (
              <div
                className="inbox__empty"
                style={{ background: "transparent", padding: "40px 16px" }}
              >
                <p style={{ fontSize: "0.82rem" }}>No conversations found</p>
              </div>
            ) : (
              filtered.map((conv) => (
                <div
                  key={conv.id}
                  className={`inbox__chat-item ${activeChat === conv.id ? "inbox__chat-item--active" : ""} ${conv.unread > 0 ? "inbox__chat-item--unread" : ""}`}
                  onClick={() => openChat(conv.id)}
                >
                  <div
                    className={`inbox__chat-avatar inbox__chat-avatar--${conv.channel}`}
                  >
                    {getInitials(conv.contactName)}
                    <div
                      className={`inbox__avatar-channel inbox__avatar-channel--${conv.channel}`}
                    >
                      {channelMiniIcons[conv.channel]}
                    </div>
                  </div>
                  <div className="inbox__chat-info">
                    <div className="inbox__chat-top">
                      <span className="inbox__chat-name">
                        {conv.contactName}
                      </span>
                      <span className="inbox__chat-time">{conv.lastTime}</span>
                    </div>
                    <div className="inbox__chat-bottom">
                      <span className="inbox__chat-preview">
                        {conv.lastMessage}
                      </span>
                      {conv.unread > 0 && (
                        <span className="inbox__chat-unread-badge">
                          {conv.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Right: Conversation or Empty ── */}
        {displayConv ? (
          <div className="inbox__conversation">
            <div className="inbox__conv-header">
              <div className="inbox__conv-header-left">
                <button
                  className="inbox__mobile-back"
                  onClick={() => { setActiveChat(null); setDraftCompose(null); }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <div
                  className={`inbox__conv-avatar inbox__conv-avatar--${displayConv.channel}`}
                >
                  {getInitials(displayConv.contactName)}
                </div>
                <div className="inbox__conv-info">
                  <h3>{displayConv.contactName}</h3>
                  <div className="inbox__conv-meta">
                    <span
                      className={`inbox__channel-badge inbox__channel-badge--${displayConv.channel}`}
                    >
                      {CHANNEL_LABELS[displayConv.channel]}
                    </span>
                    <span className="inbox__conv-email">
                      {displayConv.contactEmail || displayConv.contactPhone}
                    </span>
                  </div>
                </div>
              </div>
              <div className="inbox__conv-actions">
                  {draftCompose && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--olive-600)', fontWeight: 600, background: 'var(--olive-100)', padding: '4px 10px', borderRadius: '6px', marginRight: '8px' }}>
                      New Message
                    </span>
                  )}
                <button className="inbox__conv-action-btn" title="Star">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>
                <button className="inbox__conv-action-btn" title="Archive">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="21 8 21 21 3 21 3 8" />
                    <rect x="1" y="3" width="22" height="5" />
                    <line x1="10" y1="12" x2="14" y2="12" />
                  </svg>
                </button>
                <button
                  className="inbox__conv-action-btn inbox__conv-action-btn--delete"
                  title="Delete Conversation"
                  onClick={() => setDeleteConvId(displayConv.id)}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="inbox__messages">
              <div className="inbox__date-sep">
                <span>Today</span>
              </div>
              {displayConv.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`inbox__msg inbox__msg--${msg.sent ? "sent" : "received"}`}
                >
                  <div className="inbox__msg-bubble">
                    {msg.subject && (
                      <span className="inbox__msg-subject">{msg.subject}</span>
                    )}
                    {msg.text}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="inbox__msg-attachments">
                        {msg.attachments.map((att, i) => (
                          <a
                            key={i}
                            className="inbox__msg-attachment"
                            href={`/api/messages/${msg.id}/attachment/${att.attachmentId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={async (e) => {
                              e.preventDefault();
                              try {
                                const res = await fetch(
                                  `/api/messages/${msg.id}/attachment/${att.attachmentId}`,
                                  { headers: { Authorization: `Bearer ${token}` } }
                                );
                                const blob = await res.blob();
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = att.filename;
                                a.click();
                                URL.revokeObjectURL(url);
                              } catch {
                                console.error("Download failed");
                              }
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                            </svg>
                            <span className="inbox__attachment-name">{att.filename}</span>
                            <span className="inbox__attachment-size">
                              {att.size > 1048576
                                ? `${(att.size / 1048576).toFixed(1)} MB`
                                : `${Math.round(att.size / 1024)} KB`}
                            </span>
                          </a>
                        ))}
                      </div>
                    )}
                    <button
                      className="inbox__msg-delete-btn"
                      title="Delete message"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteMsgId(msg.id);
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  </div>
                  <span className="inbox__msg-time">{msg.time}</span>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="inbox__composer">
              <div className="inbox__composer-channel">
                <span
                  className={`inbox__composer-channel-dot inbox__composer-channel-dot--${displayConv.channel}`}
                />
                {draftCompose ? 'Composing via' : 'Replying via'} {CHANNEL_LABELS[displayConv.channel]}
                {displayConv.contactEmail && ` · ${displayConv.contactEmail}`}
                {displayConv.contactPhone &&
                  !displayConv.contactEmail &&
                  ` · ${displayConv.contactPhone}`}
              </div>
              {displayConv.channel === "gmail" && (
                <input
                  className="inbox__composer-subject"
                  type="text"
                  placeholder="Subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              )}
              <div className="inbox__composer-row">
                <textarea
                  className="inbox__composer-input"
                  placeholder={`Message ${displayConv.contactName}...`}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                />
                <button
                  className="inbox__send-btn"
                  onClick={handleSend}
                  title="Send"
                  disabled={sendingReply}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="inbox__empty">
            <div className="inbox__empty-icon">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h3>Select a Conversation</h3>
            <p>
              Choose a conversation from the list to view messages and reply
              through the same channel.
            </p>
          </div>
        )}
      </div>

      {/* ═══ Connect Apps Modal ═══ */}
      {showConnectModal && (
        <div
          className="inbox__modal-overlay"
          onClick={() => setShowConnectModal(false)}
        >
          <div className="inbox__modal" onClick={(e) => e.stopPropagation()}>
            <div className="inbox__modal-header">
              <h2>Connect Apps</h2>
              <button
                className="inbox__modal-close"
                onClick={() => setShowConnectModal(false)}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="inbox__modal-body">
              {/* Gmail — Real OAuth */}
              <div className="inbox__connection">
                <div className="inbox__connection-icon inbox__connection-icon--gmail">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </div>
                <div className="inbox__connection-info">
                  <span className="inbox__connection-name">Gmail</span>
                  {connections.gmail.connected ? (
                    <span className="inbox__connection-desc inbox__connection-desc--connected">
                      ✅ Connected as <strong>{connections.gmail.email}</strong>
                    </span>
                  ) : (
                    <span className="inbox__connection-desc">
                      Connect your Google account to send and receive emails
                    </span>
                  )}
                </div>
                {connections.gmail.connected ? (
                  <button
                    className="inbox__disconnect-btn"
                    onClick={disconnectGmail}
                    disabled={connectLoading}
                  >
                    {connectLoading ? "…" : "Disconnect"}
                  </button>
                ) : (
                  <button
                    className="inbox__connect-btn"
                    onClick={connectGmail}
                    disabled={connectLoading}
                  >
                    {connectLoading ? "Connecting…" : "Connect"}
                  </button>
                )}
              </div>
              {/* WhatsApp — Form-based connect */}
              <div className="inbox__connection">
                <div className="inbox__connection-icon inbox__connection-icon--whatsapp">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
                  </svg>
                </div>
                <div className="inbox__connection-info">
                  <span className="inbox__connection-name">
                    WhatsApp
                    {WHATSAPP_COMING_SOON && (
                      <span className="inbox__connection-badge">Coming soon</span>
                    )}
                  </span>
                  {WHATSAPP_COMING_SOON ? (
                    <span className="inbox__connection-desc">
                      Coming soon — we&rsquo;re completing Meta business verification.
                    </span>
                  ) : connections.whatsapp.connected ? (
                    <span className="inbox__connection-desc inbox__connection-desc--connected">
                      ✅ Connected as{" "}
                      <strong>{connections.whatsapp.phone}</strong>
                    </span>
                  ) : (
                    <span className="inbox__connection-desc">
                      Connect WhatsApp Business to message your clients
                    </span>
                  )}
                </div>
                {WHATSAPP_COMING_SOON ? (
                  <button className="inbox__connect-btn" disabled>
                    Coming soon
                  </button>
                ) : connections.whatsapp.connected ? (
                  <button
                    className="inbox__disconnect-btn"
                    onClick={disconnectWhatsApp}
                    disabled={connectLoading}
                  >
                    {connectLoading ? "…" : "Disconnect"}
                  </button>
                ) : (
                  <button
                    className="inbox__connect-btn"
                    onClick={() => {
                      setShowWaForm(!showWaForm);
                      setWaError("");
                    }}
                    disabled={connectLoading}
                  >
                    {showWaForm ? "Cancel" : "Connect"}
                  </button>
                )}
              </div>
              {/* WhatsApp connect form (inline) */}
              {!WHATSAPP_COMING_SOON && showWaForm && !connections.whatsapp.connected && (
                <div className="inbox__wa-form">
                  <p className="inbox__wa-note">
                    💡 Manual setup for now. Once our Meta verification is
                    approved, connecting WhatsApp will take just a couple of
                    clicks — no Phone Number ID or token needed.
                  </p>
                  <input
                    className="inbox__wa-input"
                    type="text"
                    placeholder="Phone Number ID"
                    value={waPhoneNumberId}
                    onChange={(e) => setWaPhoneNumberId(e.target.value)}
                  />
                  <input
                    className="inbox__wa-input"
                    type="password"
                    placeholder="Access Token"
                    value={waAccessToken}
                    onChange={(e) => setWaAccessToken(e.target.value)}
                  />
                  {waError && <p className="inbox__wa-error">{waError}</p>}
                  <button
                    className="inbox__connect-btn inbox__wa-submit"
                    onClick={connectWhatsApp}
                    disabled={connectLoading}
                  >
                    {connectLoading ? "Verifying…" : "Verify & Connect"}
                  </button>
                  <p className="inbox__wa-hint">
                    Get these from your{" "}
                    <a
                      href="https://developers.facebook.com/apps"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Meta Developer Console
                    </a>{" "}
                    → WhatsApp → API Setup
                  </p>
                </div>
              )}
              {/* SMS — Coming Soon */}
              <div className="inbox__connection inbox__connection--disabled">
                <div className="inbox__connection-icon inbox__connection-icon--sms">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                </div>
                <div className="inbox__connection-info">
                  <span className="inbox__connection-name">SMS</span>
                  <span className="inbox__connection-desc">
                    Send and receive text messages via Twilio integration
                  </span>
                </div>
                <span className="inbox__coming-soon-badge">Coming Soon</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Contacts Panel (Slide-out) ═══ */}
      {showContactsPanel && (
        <>
          <div
            className="inbox__contacts-overlay"
            onClick={() => setShowContactsPanel(false)}
          />
          <div className="inbox__contacts-panel" style={{ width: panelWidth }}>
            {/* Resize Handle */}
            <div
              className="inbox__contacts-resize"
              onMouseDown={handleResizeStart}
            />
            {/* Panel Header */}
            <div className="inbox__contacts-header">
              <h2>Contacts</h2>
              <button
                className="inbox__contacts-close"
                onClick={() => setShowContactsPanel(false)}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="inbox__contacts-tabs">
              <button
                className={`inbox__contacts-tab ${contactsTab === "tracked" ? "inbox__contacts-tab--active" : ""}`}
                onClick={() => setContactsTab("tracked")}
              >
                Tracked
                <span className="inbox__contacts-tab-count">
                  {trackedContacts.length}
                </span>
              </button>
              <button
                className={`inbox__contacts-tab ${contactsTab === "import" ? "inbox__contacts-tab--active" : ""}`}
                onClick={() => setContactsTab("import")}
              >
                Import
              </button>
            </div>

            {/* Panel Body */}
            <div className="inbox__contacts-body">
              {contactsTab === "tracked" ? (
                <>
                  {/* Search + Count */}
                  <div className="inbox__contacts-toolbar">
                    <div className="inbox__contacts-search">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <input
                        type="text"
                        placeholder="Search contacts..."
                        value={contactsSearch}
                        onChange={(e) => setContactsSearch(e.target.value)}
                      />
                    </div>
                    <span className="inbox__contacts-count-label">
                      {filteredContacts.length} contact
                      {filteredContacts.length !== 1 ? "s" : ""}
                    </span>
                    <button
                      className="inbox__contacts-add-btn"
                      onClick={() => { setShowAddForm(!showAddForm); setAddError(""); }}
                      title="Add contact"
                    >
                      {showAddForm ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      )}
                    </button>
                  </div>

                  {/* Add Contact Form */}
                  {showAddForm && (
                    <div className="inbox__contacts-add-form">
                      <input
                        type="text"
                        placeholder="Name *"
                        value={addForm.name}
                        onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                        className="inbox__wa-input"
                        required
                      />
                      <input
                        type="email"
                        placeholder="Email *"
                        value={addForm.email}
                        onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                        className="inbox__wa-input"
                        required
                      />
                      <input
                        type="tel"
                        placeholder="Phone (optional)"
                        value={addForm.phone}
                        onChange={(e) => {
                          const cleaned = e.target.value.replace(/[^\d+\-()\s]/g, "");
                          setAddForm({ ...addForm, phone: cleaned });
                        }}
                        className="inbox__wa-input"
                      />
                      {addError && <p className="inbox__wa-error">{addError}</p>}
                      <button className="inbox__connect-btn" onClick={handleAddContact} style={{ width: "100%", padding: "8px" }}>
                        Add Contact
                      </button>
                    </div>
                  )}

                  {/* Source Filter Pills */}
                  <div className="inbox__contacts-filters">
                    <button
                      className={`inbox__contacts-filter-pill ${sourceFilter === "all" ? "inbox__contacts-filter-pill--active" : ""}`}
                      onClick={() => setSourceFilter("all")}
                    >
                      All <span>{sourceCounts.all}</span>
                    </button>
                    <button
                      className={`inbox__contacts-filter-pill inbox__contacts-filter-pill--client ${sourceFilter === "client" ? "inbox__contacts-filter-pill--active" : ""}`}
                      onClick={() => setSourceFilter("client")}
                    >
                      Clients <span>{sourceCounts.client}</span>
                    </button>
                    <button
                      className={`inbox__contacts-filter-pill inbox__contacts-filter-pill--imported ${sourceFilter === "imported" ? "inbox__contacts-filter-pill--active" : ""}`}
                      onClick={() => setSourceFilter("imported")}
                    >
                      Imported <span>{sourceCounts.imported}</span>
                    </button>
                  </div>

                  {/* Contacts Table */}
                  {filteredContacts.length === 0 ? (
                    <div className="inbox__contacts-empty">
                      <svg
                        width="28"
                        height="28"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                      </svg>
                      <p>No contacts match your search</p>
                    </div>
                  ) : (
                    <div className="inbox__contacts-table-wrap">
                    <table className="inbox__contacts-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Phone</th>
                          <th>Source</th>
                          <th>Channels</th>
                          <th style={{ width: "100px" }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredContacts.map((contact) => (
                          <tr key={contact.id}>
                            <td>
                              <div className="inbox__contact-name-cell">
                                <div className="inbox__contact-mini-avatar">
                                  {getInitials(contact.name)}
                                </div>
                                <span className="inbox__contact-name-text">
                                  {contact.name}
                                </span>
                              </div>
                            </td>
                            <td
                              style={{
                                color: "var(--text-secondary)",
                                fontSize: "0.82rem",
                              }}
                            >
                              {contact.email}
                            </td>
                            <td
                              style={{
                                color: "var(--text-muted)",
                                fontSize: "0.82rem",
                              }}
                            >
                              {contact.phone}
                            </td>
                            <td>
                              <span
                                className={`inbox__source-badge inbox__source-badge--${contact.source}`}
                              >
                                {contact.source === "client"
                                  ? "Client"
                                  : "Imported"}
                              </span>
                            </td>
                            <td>
                              {/* Channel dots double as the "message on this channel"
                                  action. A dot is live when the contact has an identifier
                                  for it AND that channel is connected; otherwise it's a
                                  greyed, non-clickable hint. */}
                              <div className="inbox__contact-channels">
                                {(() => {
                                  const gmailReady = !!contact.email && connections.gmail.connected;
                                  const waReady = !!contact.phone && connections.whatsapp.connected;
                                  return (
                                    <>
                                      <div
                                        className={`inbox__contact-channel-dot ${gmailReady ? "inbox__contact-channel-dot--gmail inbox__contact-channel-dot--clickable" : "inbox__contact-channel-dot--inactive"}`}
                                        title={
                                          !contact.email
                                            ? "No email address"
                                            : !connections.gmail.connected
                                            ? "Gmail not connected"
                                            : `Message ${contact.name} on Gmail`
                                        }
                                        role={gmailReady ? "button" : undefined}
                                        onClick={gmailReady ? () => startDM(contact, "gmail") : undefined}
                                      >
                                        <GmailMiniIcon />
                                      </div>
                                      <div
                                        className={`inbox__contact-channel-dot ${waReady ? "inbox__contact-channel-dot--whatsapp inbox__contact-channel-dot--clickable" : "inbox__contact-channel-dot--inactive"}`}
                                        title={
                                          !contact.phone
                                            ? "No phone number"
                                            : !connections.whatsapp.connected
                                            ? "WhatsApp not connected"
                                            : `Message ${contact.name} on WhatsApp`
                                        }
                                        role={waReady ? "button" : undefined}
                                        onClick={waReady ? () => startDM(contact, "whatsapp") : undefined}
                                      >
                                        <WhatsAppMiniIcon />
                                      </div>
                                      <div
                                        className="inbox__contact-channel-dot inbox__contact-channel-dot--inactive"
                                        title="SMS — coming soon"
                                      >
                                        <SmsMiniIcon />
                                      </div>
                                    </>
                                  );
                                })()}
                              </div>
                            </td>
                            <td>
                              <div className="inbox__contact-actions">
                                <button
                                  className="inbox__contact-action-icon"
                                  title="Edit"
                                  onClick={() => {
                                    setEditingId(contact.id);
                                    setEditForm({ name: contact.name, email: contact.email, phone: contact.phone });
                                  }}
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                                  </svg>
                                </button>
                                <button
                                  className="inbox__contact-action-icon inbox__contact-action-icon--delete"
                                  title="Delete"
                                  onClick={() => setDeleteConfirmId(contact.id)}
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                </>
              ) : (
                /* ── Import Tab ── */
                <>
                  {importing ? (
                    <div className="inbox__import-progress">
                      <div className="inbox__import-spinner" />
                      <h4>Importing contacts...</h4>
                      <p>Parsing file and creating contacts. This may take a moment.</p>
                    </div>
                  ) : importResult ? (
                    <div className="inbox__import-result">
                      <div className="inbox__import-result-icon">
                        {importResult.created > 0 ? (
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4caf50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                            <polyline points="22 4 12 14.01 9 11.01" />
                          </svg>
                        ) : (
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f9a825" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                          </svg>
                        )}
                      </div>
                      <h4>{importResult.created > 0 ? "Import Complete" : "Import Finished"}</h4>
                      <div className="inbox__import-stats">
                        <span className="inbox__import-stat inbox__import-stat--created">✅ {importResult.created} created</span>
                        <span className="inbox__import-stat inbox__import-stat--skipped">⏭️ {importResult.skipped} skipped</span>
                        <span className="inbox__import-stat inbox__import-stat--total">📋 {importResult.total} total rows</span>
                      </div>
                      {importResult.errors.length > 0 && (
                        <div className="inbox__import-errors">
                          <strong>Issues:</strong>
                          <ul>
                            {importResult.errors.map((err, i) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <button
                        className="inbox__connect-btn"
                        style={{ marginTop: "14px", padding: "9px 24px" }}
                        onClick={() => { setImportResult(null); setContactsTab("tracked"); }}
                      >
                        View Contacts
                      </button>
                      <button
                        className="inbox__disconnect-btn"
                        style={{ marginTop: "8px", padding: "9px 24px" }}
                        onClick={() => setImportResult(null)}
                      >
                        Import Another File
                      </button>
                    </div>
                  ) : (
                    <>
                      <div
                        className={`inbox__import-zone ${importDragOver ? "inbox__import-zone--dragover" : ""}`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setImportDragOver(true);
                        }}
                        onDragLeave={() => setImportDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setImportDragOver(false);
                          handleImportFile(e.dataTransfer.files);
                        }}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <div className="inbox__import-zone-icon">
                          <svg
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                          </svg>
                        </div>
                        <h4>
                          Drag & drop your file, or <span>browse</span>
                        </h4>
                        <p>Upload a CSV or Excel file with your contacts</p>
                        <div className="inbox__import-formats">
                          <span className="inbox__import-format-tag">.csv</span>
                          <span className="inbox__import-format-tag">.xlsx</span>
                          <span className="inbox__import-format-tag">.xls</span>
                        </div>
                      </div>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        style={{ display: "none" }}
                        onChange={(e) => handleImportFile(e.target.files)}
                      />

                      <div className="inbox__import-note">
                        <strong>Expected columns:</strong> Name, Email, Phone
                        <br />
                        The system will match imported contacts with your client
                        database and begin surfacing their messages in the inbox.
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>

      {/* ═══ Delete Confirmation Modal ═══ */}
      {deleteConfirmId && (
        <div className="inbox__modal-overlay" onClick={() => setDeleteConfirmId(null)}>
          <div className="inbox__modal inbox__modal--sm" onClick={(e) => e.stopPropagation()}>
            <div className="inbox__modal-header">
              <h2>Delete Contact</h2>
              <button className="inbox__modal-close" onClick={() => setDeleteConfirmId(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="inbox__modal-body" style={{ textAlign: "center", padding: "24px" }}>
              <p style={{ marginBottom: "20px", color: "var(--text-secondary)" }}>
                Are you sure you want to delete this contact? This action cannot be undone.
              </p>
              <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
                <button className="inbox__connect-btn" style={{ background: "var(--bg-card)", color: "var(--text-secondary)", border: "1px solid var(--border-light)" }} onClick={() => setDeleteConfirmId(null)}>
                  Cancel
                </button>
                <button className="inbox__connect-btn" style={{ background: "#dc3545", borderColor: "#dc3545" }} onClick={() => handleDeleteContact(deleteConfirmId!)}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Edit Contact Modal ═══ */}
      {editingId && (
        <div className="inbox__modal-overlay" onClick={() => setEditingId(null)}>
          <div className="inbox__modal inbox__modal--sm" onClick={(e) => e.stopPropagation()}>
            <div className="inbox__modal-header">
              <h2>Edit Contact</h2>
              <button className="inbox__modal-close" onClick={() => setEditingId(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="inbox__modal-body" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "16px 20px" }}>
              <input className="inbox__wa-input" type="text" placeholder="Name" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
              <input className="inbox__wa-input" type="email" placeholder="Email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} required />
              <input className="inbox__wa-input" type="tel" placeholder="Phone" value={editForm.phone} onChange={(e) => { const cleaned = e.target.value.replace(/[^\d+\-()\s]/g, ""); setEditForm({ ...editForm, phone: cleaned }); }} />
              <button className="inbox__connect-btn" style={{ width: "100%", padding: "10px", marginTop: "4px" }} onClick={() => handleEditContact(editingId!)}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Delete Message Confirmation Modal ═══ */}
      {deleteMsgId && (
        <div className="inbox__modal-overlay" onClick={() => setDeleteMsgId(null)}>
          <div className="inbox__modal inbox__modal--sm" onClick={(e) => e.stopPropagation()}>
            <div className="inbox__modal-header">
              <h2>Delete Message</h2>
              <button className="inbox__modal-close" onClick={() => setDeleteMsgId(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="inbox__modal-body" style={{ padding: "16px 20px" }}>
              <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", marginBottom: "16px" }}>
                Are you sure you want to delete this message? This action cannot be undone.
              </p>
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button className="inbox__connect-btn" style={{ background: "var(--bg-card)", color: "var(--text-secondary)", border: "1px solid var(--border-light)" }} onClick={() => setDeleteMsgId(null)}>
                  Cancel
                </button>
                <button className="inbox__connect-btn" style={{ background: "#dc3545", borderColor: "#dc3545" }} onClick={() => handleDeleteMessage(deleteMsgId)}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Delete Conversation Confirmation Modal ═══ */}
      {deleteConvId && (
        <div className="inbox__modal-overlay" onClick={() => setDeleteConvId(null)}>
          <div className="inbox__modal inbox__modal--sm" onClick={(e) => e.stopPropagation()}>
            <div className="inbox__modal-header">
              <h2>Delete Conversation</h2>
              <button className="inbox__modal-close" onClick={() => setDeleteConvId(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="inbox__modal-body" style={{ padding: "16px 20px" }}>
              <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", marginBottom: "16px" }}>
                Are you sure you want to delete this entire conversation and all its messages? This action cannot be undone.
              </p>
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button className="inbox__connect-btn" style={{ background: "var(--bg-card)", color: "var(--text-secondary)", border: "1px solid var(--border-light)" }} onClick={() => setDeleteConvId(null)}>
                  Cancel
                </button>
                <button className="inbox__connect-btn" style={{ background: "#dc3545", borderColor: "#dc3545" }} onClick={() => handleDeleteConversation(deleteConvId)}>
                  Delete All
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
export default InboxPage;
