import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** GET /api/chats — the signed-in user's conversations, newest first. */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // RLS already scopes this to the current user; the filter is belt-and-braces
  // and lets Postgres use the (user_id, updated_at) index.
  const { data, error } = await supabase
    .from('chats')
    .select('id, title, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ chats: data ?? [] });
}

/** POST /api/chats — start a new conversation. */
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { title } = (await request.json().catch(() => ({}))) as { title?: string };

  const { data, error } = await supabase
    .from('chats')
    .insert({ user_id: user.id, title: title?.slice(0, 80) || 'New chat' })
    .select('id, title, created_at, updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ chat: data });
}
