-- Nightline round 2: surveyor tables.
-- Run in Supabase -> SQL Editor. Safe to re-run.

-- Surveyed ground truth. Outranks OSM tags, our seeded guess, and citizen
-- reports: somebody stood on the path and looked at it.
create table if not exists public.path_surveys (
  segment_idx int primary key,
  lighting    text not null check (lighting in ('lit', 'dim', 'dark')),
  -- Optional correction when the model's foot-traffic estimate is visibly
  -- wrong on the ground. Null means "the model's number is fine".
  traffic     text check (traffic in ('high', 'medium', 'low')),
  note        text,
  surveyor    text,
  updated_at  timestamptz not null default now()
);

-- Points a surveyor places by hand: security posts, medical, shops, gates,
-- anything OpenStreetMap is missing. Editable and deletable.
create table if not exists public.checkpoints (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text not null default 'checkpoint',
  lat        double precision not null,
  lng        double precision not null,
  note       text,
  updated_at timestamptz not null default now()
);

alter table public.path_surveys enable row level security;
alter table public.checkpoints  enable row level security;

-- Reads are public; writes are gated by a passcode in the API layer, not here.
drop policy if exists "read surveys"  on public.path_surveys;
drop policy if exists "write surveys" on public.path_surveys;
create policy "read surveys"  on public.path_surveys for select using (true);
create policy "write surveys" on public.path_surveys for all using (true) with check (true);

drop policy if exists "read checkpoints"  on public.checkpoints;
drop policy if exists "write checkpoints" on public.checkpoints;
create policy "read checkpoints"  on public.checkpoints for select using (true);
create policy "write checkpoints" on public.checkpoints for all using (true) with check (true);
