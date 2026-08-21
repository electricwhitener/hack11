'use client';

import { Plus, MessageSquare, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatSession } from './ChatProvider';

/**
 * Persistent conversation list for the sidebar.
 *
 * Deliberately always visible rather than hidden behind an icon: a history
 * drawer nobody opens is the same as no history at all.
 */
export function ConversationList({ onNavigate }: { onNavigate?: () => void }) {
  const { chats, chatId, startNewChat, selectChat, removeChat, status } = useChatSession();
  const busy = status === 'submitted' || status === 'streaming';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          disabled={busy}
          onClick={() => {
            startNewChat();
            onNavigate?.();
          }}
        >
          <Plus className="size-4" />
          New chat
        </Button>
      </div>

      <p className="px-5 pb-1 pt-2 text-xs font-medium text-muted-foreground">Conversations</p>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {chats.length === 0 ? (
          <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">
            Your conversations will appear here once you send a message.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {chats.map((c) => (
              <li key={c.id} className="group relative">
                <button
                  onClick={() => {
                    void selectChat(c.id);
                    onNavigate?.();
                  }}
                  className={`w-full rounded-lg py-2 pl-3 pr-8 text-left text-sm transition-colors ${
                    c.id === chatId
                      ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <MessageSquare className="size-3.5 shrink-0 opacity-60" />
                    <span className="truncate">{c.title}</span>
                  </span>
                </button>
                <button
                  onClick={() => void removeChat(c.id)}
                  aria-label={`Delete "${c.title}"`}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
