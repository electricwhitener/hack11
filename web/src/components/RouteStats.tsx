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
/**
 * The permit banner.
 *
 * Shown when the ONLY way through needs something like an outpass. Blocking the
 * route outright would be wrong — a student holding one really can walk it —
 * so the route is drawn and the requirement stated plainly above it.
 */
function PermitBanner({ plan }: { plan: RoutePair }) {
  if (plan.status !== 'permission' || !plan.closures.length) return null;
  const permits = [...new Set(plan.closures.map((c) => c.permit).filter(Boolean))];

  return (
    <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <p className="text-sm font-semibold text-amber-400">
        {permits.length ? `${permits.join(' and ')} required` : 'Permission required'}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        There is no other legal way at this hour, so this is the route — but you will be stopped
        without it.
      </p>
      {plan.closures.map((c) => (
        <p key={c.note} className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {c.note}
        </p>
      ))}
    </div>
  );
}

/**
 * No route at all.
 *
 * The honest answer when every way in is shut. Previously this fell through to
 * a time-blind route and drew a 2.5 km loop through paths that do not legally
 * exist — telling somebody to walk somewhere they cannot reach is worse than
 * telling them nothing.
 */
export function ClosedNotice({ plan }: { plan: RoutePair }) {
  return (
    <div className="p-4">
      <p className="text-base font-semibold text-rose-400">Closed right now</p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        There is no legal way to make this walk at this hour. Not a longer one — none.
      </p>
      {plan.closures.map((c) => (
        <p key={c.note} className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {c.note}
        </p>
      ))}
      <p className="mt-3 rounded-lg bg-muted/50 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
        Pick an earlier time to see the route, or stay where you are until the gates open at 5am.
      </p>
    </div>
  );
}

/**
 * The route stops short of the pin.
 *
 * Not a failure and not a closure: a shop mapped on ground the path network
 * does not cover is simply not joined up. Refusing to draw anything would be
 * the wrong kind of honesty, and drawing it without saying so would be a lie
 * about where the route ends — so it draws, and says.
 */
function ApproachBanner({ plan }: { plan: RoutePair }) {
  if (plan.approachMeters < 25) return null;
  const partial = plan.status === 'partial';

  return (
    <div className="mb-3 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3">
      <p className="text-sm font-semibold text-sky-400">
        Gets you within {plan.approachMeters} m
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {partial
          ? 'No mapped path reaches this point, so this is the closest the network gets. The last stretch is on your own.'
          : 'This spot sits off the path network — the route ends at the nearest mapped path.'}
      </p>
    </div>
  );
}

export function RouteStats({ plan }: { plan: RoutePair }) {
  if (plan.status === 'closed') return <ClosedNotice plan={plan} />;

  if (plan.identical) {
    return (
      <div className="p-4 text-sm">
        <PermitBanner plan={plan} />
        <ApproachBanner plan={plan} />
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
      <PermitBanner plan={plan} />
      <ApproachBanner plan={plan} />
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
