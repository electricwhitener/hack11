'use client';

import { AppShell } from '@/components/layout/AppShell';
import { Chat } from '@/components/Chat';
import { ChatProvider } from './ChatProvider';
import { ConversationList } from './ConversationList';

/**
 * Composes the agent page: the provider must wrap BOTH the sidebar list and
 * the chat pane so they share one conversation state.
 */
export function ChatWorkspace() {
  return (
    <ChatProvider>
      <AppShell title="Agent" sidebarExtra={<ConversationList />}>
        <Chat />
      </AppShell>
    </ChatProvider>
  );
}
