-- Adds city (needed for the county lookup used by the lease template) and
-- lease-PDF tracking to apartment_lease_details.
--
-- Rentvine's API has no reliable way to ask "does lease X have a file
-- attached" (its /files endpoint ignores objectID/objectTypeID filters
-- entirely -- confirmed by live testing). The only working approach is to
-- paginate the account's full file list once per sync and match by title
-- text against the address, which the sync route does. That match is a
-- heuristic (filename-based), so a manual override exists alongside it for
-- pre-existing Rentvine uploads the heuristic misses. uploaded_via_mission_control_at
-- is the only 100%-certain signal, since it's set by our own upload code.
alter table public.apartment_lease_details add column if not exists city text;
alter table public.apartment_lease_details add column if not exists rentvine_file_matched boolean not null default false;
alter table public.apartment_lease_details add column if not exists rentvine_file_title text;
alter table public.apartment_lease_details add column if not exists rentvine_file_checked_at timestamptz;
alter table public.apartment_lease_details add column if not exists pdf_manual_flag boolean not null default false;
alter table public.apartment_lease_details add column if not exists uploaded_via_mission_control_at timestamptz;
alter table public.apartment_lease_details add column if not exists uploaded_via_mission_control_file_id text;

notify pgrst, 'reload schema';
