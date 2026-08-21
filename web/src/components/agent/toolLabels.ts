/**
 * Human-readable verbs for each tool, shown in the live status line.
 *
 * Judges cannot see your tool names. They see "Analysing dataset…" and
 * understand the agent is working. Add an entry here whenever you add a tool —
 * an unmapped tool falls back to its raw name, which looks unfinished.
 */
export const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  showChart: { running: 'Drawing chart', done: 'Chart ready' },
  getAreaStats: { running: 'Reading area statistics', done: 'Area statistics' },
  planSafeRoute: { running: 'Routing both ways', done: 'Routes compared' },
  rankRepairQueue: { running: 'Ranking repairs by risk removed', done: 'Repair queue ranked' },
  explainRanking: { running: 'Checking the underlying scores', done: 'Scores retrieved' },
  fileRepairRequest: { running: 'Drafting repair request', done: 'Request ready to file' },
};

export function toolLabel(name: string, phase: 'running' | 'done' = 'running') {
  return TOOL_LABELS[name]?.[phase] ?? name;
}
