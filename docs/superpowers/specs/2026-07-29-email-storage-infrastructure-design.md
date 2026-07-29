# Email + Storage Infrastructure — Design

**Date:** 2026-07-29
**Status:** Approved, proceeding to implementation plan
**Phase:** 1 of 6 for the tenant e-signature feature (see
`2026-07-29-lease-template-editor-design.md` for the sibling Lease Template
Editor work this eventually connects to).

## Problem

The planned tenant e-signature workflow needs two pieces of infrastructure
that don't exist anywhere in this project yet:

1. A way to send transactional email (OTP codes, document delivery).
2. A way to store PDFs privately (not publicly accessible, not a static
   file in `public/`), with short-lived signed download URLs.

Neither exists today — the one PDF-upload feature in this project (PDF
extraction) parses an upload in-memory and never persists it.

## Scope

**In scope (Phase 1):**
- `lib/email.ts` — a thin wrapper around Resend's API: `sendEmail({ to,
  subject, html })`, reading `RESEND_API_KEY` from env.
- `lib/storage.ts` — a wrapper around Supabase Storage: `uploadFile(path,
  buffer, contentType)` and `getSignedDownloadUrl(path, expiresInSeconds)`.
- One private Supabase Storage bucket (`lease-documents`), no public
  access, with an `originals/` and `completed/` folder convention (the
  folders themselves don't need to be created up front — Storage paths are
  just string prefixes, not real directories).
- Verification via a real Resend sandbox-mode send (to the account owner's
  own email, which works without domain verification) and a real
  upload/signed-URL round trip against the live Supabase bucket — matching
  this project's existing convention of no automated test suite, verified
  instead via direct scripts (as done throughout this session for Rentvine,
  Supabase, and auth work).

**Explicitly deferred:**
- Verifying `rentshieldpropertymanagement.com` as a Resend sending domain
  (DNS records in Namecheap) — the user will do this later, at the point
  production email-sending to arbitrary tenant addresses is actually
  needed. Everything built in this phase works in Resend's sandbox mode
  until then.
- Everything signing-specific (Phases 2–6) — this phase only builds the
  reusable plumbing.

## Design

- `lib/email.ts` throws on failure (matching this project's convention in
  `lib/rentvine.ts`) rather than swallowing errors; callers decide how to
  handle/report failures.
- `lib/storage.ts` uses the Supabase JS client's built-in Storage API
  (`supabaseServer.storage.from(bucket)`) — no new dependency needed, since
  `@supabase/supabase-js` already includes Storage support.
- The bucket is created once via the Supabase dashboard (Storage tab) or a
  one-time SQL/API call — not via a `supabase/migrations/*.sql` file, since
  bucket creation isn't a table DDL statement Postgres migrations cover
  the same way. This will be a manual setup step, same as running SQL
  migrations has been throughout this project.
- Both helpers require `RESEND_API_KEY` and the existing Supabase env vars
  (`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`) — no new
  Supabase-side env vars needed for storage, since it's the same project/
  credentials already in use for the database.

## Error Handling

- `sendEmail` failures throw with Resend's error message intact (callers
  in later phases decide whether a failed OTP email should be retried,
  surfaced to the tenant, etc. — out of scope for this infrastructure-only
  phase to decide).
- `uploadFile`/`getSignedDownloadUrl` failures similarly throw rather than
  silently returning null, so calling code can't accidentally treat a
  failed upload as success.

## Testing

- Manual verification only (matching project convention): a real send via
  Resend's sandbox mode to the account owner's own email, and a real
  upload + signed-URL fetch against the live Supabase bucket — both run
  directly against the actual services, not mocked.
