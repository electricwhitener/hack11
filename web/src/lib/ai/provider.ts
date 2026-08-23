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
/**
 * Display only. The chat route walks MODEL_CHAIN, not this — see MODEL_ATTEMPTS.
 * Kept in step with the head of the chain so nothing reports a model we are not
 * actually using.
 */
export const MODEL_ID = process.env.MODEL_ID ?? 'gemini-3.5-flash-lite';
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
 * ORDER IS MEASURED, NOT ASSUMED — and it is ordered for SPEED.
 *
 * Benchmarked against the real tool registry, three agent turns each, median:
 *
 *   gemini-3.5-flash-lite       2.9 s   <- primary
 *   gemini-flash-lite-latest    3.5 s
 *   gemini-3.1-flash-lite       4.1 s
 *   gemini-3.5-flash            5.8 s   (quota spent on key1 when measured)
 *   gemini-3.6-flash           43.6 s   <- REMOVED, see below
 *
 * All of them call the right tools on every run, so the ordering costs nothing
 * in correctness. The lite models write a little more tersely — roughly 190
 * characters against 240 — which on a stage is a feature, not a loss.
 *
 * `gemini-3.5-flash` used to lead on prose quality. It is now fourth, for two
 * reasons: a demo is judged on not stalling, and it was measured EXHAUSTED on
 * key1, which meant every single request began with a failed attempt before
 * falling through. A dead model at the head of the chain is latency nobody
 * agreed to pay.
 *
 * `gemini-3.6-flash` is GONE, not merely demoted. At 43.6 s a single attempt
 * plus the failures ahead of it exceeds the route's 60 s maxDuration, so it
 * does not degrade the answer — it returns a 504 having first consumed the
 * entire budget. An attempt that cannot finish is worse than no attempt, and
 * the 20 requests a day it contributed are not worth a timeout on stage.
 */
export const MODEL_CHAIN = (
  process.env.MODEL_CHAIN ??
  'gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-3.5-flash'
)
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

/**
 * Every (key, model) pair to try, in order. MODEL outer, KEY inner — the
 * fastest model is tried on all three keys before any slower model is tried at
 * all.
 *
 * This was the other way round, concentrating usage on one key so the per-key
 * AI Studio dashboard was easier to read. That convenience cost a demo.
 *
 * Google limits requests per MINUTE as well as per day, and the per-minute
 * bucket is per project — so three messages in quick succession can rate-limit
 * key1 while keys 2 and 3 sit idle. Walking key1's five models first meant a
 * rate-limited key1 pushed the request down to key1's SLOWEST model, on the
 * very key that was already refusing it, and the request spent its whole 60 s
 * budget doing so. Measured: two 504s in three consecutive calls.
 *
 * Failing sideways to another key on the same fast model is both likelier to
 * succeed and bounded in latency. A different key is a different project, and
 * therefore a different per-minute bucket.
 */
export type ModelAttempt = { label: string; keyIndex: number; modelId: string };

export const MODEL_ATTEMPTS: ModelAttempt[] = MODEL_CHAIN.flatMap((modelId) =>
  providers.map((_, keyIndex) => ({
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
