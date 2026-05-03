-- Migration : système d'identification consentie WhatsApp → Site
-- Exécuter dans l'éditeur SQL Supabase ou via psql

-- ── user_identities ──────────────────────────────────────────────────────────
create table if not exists user_identities (
  id                uuid primary key default gen_random_uuid(),
  phone_hash        text not null unique,
  whatsapp_wa_id    text,
  whatsapp_from     text,
  profile_name      text,
  consent_status    text not null default 'unknown',
  consent_version   text,
  consent_hash      text,
  consent_channel   text,
  metadata          jsonb default '{}',
  first_seen_at     timestamptz default now(),
  last_seen_at      timestamptz default now(),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists idx_user_identities_phone_hash  on user_identities(phone_hash);
create index if not exists idx_user_identities_wa_id       on user_identities(whatsapp_wa_id);

-- ── user_sessions ─────────────────────────────────────────────────────────────
create table if not exists user_sessions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references user_identities(id) on delete cascade,
  session_token_hash text not null,
  source             text default 'whatsapp',
  campaign           text,
  landing_url        text,
  user_agent         text,
  ip_hash            text,
  metadata           jsonb default '{}',
  created_at         timestamptz default now(),
  expires_at         timestamptz not null
);

create index if not exists idx_user_sessions_user_id on user_sessions(user_id, created_at desc);

-- ── user_visits ───────────────────────────────────────────────────────────────
create table if not exists user_visits (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references user_identities(id) on delete cascade,
  session_id uuid references user_sessions(id) on delete set null,
  page_url   text not null,
  referrer   text,
  source     text default 'whatsapp',
  campaign   text,
  user_agent text,
  ip_hash    text,
  metadata   jsonb default '{}',
  visited_at timestamptz default now()
);

create index if not exists idx_user_visits_user_id on user_visits(user_id, visited_at desc);

-- ── user_events ───────────────────────────────────────────────────────────────
create table if not exists user_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references user_identities(id) on delete cascade,
  session_id uuid references user_sessions(id) on delete set null,
  event_name text not null,
  event_data jsonb default '{}',
  page_url   text,
  created_at timestamptz default now()
);

create index if not exists idx_user_events_user_id on user_events(user_id, created_at desc);

-- ── RLS : désactiver pour accès service_role uniquement ──────────────────────
alter table user_identities disable row level security;
alter table user_sessions   disable row level security;
alter table user_visits     disable row level security;
alter table user_events     disable row level security;
