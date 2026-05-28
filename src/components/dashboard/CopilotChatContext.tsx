import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "../AuthContext";

export interface ChatListItem {
  _id: string;
  title: string;
  updatedAt: string;
}

interface CopilotChatState {
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  chatList: ChatListItem[];
  refreshChatList: () => Promise<void>;
  createNewChat: () => Promise<string | null>;
  deleteChat: (id: string) => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;
}

const CopilotChatCtx = createContext<CopilotChatState>({
  activeChatId: null,
  setActiveChatId: () => {},
  chatList: [],
  refreshChatList: async () => {},
  createNewChat: async () => null,
  deleteChat: async () => {},
  renameChat: async () => {},
});

export function useCopilotChat() {
  return useContext(CopilotChatCtx);
}

export function CopilotChatProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const refreshChatList = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch("/api/agent/chats", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data?.chats)) {
        setChatList(data.chats);
      }
    } catch { /* ignore */ }
  }, [token]);

  const createNewChat = useCallback(async () => {
    if (!token) return null;
    try {
      const r = await fetch("/api/agent/chats/new", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return null;
      const data = await r.json();
      if (data?._id) {
        setActiveChatId(data._id);
        await refreshChatList();
        return data._id;
      }
    } catch { /* ignore */ }
    return null;
  }, [token, refreshChatList]);

  const deleteChat = useCallback(async (id: string) => {
    if (!token) return;
    try {
      await fetch(`/api/agent/chats/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      // If we deleted the active chat, switch to the next available
      if (activeChatId === id) {
        setActiveChatId(null);
      }
      await refreshChatList();
    } catch { /* ignore */ }
  }, [token, activeChatId, refreshChatList]);

  const renameChat = useCallback(async (id: string, title: string) => {
    if (!token) return;
    try {
      await fetch(`/api/agent/chats/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title }),
      });
      await refreshChatList();
    } catch { /* ignore */ }
  }, [token, refreshChatList]);

  // Load chat list on mount
  useEffect(() => {
    refreshChatList();
  }, [refreshChatList]);

  // Auto-select the most recent chat if none is active
  useEffect(() => {
    if (!activeChatId && chatList.length > 0) {
      setActiveChatId(chatList[0]._id);
    }
  }, [activeChatId, chatList]);

  return (
    <CopilotChatCtx.Provider
      value={{
        activeChatId,
        setActiveChatId,
        chatList,
        refreshChatList,
        createNewChat,
        deleteChat,
        renameChat,
      }}
    >
      {children}
    </CopilotChatCtx.Provider>
  );
}
