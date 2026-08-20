import { tool } from '@ai-sdk/provider-utils';
import { z } from 'zod';

/**
 * THE TOOL REGISTRY — this is the file you rewrite for your problem statement.
 *
 * A tool is how the agent *acts* instead of just talking. Judges reward an agent
 * that changes application state; they ignore a chatbot glued to a sidebar.
 *
 * Anatomy:
 *   description  -> how the model decides to call it. Write it for a reader who
 *                   has never seen your app. This matters more than the code.
 *   inputSchema  -> zod schema; doubles as validation and as the model's contract.
 *   execute      -> your actual logic. Runs on the server.
 *   needsApproval-> optional; pauses for a human click before executing.
 */

const PY = process.env.PY_SERVICE_URL ?? 'http://127.0.0.1:8000';

/** Returns structured chart data. The UI renders it as a real chart (generative UI). */
const showChart = tool({
  description:
    'Render a chart in the UI. Use whenever the answer involves comparing numbers, ' +
    'showing a trend over time, or breaking a total into parts.',
  inputSchema: z.object({
    kind: z.enum(['bar', 'line', 'pie']).describe('bar=compare, line=trend, pie=composition'),
    title: z.string(),
    data: z
      .array(z.object({ label: z.string(), value: z.number() }))
      .min(1)
      .describe('The points to plot. Keep under 12 for readability.'),
  }),
  execute: async ({ kind, title, data }) => ({ kind, title, data }),
});

/** Bridges to the Python service for anything pandas/sklearn shaped. */
const runAnalysis = tool({
  description:
    'Run a statistical or machine-learning analysis on an uploaded dataset. ' +
    'Use for correlations, summary statistics, forecasting, or clustering.',
  inputSchema: z.object({
    datasetId: z.string().describe('Dataset identifier returned when the file was uploaded.'),
    question: z.string().describe('Plain-English description of the analysis to perform.'),
  }),
  execute: async ({ datasetId, question }) => {
    try {
      const res = await fetch(`${PY}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataset_id: datasetId, question }),
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) return { error: `Analysis service returned ${res.status}` };
      return await res.json();
    } catch {
      return { error: 'Analysis service unreachable. Is py-service running on :8000?' };
    }
  },
});

/**
 * Demonstrates human-in-the-loop. The model proposes; the user clicks Approve.
 * This pattern reads extremely well in a demo — you are visibly in control of
 * the agent rather than hoping it behaves.
 */
const commitAction = tool({
  description:
    'Perform a real, irreversible action on behalf of the user (save, send, submit, delete). ' +
    'Always describe precisely what will happen before calling this.',
  inputSchema: z.object({
    summary: z.string().describe('One line the user will read before approving.'),
    payload: z.record(z.string(), z.unknown()).describe('The data to commit.'),
  }),
  needsApproval: true,
  execute: async ({ summary, payload }) => {
    // TODO: replace with a real DB write / email send / API call.
    return { committed: true, summary, payload, at: new Date().toISOString() };
  },
});

export const tools = { showChart, runAnalysis, commitAction };

export type AppTools = typeof tools;
