# Lease Renewals — Supabase Persistence + Color-Coded Table (Phase 1)

**Date:** 2026-07-27
**Status:** Approved
**Scope note:** This is Phase 1 of a two-phase project. Phase 2 (two-way Google Sheets sync at `https://docs.google.com/spreadsheets/d/1i9Q3Bcul0C4tYwfUTHw6dYjKtEq6LGSOMRm4k115UGg/`) is a separate future spec, deferred until this data model is proven.

## Background

Mission Control already has a Rentvine integration (`components/rentvine/RentvineTab.tsx`, `app/api/rentvine/lease-renewals/route.ts`) that live-fetches lease renewal data from Rentvine on button press and caches it in `localStorage`. It has no persistence layer and no visual indication of urgency beyond per-cell badges.

Separately, the team manually tracks lease renewals in a Google Sheet ("List of Renewals Leases") with columns including Tenant Name, Activation/Expiration dates, Current Rent, Security Deposit, a manually-set Lease Status (EXPIRED/EXPIRING/NEW/EVICTED), Notes, and Lease Sent status. That sheet has manual fields Rentvine doesn't provide.

Goal for Phase 1: give the dashboard a persisted, Supabase-backed version of the Rentvine renewals data with row-level color coding for at-a-glance status, replacing the live-only fetch. This also creates the data store Phase 2 will sync against the Google Sheet.

## Architecture

```
"Sync Now" button (RentvineTab)
  → POST /api/rentvine/lease-sync
      → fetch /leases/renewals + /leases?leaseStatusID=2 from Rentvine
      → upsert rows into Supabase public.lease_renewals (keyed by lease_id)
  → GET /api/rentvine/lease-renewals
      → reads from Supabase (not live Rentvine)
      → computes daysUntilEnd + statusColor per row at read time
  → RentvineTab renders table; row background driven by statusColor
```

Sync is manual only (no scheduled/cron sync in this phase) — the user explicitly chose "Sync Now" button only over scheduled background sync.

## Data model

```sql
create table public.lease_renewals (
  lease_id text primary key,          -- Rentvine leaseID
  source text not null,               -- 'renewal' | 'expiring'
  tenants text[] not null default '{}',
  address text,
  unit text,
  city text,
  state text,
  portfolio text,
  lease_status text,                  -- Rentvine's own status name
  lease_end date,
  current_rent numeric(12,2),
  current_balance numeric(12,2),
  overdue_balance numeric(12,2),
  has_overdue_balance boolean default false,
  synced_at timestamptz not null default now()
);

create index lease_renewals_lease_end_idx on public.lease_renewals (lease_end);
```

- `lease_id` is primary key; sync upserts on conflict.
- `statusColor` (expired / expiring_soon / ok) is **computed at read time**, not stored, since it depends on "today."
- RLS enabled, browser access revoked, service-role only — same pattern as `apartment_prices`/`apartment_price_history`. Both the sync route and the read route use the Supabase service-role client server-side; the browser never queries this table directly.
- No Notes/Lease Sent/Security Deposit columns yet — deferred to Phase 2 since those are sheet-only manual fields whose sync direction (sheet → Supabase, or Supabase → sheet, or both) hasn't been designed.
- Stale-row cleanup (leases Rentvine stops returning) is out of scope for Phase 1; rows simply stop refreshing.

## Sync route

`POST /api/rentvine/lease-sync`

- Reuses the existing merge logic in `app/api/rentvine/lease-renewals/route.ts` (formal renewals + expiring-not-yet-renewed active leases, 120-day window, dedup by leaseID already in a formal renewal).
- Upserts each merged row into `lease_renewals`, setting `synced_at = now()`.
- Response: `{ ok: true, synced: <count> }` on success; on failure, Supabase-style error shape (`message`, `code`, `details`, `hint`) matching the existing `apartment-prices` route's error handling, not `String(error)`.

## Read route

`GET /api/rentvine/lease-renewals` (rewritten to read from Supabase instead of live Rentvine)

- Selects all rows from `lease_renewals`, ordered by `lease_end`.
- Computes per row:
  - `daysUntilEnd`: integer days between today and `lease_end` (null if `lease_end` is null).
  - `statusColor`:
    - `expired` if `lease_end < today`
    - `expiring_soon` if `0 <= daysUntilEnd <= 30`
    - `ok` otherwise (including null `lease_end`, treated as ok/unknown rather than erroring)
- Response shape stays compatible with the current `RenewalRow` type in `RentvineTab.tsx` plus the new `statusColor` field.

## UI changes (`RentvineTab.tsx`)

- "Fetch Renewals" button becomes "Sync Now" — calls `POST /api/rentvine/lease-sync`, then re-fetches `GET /api/rentvine/lease-renewals`.
- Table row gets a background-tint class based on `statusColor`:
  - `expired` → red tint
  - `expiring_soon` → amber tint
  - `ok` → no tint (existing neutral row style)
- Existing per-cell badges (days-left, overdue balance) are unchanged.
- `localStorage` cache (`rentvine_renewals_cache`) continues to work the same way, now caching the Supabase-sourced payload.

## Error handling

- Sync failures surface through the existing error banner UI.
- A lease row with a missing/malformed `lease_end` is treated as `statusColor: "ok"` rather than throwing.

## Testing / verification

Manual verification (no automated test suite exists for this app currently):

1. Trigger "Sync Now" and confirm the returned `synced` count is sane (roughly matches Rentvine's renewal + expiring-lease count).
2. Confirm a known-expired test lease renders with the red row tint.
3. Confirm a known lease expiring within 30 days renders with the amber row tint.
4. Re-run "Sync Now" and confirm existing rows update in place (no duplicate rows, `synced_at` advances).
5. Confirm the browser cannot query `lease_renewals` directly (RLS blocks anon/authenticated access).

## Out of scope (Phase 2+)

- Two-way sync with the Google Sheet.
- Manual fields: Notes, Lease Sent, Security Deposit, hand-set Lease Status overrides (NEW/EVICTED/etc.).
- Scheduled/cron-based sync.
- Stale-row cleanup/deletion.
