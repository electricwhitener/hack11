-- Nightline round 2: gates that actually gate.
-- Run in Supabase -> SQL Editor. Safe to re-run.
--
-- Until now a placed checkpoint was drawn on the map and read by nothing else:
-- the router never saw it, so "locked after 8pm" in the note field was prose.
-- Closing times lived only in ACCESS_RULES and PORTALS, both hardcoded, so a
-- surveyor standing at a gate could not record what it does.
--
-- These columns let a point carry its own rule. The router resolves each gate
-- to the path segments it physically sits on, by lat/lng at load time — NOT by
-- segment index, so regenerating the graph re-resolves instead of silently
-- pointing tonight's fieldwork at the wrong paths.

alter table public.checkpoints
  -- null = an ordinary marker that constrains nothing.
  -- 'hard'       = shut to everyone once closed.
  -- 'permission' = passable if you hold `permit`.
  add column if not exists barrier text check (barrier in ('hard', 'permission')),
  -- 24h HH:MM. BOTH null with a barrier set means always shut - a wall, not a
  -- schedule, which is how an authorised-personnel-only gate actually behaves.
  add column if not exists closes  text,
  add column if not exists opens   text,
  -- What gets you through a 'permission' barrier, e.g. 'outpass'.
  add column if not exists permit  text;

comment on column public.checkpoints.barrier is
  'null = marker only; hard = shut to all; permission = passable with permit';
comment on column public.checkpoints.closes is
  'HH:MM. With opens, the shut window (wraps midnight). Null + barrier = always shut.';
