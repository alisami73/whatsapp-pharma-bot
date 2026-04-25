-- Table : chatbot_answer_history
-- Exécuter dans l'éditeur SQL de Supabase (https://supabase.com/dashboard/project/_/sql)

create extension if not exists "pgcrypto";

create table if not exists chatbot_answer_history (
  id               uuid primary key default gen_random_uuid(),
  user_phone_hash  text        not null,          -- sha256(phone)[0:16] — jamais le vrai numéro
  rubrique         text        not null,          -- 'fse' | 'conformites'
  question         text        not null,
  answer           text        not null,
  sources          jsonb,                         -- tableau de sources optionnel
  page_slug        text        not null,          -- = id (alias lisible)
  pdf_url          text,                          -- réservé pour future génération PDF serveur
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);

-- Index pour récupération rapide par utilisateur
create index if not exists idx_answer_history_phone
  on chatbot_answer_history (user_phone_hash, created_at desc);

-- Index pour lookup par slug/id
create index if not exists idx_answer_history_slug
  on chatbot_answer_history (page_slug);

-- RLS : lecture publique par id uniquement (la page web fetch via /api/answers/:id)
alter table chatbot_answer_history enable row level security;

create policy "public_read_by_id"
  on chatbot_answer_history for select
  using (true);   -- la sécurité est garantie par l'UUID opaque

create policy "service_role_insert"
  on chatbot_answer_history for insert
  with check (true);  -- seul le service_role_key peut insérer (côté bot)
