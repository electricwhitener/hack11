-- Nightline round 2: corrections to imported landmarks.
-- Run in Supabase -> SQL Editor. Safe to re-run.
--
-- The 32 landmarks come from OpenStreetMap via graph.json, and graph.json is
-- frozen: regenerating it renumbers every segment and orphans the survey. So a
-- wrong landmark - one that has closed, moved, or was never really a
-- destination - cannot be removed at source. This table overlays corrections on
-- top of the import, keyed by the original OSM name.

create table if not exists public.place_overrides (
  -- The name exactly as it appears in graph.json.
  name         text primary key,
  -- Hidden places leave the map, the destination pickers and the agent's list.
  hidden       boolean not null default false,
  -- Null keeps the imported name.
  display_name text,
  updated_at   timestamptz not null default now()
);

alter table public.place_overrides enable row level security;

-- Reads are public; writes are gated by the passcode in the API layer.
drop policy if exists "read place overrides"  on public.place_overrides;
drop policy if exists "write place overrides" on public.place_overrides;
create policy "read place overrides"  on public.place_overrides for select using (true);
create policy "write place overrides" on public.place_overrides for all using (true) with check (true);
