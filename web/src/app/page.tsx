import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Chat } from '@/components/Chat';
import { createClient } from '@/lib/supabase/server';
import { hasSupabase } from '@/lib/supabase/config';

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

  return (
    <AppShell title="Agent">
      <Chat />
    </AppShell>
  );
}
