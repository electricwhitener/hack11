'use client';

import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isToolUIPart, getToolName } from 'ai';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Chart, type ChartSpec } from './Chart';
import { useNotifications } from '@/components/providers/notifications';

export function Chat() {
  const [input, setInput] = useState('');
  const { push } = useNotifications();
  const { messages, sendMessage, status, addToolApprovalResponse, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });

  const busy = status === 'submitted' || status === 'streaming';

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="mt-24 text-center">
            <p className="text-sm text-muted-foreground">
              Ask the agent something. It can chart data, run analyses, and request
              your approval before acting.
            </p>
            {/* Demo trigger for the proactive-notification pattern. Delete once
                a real event source pushes notifications. */}
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() =>
                push({
                  title: 'Agent noticed something',
                  body: 'This is how a proactive alert appears. Check the bell.',
                  kind: 'warning',
                })
              }
            >
              Try a proactive alert
            </Button>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {m.role === 'user' ? 'You' : 'Agent'}
            </div>

            {m.parts.map((part, i) => {
              if (part.type === 'text') {
                return (
                  <p key={i} className="whitespace-pre-wrap leading-relaxed">
                    {part.text}
                  </p>
                );
              }

              if (part.type === 'reasoning') {
                return (
                  <details key={i} className="rounded-lg bg-muted p-2 text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Reasoning</summary>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{part.text}</p>
                  </details>
                );
              }

              if (isToolUIPart(part)) {
                const name = getToolName(part);

                // Human-in-the-loop: the agent is asking permission to act.
                if (part.state === 'approval-requested') {
                  const summary = (part.input as { summary?: string })?.summary ?? name;
                  return (
                    <div
                      key={i}
                      className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3"
                    >
                      <p className="text-sm font-medium">Approve this action?</p>
                      <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            addToolApprovalResponse({ id: part.approval.id, approved: true })
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            addToolApprovalResponse({ id: part.approval.id, approved: false })
                          }
                        >
                          Deny
                        </Button>
                      </div>
                    </div>
                  );
                }

                // Generative UI: the chart tool renders as an actual chart.
                if (name === 'showChart' && part.state === 'output-available') {
                  return <Chart key={i} spec={part.output as ChartSpec} />;
                }

                // Everything else renders as a visible trace step. Judges love
                // seeing the agent's work instead of a black box.
                return (
                  <div key={i} className="rounded-lg border bg-card px-3 py-2 text-xs">
                    <span className="font-mono font-medium">{name}</span>
                    <span className="ml-2 text-muted-foreground">
                      {part.state === 'output-available'
                        ? 'done'
                        : part.state === 'output-error'
                          ? `error: ${part.errorText}`
                          : part.state === 'output-denied'
                            ? 'denied by user'
                            : 'running…'}
                    </span>
                    {part.state === 'output-available' && (
                      <pre className="mt-1 max-h-40 overflow-auto text-[11px] text-muted-foreground">
                        {JSON.stringify(part.output, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              }

              return null;
            })}
          </div>
        ))}

        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
            {error.message}
          </p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || busy) return;
          sendMessage({ text: input });
          setInput('');
        }}
        className="flex shrink-0 gap-2 border-t p-4"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent…"
        />
        <Button type="submit" disabled={busy}>
          {busy ? '…' : 'Send'}
        </Button>
      </form>
    </div>
  );
}
