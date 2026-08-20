'use client';

import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isToolUIPart, getToolName } from 'ai';
import { Chart, type ChartSpec } from './Chart';

export function Chat() {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status, addToolApprovalResponse, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });

  const busy = status === 'submitted' || status === 'streaming';

  return (
    <div className="mx-auto flex h-dvh max-w-3xl flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="mt-20 text-center text-sm text-neutral-500">
            Ask the agent something. It can chart data, run analyses, and request
            your approval before acting.
          </p>
        )}

        {messages.map((m) => (
          <div key={m.id} className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">
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
                  <details key={i} className="rounded-lg bg-neutral-100 p-2 text-xs dark:bg-neutral-800">
                    <summary className="cursor-pointer text-neutral-500">Reasoning</summary>
                    <p className="mt-1 whitespace-pre-wrap text-neutral-600 dark:text-neutral-400">
                      {part.text}
                    </p>
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
                      className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950"
                    >
                      <p className="text-sm font-medium">Approve this action?</p>
                      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{summary}</p>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: true })}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: false })}
                          className="rounded-lg bg-neutral-200 px-3 py-1.5 text-sm font-medium hover:bg-neutral-300 dark:bg-neutral-700"
                        >
                          Deny
                        </button>
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
                  <div
                    key={i}
                    className="rounded-lg border border-black/10 bg-neutral-50 px-3 py-2 text-xs dark:border-white/10 dark:bg-neutral-900"
                  >
                    <span className="font-mono font-medium">{name}</span>
                    <span className="ml-2 text-neutral-500">
                      {part.state === 'output-available'
                        ? 'done'
                        : part.state === 'output-error'
                          ? `error: ${part.errorText}`
                          : part.state === 'output-denied'
                            ? 'denied by user'
                            : 'running…'}
                    </span>
                    {part.state === 'output-available' && (
                      <pre className="mt-1 max-h-40 overflow-auto text-[11px] text-neutral-500">
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
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
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
        className="flex gap-2 border-t border-black/10 p-4 dark:border-white/10"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent…"
          className="flex-1 rounded-xl border border-black/15 px-4 py-2.5 outline-none focus:border-indigo-500 dark:border-white/20 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white disabled:opacity-40"
        >
          {busy ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
