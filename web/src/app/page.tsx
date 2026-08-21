import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { DarkZoneMap } from '@/components/DarkZoneMap';
import { AgentDock } from '@/components/agent/AgentDock';
import { createClient } from '@/lib/supabase/server';
import { hasSupabase } from '@/lib/supabase/config';
import { areaStats } from '@/lib/nightsafety';

/**
 * The product is one screen: the map, with the agent beside it.
 *
 * Splitting them across two tabs meant leaving the map to ask a question about
 * the map. Here you can point at a path and ask why it ranks where it does
 * without losing sight of it.
 */
export default async function Home() {
  // Without Supabase configured the app runs auth-free: the agent still works,
  // chat history just is not persisted. This keeps a missing env var from
  // turning into a broken deploy.
  if (hasSupabase) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Gate on the server, not the client: a client-side redirect would flash
    // the whole app to a signed-out visitor before bouncing them.
    if (!user) redirect('/login');
  }

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
