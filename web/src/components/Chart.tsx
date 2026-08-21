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

// Uses the theme's chart tokens so charts match light and dark automatically.
const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

/** Renders a chart the agent asked for. This is "generative UI": the model
 *  returns structured data and the app decides how it looks. */
export function Chart({ spec }: { spec: ChartSpec }) {
  return (
    <div className="my-3 rounded-xl border bg-card p-4">
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
