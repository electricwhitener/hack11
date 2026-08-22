import { AppShell } from '@/components/layout/AppShell';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { repairQueue, areaStats, loadReports } from '@/lib/nightsafety';

// Citizen reports re-rank this list at runtime, so it must not be prerendered
// at build time — a static page would show the pre-report ordering forever.
export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  await loadReports();
  const queue = repairQueue(12);
  const s = areaStats();
  const top5 = queue.slice(0, 5).reduce((a, q) => a + q.benefitPct, 0);
  const top = Math.max(...queue.map((q) => q.benefitPct), 1);

  return (
    <AppShell title="Repair priority queue">
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <Card className="p-4">
          <p className="text-sm">
            Repairing the top five streets removes{' '}
            <span className="font-semibold text-emerald-500">{top5.toFixed(1)}%</span> of all
            night-time pedestrian risk in this area — out of {s.darkKm} km currently unlit.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ranked by risk removed, not by complaint date. Risk-metres = modelled night foot
            traffic × unlit distance.
            {s.citizenReports > 0
              ? ` Includes ${s.citizenReports} citizen report${s.citizenReports > 1 ? 's' : ''} filed from the map.`
              : ''}
          </p>
        </Card>

        <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Street</TableHead>
              <TableHead className="text-right">Unlit</TableHead>
              <TableHead className="text-right">Foot traffic</TableHead>
              <TableHead className="text-right">Risk removed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queue.map((q, i) => (
              <TableRow key={q.id}>
                <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                <TableCell className="font-medium">
                  {q.label}
                  {q.status !== 'estimated' ? (
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 align-middle text-[10px] font-medium ${
                        q.status === 'confirmed'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-amber-500/15 text-amber-400'
                      }`}
                    >
                      {q.status === 'confirmed'
                        ? `confirmed · ${q.reports} reports`
                        : 'unconfirmed · 1 report'}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {q.meters} m
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {q.avgExposure.toFixed(3)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    {/* Scaled against the top item, so the drop-off after the
                        first few entries is visible at a glance. */}
                    <div
                      className="h-1.5 rounded-full bg-emerald-500"
                      style={{ width: `${Math.max(4, (q.benefitPct / top) * 90)}px` }}
                    />
                    <span className="w-12 text-right font-semibold tabular-nums text-emerald-500">
                      {q.benefitPct}%
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </div>
    </AppShell>
  );
}
