import { createGoogleGenerativeAI } from '@ai-sdk/google';

/**
 * Single place where the LLM provider is configured.
 * To swap providers (OpenAI / Anthropic / Groq), change ONLY this file:
 *   npm i @ai-sdk/openai  ->  createOpenAI({ apiKey })  ->  openai('gpt-...')
 * Nothing else in the codebase imports a provider directly.
 */
const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

/** False when no key is set: the app degrades to mock mode instead of crashing. */
export const hasLLMKey = Boolean(apiKey && apiKey.length > 10);

const google = createGoogleGenerativeAI({ apiKey: apiKey ?? 'not-configured' });

/**
 * MODEL CHOICE — read before changing.
 *
 * We pin a specific slightly-older model rather than the `gemini-flash-latest`
 * alias. The alias always resolves to Google's newest model, and the newest
 * models carry the TIGHTEST free-tier quotas — `gemini-3.7-flash` allows only
 * 20 requests/minute, which one busy demo can exhaust.
 *
 * Trade-off: a pinned model can eventually be deprecated (that is what happened
 * to gemini-2.5-flash). Deprecation takes months; quota exhaustion takes
 * minutes. For a 36-hour hackathon, pinning is the safer side of that trade.
 *
 * If you hit quota limits anyway, switch MODEL_ID in .env.local to
 * gemini-flash-lite-latest — lighter, faster, and more generous.
 */
export const MODEL_ID = process.env.MODEL_ID ?? 'gemini-3.5-flash';
export const FAST_MODEL_ID = process.env.FAST_MODEL_ID ?? 'gemini-flash-lite-latest';

/**
 * FALLBACK CHAIN — the single most important reliability feature here.
 *
 * Google's free tier allows only 20 requests PER DAY PER MODEL (quota id
 * GenerateRequestsPerDayPerProjectPerModel-FreeTier). Verified against the live
 * API, not guessed. One model alone cannot survive a demo.
 *
 * Because the quota is scoped per model, listing several models multiplies the
 * daily budget: 5 models x 20 = ~100 requests/day. The route tries each in turn
 * and moves on when one is exhausted, so a dead model is invisible to the user.
 *
 * Order matters: best quality first, cheapest last.
 */
export const MODEL_CHAIN = (
  process.env.MODEL_CHAIN ??
  'gemini-3.5-flash,gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest'
)
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

/** Build a model instance by id, for the fallback chain. */
export const modelById = (id: string) => google(id);

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

/** Main reasoning + tool-calling model. */
export const chatModel = () => google(MODEL_ID);

/** Cheap model for classification, routing, extraction. Saves free-tier quota. */
export const fastModel = () => google(FAST_MODEL_ID);
