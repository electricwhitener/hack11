import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai';
import { hasLLMKey, modelById, MODEL_CHAIN, googleOptions } from '@/lib/ai/provider';
import { tools } from '@/lib/ai/tools';
import { SYSTEM_PROMPT } from '@/lib/ai/prompt';

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Mock mode: lets you build and demo the UI with no API key and zero quota burn.
  if (!hasLLMKey) return mockStream();

  const modelMessages = await convertToModelMessages(messages);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let lastError: unknown;

      // Walk the chain. Google's free quota is per model per day, so an
      // exhausted model is normal, not exceptional — move to the next one.
      for (const id of MODEL_CHAIN) {
        // streamText's own onError receives the REAL provider error. The promise
        // below rejects with a bare "No output generated" and no `cause`, so this
        // callback is the only place the 429 is actually visible.
        let providerError: unknown;

        try {
          const result = streamText({
            onError: ({ error }) => {
              providerError = error;
            },
            model: modelById(id),
            system: SYSTEM_PROMPT,
            messages: modelMessages,
            tools,
            providerOptions: googleOptions,
            // Each step is a separate API request, so this directly multiplies
            // quota use. Keep it low.
            stopWhen: stepCountIs(5),
            // The chain is our real retry strategy; retrying an exhausted model
            // just wastes seconds before failing anyway.
            maxRetries: 0,
          });

          // `warnings` settles once the request is accepted but before the
          // response finishes. Awaiting it surfaces a 429 or auth failure HERE,
          // while we can still switch models, rather than mid-stream.
          await result.warnings;

          writer.merge(result.toUIMessageStream());
          return;
        } catch (error) {
          lastError = providerError ?? error;
          if (!isRetryableModelError(lastError)) break;
        }
      }

      throw lastError ?? new Error('No model available');
    },
    onError: friendlyError,
  });

  return createUIMessageStreamResponse({ stream });
}

/**
 * Flatten an error and its `cause` chain into one searchable string.
 *
 * The AI SDK wraps provider failures: a 429 surfaces as the unhelpful
 * "No output generated. Check the stream for errors." with the real quota error
 * buried in `.cause`. Matching only the top-level message misses every one.
 */
function errorText(error: unknown, depth = 0): string {
  if (depth > 5 || error == null) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    return `${error.message} ${errorText(error.cause, depth + 1)}`;
  }
  if (typeof error === 'object') {
    const o = error as Record<string, unknown>;
    return [o.message, o.statusCode, o.error, o.cause]
      .map((v) => (typeof v === 'object' ? errorText(v, depth + 1) : String(v ?? '')))
      .join(' ');
  }
  return String(error);
}

/** Quota and availability failures are worth trying the next model for. */
function isRetryableModelError(error: unknown): boolean {
  return /quota|rate.?limit|RESOURCE_EXHAUSTED|429|not found|404|unavailable|overloaded|503/i.test(
    errorText(error),
  );
}

/**
 * Never show a raw stack trace to a judge. Quota errors are the likely failure
 * during a demo, so they get a calm, specific message the user can act on.
 */
function friendlyError(error: unknown): string {
  const raw = errorText(error);

  if (/quota|rate.?limit|RESOURCE_EXHAUSTED|429/i.test(raw)) {
    return 'Every available model has hit its free daily quota. Add another API key or wait for the quota to reset.';
  }

  if (/API key|PERMISSION_DENIED|401|403/i.test(raw)) {
    return 'The AI key is missing or invalid on the server.';
  }

  if (/not found|404|deprecated/i.test(raw)) {
    return 'No configured model is available. Check MODEL_CHAIN in your environment variables.';
  }

  return 'Something went wrong reaching the AI service. Please try again.';
}

function mockStream() {
  const text =
    'Mock mode: no GOOGLE_GENERATIVE_AI_API_KEY found in .env.local. ' +
    'The UI, streaming, and tool rendering all work — add a key to enable the real agent.';

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const id = 'mock-1';
      writer.write({ type: 'text-start', id });
      for (const word of text.split(' ')) {
        writer.write({ type: 'text-delta', id, delta: word + ' ' });
        await new Promise((r) => setTimeout(r, 18));
      }
      writer.write({ type: 'text-end', id });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
