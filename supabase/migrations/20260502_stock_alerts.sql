create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  organization_type text not null check (organization_type in ('laboratory', 'wholesaler')),
  name text not null,
  legal_name text,
  registration_number text,
  contact_email text,
  contact_phone text,
  city text,
  country text not null default 'MA',
  website text,
  status text not null default 'pending' check (status in ('pending', 'validated', 'rejected', 'disabled')),
  approved_at timestamptz,
  approved_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists organization_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  full_name text not null,
  email text,
  phone_e164 text,
  role text not null default 'manager',
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  access_token_hash text,
  access_token_expires_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists pharmacist_alert_preferences (
  id uuid primary key default gen_random_uuid(),
  pharmacist_id text not null,
  phone_e164 text not null,
  source_type text not null check (source_type in ('laboratory', 'wholesaler')),
  source_id uuid not null references organizations(id) on delete cascade,
  category text not null check (category in ('stock_recovery', 'out_of_stock', 'product_recall', 'new_product', 'regulatory_info')),
  status text not null default 'active' check (status in ('active', 'revoked', 'paused', 'opted_out', 'pending')),
  accepted_at timestamptz,
  revoked_at timestamptz,
  consent_text_version text,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (phone_e164, source_type, source_id, category)
);

create table if not exists consent_versions (
  id uuid primary key default gen_random_uuid(),
  pharmacist_alert_preference_id uuid references pharmacist_alert_preferences(id) on delete set null,
  pharmacist_id text not null,
  phone_e164 text not null,
  source_type text not null,
  source_id uuid references organizations(id) on delete set null,
  category text not null,
  status text not null,
  consent_text_version text,
  ip_address text,
  user_agent text,
  accepted_at timestamptz,
  revoked_at timestamptz,
  changed_at timestamptz not null default timezone('utc', now())
);

create table if not exists uploaded_product_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  organization_type text not null check (organization_type in ('laboratory', 'wholesaler')),
  filename text not null,
  mime_type text,
  storage_path text,
  file_size_bytes bigint,
  parse_status text not null default 'uploaded' check (parse_status in ('uploaded', 'parsed', 'pending_manual_review', 'failed')),
  matched_count integer not null default 0,
  pending_count integer not null default 0,
  rejected_count integer not null default 0,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists supplier_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id_medindex text,
  product_name text not null,
  source text not null default 'manual',
  match_status text not null default 'pending_manual_review' check (match_status in ('validated', 'pending_manual_review', 'rejected')),
  uploaded_file_id uuid references uploaded_product_files(id) on delete set null,
  raw_product_name text,
  raw_row jsonb not null default '{}'::jsonb,
  validated_by text,
  validated_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists stock_alerts (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('laboratory', 'wholesaler')),
  source_id uuid not null references organizations(id) on delete cascade,
  product_id_medindex text not null,
  product_name text not null,
  alert_type text not null check (alert_type in ('stock_recovery', 'out_of_stock', 'product_recall', 'new_product', 'regulatory_info')),
  availability_status text not null,
  available_quantity integer,
  geographic_zone text,
  comment text,
  target_segment text,
  scheduled_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'sending', 'sent', 'cancelled')),
  created_by text,
  approved_at timestamptz,
  approved_by text,
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists stock_alert_recipients (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references stock_alerts(id) on delete cascade,
  pharmacist_id text not null,
  phone_e164 text not null,
  template_key text not null,
  variables jsonb not null default '{}'::jsonb,
  provider_message_sid text,
  status text not null default 'eligible' check (status in ('eligible', 'queued', 'sent', 'delivered', 'failed', 'skipped_no_consent', 'skipped_opted_out')),
  batch_number integer not null default 1,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists whatsapp_message_logs (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid references stock_alerts(id) on delete cascade,
  recipient_id uuid references stock_alert_recipients(id) on delete set null,
  pharmacist_id text not null,
  phone_e164 text not null,
  template_key text not null,
  variables jsonb not null default '{}'::jsonb,
  provider_message_sid text,
  status text not null,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_reason text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null,
  actor_id text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists organizations_type_status_idx
  on organizations (organization_type, status);

create index if not exists organization_users_org_idx
  on organization_users (organization_id, status);

create index if not exists pharmacist_alert_preferences_phone_idx
  on pharmacist_alert_preferences (phone_e164, status);

create index if not exists pharmacist_alert_preferences_source_idx
  on pharmacist_alert_preferences (source_type, source_id, category, status);

create index if not exists consent_versions_phone_idx
  on consent_versions (phone_e164, changed_at desc);

create index if not exists supplier_products_org_status_idx
  on supplier_products (organization_id, match_status);

create unique index if not exists supplier_products_org_medindex_unique_idx
  on supplier_products (organization_id, product_id_medindex)
  where product_id_medindex is not null;

create index if not exists uploaded_product_files_org_idx
  on uploaded_product_files (organization_id, parse_status);

create index if not exists stock_alerts_source_status_idx
  on stock_alerts (source_type, source_id, status, created_at desc);

create index if not exists stock_alert_recipients_alert_idx
  on stock_alert_recipients (alert_id, status);

create index if not exists stock_alert_recipients_message_sid_idx
  on stock_alert_recipients (provider_message_sid);

create index if not exists whatsapp_message_logs_alert_idx
  on whatsapp_message_logs (alert_id, status, created_at desc);

create index if not exists whatsapp_message_logs_sid_idx
  on whatsapp_message_logs (provider_message_sid);

create index if not exists audit_logs_entity_idx
  on audit_logs (entity_type, entity_id, created_at desc);
