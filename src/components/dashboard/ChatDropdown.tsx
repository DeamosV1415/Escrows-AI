import { useRef, useState, useEffect, useCallback } from "react";
import { useCopilotChat, type ChatListItem } from "./CopilotChatContext";
import "./ChatDropdown.css";

function timeAgo(dateStr: string) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ChatDropdown() {
  const {
    activeChatId,
    setActiveChatId,
    chatList,
    createNewChat,
    deleteChat,
    renameChat,
  } = useCopilotChat();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const checkboxRef = useRef<HTMLInputElement>(null);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renamingId]);

  // Close dropdown when clicking outside
  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (checkboxRef.current) checkboxRef.current.checked = false;
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const activeChat = chatList.find((c) => c._id === activeChatId);
  const triggerTitle = activeChat?.title || "New Chat";

  const filtered = search.trim()
    ? chatList.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()))
    : chatList;

  const handleSelect = useCallback((id: string) => {
    setActiveChatId(id);
    setOpen(false);
    if (checkboxRef.current) checkboxRef.current.checked = false;
    setSearch("");
  }, [setActiveChatId]);

  const handleNewChat = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    await createNewChat();
    setOpen(false);
    if (checkboxRef.current) checkboxRef.current.checked = false;
    setSearch("");
  }, [createNewChat]);

  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteChat(id);
  }, [deleteChat]);

  const startRename = useCallback((e: React.MouseEvent, chat: ChatListItem) => {
    e.stopPropagation();
    setRenamingId(chat._id);
    setRenameValue(chat.title);
  }, []);

  const commitRename = useCallback(async () => {
    if (renamingId && renameValue.trim()) {
      await renameChat(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue("");
  }, [renamingId, renameValue, renameChat]);

  const onRenameKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { setRenamingId(null); setRenameValue(""); }
  }, [commitRename]);

  return (
    <div className="chat-dropdown" ref={dropdownRef}>
      <input
        hidden
        className="chat-dropdown__sr-only chat-dropdown__state"
        name="state-chat-dropdown"
        id="state-chat-dropdown"
        type="checkbox"
        ref={checkboxRef}
        checked={open}
        onChange={(e) => setOpen(e.target.checked)}
      />
      <label
        aria-label="Toggle chat list"
        htmlFor="state-chat-dropdown"
        className="chat-dropdown__trigger"
      >
        <span className="chat-dropdown__chevron">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
        <span className="chat-dropdown__trigger-title">{triggerTitle}</span>
        <button
          className="chat-dropdown__trigger-new"
          onClick={handleNewChat}
          title="New chat"
          aria-label="New chat"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </label>

      <div className="chat-dropdown__list">
        {/* Search */}
        <div className="chat-dropdown__search">
          <span className="chat-dropdown__search-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            className="chat-dropdown__search-input"
            type="text"
            placeholder="Search chats…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        {/* Items */}
        <div className="chat-dropdown__items">
          {filtered.length === 0 ? (
            <div className="chat-dropdown__empty">
              {search ? "No chats match your search" : "No chats yet"}
            </div>
          ) : (
            filtered.map((chat) => (
              <div
                key={chat._id}
                className={`chat-dropdown__item${chat._id === activeChatId ? " chat-dropdown__item--active" : ""}`}
                onClick={() => handleSelect(chat._id)}
              >
                <div className="chat-dropdown__item-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                </div>
                <div className="chat-dropdown__item-info">
                  {renamingId === chat._id ? (
                    <input
                      ref={renameRef}
                      className="chat-dropdown__rename-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={onRenameKey}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <span className="chat-dropdown__item-title">{chat.title}</span>
                      <span className="chat-dropdown__item-time">{timeAgo(chat.updatedAt)}</span>
                    </>
                  )}
                </div>
                {renamingId !== chat._id && (
                  <div className="chat-dropdown__item-actions">
                    {/* Rename */}
                    <button
                      className="chat-dropdown__item-action"
                      onClick={(e) => startRename(e, chat)}
                      title="Rename"
                      aria-label="Rename chat"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    {/* Delete */}
                    <button
                      className="chat-dropdown__item-action chat-dropdown__item-action--delete"
                      onClick={(e) => handleDelete(e, chat._id)}
                      title="Delete"
                      aria-label="Delete chat"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* New Chat button at bottom */}
        <button className="chat-dropdown__new-btn" onClick={handleNewChat}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Chat
        </button>
      </div>
    </div>
  );
}
