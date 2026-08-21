import type { UIMessage } from 'ai';

/**
 * Chat history persistence.
 *
 * localStorage, not a database, on purpose: it survives an accidental refresh
 * mid-demo (the actual risk) with zero backend work. It is per-browser, so it
 * does NOT sync across devices or between judges trying the app — if the
 * product needs shared history, move this to Postgres via src/lib/db.ts.
 *
 * Every access is wrapped: localStorage throws outright in some privacy modes,
 * and an unhandled throw here would blank the whole chat screen.
 */
const KEY = 'hack11:chat';

/** Cap what we keep. Tool outputs can be large and the quota is ~5MB. */
const MAX_MESSAGES = 50;

export function loadMessages(): UIMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UIMessage[]) : [];
  } catch {
    return [];
  }
}

export function saveMessages(messages: UIMessage[]) {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = messages.slice(-MAX_MESSAGES);
    window.localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded or storage blocked. Losing history is survivable;
    // crashing the chat is not.
  }
}

export function clearMessages() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
