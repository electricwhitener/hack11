'use client';

import { useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isToolUIPart, getToolName } from 'ai';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Check, X, RotateCcw } from 'lucide-react';
import { Chart, type ChartSpec } from './Chart';
import { AgentStatus } from './agent/AgentStatus';
import { toolLabel } from './agent/toolLabels';
import {
  listSessions,
  loadSession,
  saveSession,
  deleteSession,
  getActiveSessionId,
  setActiveSessionId,
  type ChatSession,
} from '@/lib/chatStorage';
import { useNotifications } from '@/components/providers/notifications';
import { ChatHistory } from './agent/ChatHistory';

export function Chat() {
  const [input, setInput] = useState('');
  const { push } = useNotifications();
  const { messages, setMessages, sendMessage, status, addToolApprovalResponse, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });

  const busy = status === 'submitted' || status === 'streaming';
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the newest content in view as tokens stream in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, status]);

  // The conversation currently open, so a brand-new chat has an id before its
  // first message ever saves. Safe to generate during SSR too: the id is never
  // rendered as text on first paint (sessions starts empty), only used for
  // storage keys and equality checks once the effect below restores state.
  const [sessionId, setSessionIdState] = useState<string>(() => crypto.randomUUID());
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  // Restore the last-open conversation AFTER mount, never during render:
  // localStorage does not exist on the server, and seeding initial state from
  // it causes a hydration mismatch. A one-frame empty flash is the correct
  // trade.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;

    setSessions(listSessions());

    const lastId = getActiveSessionId();
    const saved = lastId ? loadSession(lastId) : null;
    if (saved) {
      setSessionIdState(saved.id);
      setMessages(saved.messages);
    }
  }, [setMessages]);

  // Persist once a turn settles. Writing mid-stream would save half-formed
  // messages and thrash localStorage on every token.
  useEffect(() => {
    if (!restored.current || status !== 'ready' || !sessionId) return;
    if (!messages.length) return;
    saveSession(sessionId, messages);
    setActiveSessionId(sessionId);
    setSessions(listSessions());
  }, [messages, status, sessionId]);

  function startNewChat() {
    setSessionIdState(crypto.randomUUID());
    setMessages([]);
  }

  function selectSession(id: string) {
    const s = loadSession(id);
    if (!s) return;
    setSessionIdState(id);
    setActiveSessionId(id);
    setMessages(s.messages);
  }

  function removeSession(id: string) {
    deleteSession(id);
    setSessions(listSessions());
    if (id === sessionId) startNewChat();
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <ChatHistory
          sessions={sessions}
          activeId={sessionId}
          onSelect={selectSession}
          onDelete={removeSession}
        />
        <span className="truncate text-xs text-muted-foreground">
          {sessions.find((s) => s.id === sessionId)?.title ?? 'New chat'}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          aria-label="New chat"
          title="New chat"
          disabled={busy || messages.length === 0}
          onClick={startNewChat}
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>

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
                  <p
                    key={i}
                    className={
                      m.role === 'user'
                        ? 'inline-block rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2 whitespace-pre-wrap leading-relaxed'
                        : 'whitespace-pre-wrap leading-relaxed'
                    }
                  >
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
                const running =
                  part.state === 'input-streaming' || part.state === 'input-available';

                return (
                  <div key={i} className="rounded-lg border bg-card px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      {running ? (
                        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                      ) : part.state === 'output-available' ? (
                        <Check className="size-3.5 shrink-0 text-emerald-500" />
                      ) : (
                        <X className="size-3.5 shrink-0 text-destructive" />
                      )}
                      <span className="font-medium">
                        {toolLabel(name, part.state === 'output-available' ? 'done' : 'running')}
                      </span>
                      {part.state === 'output-error' && (
                        <span className="text-destructive">{part.errorText}</span>
                      )}
                      {part.state === 'output-denied' && (
                        <span className="text-muted-foreground">denied by you</span>
                      )}
                    </div>
                    {part.state === 'output-available' && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-muted-foreground">
                          View result
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto text-[11px] text-muted-foreground">
                          {JSON.stringify(part.output, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              }

              return null;
            })}
          </div>
        ))}

        <AgentStatus status={status} lastMessage={messages[messages.length - 1]} />

        <div ref={bottomRef} />

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
