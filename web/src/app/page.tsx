import { AppShell } from '@/components/layout/AppShell';
import { DarkZoneMap } from '@/components/DarkZoneMap';
import { AgentDock } from '@/components/agent/AgentDock';
import { areaStats } from '@/lib/nightsafety';

/**
 * The product is one screen: the map, with the agent beside it.
 *
 * DELIBERATELY NOT AUTH-GATED. This used to redirect signed-out visitors to
 * /login, which meant anyone opening the link — a judge, someone handed the URL
 * — hit a signup form before seeing a single thing the product does. The map,
 * the routing, the repair queue and the agent all work without an account;
 * signing in only adds saved conversations. Auth is an upgrade, not a gate.
 */
export default function Home() {
  const s = areaStats();

  return (
    <AppShell title={`${s.area} · ${s.totalKm} km mapped`} bleed>
      <div className="flex h-full">
        <div className="relative min-w-0 flex-1">
          <DarkZoneMap />
        </div>
        <AgentDock />
      </div>
    </AppShell>
  );
}
