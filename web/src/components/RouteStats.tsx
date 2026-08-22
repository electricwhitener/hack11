'use client';

import type { RoutePair } from './DarkZoneMap';

/**
 * The tradeoff readout.
 *
 * Every number comes from the computation layer, and both routes are always
 * shown together: the point is that the walker decides, not that the app
 * quietly picks a longer way for them.
 *
 * The plain-language list underneath is the idea worth borrowing from prior art
 * in this space — a score with no reasons attached is not trusted, and ours has
 * the advantage that each line is a computed quantity rather than a heuristic.
 */
function Closures({ plan }: { plan: RoutePair }) {
  if (!plan.closures?.length) return null;
  return (
    <div className="mb-3 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
      {plan.closures.map((c) => (
        <div key={c.note} className="text-[11px] leading-relaxed">
          <span className="font-medium text-amber-400">Closed at this hour</span>
          <p className="mt-0.5 text-muted-foreground">{c.note}</p>
          {c.exception ? (
            <p className="mt-0.5 text-muted-foreground">
              The direct route uses it — this one goes around, unless you have an{' '}
              <span className="text-foreground">{c.exception}</span>.
            </p>
          ) : (
            <p className="mt-0.5 text-muted-foreground">
              The direct route uses it, so this one goes around.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function RouteStats({ plan }: { plan: RoutePair }) {
  if (plan.identical) {
    return (
      <div className="p-4 text-sm">
        <Closures plan={plan} />
        <div className="font-medium text-emerald-500">Already the safest way</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The shortest route ({plan.shortest.meters} m) is also the best-lit one. No detour
          would cut your time on unlit paths.
        </p>
      </div>
    );
  }

  const walkMins = Math.max(1, Math.round(plan.detourMeters / 80));
  const checks: string[] = [];

  if (plan.shortest.darkStretches.length) {
    const w = plan.shortest.darkStretches[0];
    checks.push(`Avoids ${w.meters} m of unlit walking on ${w.label}`);
  }
  if (plan.shortest.darkStretches.length > 1) {
    const rest = plan.shortest.darkStretches.length - 1;
    checks.push(`Skips ${rest} other unlit stretch${rest > 1 ? 'es' : ''} on the direct route`);
  }
  checks.push(
    plan.detourPct <= 5
      ? `Costs ${plan.detourMeters} m — under a minute of extra walking`
      : `Costs ${plan.detourMeters} m extra, roughly ${walkMins} min more`,
  );
  if (plan.safest.darkMeters > 0) {
    checks.push(`Still ${plan.safest.darkMeters} m unlit — no fully lit route exists yet`);
  } else {
    checks.push('Entirely on lit paths');
  }

  return (
    <div className="p-4">
      <Closures plan={plan} />
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums text-emerald-500">
          {plan.darkReductionPct}%
        </span>
        <span className="text-sm text-muted-foreground">less time in the dark</span>
      </div>

      <div className="mt-1 text-xs text-amber-500">
        for {plan.detourMeters} m more walking ({plan.detourPct}%)
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-muted/50 p-2">
          <div className="text-muted-foreground">Shortest</div>
          <div className="font-medium tabular-nums">{plan.shortest.meters} m</div>
          <div className="tabular-nums text-red-400">{plan.shortest.darkMeters} m unlit</div>
        </div>
        <div className="rounded-lg bg-muted/50 p-2">
          <div className="text-muted-foreground">Safer</div>
          <div className="font-medium tabular-nums">{plan.safest.meters} m</div>
          <div className="tabular-nums text-emerald-400">{plan.safest.darkMeters} m unlit</div>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {checks.map((c) => (
          <li key={c} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
            <span aria-hidden className="mt-1 size-1 shrink-0 rounded-full bg-muted-foreground" />
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}
