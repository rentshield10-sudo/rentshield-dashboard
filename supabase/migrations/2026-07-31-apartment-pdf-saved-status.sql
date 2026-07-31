-- Tracks the "staff filled in the data and saved it" milestone, distinct
-- from rentvine_file_matched/uploaded_via_mission_control_at (both about
-- Rentvine specifically). This is the step before an approver reviews the
-- draft and it goes out to the client for signature.
alter table public.apartment_lease_details add column if not exists pdf_saved_status text;
alter table public.apartment_lease_details add column if not exists pdf_saved_at timestamptz;

notify pgrst, 'reload schema';
