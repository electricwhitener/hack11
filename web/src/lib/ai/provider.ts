import { createGoogleGenerativeAI } from '@ai-sdk/google';

/**
 * Single place where the LLM provider is configured.
 * To swap providers (OpenAI / Anthropic / Groq), change ONLY this file:
 *   npm i @ai-sdk/openai  ->  createOpenAI({ apiKey })  ->  openai('gpt-...')
 * Nothing else in the codebase imports a provider directly.
 */

/**
 * API KEYS — supports multiple, comma-separated.
 *
 * Google's free quota is scoped per PROJECT per model per day (20 requests).
 * Different Google accounts are different projects, so each key you add here
 * is a fully separate quota bucket. Combined with MODEL_CHAIN below, N keys x
 * M models = N x M x 20 requests/day.
 *
 * Set GOOGLE_GENERATIVE_AI_API_KEYS="key-one,key-two,key-three" to use several.
 * The single-key GOOGLE_GENERATIVE_AI_API_KEY still works and is folded in.
 */
const KEYS = [
  process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  ...(process.env.GOOGLE_GENERATIVE_AI_API_KEYS?.split(',') ?? []),
]
  .map((k) => k?.trim())
  .filter((k): k is string => Boolean(k && k.length > 10));

/** De-duplicated in case the same key ends up in both env vars. */
export const API_KEYS = [...new Set(KEYS)];

/** False when no key is set: the app degrades to mock mode instead of crashing. */
export const hasLLMKey = API_KEYS.length > 0;

const providers = API_KEYS.map((key) => createGoogleGenerativeAI({ apiKey: key }));

/**
 * MODEL CHOICE — read before changing.
 *
 * We pin a specific slightly-older model rather than the `gemini-flash-latest`
 * alias. The alias always resolves to Google's newest model, and the newest
 * models carry the TIGHTEST free-tier quotas — `gemini-3.7-flash` allows only
 * 20 requests/DAY, which is exhausted almost immediately.
 *
 * Trade-off: a pinned model can eventually be deprecated (that is what happened
 * to gemini-2.5-flash). Deprecation takes months; quota exhaustion takes
 * minutes. For a 36-hour hackathon, pinning is the safer side of that trade.
 */
export const MODEL_ID = process.env.MODEL_ID ?? 'gemini-3.5-flash';
export const FAST_MODEL_ID = process.env.FAST_MODEL_ID ?? 'gemini-flash-lite-latest';

/**
 * FALLBACK CHAIN — the single most important reliability feature here.
 *
 * Google's free tier allows only 20 requests PER DAY PER PROJECT PER MODEL
 * (quota id GenerateRequestsPerDayPerProjectPerModel-FreeTier). Verified
 * against the live API, not guessed. One model alone cannot survive a demo.
 *
 * Because the quota is scoped per model, listing several models multiplies the
 * daily budget per key. The route tries every (key, model) pair in turn and
 * moves on when one is exhausted, so a dead combination is invisible to the
 * user — see src/app/api/chat/route.ts.
 *
 * ORDER IS MEASURED, NOT ASSUMED. Every model below was timed against the real
 * tool registry on 23 Aug, one agent turn each, same prompt:
 *
 *   gemini-flash-lite-latest    3.0 s
 *   gemini-3.1-flash-lite       4.3 s
 *   gemini-3.5-flash-lite       4.3 s
 *   gemini-3.5-flash            5.8 s   <- primary
 *   gemini-3.6-flash           43.6 s   <- last resort ONLY
 *
 * All five call tools correctly, so the ordering is about latency and prose
 * quality rather than capability.
 *
 * `gemini-3.5-flash` leads because it is the best-writing model that is also
 * fast, and the agent's job here is to explain a number in words somebody can
 * read aloud. The lite models answer a second or two quicker but write more
 * thinly, so they sit behind it as fallbacks rather than ahead of it.
 *
 * `gemini-3.6-flash` is NEWER and was second in this chain. It is now last.
 * Being newer bought nothing measurable — identical tools, an equivalent
 * answer — and cost 7.5x the latency. At 43.6 s it is also close enough to the
 * route's 60 s maxDuration that a slow run would not merely be embarrassing on
 * stage, it would time out. It stays in the chain because it is still 20 more
 * requests a day, but nothing reaches it until 80 requests have been spent on
 * the same key.
 */
export const MODEL_CHAIN = (
  process.env.MODEL_CHAIN ??
  'gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-3.6-flash'
)
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

/**
 * Every (key, model) pair to try, in order. Outer loop is keys, inner is
 * models: exhaust everything on key 1 before touching key 2. This keeps usage
 * concentrated on one key at a time, which makes the AI Studio dashboard
 * (which is per-key) easier to read mid-hackathon.
 */
export type ModelAttempt = { label: string; keyIndex: number; modelId: string };

export const MODEL_ATTEMPTS: ModelAttempt[] = providers.flatMap((_, keyIndex) =>
  MODEL_CHAIN.map((modelId) => ({
    label: `key${keyIndex + 1}/${modelId}`,
    keyIndex,
    modelId,
  })),
);

/** Build a model instance for one (key, model) attempt. */
export const modelFor = (attempt: ModelAttempt) => providers[attempt.keyIndex](attempt.modelId);

/**
 * Gemini 3.x "thinks" before answering by default, which roughly doubles
 * latency. Tool-calling agents rarely need much of it — the reasoning lives in
 * which tool gets called. Raise to 'medium' if answer quality suffers.
 *
 * Use 'low', not 'minimal'. Verified against the API: 'low' is accepted by
 * every current flash model, while 'minimal' is REJECTED by gemini-3.7-flash
 * with INVALID_ARGUMENT — which fails the whole request, not just the option.
 */
export const THINKING_LEVEL = (process.env.THINKING_LEVEL ?? 'low') as
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high';

export const googleOptions = {
  google: { thinkingConfig: { thinkingLevel: THINKING_LEVEL } },
};

/** Cheap model for classification, routing, extraction. Uses the first key. */
export const fastModel = () => (providers[0] ?? createGoogleGenerativeAI({ apiKey: 'not-configured' }))(FAST_MODEL_ID);
