create table if not exists dashboard_users (
  id bigint generated always as identity primary key,
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

alter table dashboard_users enable row level security;

-- No policies are created: RLS with zero policies blocks all access via the
-- anon/authenticated keys. Only the service-role key (used server-side in
-- app/api/auth/login/route.ts) can read this table, same as every other
-- table in this project.

insert into dashboard_users (username, password_hash) values
  ('admin', '$2b$12$nyaaXmLX8qh5KWd03SzW9eHUlOTknC8m4TSnbaOCBVSMQ4fLi43qO'),
  ('employee1', '$2b$12$SA1Ctn2COhgw/aBEopzaQecTGQLzR1zDIhZiQvmUF65XVGGGI4/7e')
on conflict (username) do nothing;
