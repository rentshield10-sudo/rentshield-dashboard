-- Enforces sequential signing: Tenant(s) first, then Landlord, then any
-- remaining participant (e.g. Witness - Property Management). A
-- participant can only proceed (view status past a locked gate, verify,
-- and sign) once every participant with a lower signing_order on the same
-- envelope has status = 'signed'.
alter table public.signing_participants add column if not exists signing_order integer not null default 0;

notify pgrst, 'reload schema';
