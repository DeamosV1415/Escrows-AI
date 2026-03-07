import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import "./InboxPage.css";

/* ─── Types ─── */

type Channel = "gmail" | "whatsapp" | "sms";

interface Message {
  id: string;
  text: string;
  sent: boolean;
  time: string;
  subject?: string;
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

/* ─── Mock Data ─── */

const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: "1",
    contactName: "Sarah Mitchell",
    contactEmail: "sarah.m@luxeproperties.com",
    channel: "gmail",
    lastMessage:
      "I'd love to schedule a viewing for the downtown penthouse listing",
    lastTime: "2m ago",
    unread: 2,
    priority: true,
    messages: [
      {
        id: "1a",
        text: "Hi, I saw your listing for the Downtown Skyline Penthouse. Is it still available?",
        sent: false,
        time: "10:15 AM",
      },
      {
        id: "1b",
        text: "Hi Sarah! Yes, the penthouse is still available. Would you like to schedule a viewing?",
        sent: true,
        time: "10:22 AM",
      },
      {
        id: "1c",
        text: "That would be great. I'm particularly interested in the terrace and the building amenities.",
        sent: false,
        time: "10:28 AM",
        subject: "Re: Downtown Skyline Penthouse Viewing",
      },
      {
        id: "1d",
        text: "I'd love to schedule a viewing for the downtown penthouse listing. Are weekends available?",
        sent: false,
        time: "10:30 AM",
      },
    ],
  },
  {
    id: "2",
    contactName: "James Rodriguez",
    contactPhone: "+1 (555) 234-5678",
    channel: "whatsapp",
    lastMessage: "Can we finalize the contract terms this week?",
    lastTime: "15m ago",
    unread: 1,
    priority: true,
    messages: [
      {
        id: "2a",
        text: "Hey, I reviewed the contract draft you sent over.",
        sent: false,
        time: "Yesterday, 4:32 PM",
      },
      {
        id: "2b",
        text: "Great! Any questions or concerns?",
        sent: true,
        time: "Yesterday, 4:45 PM",
      },
      {
        id: "2c",
        text: "Just a couple of minor things regarding the closing timeline. I'll send my notes.",
        sent: false,
        time: "Yesterday, 5:01 PM",
      },
      {
        id: "2d",
        text: "Can we finalize the contract terms this week?",
        sent: false,
        time: "9:48 AM",
      },
    ],
  },
  {
    id: "3",
    contactName: "Emily Chen",
    contactEmail: "emily.chen@gmail.com",
    channel: "gmail",
    lastMessage: "Thanks for the market analysis report. Very thorough!",
    lastTime: "1h ago",
    unread: 0,
    priority: false,
    messages: [
      {
        id: "3a",
        text: "Hi, could you send me the Q4 market analysis for the Westside neighborhood?",
        sent: false,
        time: "Yesterday, 2:10 PM",
        subject: "Market Analysis Request",
      },
      {
        id: "3b",
        text: "Of course! I've attached the full report with comparables and trend projections.",
        sent: true,
        time: "Yesterday, 3:15 PM",
        subject: "Re: Market Analysis Request",
      },
      {
        id: "3c",
        text: "Thanks for the market analysis report. Very thorough!",
        sent: false,
        time: "9:02 AM",
        subject: "Re: Market Analysis Request",
      },
    ],
  },
  {
    id: "4",
    contactName: "Michael Torres",
    contactPhone: "+1 (555) 876-5432",
    channel: "sms",
    lastMessage: "Running 10 min late to the property showing. Sorry!",
    lastTime: "2h ago",
    unread: 0,
    priority: false,
    messages: [
      {
        id: "4a",
        text: "Hi Michael, just confirming our 2 PM showing at 450 Oak Ave today.",
        sent: true,
        time: "12:30 PM",
      },
      {
        id: "4b",
        text: "Confirmed! See you there.",
        sent: false,
        time: "12:45 PM",
      },
      {
        id: "4c",
        text: "Running 10 min late to the property showing. Sorry!",
        sent: false,
        time: "1:50 PM",
      },
      {
        id: "4d",
        text: "No problem at all, I'll wait for you. Take your time!",
        sent: true,
        time: "1:52 PM",
      },
    ],
  },
  {
    id: "5",
    contactName: "Priya Sharma",
    contactPhone: "+1 (555) 345-6789",
    channel: "whatsapp",
    lastMessage:
      "The 3BR in Maple Ridge is perfect. Let's make an offer.",
    lastTime: "3h ago",
    unread: 3,
    priority: true,
    messages: [
      {
        id: "5a",
        text: "I've shortlisted 3 properties from your recommendations.",
        sent: false,
        time: "Yesterday, 11:00 AM",
      },
      {
        id: "5b",
        text: "Excellent! Which ones caught your eye?",
        sent: true,
        time: "Yesterday, 11:15 AM",
      },
      {
        id: "5c",
        text: "The Maple Ridge 3BR, the Downtown loft, and the Riverside condo.",
        sent: false,
        time: "Yesterday, 11:30 AM",
      },
      {
        id: "5d",
        text: "All great choices. I can arrange viewings this week.",
        sent: true,
        time: "Yesterday, 11:45 AM",
      },
      {
        id: "5e",
        text: "We visited Maple Ridge yesterday. It's perfect! Can we discuss an offer strategy?",
        sent: false,
        time: "8:20 AM",
      },
      {
        id: "5f",
        text: "The 3BR in Maple Ridge is perfect. Let's make an offer.",
        sent: false,
        time: "8:22 AM",
      },
    ],
  },
  {
    id: "6",
    contactName: "David Park",
    contactEmail: "david.park@realtycorp.com",
    channel: "gmail",
    lastMessage:
      "Inspection report is attached. A few items need attention.",
    lastTime: "5h ago",
    unread: 1,
    priority: false,
    messages: [
      {
        id: "6a",
        text: "Hi, the home inspection for 1220 Cedar Lane has been completed.",
        sent: false,
        time: "7:00 AM",
        subject: "Inspection Report — 1220 Cedar Lane",
      },
      {
        id: "6b",
        text: "Inspection report is attached. A few items need attention before we proceed.",
        sent: false,
        time: "7:05 AM",
      },
    ],
  },
  {
    id: "7",
    contactName: "Lisa Wang",
    contactPhone: "+1 (555) 901-2345",
    channel: "sms",
    lastMessage:
      "Can you check if there are any new listings in Oakwood?",
    lastTime: "Yesterday",
    unread: 0,
    priority: false,
    messages: [
      {
        id: "7a",
        text: "Hi Lisa! I have a couple of new listings you might like. Want me to send details?",
        sent: true,
        time: "Mon, 3:00 PM",
      },
      {
        id: "7b",
        text: "Yes please! Anything in the $500K-$700K range.",
        sent: false,
        time: "Mon, 3:30 PM",
      },
      {
        id: "7c",
        text: "Can you check if there are any new listings in Oakwood?",
        sent: false,
        time: "Yesterday, 9:15 AM",
      },
    ],
  },
  {
    id: "8",
    contactName: "Robert Kim",
    contactPhone: "+1 (555) 567-8901",
    channel: "whatsapp",
    lastMessage:
      "Sent the signed documents via DocuSign. Please confirm.",
    lastTime: "Yesterday",
    unread: 0,
    priority: false,
    messages: [
      {
        id: "8a",
        text: "The buyer has accepted your counter-offer! Congratulations! 🎉",
        sent: true,
        time: "Sun, 2:00 PM",
      },
      {
        id: "8b",
        text: "That's amazing news! What's the next step?",
        sent: false,
        time: "Sun, 2:15 PM",
      },
      {
        id: "8c",
        text: "I'll send over the purchase agreement for your signature.",
        sent: true,
        time: "Sun, 2:20 PM",
      },
      {
        id: "8d",
        text: "Sent the signed documents via DocuSign. Please confirm.",
        sent: false,
        time: "Yesterday, 10:00 AM",
      },
    ],
  },
];

/* ─── Mock Tracked Contacts ─── */

const MOCK_TRACKED_CONTACTS: TrackedContact[] = [
  {
    id: "tc1",
    name: "Sarah Mitchell",
    email: "sarah.m@luxeproperties.com",
    phone: "+1 (555) 123-4567",
    source: "client",
    channels: { gmail: true, whatsapp: false, sms: false },
  },
  {
    id: "tc2",
    name: "James Rodriguez",
    email: "james.r@outlook.com",
    phone: "+1 (555) 234-5678",
    source: "client",
    channels: { gmail: false, whatsapp: true, sms: false },
  },
  {
    id: "tc3",
    name: "Emily Chen",
    email: "emily.chen@gmail.com",
    phone: "+1 (555) 345-6789",
    source: "client",
    channels: { gmail: true, whatsapp: false, sms: false },
  },
  {
    id: "tc4",
    name: "Michael Torres",
    email: "m.torres@email.com",
    phone: "+1 (555) 876-5432",
    source: "client",
    channels: { gmail: false, whatsapp: false, sms: true },
  },
  {
    id: "tc5",
    name: "Priya Sharma",
    email: "priya.sharma@hotmail.com",
    phone: "+1 (555) 345-6789",
    source: "client",
    channels: { gmail: false, whatsapp: true, sms: false },
  },
  {
    id: "tc6",
    name: "David Park",
    email: "david.park@realtycorp.com",
    phone: "+1 (555) 456-7890",
    source: "imported",
    channels: { gmail: true, whatsapp: false, sms: false },
  },
  {
    id: "tc7",
    name: "Lisa Wang",
    email: "lisa.wang@gmail.com",
    phone: "+1 (555) 901-2345",
    source: "imported",
    channels: { gmail: false, whatsapp: false, sms: true },
  },
  {
    id: "tc8",
    name: "Robert Kim",
    email: "robert.kim@yahoo.com",
    phone: "+1 (555) 567-8901",
    source: "client",
    channels: { gmail: false, whatsapp: true, sms: false },
  },
  {
    id: "tc9",
    name: "Angela Martinez",
    email: "angela.m@protonmail.com",
    phone: "+1 (555) 678-9012",
    source: "imported",
    channels: { gmail: true, whatsapp: true, sms: false },
  },
  {
    id: "tc10",
    name: "Kevin Brooks",
    email: "kevin.b@gmail.com",
    phone: "+1 (555) 789-0123",
    source: "imported",
    channels: { gmail: true, whatsapp: false, sms: true },
  },
  {
    id: "tc11",
    name: "Rachel Green",
    email: "rachel.g@realestate.com",
    phone: "+1 (555) 890-1234",
    source: "client",
    channels: { gmail: true, whatsapp: true, sms: false },
  },
  {
    id: "tc12",
    name: "Tom Henderson",
    email: "tom.h@outlook.com",
    phone: "+1 (555) 012-3456",
    source: "imported",
    channels: { gmail: false, whatsapp: false, sms: true },
  },
];

/* ─── Channel helpers ─── */

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
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

const WhatsAppMiniIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
  </svg>
);

const SmsMiniIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
  /* ─── State ─── */
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<Channel | "all">("all");
  const [showUnread, setShowUnread] = useState(false);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [conversations, setConversations] = useState(MOCK_CONVERSATIONS);
  const [showConnectModal, setShowConnectModal] = useState(false);

  // Contacts panel
  const [showContactsPanel, setShowContactsPanel] = useState(false);
  const [contactsTab, setContactsTab] = useState<"tracked" | "import">("tracked");
  const [contactsSearch, setContactsSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "client" | "imported">("all");
  const [importDragOver, setImportDragOver] = useState(false);
  const [panelWidth, setPanelWidth] = useState(680);
  const isResizing = useRef(false);

  const [connections, setConnections] = useState({
    gmail: true,
    whatsapp: true,
    sms: false,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          (c.contactEmail && c.contactEmail.toLowerCase().includes(q))
      );
    }
    return list;
  }, [conversations, channelFilter, showUnread, search]);

  const activeConv = conversations.find((c) => c.id === activeChat) || null;

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
    let list = MOCK_TRACKED_CONTACTS;
    if (sourceFilter !== "all") {
      list = list.filter((c) => c.source === sourceFilter);
    }
    if (contactsSearch.trim()) {
      const q = contactsSearch.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.phone.includes(q)
      );
    }
    return list;
  }, [contactsSearch, sourceFilter]);

  const sourceCounts = useMemo(() => ({
    all: MOCK_TRACKED_CONTACTS.length,
    client: MOCK_TRACKED_CONTACTS.filter((c) => c.source === "client").length,
    imported: MOCK_TRACKED_CONTACTS.filter((c) => c.source === "imported").length,
  }), []);

  // Resize handler
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = panelWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startX - ev.clientX;
      const newWidth = Math.min(Math.max(startWidth + delta, 400), window.innerWidth * 0.9);
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
  }, [panelWidth]);

  /* ─── Handlers ─── */

  const openChat = (id: string) => {
    setActiveChat(id);
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c))
    );
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  };

  const handleSend = () => {
    if (!replyText.trim() || !activeChat) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const newMsg: Message = {
      id: `msg-${Date.now()}`,
      text: replyText.trim(),
      sent: true,
      time: timeStr,
    };
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeChat
          ? {
              ...c,
              messages: [...c.messages, newMsg],
              lastMessage: newMsg.text,
              lastTime: "Just now",
            }
          : c
      )
    );
    setReplyText("");
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleConnection = (ch: Channel) => {
    setConnections((prev) => ({ ...prev, [ch]: !prev[ch] }));
  };

  /* ─── Render ─── */
  return (
    <div className="inbox">
      {/* ── Top Bar ── */}
      <div className="inbox__topbar">
        <div className="inbox__topbar-left">
          <h1 className="inbox__title">Inbox</h1>
          <span className="inbox__subtitle">
            {counts.unread} unread · {counts.all} conversations
          </span>
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
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                    channelFilter === "whatsapp" ? "all" : "whatsapp"
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
              <div className="inbox__empty" style={{ background: "transparent", padding: "40px 16px" }}>
                <p style={{ fontSize: "0.82rem" }}>No conversations found</p>
              </div>
            ) : (
              filtered.map((conv) => (
                <div
                  key={conv.id}
                  className={`inbox__chat-item ${activeChat === conv.id ? "inbox__chat-item--active" : ""} ${conv.unread > 0 ? "inbox__chat-item--unread" : ""}`}
                  onClick={() => openChat(conv.id)}
                >
                  <div className={`inbox__chat-avatar inbox__chat-avatar--${conv.channel}`}>
                    {getInitials(conv.contactName)}
                    <div className={`inbox__avatar-channel inbox__avatar-channel--${conv.channel}`}>
                      {channelMiniIcons[conv.channel]}
                    </div>
                  </div>
                  <div className="inbox__chat-info">
                    <div className="inbox__chat-top">
                      <span className="inbox__chat-name">{conv.contactName}</span>
                      <span className="inbox__chat-time">{conv.lastTime}</span>
                    </div>
                    <div className="inbox__chat-bottom">
                      <span className="inbox__chat-preview">{conv.lastMessage}</span>
                      {conv.unread > 0 && (
                        <span className="inbox__chat-unread-badge">{conv.unread}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Right: Conversation or Empty ── */}
        {activeConv ? (
          <div className="inbox__conversation">
            <div className="inbox__conv-header">
              <div className="inbox__conv-header-left">
                <button className="inbox__mobile-back" onClick={() => setActiveChat(null)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <div className={`inbox__conv-avatar inbox__conv-avatar--${activeConv.channel}`}>
                  {getInitials(activeConv.contactName)}
                </div>
                <div className="inbox__conv-info">
                  <h3>{activeConv.contactName}</h3>
                  <div className="inbox__conv-meta">
                    <span className={`inbox__channel-badge inbox__channel-badge--${activeConv.channel}`}>
                      {CHANNEL_LABELS[activeConv.channel]}
                    </span>
                    <span className="inbox__conv-email">
                      {activeConv.contactEmail || activeConv.contactPhone}
                    </span>
                  </div>
                </div>
              </div>
              <div className="inbox__conv-actions">
                <button className="inbox__conv-action-btn" title="Star">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>
                <button className="inbox__conv-action-btn" title="Archive">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="21 8 21 21 3 21 3 8" />
                    <rect x="1" y="3" width="22" height="5" />
                    <line x1="10" y1="12" x2="14" y2="12" />
                  </svg>
                </button>
                <button className="inbox__conv-action-btn" title="More">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="1" />
                    <circle cx="19" cy="12" r="1" />
                    <circle cx="5" cy="12" r="1" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="inbox__messages">
              <div className="inbox__date-sep"><span>Today</span></div>
              {activeConv.messages.map((msg) => (
                <div key={msg.id} className={`inbox__msg inbox__msg--${msg.sent ? "sent" : "received"}`}>
                  <div className="inbox__msg-bubble">
                    {msg.subject && <span className="inbox__msg-subject">{msg.subject}</span>}
                    {msg.text}
                  </div>
                  <span className="inbox__msg-time">{msg.time}</span>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="inbox__composer">
              <div className="inbox__composer-channel">
                <span className={`inbox__composer-channel-dot inbox__composer-channel-dot--${activeConv.channel}`} />
                Replying via {CHANNEL_LABELS[activeConv.channel]}
                {activeConv.contactEmail && ` · ${activeConv.contactEmail}`}
                {activeConv.contactPhone && !activeConv.contactEmail && ` · ${activeConv.contactPhone}`}
              </div>
              <div className="inbox__composer-row">
                <textarea
                  className="inbox__composer-input"
                  placeholder={`Message ${activeConv.contactName}...`}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                />
                <button className="inbox__send-btn" onClick={handleSend} title="Send">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h3>Select a Conversation</h3>
            <p>Choose a conversation from the list to view messages and reply through the same channel.</p>
          </div>
        )}
      </div>

      {/* ═══ Connect Apps Modal ═══ */}
      {showConnectModal && (
        <div className="inbox__modal-overlay" onClick={() => setShowConnectModal(false)}>
          <div className="inbox__modal" onClick={(e) => e.stopPropagation()}>
            <div className="inbox__modal-header">
              <h2>Connect Apps</h2>
              <button className="inbox__modal-close" onClick={() => setShowConnectModal(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="inbox__modal-body">
              {/* Gmail */}
              <div className="inbox__connection">
                <div className="inbox__connection-icon inbox__connection-icon--gmail">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </div>
                <div className="inbox__connection-info">
                  <span className="inbox__connection-name">Gmail</span>
                  <span className="inbox__connection-desc">Connect your Google account to send and receive emails</span>
                </div>
                <label className="inbox__toggle">
                  <input type="checkbox" checked={connections.gmail} onChange={() => toggleConnection("gmail")} />
                  <span className="inbox__toggle-slider" />
                </label>
              </div>
              {/* WhatsApp */}
              <div className="inbox__connection">
                <div className="inbox__connection-icon inbox__connection-icon--whatsapp">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
                  </svg>
                </div>
                <div className="inbox__connection-info">
                  <span className="inbox__connection-name">WhatsApp</span>
                  <span className="inbox__connection-desc">Connect WhatsApp Business to message your clients</span>
                </div>
                <label className="inbox__toggle">
                  <input type="checkbox" checked={connections.whatsapp} onChange={() => toggleConnection("whatsapp")} />
                  <span className="inbox__toggle-slider" />
                </label>
              </div>
              {/* SMS */}
              <div className="inbox__connection">
                <div className="inbox__connection-icon inbox__connection-icon--sms">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                </div>
                <div className="inbox__connection-info">
                  <span className="inbox__connection-name">SMS</span>
                  <span className="inbox__connection-desc">Send and receive text messages via Twilio integration</span>
                </div>
                <label className="inbox__toggle">
                  <input type="checkbox" checked={connections.sms} onChange={() => toggleConnection("sms")} />
                  <span className="inbox__toggle-slider" />
                </label>
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                  {MOCK_TRACKED_CONTACTS.length}
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
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                      {filteredContacts.length} contact{filteredContacts.length !== 1 ? "s" : ""}
                    </span>
                  </div>

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
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                      </svg>
                      <p>No contacts match your search</p>
                    </div>
                  ) : (
                    <table className="inbox__contacts-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Phone</th>
                          <th>Source</th>
                          <th>Channels</th>
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
                            <td style={{ color: "var(--text-secondary)", fontSize: "0.82rem" }}>
                              {contact.email}
                            </td>
                            <td style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
                              {contact.phone}
                            </td>
                            <td>
                              <span
                                className={`inbox__source-badge inbox__source-badge--${contact.source}`}
                              >
                                {contact.source === "client" ? "Client" : "Imported"}
                              </span>
                            </td>
                            <td>
                              <div className="inbox__contact-channels">
                                <div
                                  className={`inbox__contact-channel-dot ${contact.channels.gmail ? "inbox__contact-channel-dot--gmail" : "inbox__contact-channel-dot--inactive"}`}
                                  title="Gmail"
                                >
                                  <GmailMiniIcon />
                                </div>
                                <div
                                  className={`inbox__contact-channel-dot ${contact.channels.whatsapp ? "inbox__contact-channel-dot--whatsapp" : "inbox__contact-channel-dot--inactive"}`}
                                  title="WhatsApp"
                                >
                                  <WhatsAppMiniIcon />
                                </div>
                                <div
                                  className={`inbox__contact-channel-dot ${contact.channels.sms ? "inbox__contact-channel-dot--sms" : "inbox__contact-channel-dot--inactive"}`}
                                  title="SMS"
                                >
                                  <SmsMiniIcon />
                                </div>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              ) : (
                /* ── Import Tab ── */
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
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <div className="inbox__import-zone-icon">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
                    onChange={() => {}}
                  />

                  <div className="inbox__import-note">
                    <strong>Expected columns:</strong> Name, Email, Phone
                    <br />
                    The system will match imported contacts with your client
                    database and begin surfacing their messages in the inbox.
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default InboxPage;
