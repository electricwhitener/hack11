'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  listChats,
  loadChat,
  createChat,
  saveChat,
  deleteChat,
  titleFrom,
  type ChatSummary,
} from '@/lib/chatStorage';

/**
 * Owns the conversation: the live message stream AND the saved-chat list.
 *
 * This lives in a provider because two separate parts of the layout need it —
 * the sidebar (which lists and switches conversations) and the chat pane
 * (which renders the active one). Without it they would each hold their own
 * copy and drift apart.
 */
type ChatContextValue = ReturnType<typeof useChat> & {
  chats: ChatSummary[];
  chatId: string | null;
  startNewChat: () => void;
  selectChat: (id: string) => Promise<void>;
  removeChat: (id: string) => Promise<void>;
};

const Ctx = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const chat = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const { messages, setMessages, status } = chat;

  // null until the first message is sent — a conversation row is only created
  // when there is something to put in it, so empty chats never clutter the list.
  const [chatId, setChatId] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);

  async function refreshChats() {
    setChats(await listChats());
  }

  useEffect(() => {
    void refreshChats();
  }, []);

  // Persist once a turn settles. Writing mid-stream would save half-formed
  // messages on every token.
  const saving = useRef(false);
  useEffect(() => {
    if (status !== 'ready' || !messages.length || saving.current) return;

    saving.current = true;
    void (async () => {
      try {
        let id = chatId;
        if (!id) {
          const created = await createChat(titleFrom(messages));
          if (!created) return;
          id = created.id;
          setChatId(id);
        }
        await saveChat(id, messages, titleFrom(messages));
        await refreshChats();
      } finally {
        saving.current = false;
      }
    })();
  }, [messages, status, chatId]);

  function startNewChat() {
    setChatId(null);
    setMessages([]);
  }

  async function selectChat(id: string) {
    const loaded = await loadChat(id);
    if (!loaded) return;
    setChatId(id);
    setMessages(loaded.messages);
  }

  async function removeChat(id: string) {
    await deleteChat(id);
    await refreshChats();
    if (id === chatId) startNewChat();
  }

  return (
    <Ctx.Provider value={{ ...chat, chats, chatId, startNewChat, selectChat, removeChat }}>
      {children}
    </Ctx.Provider>
  );
}

export function useChatSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useChatSession must be used inside <ChatProvider>');
  return ctx;
}
