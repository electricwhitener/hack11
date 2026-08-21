'use client';

import type { UIMessage } from 'ai';
import { isToolUIPart, getToolName } from 'ai';
import { toolLabel } from './toolLabels';

/**
 * The live "what is it doing right now" line.
 *
 * A blank pause while the model thinks reads as a frozen app. Naming the current
 * step keeps the user oriented and, in a demo, makes the agent's work legible
 * instead of magic. This is the cheapest credibility win in the whole UI.
 */
export function AgentStatus({
  status,
  lastMessage,
}: {
  status: 'submitted' | 'streaming' | 'ready' | 'error';
  lastMessage?: UIMessage;
}) {
  if (status !== 'submitted' && status !== 'streaming') return null;

  const label = deriveLabel(status, lastMessage);
  if (!label) return null;

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-primary" />
      </span>
      <span className="animate-shimmer bg-[linear-gradient(90deg,var(--muted-foreground)_25%,var(--foreground)_50%,var(--muted-foreground)_75%)] bg-[length:200%_100%] bg-clip-text text-transparent">
        {label}…
      </span>
    </div>
  );
}

function deriveLabel(status: string, msg?: UIMessage): string | null {
  if (!msg || msg.role !== 'assistant') return 'Thinking';

  // Walk backwards: the most recent part is what the agent is doing now.
  for (let i = msg.parts.length - 1; i >= 0; i--) {
    const part = msg.parts[i];

    if (isToolUIPart(part)) {
      const name = getToolName(part);
      if (part.state === 'input-streaming') return `Preparing ${toolLabel(name)}`;
      if (part.state === 'input-available') return toolLabel(name);
      if (part.state === 'approval-requested') return null; // buttons are showing
    }

    if (part.type === 'reasoning') return 'Reasoning';

    // Text is already streaming visibly — no status line needed.
    if (part.type === 'text' && part.text.length > 0) return null;
  }

  return status === 'submitted' ? 'Thinking' : 'Working';
}
