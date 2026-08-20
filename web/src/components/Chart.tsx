'use client';

import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

export type ChartSpec = {
  kind: 'bar' | 'line' | 'pie';
  title: string;
  data: { label: string; value: number }[];
};

const COLORS = ['#6366f1', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

/** Renders a chart the agent asked for. This is "generative UI": the model
 *  returns structured data and the app decides how it looks. */
export function Chart({ spec }: { spec: ChartSpec }) {
  return (
    <div className="my-3 rounded-xl border border-black/10 bg-white p-4 dark:border-white/15 dark:bg-neutral-900">
      <h4 className="mb-3 text-sm font-semibold">{spec.title}</h4>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {spec.kind === 'line' ? (
            <LineChart data={spec.data}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke={COLORS[0]} strokeWidth={2} />
            </LineChart>
          ) : spec.kind === 'pie' ? (
            <PieChart>
              <Pie data={spec.data} dataKey="value" nameKey="label" outerRadius={90} label>
                {spec.data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          ) : (
            <BarChart data={spec.data}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {spec.data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
