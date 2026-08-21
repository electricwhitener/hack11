import type { UIMessage } from 'ai';

/**
 * Chat SESSION persistence — multiple conversations, not one slot.
 *
 * localStorage, not a database, on purpose: works per-browser with zero
 * backend, survives an accidental refresh mid-demo. It does NOT sync across
 * devices or between judges trying the app on their own machine — if the
 * product needs shared history, move this to Postgres via src/lib/db.ts.
 *
 * Every access is wrapped: localStorage throws outright in some privacy
 * modes, and an unhandled throw here would blank the whole chat screen.
 */
const KEY = 'hack11:chats';
const ACTIVE_KEY = 'hack11:activeChatId';

/** Cap what one session keeps. Tool outputs can be large. */
const MAX_MESSAGES = 50;
/** Cap how many past conversations we keep at all, oldest dropped first. */
const MAX_SESSIONS = 30;

export type ChatSession = {
  id: string;
  title: string;
  messages: UIMessage[];
  createdAt: number;
  updatedAt: number;
};

function readAll(): ChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatSession[]) : [];
  } catch {
    return [];
  }
}

function writeAll(sessions: ChatSession[]) {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = [...sessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SESSIONS);
    window.localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded or storage blocked. Losing history is survivable;
    // crashing the chat is not.
  }
}

/** All saved sessions, newest first. */
export function listSessions(): ChatSession[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadSession(id: string): ChatSession | null {
  return readAll().find((s) => s.id === id) ?? null;
}

/**
 * Create or update a session. Called once a turn settles — never mid-stream,
 * which would save half-formed messages and thrash storage on every token.
 */
export function saveSession(id: string, messages: UIMessage[]) {
  if (!messages.length) return;
  const all = readAll();
  const existing = all.find((s) => s.id === id);
  const now = Date.now();

  const session: ChatSession = {
    id,
    title: existing?.title ?? titleFrom(messages),
    messages: messages.slice(-MAX_MESSAGES),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  writeAll([...all.filter((s) => s.id !== id), session]);
}

export function deleteSession(id: string) {
  writeAll(readAll().filter((s) => s.id !== id));
}

/** First user message, trimmed, as the session's label in the history list. */
function titleFrom(messages: UIMessage[]): string {
  const firstUserText = messages
    .find((m) => m.role === 'user')
    ?.parts.find((p) => p.type === 'text')?.text;
  if (!firstUserText) return 'New chat';
  return firstUserText.length > 48 ? firstUserText.slice(0, 48) + '…' : firstUserText;
}

/** Which conversation was open when the tab was last closed. */
export function getActiveSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveSessionId(id: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
}
