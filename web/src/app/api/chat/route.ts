import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai';
import { chatModel, hasLLMKey, googleOptions } from '@/lib/ai/provider';
import { tools } from '@/lib/ai/tools';
import { SYSTEM_PROMPT } from '@/lib/ai/prompt';

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Mock mode: lets you build and demo the UI with no API key and zero quota burn.
  if (!hasLLMKey) return mockStream();

  const result = streamText({
    model: chatModel(),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools,
    providerOptions: googleOptions,
    // The agent loop: model -> tool -> model -> ... up to 5 turns.
    // Without this it calls one tool and stops.
    //
    // Keep this number low. Each step is a separate API request, so this is a
    // direct multiplier on your free-tier quota: at 8 steps, one user message
    // could burn 8 of the 20 requests/minute Google allows.
    stopWhen: stepCountIs(5),
    // Google's free tier throttles hard. Two retries with backoff rides out a
    // brief spike; more than that just makes the user stare at a spinner.
    maxRetries: 2,
  });

  return result.toUIMessageStreamResponse({
    onError: friendlyError,
  });
}

/**
 * Never show a raw stack trace to a judge. Quota errors are the likely failure
 * during a demo, so they get a calm, specific message the user can act on.
 */
function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  if (/quota|rate.?limit|RESOURCE_EXHAUSTED|429/i.test(raw)) {
    const seconds = raw.match(/retry in ([0-9.]+)s/i)?.[1];
    const wait = seconds ? ` Try again in about ${Math.ceil(Number(seconds))} seconds.` : '';
    return `The free Gemini quota was hit for a moment.${wait}`;
  }

  if (/API key|PERMISSION_DENIED|401|403/i.test(raw)) {
    return 'The AI key is missing or invalid on the server.';
  }

  if (/not found|404|deprecated/i.test(raw)) {
    return 'That model is unavailable. Check MODEL_ID in your environment variables.';
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
