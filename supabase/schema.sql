-- HACKS 11.0 — chat persistence schema.
-- Run this ONCE in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.chats (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'New chat',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Ordering the sidebar by recency is the only query pattern, so index for it.
create index if not exists chats_user_updated_idx
  on public.chats (user_id, updated_at desc);

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references public.chats(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant', 'system')),
  -- The AI SDK message `parts` array, stored whole. Keeping the original
  -- shape means tool calls, charts, and approvals all survive a reload
  -- exactly as they were rendered.
  parts       jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists messages_chat_created_idx
  on public.messages (chat_id, created_at);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- This is the actual security boundary. The anon key is public and shipped to
-- the browser, so WITHOUT these policies anyone could read every user's chats.
-- With them, Postgres itself refuses to return another user's rows.
-- ---------------------------------------------------------------------------

alter table public.chats    enable row level security;
alter table public.messages enable row level security;

drop policy if exists "own chats" on public.chats;
create policy "own chats" on public.chats
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Messages are reachable only through a chat the user owns.
drop policy if exists "own messages" on public.messages;
create policy "own messages" on public.messages
  for all
  using (
    exists (
      select 1 from public.chats
      where chats.id = messages.chat_id
        and chats.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.chats
      where chats.id = messages.chat_id
        and chats.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Keep chats.updated_at fresh so the sidebar sorts correctly.
-- ---------------------------------------------------------------------------

create or replace function public.touch_chat_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chats set updated_at = now() where id = new.chat_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_chat on public.messages;
create trigger messages_touch_chat
  after insert on public.messages
  for each row execute function public.touch_chat_updated_at();
