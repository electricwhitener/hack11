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

// Rolling aliases: Google repoints these at the current stable model, so pinning
// a dated version (e.g. gemini-2.5-flash) can't quietly go stale mid-hackathon.
export const MODEL_ID = process.env.MODEL_ID ?? 'gemini-flash-latest';
export const FAST_MODEL_ID = process.env.FAST_MODEL_ID ?? 'gemini-flash-lite-latest';

/** Main reasoning + tool-calling model. */
export const chatModel = () => google(MODEL_ID);

/** Cheap model for classification, routing, extraction. Saves free-tier quota. */
export const fastModel = () => google(FAST_MODEL_ID);
