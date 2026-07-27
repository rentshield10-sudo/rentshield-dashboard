create table public.lease_renewals (
  lease_id text primary key,
  source text not null,
  tenants text[] not null default '{}',
  address text,
  unit text,
  city text,
  state text,
  portfolio text,
  lease_status text,
  lease_end date,
  current_rent numeric(12,2),
  current_balance numeric(12,2),
  overdue_balance numeric(12,2),
  has_overdue_balance boolean not null default false,
  synced_at timestamptz not null default now()
);

create index lease_renewals_lease_end_idx on public.lease_renewals (lease_end);

alter table public.lease_renewals enable row level security;

revoke all on public.lease_renewals from anon, authenticated;
grant all on public.lease_renewals to service_role;

notify pgrst, 'reload schema';
