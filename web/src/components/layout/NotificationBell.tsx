'use client';

import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications } from '@/components/providers/notifications';

const DOT: Record<string, string> = {
  info: 'bg-blue-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
};

export function NotificationBell() {
  const { items, unread, markAllRead, clear } = useNotifications();

  return (
    <DropdownMenu onOpenChange={(open) => open && markAllRead()}>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" className="relative" aria-label="Notifications" />}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <Badge className="absolute -right-1 -top-1 size-4 justify-center rounded-full p-0 text-[10px] tabular-nums">
            {unread > 9 ? '9+' : unread}
          </Badge>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {items.length > 0 && (
            <button onClick={clear} className="text-xs text-muted-foreground hover:text-foreground">
              Clear
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing yet. The agent will speak up when it notices something.
          </p>
        ) : (
          <ScrollArea className="max-h-80">
            <ul className="divide-y">
              {items.map((n) => (
                <li key={n.id} className="flex gap-2.5 px-3 py-2.5">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[n.kind]}`} />
                  <div className="min-w-0">
                    <p className="text-sm leading-snug">{n.title}</p>
                    {n.body && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(n.at).toLocaleTimeString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
