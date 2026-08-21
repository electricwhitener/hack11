'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { toast } from 'sonner';

/**
 * Agent notification store.
 *
 * This exists to enable the strongest differentiator in docs/IDEA-PLAYBOOK.md:
 * a PROACTIVE agent. Nearly every hackathon agent waits to be spoken to. Yours
 * can notice something and tell the user unprompted — but it needs somewhere to
 * speak. That is this.
 *
 * Usage from any client component:
 *   const { push } = useNotifications();
 *   push({ title: 'Attendance dropped below 75%', kind: 'warning' });
 *
 * To fire from the server, have a tool in tools.ts return a payload the client
 * detects, or poll an endpoint on an interval.
 */

export type NotificationKind = 'info' | 'success' | 'warning' | 'error';

export type AgentNotification = {
  id: string;
  title: string;
  body?: string;
  kind: NotificationKind;
  at: number;
  read: boolean;
};

type NotificationContext = {
  items: AgentNotification[];
  unread: number;
  push: (n: { title: string; body?: string; kind?: NotificationKind }) => void;
  markAllRead: () => void;
  clear: () => void;
};

const Ctx = createContext<NotificationContext | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<AgentNotification[]>([]);

  const push = useCallback((n: { title: string; body?: string; kind?: NotificationKind }) => {
    const entry: AgentNotification = {
      id: crypto.randomUUID(),
      title: n.title,
      body: n.body,
      kind: n.kind ?? 'info',
      at: Date.now(),
      read: false,
    };

    setItems((prev) => [entry, ...prev].slice(0, 50));

    // Also surface it immediately as a toast, so it is visible on stage.
    toast[entry.kind === 'error' ? 'error' : entry.kind](entry.title, {
      description: entry.body,
    });
  }, []);

  const markAllRead = useCallback(
    () => setItems((prev) => prev.map((i) => ({ ...i, read: true }))),
    [],
  );

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(
    () => ({ items, unread: items.filter((i) => !i.read).length, push, markAllRead, clear }),
    [items, push, markAllRead, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationProvider>');
  return ctx;
}
