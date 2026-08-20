import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai';
import { chatModel, hasLLMKey } from '@/lib/ai/provider';
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
    // The agent loop: model -> tool -> model -> ... up to 8 turns.
    // Without this it calls one tool and stops.
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse({
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });
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
