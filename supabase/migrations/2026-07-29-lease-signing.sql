create table if not exists signing_requests (
  id bigint generated always as identity primary key,
  draft_id bigint not null references lease_template_drafts(id),
  tenant_name text,
  tenant_email text not null,
  document_id uuid not null default gen_random_uuid(),
  token_hash text not null unique,
  original_pdf_path text,
  original_pdf_hash text,
  completed_pdf_path text,
  completed_pdf_hash text,
  status text not null default 'draft' check (
    status in ('draft','sent','opened','verified','consented','signed','completed','expired','revoked','declined')
  ),
  expires_at timestamptz,
  opened_at timestamptz,
  verified_at timestamptz,
  consented_at timestamptz,
  signed_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table signing_requests enable row level security;

create table if not exists verification_codes (
  id bigint generated always as identity primary key,
  signing_request_id bigint not null references signing_requests(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  failed_attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table verification_codes enable row level security;

create table if not exists signature_records (
  id bigint generated always as identity primary key,
  signing_request_id bigint not null references signing_requests(id) on delete cascade,
  signature_type text not null check (signature_type in ('typed', 'drawn')),
  typed_name text,
  signature_data text,
  consent_text_1 text not null,
  consent_text_2 text not null,
  consent_version integer not null default 1,
  consented_at timestamptz not null,
  signed_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table signature_records enable row level security;

create table if not exists audit_events (
  id bigint generated always as identity primary key,
  signing_request_id bigint references signing_requests(id) on delete cascade,
  document_id uuid,
  event_type text not null,
  event_metadata jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table audit_events enable row level security;
