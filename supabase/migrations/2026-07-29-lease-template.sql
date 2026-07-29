create table if not exists lease_template_fields (
  id bigint generated always as identity primary key,
  page_number integer not null default 1,
  x numeric not null,
  y numeric not null,
  width numeric not null,
  height numeric not null,
  label text not null,
  field_type text not null default 'text' check (field_type in ('text', 'date', 'signature')),
  created_at timestamptz not null default now()
);

alter table lease_template_fields enable row level security;

create table if not exists lease_template_remembered_values (
  id bigint generated always as identity primary key,
  label text not null,
  value text not null,
  last_used_at timestamptz not null default now()
);

alter table lease_template_remembered_values enable row level security;

create table if not exists lease_template_drafts (
  id bigint generated always as identity primary key,
  apartment_lease_details_id bigint references apartment_lease_details(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table lease_template_drafts enable row level security;

create table if not exists lease_template_filled_values (
  id bigint generated always as identity primary key,
  draft_id bigint not null references lease_template_drafts(id) on delete cascade,
  field_id bigint not null references lease_template_fields(id) on delete cascade,
  value text not null,
  updated_at timestamptz not null default now(),
  unique (draft_id, field_id)
);

alter table lease_template_filled_values enable row level security;
