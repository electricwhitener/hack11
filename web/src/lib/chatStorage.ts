import type { UIMessage } from 'ai';

/**
 * Chat persistence — server-backed, per user.
 *
 * Replaces the old localStorage version, which stored a single conversation
 * per browser and could not survive clearing site data or switching device.
 * Everything here talks to /api/chats, which is protected by Supabase auth
 * and Row Level Security, so a user can only ever reach their own rows.
 */

export type ChatSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

/** All of the signed-in user's conversations, newest first. */
export async function listChats(): Promise<ChatSummary[]> {
  const res = await fetch('/api/chats');
  if (!res.ok) return [];
  const { chats } = await res.json();
  return chats ?? [];
}

/** Create an empty conversation and return it. */
export async function createChat(title?: string): Promise<ChatSummary | null> {
  const res = await fetch('/api/chats', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) return null;
  const { chat } = await res.json();
  return chat ?? null;
}

export async function loadChat(
  id: string,
): Promise<{ chat: ChatSummary; messages: UIMessage[] } | null> {
  const res = await fetch(`/api/chats/${id}`);
  if (!res.ok) return null;
  return res.json();
}

/**
 * Persist a conversation. Called once a turn settles — never mid-stream,
 * which would save half-formed messages on every token.
 */
export async function saveChat(id: string, messages: UIMessage[], title?: string) {
  await fetch(`/api/chats/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, title }),
  }).catch(() => {
    // A failed save must not break the live conversation on screen.
  });
}

export async function deleteChat(id: string) {
  await fetch(`/api/chats/${id}`, { method: 'DELETE' }).catch(() => {});
}

/** First user message, trimmed, used as the conversation's sidebar label. */
export function titleFrom(messages: UIMessage[]): string {
  const firstUserText = messages
    .find((m) => m.role === 'user')
    ?.parts.find((p) => p.type === 'text')?.text;
  if (!firstUserText) return 'New chat';
  return firstUserText.length > 48 ? firstUserText.slice(0, 48) + '…' : firstUserText;
}
