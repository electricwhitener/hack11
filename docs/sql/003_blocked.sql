-- Lets a surveyor mark a stretch as not-walkable-at-all: a fence line, a wall,
-- a lawn OpenStreetMap thinks is a path, a service yard that is gated.
--
-- Stored per segment rather than baked into graph.json so blocking does NOT
-- renumber segments and therefore cannot corrupt survey data.
alter table public.path_surveys
  add column if not exists blocked boolean not null default false;

-- lighting is not known for a purely structural block, so allow it to be null
alter table public.path_surveys
  alter column lighting drop not null;
