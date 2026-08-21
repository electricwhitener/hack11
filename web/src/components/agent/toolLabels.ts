/**
 * Human-readable verbs for each tool, shown in the live status line.
 *
 * Judges cannot see your tool names. They see "Analysing dataset…" and
 * understand the agent is working. Add an entry here whenever you add a tool —
 * an unmapped tool falls back to its raw name, which looks unfinished.
 */
export const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  showChart: { running: 'Drawing chart', done: 'Chart ready' },
  runAnalysis: { running: 'Analysing dataset', done: 'Analysis complete' },
  commitAction: { running: 'Preparing action', done: 'Action ready' },
};

export function toolLabel(name: string, phase: 'running' | 'done' = 'running') {
  return TOOL_LABELS[name]?.[phase] ?? name;
}
