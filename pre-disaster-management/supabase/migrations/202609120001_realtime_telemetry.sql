-- Run with `supabase db push` or paste into the Supabase SQL editor.
-- The browser never receives a service-role key; all access stays behind authenticated API routes.
create table if not exists public.telemetry_samples (
  id text primary key,
  timestamp timestamptz not null,
  received_at timestamptz not null default now(),
  node_id text not null check (node_id in ('node-1', 'node-2')),
  battery integer not null check (battery between 0 and 100),
  sensors jsonb not null,
  location jsonb,
  rssi integer,
  snr real
);

create index if not exists telemetry_node_time_idx
  on public.telemetry_samples (node_id, timestamp desc);

create table if not exists public.hazard_events (
  id text primary key,
  timestamp timestamptz not null default now(),
  node_id text not null,
  node_name text not null,
  hazard text not null,
  tier text not null check (tier in ('Normal', 'Watch', 'Warning', 'Critical')),
  score integer not null check (score between 0 and 100),
  contributors jsonb not null,
  explanation text not null,
  location jsonb not null
);

create index if not exists hazard_events_time_idx on public.hazard_events (timestamp desc);

alter table public.telemetry_samples enable row level security;
alter table public.hazard_events enable row level security;

-- Realtime is enabled for future native subscribers. The current operator UI uses
-- authenticated server-sent events so database credentials never reach the browser.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'telemetry_samples') then
    alter publication supabase_realtime add table public.telemetry_samples;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hazard_events') then
    alter publication supabase_realtime add table public.hazard_events;
  end if;
end $$;

comment on table public.telemetry_samples is 'Immutable valid hardware packets used for trends, calibration, and reproducible model training.';
comment on table public.hazard_events is 'Rule-engine tier transitions only; advisory ML output never changes this table.';
