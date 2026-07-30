-- Replaces the drag-and-drop PDF field-box editor with a plain-text
-- {{variable}} template (matching the existing message-template editor's
-- pattern). lease_template_fields and lease_template_filled_values are no
-- longer used by the app; left in place rather than dropped, in case any
-- data in them is still wanted -- safe to drop manually later.

create table if not exists lease_templates (
  id bigint generated always as identity primary key,
  name text not null default 'Lease Renewal Agreement',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table lease_templates enable row level security;

create table if not exists lease_template_draft_values (
  id bigint generated always as identity primary key,
  draft_id bigint not null references lease_template_drafts(id) on delete cascade,
  variable_name text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  unique (draft_id, variable_name)
);

alter table lease_template_draft_values enable row level security;
