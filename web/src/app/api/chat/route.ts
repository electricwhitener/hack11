import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai';
import { hasLLMKey, modelFor, MODEL_ATTEMPTS, googleOptions } from '@/lib/ai/provider';
import { tools } from '@/lib/ai/tools';
import { SYSTEM_PROMPT } from '@/lib/ai/prompt';
import { loadAll } from '@/lib/nightsafety';

export const maxDuration = 60;

/**
 * How long the fallback chain may spend LOOKING for a model that will answer.
 *
 * Twelve attempts that each take a few seconds to be refused add up to the
 * whole 60 s budget, and the function is then killed by the platform — the user
 * waits a full minute and gets a 504, which is the worst outcome available.
 * Measured: two 504s in four calls at realistic pacing.
 *
 * Stopping at 28 s leaves room for the answer itself and turns the bad case
 * into a calm message after a pause, instead of a minute of nothing.
 */
const SEARCH_BUDGET_MS = 28_000;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Mock mode: lets you build and demo the UI with no API key and zero quota burn.
  if (!hasLLMKey) return mockStream();

  /*
   * Pull shared state BEFORE the model runs.
   *
   * Every other route does this and this one never did, so on a cold lambda the
   * agent answered from an empty store: no surveys, no gates, and no knowledge
   * of a single surveyor-placed shop. It would then insist a place it can
   * perfectly well route to does not exist. Once per request is enough — the
   * tools execute inside this same invocation.
   */
  await loadAll();

  const modelMessages = await convertToModelMessages(messages);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let lastError: unknown;

      // Walk every (key, model) pair. Google's free quota is per project per
      // model per day, so an exhausted combination is normal, not exceptional
      // — move to the next one.
      const startedAt = Date.now();

      for (const attempt of MODEL_ATTEMPTS) {
        /*
         * Give up SEARCHING before the platform gives up on us. Once a model
         * has accepted the request this no longer applies — the answer streams
         * on whatever time is left.
         */
        if (Date.now() - startedAt > SEARCH_BUDGET_MS) break;
        // streamText's own onError receives the REAL provider error. The promise
        // below rejects with a bare "No output generated" and no `cause`, so this
        // callback is the only place the 429 is actually visible.
        let providerError: unknown;

        try {
          const result = streamText({
            onError: ({ error }) => {
              providerError = error;
            },
            model: modelFor(attempt),
            system: SYSTEM_PROMPT,
            messages: modelMessages,
            tools,
            providerOptions: googleOptions,
            // Each step is a separate API request, so this directly multiplies
            // quota use. Keep it low.
            /*
             * Four, not five. Every step is a separate API request, so each one
             * is another chance to be rate-limited mid-answer, on a pair we can
             * no longer switch away from. Observed traces use three — two tools
             * and the reply — so this keeps one spare and drops a round trip
             * from the worst case.
             */
            stopWhen: stepCountIs(4),
            // The chain is our real retry strategy; retrying an exhausted model
            // just wastes seconds before failing anyway.
            maxRetries: 0,
          });

          // `warnings` settles once the request is accepted but before the
          // response finishes. Awaiting it surfaces a 429 or auth failure HERE,
          // while we can still switch models, rather than mid-stream.
          await result.warnings;

          /*
           * onError here is NOT optional.
           *
           * Only the FIRST request of a run is protected by the chain above.
           * A multi-step tool loop makes one API request per step, so steps 2..n
           * happen inside this merged stream — after we have committed to a
           * (key, model) pair and can no longer switch. When one of those later
           * steps hits quota, toUIMessageStream handles it with its own default
           * handler, which emits the literal string "An error occurred." That is
           * the message users were seeing: three tools would run, then the final
           * answer would die with no explanation and no clue that it was quota.
           *
           * midStreamError handles that case, and deliberately does NOT claim
           * the whole chain is spent - only this one pair is.
           */
          writer.merge(result.toUIMessageStream({ onError: midStreamError }));
          return;
        } catch (error) {
          lastError = providerError ?? error;
          if (!isRetryableModelError(lastError)) break;
        }
      }

      throw lastError ?? new Error('No model available');
    },
    onError: exhaustedError,
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

/**
 * Worth trying the next (key, model) attempt for. This includes auth failures
 * (401/403/PERMISSION_DENIED) alongside quota and availability errors — a
 * revoked or mistyped key on attempt N must not block attempt N+1, which may
 * use a completely different key. Verified: without 401/403 here, one bad key
 * placed first in the chain silently kills every attempt after it.
 */
function isRetryableModelError(error: unknown): boolean {
  return /quota|rate.?limit|RESOURCE_EXHAUSTED|429|not found|404|unavailable|overloaded|503|401|403|PERMISSION_DENIED|API key/i.test(
    errorText(error),
  );
}

const isQuota = (raw: string) => /quota|rate.?limit|RESOURCE_EXHAUSTED|429/i.test(raw);

/** The real error, for us. Users never see this; it goes to the server log. */
function logFailure(where: string, error: unknown) {
  console.error(`[chat:${where}]`, errorText(error).slice(0, 400));
}

/**
 * EXHAUSTED - every (key, model) pair was tried and none worked.
 *
 * Only reachable after the loop above walks the whole chain, so "no capacity
 * left today" is genuinely true here. Users get no mention of API keys or env
 * vars: that is our problem to fix, not something they can act on.
 */
function exhaustedError(error: unknown): string {
  logFailure('chain-exhausted', error);
  const raw = errorText(error);

  /*
   * A per-MINUTE limit is not a per-day one, and saying "back tomorrow" when
   * the answer is "back in ten seconds" is both false and alarming — precisely
   * the sentence you do not want on screen during a demo. Google names the
   * window in the quota metric, so the two are distinguishable.
   */
  if (/PerMinute|per minute|RPM/i.test(raw)) {
    return 'The assistant is busy for a moment. Ask again in a few seconds.';
  }
  if (isQuota(raw)) return 'Daily usage limit reached. The assistant will be back tomorrow.';
  if (/API key|PERMISSION_DENIED|401|403/i.test(raw)) return 'The assistant is unavailable right now.';
  if (/not found|404|deprecated/i.test(raw)) return 'The assistant is unavailable right now.';
  return 'Something went wrong. Please try again.';
}

/**
 * MID-STREAM - one step of an already-committed (key, model) pair failed.
 *
 * Critically NOT the same as the chain being exhausted. A single message costs
 * roughly four requests (three tool steps plus the final answer) and they all
 * land on the same pair, so that ONE pair can run dry while the other fourteen
 * are untouched. Reporting this as "everything is exhausted" was both wrong and
 * discouraging: asking again restarts the chain and usually just works.
 */
function midStreamError(error: unknown): string {
  logFailure('mid-stream', error);
  return isQuota(errorText(error))
    ? 'That answer stopped partway through. Please ask again.'
    : 'Something went wrong. Please try again.';
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
