'use client';

import { History, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { ChatSession } from '@/lib/chatStorage';

/**
 * Past-conversation switcher. "New chat" starts a fresh thread WITHOUT
 * deleting the current one — this panel is how you get back to it.
 */
export function ChatHistory({
  sessions,
  activeId,
  onSelect,
  onDelete,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Chat history" />}>
        <History className="size-4" />
      </SheetTrigger>

      <SheetContent side="left" className="w-80 p-0">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm">Past conversations</SheetTitle>
        </SheetHeader>

        {sessions.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Nothing saved yet. Conversations appear here once you send a message.
          </p>
        ) : (
          <ScrollArea className="h-[calc(100dvh-3.5rem)]">
            <ul className="divide-y">
              {sessions.map((s) => (
                <li key={s.id} className="group relative">
                  <button
                    onClick={() => onSelect(s.id)}
                    className={`w-full px-4 py-3 text-left transition-colors hover:bg-accent ${
                      s.id === activeId ? 'bg-accent' : ''
                    }`}
                  >
                    <p className="truncate pr-7 text-sm font-medium">{s.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {relativeTime(s.updatedAt)}
                    </p>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(s.id);
                    }}
                    aria-label={`Delete "${s.title}"`}
                    className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}

function relativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
