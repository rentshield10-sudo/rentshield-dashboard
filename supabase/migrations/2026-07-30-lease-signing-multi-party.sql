-- Extends the single-signer flow to support multiple participants per
-- document (Landlord, Tenant(s), Witness, etc.), each with their own
-- token/OTP/consent/signature. signing_requests now represents the
-- overall "envelope" (one document, its hash, its lifecycle), while each
-- individual signer is a row in signing_participants.
--
-- Additive only: the old signing_requests.tenant_name/tenant_email/
-- token_hash/opened_at/verified_at/consented_at/signed_at columns and the
-- old verification_codes/signature_records tables are left in place, no
-- longer used by the app going forward (single-signer test data from
-- earlier stays intact, nothing dropped).

create table if not exists signing_participants (
  id bigint generated always as identity primary key,
  signing_request_id bigint not null references signing_requests(id) on delete cascade,
  role text not null,
  name text,
  email text not null,
  token_hash text not null unique,
  status text not null default 'sent' check (
    status in ('sent', 'opened', 'verified', 'consented', 'signed', 'declined')
  ),
  expires_at timestamptz,
  opened_at timestamptz,
  verified_at timestamptz,
  consented_at timestamptz,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table signing_participants enable row level security;

create table if not exists participant_verification_codes (
  id bigint generated always as identity primary key,
  participant_id bigint not null references signing_participants(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  failed_attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table participant_verification_codes enable row level security;

create table if not exists participant_signatures (
  id bigint generated always as identity primary key,
  participant_id bigint not null references signing_participants(id) on delete cascade,
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

alter table participant_signatures enable row level security;

alter table audit_events add column if not exists participant_id bigint references signing_participants(id) on delete cascade;

-- signing_requests.tenant_email/token_hash were NOT NULL/UNIQUE under the
-- single-signer model; signers now live in signing_participants instead,
-- so relax these rather than fake placeholder values into them.
alter table signing_requests alter column tenant_email drop not null;
alter table signing_requests alter column token_hash drop not null;
alter table signing_requests drop constraint if exists signing_requests_token_hash_key;
