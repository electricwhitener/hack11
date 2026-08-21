'use client';

import { useState } from 'react';
import { MessageSquare, X, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Chat } from '@/components/Chat';
import { ChatProvider } from './ChatProvider';
import { ConversationList } from './ConversationList';

/**
 * The agent, docked beside the map instead of on its own page.
 *
 * A separate "Agent" tab meant leaving the map to ask a question about the map,
 * then coming back to see the answer. Questions like "why is this ranked first"
 * only occur while looking at the thing, so the agent belongs next to it.
 *
 * Desktop: a collapsible right-hand column. Mobile: a full-height sheet, since
 * a 384px column and a map cannot share a phone screen.
 */
export function AgentDock() {
  const [open, setOpen] = useState(true);

  return (
    <ChatProvider>
      {/* Desktop dock */}
      <aside
        className={`z-20 hidden shrink-0 flex-col border-l bg-card transition-[width] duration-200 lg:flex ${
          open ? 'w-[380px]' : 'w-12'
        }`}
      >
        {open ? (
          <>
            <div className="flex h-11 shrink-0 items-center gap-1 border-b px-3">
              <MessageSquare className="size-4 text-primary" />
              <span className="text-sm font-medium">Ask about this map</span>
              <div className="ml-auto flex items-center gap-0.5">
                <HistorySheet />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => setOpen(false)}
                  aria-label="Collapse agent"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <Chat />
            </div>
          </>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="flex h-full w-full flex-col items-center gap-2 py-3 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Open agent"
          >
            <MessageSquare className="size-4" />
            <span className="text-[11px] [writing-mode:vertical-rl]">Ask about this map</span>
          </button>
        )}
      </aside>

      {/* Mobile: a button over the map that opens the agent full-height. */}
      <div className="absolute bottom-4 right-4 z-[1200] lg:hidden">
        <Sheet>
          <SheetTrigger render={<Button size="lg" className="rounded-full shadow-lg" />}>
            <MessageSquare className="size-4" />
            Ask
          </SheetTrigger>
          <SheetContent side="bottom" className="flex h-[85dvh] flex-col p-0">
            <SheetTitle className="flex h-12 shrink-0 items-center gap-2 border-b px-4 text-sm font-medium">
              <MessageSquare className="size-4 text-primary" />
              Ask about this map
            </SheetTitle>
            <div className="min-h-0 flex-1">
              <Chat />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </ChatProvider>
  );
}

/** Past conversations, tucked behind an icon rather than given a sidebar. */
function HistorySheet() {
  return (
    <Sheet>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" className="size-7" aria-label="Past conversations" />}
      >
        <History className="size-4" />
      </SheetTrigger>
      <SheetContent side="right" className="flex w-80 flex-col p-0">
        <SheetTitle className="flex h-12 shrink-0 items-center border-b px-4 text-sm font-medium">
          Past conversations
        </SheetTitle>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ConversationList />
        </div>
      </SheetContent>
    </Sheet>
  );
}
