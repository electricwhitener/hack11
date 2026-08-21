import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { UIMessage } from 'ai';

type Params = { params: Promise<{ id: string }> };

/** GET /api/chats/:id — one conversation with its messages. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: chat, error } = await supabase
    .from('chats')
    .select('id, title, created_at, updated_at')
    .eq('id', id)
    .single();

  // RLS turns "someone else's chat" into "no rows", which is the correct
  // answer to give: it does not leak whether the id exists.
  if (error || !chat) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: rows } = await supabase
    .from('messages')
    .select('id, role, parts, created_at')
    .eq('chat_id', id)
    .order('created_at', { ascending: true });

  const messages: UIMessage[] = (rows ?? []).map((r) => ({
    id: r.id,
    role: r.role as UIMessage['role'],
    parts: r.parts as UIMessage['parts'],
  }));

  return NextResponse.json({ chat, messages });
}

/** PUT /api/chats/:id — replace the stored messages for this conversation. */
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { messages, title } = (await request.json()) as {
    messages: UIMessage[];
    title?: string;
  };

  // Confirm ownership before writing. RLS would block it anyway, but failing
  // here gives a clear 404 instead of a confusing empty write.
  const { data: chat } = await supabase.from('chats').select('id').eq('id', id).single();
  if (!chat) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Replace wholesale. Chats are short and this keeps the client simple —
  // no diffing, no risk of duplicated or missing turns.
  await supabase.from('messages').delete().eq('chat_id', id);

  if (messages.length) {
    const { error } = await supabase.from('messages').insert(
      messages.map((m) => ({
        chat_id: id,
        role: m.role,
        parts: m.parts,
      })),
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (title) {
    await supabase.from('chats').update({ title: title.slice(0, 80) }).eq('id', id);
  }

  await supabase.from('chats').update({ updated_at: new Date().toISOString() }).eq('id', id);

  return NextResponse.json({ ok: true });
}

/** DELETE /api/chats/:id — messages cascade via the foreign key. */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { error } = await supabase.from('chats').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
