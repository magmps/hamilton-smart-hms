-- Hamilton International Hotel HMS — Supabase cloud persistence layer
-- Run this file in Supabase Dashboard > SQL Editor.

create table if not exists public.hms_state (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  checksum text,
  updated_at timestamptz not null default now()
);

comment on table public.hms_state is
  'Server-managed Hamilton HMS state document. Access is restricted to backend secret/service role keys.';

alter table public.hms_state enable row level security;

-- The browser must never access this table directly. The backend uses a
-- Supabase secret key (recommended) or legacy service_role key.
revoke all on table public.hms_state from anon, authenticated;
grant select, insert, update, delete on table public.hms_state to service_role;

create index if not exists hms_state_updated_at_idx
  on public.hms_state (updated_at desc);
