# Lease Renewals Supabase Persistence (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Rentvine lease/renewal data in a new Supabase table, add a manual "Sync Now" action, and color-code the dashboard's Rentvine table rows by expired / expiring-soon / ok status.

**Architecture:** A new `lib/rentvine.ts` module holds the Rentvine-fetching logic (extracted from the current live-fetch route, unchanged). A new `POST /api/rentvine/lease-sync` route calls it and upserts rows into a new `public.lease_renewals` Supabase table. The existing `GET /api/rentvine/lease-renewals` route is rewritten to read from Supabase instead of Rentvine directly, computing `daysUntilEnd`/`statusColor` per row. `RentvineTab.tsx` calls sync-then-fetch from one button and tints table rows based on `statusColor`.

**Tech Stack:** Next.js 16 (App Router) API routes, TypeScript, `@supabase/supabase-js` service-role client (`lib/supabase-server.ts`), CSS Modules.

## Global Constraints

- Never expose `SUPABASE_SERVICE_ROLE_KEY` or Rentvine credentials to browser code — all Supabase/Rentvine calls stay in server-side route handlers (spec: Data model / Architecture).
- `lease_renewals` RLS: enabled, browser (anon/authenticated) access revoked, service-role only — matches the `apartment_prices` pattern (spec: Data model).
- `statusColor` is computed at read time from `lease_end`, never stored (spec: Data model).
- Sync is manual-only via a button in this phase — no cron/scheduled job (spec: Architecture).
- No automated test framework exists in this repo (`package.json` has no `test` script, no jest/vitest). Verification steps in this plan use `npx tsc --noEmit`, `npm run lint`, `curl`, and manual browser checks instead of unit tests — this mirrors how the existing `apartment-prices` feature was verified (see `Documentation/Mission-Control-Daily-Handoff-2026-07-16.md` §11).
- Rentvine env vars (`RENTVINE_ACC_CODE`, `RENTVINE_ACC_KEY`, `RENTVINE_ACC_SECRET`) and Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) already exist in `.env.local` — no new env vars needed.

---

### Task 1: Create the `lease_renewals` Supabase table

**Files:**
- Create: `supabase/migrations/2026-07-27-lease-renewals.sql`

**Interfaces:**
- Produces: Supabase table `public.lease_renewals` with columns `lease_id text primary key, source text, tenants text[], address text, unit text, city text, state text, portfolio text, lease_status text, lease_end date, current_rent numeric(12,2), current_balance numeric(12,2), overdue_balance numeric(12,2), has_overdue_balance boolean, synced_at timestamptz`. Later tasks (2, 3) write/read this exact table and column set.

- [ ] **Step 1: Write the migration SQL file**

```sql
-- supabase/migrations/2026-07-27-lease-renewals.sql
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
```

- [ ] **Step 2: Run the migration against Supabase**

Open the Supabase SQL editor for this project and run the full contents of `supabase/migrations/2026-07-27-lease-renewals.sql`.

- [ ] **Step 3: Verify the table exists with correct structure**

Run this in the Supabase SQL editor:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'lease_renewals'
order by ordinal_position;
```

Expected: 15 rows — `lease_id, source, tenants, address, unit, city, state, portfolio, lease_status, lease_end, current_rent, current_balance, overdue_balance, has_overdue_balance, synced_at`.

- [ ] **Step 4: Verify RLS blocks anon access**

Run this in the Supabase SQL editor (using the `anon` role, e.g. via the Supabase API/REST tester or `set role anon; select * from public.lease_renewals;`):

```sql
set role anon;
select * from public.lease_renewals;
reset role;
```

Expected: permission denied error (RLS blocks the read).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/2026-07-27-lease-renewals.sql
git commit -m "feat: add lease_renewals Supabase table"
```

---

### Task 2: Extract Rentvine-fetching logic into `lib/rentvine.ts`

**Files:**
- Create: `lib/rentvine.ts`
- Modify: `app/api/rentvine/lease-renewals/route.ts` (full replacement — becomes a thin wrapper calling the new lib for now; Task 4 will rewrite it again to read from Supabase)
- Test: manual `curl` verification (no automated test framework in this repo)

**Interfaces:**
- Produces: `export interface RenewalRow { source: "renewal" | "expiring"; leaseID: string; tenants: string[]; address: string; unit: string; city: string; state: string; portfolio: string; leaseStatus: string; leaseEnd: string; daysUntilEnd: string | null; currentRent: string; currentBalance: string; overdueBalance: string; hasOverdueBalance: boolean; }` and `export async function fetchRentvineRenewals(): Promise<RenewalRow[]>` — used by Task 3 (sync route).

- [ ] **Step 1: Create `lib/rentvine.ts` with the extracted fetch logic**

This is a straight extraction of the existing merge logic currently inline in `app/api/rentvine/lease-renewals/route.ts` — behavior must stay identical.

```ts
// lib/rentvine.ts

// Rentvine API:
// - Base URL: https://{account_host}/api/manager/
// - Auth: HTTP Basic — Base64("api_key:api_secret") in Authorization header
//
// Merges two sources for a complete renewals picture:
//   1. /leases/renewals  — formal renewal records created in Rentvine
//   2. /leases           — active leases whose end date has passed or is within
//                          EXPIRY_WINDOW_DAYS, that don't already have a renewal record

const EXPIRY_WINDOW_DAYS = 120;

export interface RenewalRow {
  source: "renewal" | "expiring";
  leaseID: string;
  tenants: string[];
  address: string;
  unit: string;
  city: string;
  state: string;
  portfolio: string;
  leaseStatus: string;
  leaseEnd: string;
  daysUntilEnd: string | null;
  currentRent: string;
  currentBalance: string;
  overdueBalance: string;
  hasOverdueBalance: boolean;
}

function getBasicAuth(apiKey: string, apiSecret: string): string {
  return Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
}

function normalizeHost(accCode: string): string {
  // ACC_CODE may be stored as full domain or just the subdomain.
  return accCode.includes(".") ? accCode : `${accCode}.rentvine.com`;
}

async function rentvineGet(baseUrl: string, path: string, auth: string): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Rentvine ${path} → ${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

export async function fetchRentvineRenewals(): Promise<RenewalRow[]> {
  const accountCode = process.env.RENTVINE_ACC_CODE;
  const apiKey = process.env.RENTVINE_ACC_KEY;
  const apiSecret = process.env.RENTVINE_ACC_SECRET;

  const missing = [
    !accountCode && "RENTVINE_ACC_CODE",
    !apiKey && "RENTVINE_ACC_KEY",
    !apiSecret && "RENTVINE_ACC_SECRET",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }

  const auth = getBasicAuth(apiKey!, apiSecret!);
  const baseUrl = `https://${normalizeHost(accountCode!)}/api/manager`;

  const [renewalsData, leasesData] = (await Promise.all([
    rentvineGet(baseUrl, "/leases/renewals?per-page=100", auth),
    rentvineGet(baseUrl, "/leases?leaseStatusID=2&per-page=100", auth),
  ])) as [Record<string, unknown>, unknown[]];

  // --- Formal renewal records ---
  const formalRenewals = (
    Array.isArray(renewalsData?.data)
      ? renewalsData.data
      : Array.isArray(renewalsData)
        ? renewalsData
        : []
  ) as Record<string, unknown>[];

  const renewedLeaseIds = new Set<string>(
    formalRenewals.map((r) => String((r.lease as Record<string, unknown>)?.leaseID ?? "")),
  );

  const renewalRows: RenewalRow[] = formalRenewals.map((r) => {
    const lease = r.lease as Record<string, unknown>;
    const property = r.property as Record<string, unknown>;
    const unit = r.unit as Record<string, unknown>;
    const portfolio = r.portfolio as Record<string, unknown>;
    const leaseStatus = r.leaseStatus as Record<string, unknown>;
    return {
      source: "renewal",
      leaseID: String(lease?.leaseID ?? ""),
      tenants: (lease?.tenants as string[]) ?? [],
      address: String(property?.address ?? unit?.address ?? ""),
      unit: String(unit?.address2 ?? ""),
      city: String(property?.city ?? unit?.city ?? ""),
      state: String(property?.stateID ?? unit?.stateID ?? ""),
      portfolio: String(portfolio?.name ?? ""),
      leaseStatus: String(leaseStatus?.name ?? ""),
      leaseEnd: String(lease?.endDate ?? ""),
      daysUntilEnd: lease?.daysUntilLeaseEnd != null ? String(lease.daysUntilLeaseEnd) : null,
      currentRent: String(lease?.currentRent ?? ""),
      currentBalance: String(lease?.currentBalance ?? "0"),
      overdueBalance: String(lease?.overdueBalance ?? "0"),
      hasOverdueBalance: String(lease?.hasOverdueBalance ?? "0") === "1",
    };
  });

  // --- Active leases expiring soon (not already in renewals) ---
  const leaseList = Array.isArray(leasesData) ? leasesData : [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + EXPIRY_WINDOW_DAYS);

  const expiringRows = leaseList
    .map((item) => {
      const i = item as Record<string, unknown>;
      const lease = i.lease as Record<string, unknown>;
      const unit = i.unit as Record<string, unknown>;
      const leaseID = String(lease?.leaseID ?? "");
      const endDate = String(lease?.endDate ?? "");

      if (renewedLeaseIds.has(leaseID)) return null; // already in formal renewals
      if (!endDate) return null;

      const endDt = new Date(endDate);
      if (endDt > cutoff) return null; // too far in future

      const now = new Date();
      const msPerDay = 1000 * 60 * 60 * 24;
      const daysLeft = Math.ceil((endDt.getTime() - now.getTime()) / msPerDay);

      const row: RenewalRow = {
        source: "expiring",
        leaseID,
        tenants: (lease?.tenants as string[]) ?? [],
        address: String(unit?.address ?? ""),
        unit: String(unit?.address2 ?? ""),
        city: String(unit?.city ?? ""),
        state: String(unit?.stateID ?? ""),
        portfolio: "",
        leaseStatus: "Active",
        leaseEnd: endDate,
        daysUntilEnd: String(daysLeft),
        currentRent: String(unit?.rent ?? ""),
        currentBalance: "0",
        overdueBalance: "0",
        hasOverdueBalance: false,
      };
      return row;
    })
    .filter((row): row is RenewalRow => row !== null);

  return [...renewalRows, ...expiringRows];
}
```

- [ ] **Step 2: Replace `app/api/rentvine/lease-renewals/route.ts` to use the extracted lib (temporary — behavior unchanged)**

```ts
// app/api/rentvine/lease-renewals/route.ts
import { NextResponse } from "next/server";
import { fetchRentvineRenewals } from "@/lib/rentvine";

export async function GET() {
  try {
    const renewals = await fetchRentvineRenewals();
    return NextResponse.json({ ok: true, renewals, total: renewals.length });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Manually verify the route still returns live Rentvine data unchanged**

Run: `npm run dev` (note the port it prints, e.g. 3002), then in another terminal:

```bash
curl -s http://localhost:3002/api/rentvine/lease-renewals | head -c 500
```

Expected: `{"ok":true,"renewals":[...` with the same shape as before this refactor (same fields per row).

- [ ] **Step 5: Commit**

```bash
git add lib/rentvine.ts app/api/rentvine/lease-renewals/route.ts
git commit -m "refactor: extract Rentvine fetch/merge logic into lib/rentvine.ts"
```

---

### Task 3: Add the sync route (`POST /api/rentvine/lease-sync`)

**Files:**
- Create: `app/api/rentvine/lease-sync/route.ts`
- Test: manual `curl` + Supabase SQL verification

**Interfaces:**
- Consumes: `fetchRentvineRenewals(): Promise<RenewalRow[]>` from `lib/rentvine.ts` (Task 2); `supabaseServer` from `lib/supabase-server.ts`; `lease_renewals` table from Task 1.
- Produces: `POST /api/rentvine/lease-sync` → `{ ok: true, synced: number }` or `{ ok: false, error: string, detail?: unknown }`. Not consumed by other tasks' code, but the UI (Task 5) calls this endpoint by URL.

- [ ] **Step 1: Write the sync route**

```ts
// app/api/rentvine/lease-sync/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { fetchRentvineRenewals } from "@/lib/rentvine";

function toNumberOrNull(value: string): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function POST() {
  try {
    const rows = await fetchRentvineRenewals();

    const upsertRows = rows.map((r) => ({
      lease_id: r.leaseID,
      source: r.source,
      tenants: r.tenants,
      address: r.address,
      unit: r.unit,
      city: r.city,
      state: r.state,
      portfolio: r.portfolio,
      lease_status: r.leaseStatus,
      lease_end: r.leaseEnd || null,
      current_rent: toNumberOrNull(r.currentRent),
      current_balance: toNumberOrNull(r.currentBalance),
      overdue_balance: toNumberOrNull(r.overdueBalance),
      has_overdue_balance: r.hasOverdueBalance,
      synced_at: new Date().toISOString(),
    }));

    if (upsertRows.length === 0) {
      return NextResponse.json({ ok: true, synced: 0 });
    }

    const { error } = await supabaseServer
      .from("lease_renewals")
      .upsert(upsertRows, { onConflict: "lease_id" });

    if (error) throw error;

    return NextResponse.json({ ok: true, synced: upsertRows.length });
  } catch (error) {
    const err = error as { message?: string; code?: string; details?: string; hint?: string };
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || String(error),
        detail: { code: err?.code, details: err?.details, hint: err?.hint },
      },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Manually verify the sync writes rows to Supabase**

With `npm run dev` running:

```bash
curl -s -X POST http://localhost:3002/api/rentvine/lease-sync
```

Expected: `{"ok":true,"synced":<some number > 0>}`.

Then in the Supabase SQL editor:

```sql
select lease_id, source, address, lease_end, current_rent, synced_at
from public.lease_renewals
order by synced_at desc
limit 10;
```

Expected: rows present with a recent `synced_at` timestamp.

- [ ] **Step 4: Verify re-running sync updates rows in place (no duplicates)**

Run the same `curl -s -X POST http://localhost:3002/api/rentvine/lease-sync` command again.

Then in the Supabase SQL editor:

```sql
select count(*) from public.lease_renewals;
select lease_id, count(*) from public.lease_renewals group by lease_id having count(*) > 1;
```

Expected: total row count is the same as after the first sync (assuming no real-world lease changes in between); the duplicate-check query returns zero rows (since `lease_id` is the primary key, duplicates are structurally impossible, but this confirms the upsert path, not an insert path).

- [ ] **Step 5: Commit**

```bash
git add app/api/rentvine/lease-sync/route.ts
git commit -m "feat: add Rentvine-to-Supabase lease sync route"
```

---

### Task 4: Rewrite `GET /api/rentvine/lease-renewals` to read from Supabase with computed status

**Files:**
- Modify: `app/api/rentvine/lease-renewals/route.ts`
- Test: manual `curl` verification

**Interfaces:**
- Consumes: `supabaseServer` from `lib/supabase-server.ts`; `lease_renewals` table from Task 1 (must already have rows from Task 3's sync for this to return data).
- Produces: `GET /api/rentvine/lease-renewals` → `{ ok: true, renewals: RenewalRowWithStatus[], total: number }` where each row has all the original `RenewalRow` fields plus `statusColor: "expired" | "expiring_soon" | "ok"`. Consumed by `RentvineTab.tsx` (Task 5), which needs the exact field name `statusColor`.

- [ ] **Step 1: Rewrite the route**

```ts
// app/api/rentvine/lease-renewals/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

type StatusColor = "expired" | "expiring_soon" | "ok";

const EXPIRING_SOON_DAYS = 30;

function computeStatus(leaseEnd: string | null): {
  daysUntilEnd: number | null;
  statusColor: StatusColor;
} {
  if (!leaseEnd) return { daysUntilEnd: null, statusColor: "ok" };

  const end = new Date(leaseEnd);
  if (isNaN(end.getTime())) return { daysUntilEnd: null, statusColor: "ok" };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysUntilEnd = Math.round((end.getTime() - today.getTime()) / msPerDay);

  let statusColor: StatusColor = "ok";
  if (daysUntilEnd < 0) statusColor = "expired";
  else if (daysUntilEnd <= EXPIRING_SOON_DAYS) statusColor = "expiring_soon";

  return { daysUntilEnd, statusColor };
}

export async function GET() {
  try {
    const { data, error } = await supabaseServer
      .from("lease_renewals")
      .select(
        "lease_id, source, tenants, address, unit, city, state, portfolio, lease_status, lease_end, current_rent, current_balance, overdue_balance, has_overdue_balance, synced_at",
      )
      .order("lease_end", { ascending: true });

    if (error) throw error;

    const renewals = (data || []).map((row) => {
      const { daysUntilEnd, statusColor } = computeStatus(row.lease_end);
      return {
        source: row.source as "renewal" | "expiring",
        leaseID: row.lease_id as string,
        tenants: (row.tenants as string[]) || [],
        address: (row.address as string) || "",
        unit: (row.unit as string) || "",
        city: (row.city as string) || "",
        state: (row.state as string) || "",
        portfolio: (row.portfolio as string) || "",
        leaseStatus: (row.lease_status as string) || "",
        leaseEnd: (row.lease_end as string) || "",
        daysUntilEnd: daysUntilEnd !== null ? String(daysUntilEnd) : null,
        currentRent: row.current_rent !== null ? String(row.current_rent) : "",
        currentBalance: row.current_balance !== null ? String(row.current_balance) : "0",
        overdueBalance: row.overdue_balance !== null ? String(row.overdue_balance) : "0",
        hasOverdueBalance: !!row.has_overdue_balance,
        statusColor,
      };
    });

    return NextResponse.json({ ok: true, renewals, total: renewals.length });
  } catch (error) {
    const err = error as { message?: string; code?: string; details?: string; hint?: string };
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || String(error),
        detail: { code: err?.code, details: err?.details, hint: err?.hint },
      },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Manually verify the route reads from Supabase with statusColor**

With `npm run dev` running (and Task 3's sync already having populated rows):

```bash
curl -s http://localhost:3002/api/rentvine/lease-renewals | head -c 800
```

Expected: `{"ok":true,"renewals":[{"source":...,"leaseID":...,...,"statusColor":"expired"|"expiring_soon"|"ok"},...],"total":<n>}`.

- [ ] **Step 4: Verify statusColor thresholds against a known row**

In the Supabase SQL editor, find a lease ending in the past and one ending within 30 days:

```sql
select lease_id, address, lease_end,
  (lease_end - current_date) as days_until_end
from public.lease_renewals
where lease_end is not null
order by lease_end asc
limit 5;
```

Cross-check: any row with `days_until_end < 0` must appear with `"statusColor":"expired"` in the curl output from Step 3; any row with `0 <= days_until_end <= 30` must appear with `"statusColor":"expiring_soon"`.

- [ ] **Step 5: Commit**

```bash
git add app/api/rentvine/lease-renewals/route.ts
git commit -m "feat: read lease renewals from Supabase with computed status color"
```

---

### Task 5: Update `RentvineTab.tsx` — Sync Now button + row coloring

**Files:**
- Modify: `components/rentvine/RentvineTab.tsx`
- Modify: `components/rentvine/RentvineTab.module.css`
- Test: manual browser verification (no automated UI test framework in this repo)

**Interfaces:**
- Consumes: `POST /api/rentvine/lease-sync` (Task 3), `GET /api/rentvine/lease-renewals` → rows with `statusColor: "expired" | "expiring_soon" | "ok"` (Task 4).

- [ ] **Step 1: Add `statusColor` to the `RenewalRow` interface and add the sync-then-fetch function**

In `components/rentvine/RentvineTab.tsx`, update the interface and replace `fetchRenewals`:

```tsx
interface RenewalRow {
  source: "renewal" | "expiring";
  leaseID: string;
  tenants: string[];
  address: string;
  unit: string;
  city: string;
  state: string;
  portfolio: string;
  leaseStatus: string;
  leaseEnd: string;
  daysUntilEnd: string | null;
  currentRent: string;
  currentBalance: string;
  overdueBalance: string;
  hasOverdueBalance: boolean;
  statusColor: "expired" | "expiring_soon" | "ok";
}
```

Replace the `fetchRenewals` function with:

```tsx
  async function syncNow() {
    setStatus("loading");
    setErrorMessage("");
    setErrorDetail("");

    try {
      const syncRes = await fetch("/api/rentvine/lease-sync", {
        method: "POST",
        cache: "no-store",
      });
      const syncJson: { ok: boolean; error?: string; detail?: unknown; synced?: number } =
        await syncRes.json();

      if (!syncJson.ok) {
        setErrorMessage(syncJson.error || "Sync failed.");
        setErrorDetail(
          syncJson.detail !== undefined ? JSON.stringify(syncJson.detail, null, 2) : "",
        );
        setStatus("error");
        return;
      }

      const res = await fetch("/api/rentvine/lease-renewals", { cache: "no-store" });
      const json: ApiResponse = await res.json();

      if (!json.ok) {
        setErrorMessage(json.error);
        setErrorDetail(json.detail !== undefined ? JSON.stringify(json.detail, null, 2) : "");
        setStatus("error");
        return;
      }

      const now = new Date().toISOString();
      setRenewals(json.renewals);
      setTotal(json.total);
      setFetchedAt(now);
      setStatus("success");
      saveCache({ renewals: json.renewals, total: json.total, fetchedAt: now });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Unexpected error.");
      setStatus("error");
    }
  }
```

- [ ] **Step 2: Update the button and empty-state copy to reference "Sync Now"**

Replace the button JSX:

```tsx
            <button
              type="button"
              className={styles.primaryButton}
              onClick={syncNow}
              disabled={isLoading}
            >
              {isLoading ? "Syncing..." : "Sync Now"}
            </button>
```

Replace the idle-state prompt text:

```tsx
      {status === "idle" && (
        <div className={styles.prompt}>
          <div className={styles.promptTitle}>No data loaded</div>
          <div>Press &quot;Sync Now&quot; to pull lease renewals from Rentvine into Supabase.</div>
        </div>
      )}
```

- [ ] **Step 3: Add row coloring based on `statusColor`**

Update the table row JSX to add a conditional class:

```tsx
                    {renewals.map((r) => {
                      const days = r.daysUntilEnd !== null ? parseInt(r.daysUntilEnd) : null;
                      const isUrgent = days !== null && days <= 30;
                      const isPast = days !== null && days < 0;
                      const rowClass =
                        r.statusColor === "expired"
                          ? styles.rowExpired
                          : r.statusColor === "expiring_soon"
                            ? styles.rowExpiringSoon
                            : undefined;

                      return (
                        <tr key={`${r.source}-${r.leaseID}`} className={rowClass}>
```

(The rest of the `<tr>` body — cells — stays exactly as it is today; only the opening `<tr>` tag and the three new variables above change.)

- [ ] **Step 4: Add row-tint CSS classes**

Append to `components/rentvine/RentvineTab.module.css`:

```css
/* ── Row status tints ────────────────────────────────────────────────────── */

.rowExpired td {
    background: #fef2f2;
}

.rowExpired:hover td {
    background: #fee2e2;
}

.rowExpiringSoon td {
    background: #fffbeb;
}

.rowExpiringSoon:hover td {
    background: #fef3c7;
}
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Manually verify in the browser**

With `npm run dev` running, open the Rentvine tab in the dashboard (whatever port `npm run dev` printed, e.g. `http://localhost:3002`):

1. Click "Sync Now". Confirm the button shows "Syncing..." then returns to "Sync Now", and the table populates.
2. Confirm at least one row with a past `lease_end` has a light red row background.
3. Confirm at least one row with `lease_end` within 30 days has a light amber row background.
4. Confirm rows with `lease_end` further out have no tint (default white/hover background).
5. Reload the page — confirm the table still shows the same data without needing to click "Sync Now" again (proves it's reading from Supabase, not requiring a fresh Rentvine call on every page load).

- [ ] **Step 7: Commit**

```bash
git add components/rentvine/RentvineTab.tsx components/rentvine/RentvineTab.module.css
git commit -m "feat: add Sync Now action and row status coloring to Rentvine tab"
```

---

## Self-Review Notes

- **Spec coverage:** Architecture (Task 3+4+5), Data model (Task 1), Sync route (Task 3), Read route (Task 4), UI changes (Task 5), Error handling (Tasks 3 & 4 use the `apartment-prices`-style error shape; Task 4 treats missing/malformed `lease_end` as `"ok"`), Testing/verification (manual steps embedded per task) are all covered. Out-of-scope items (Sheets sync, manual fields, cron sync, stale-row cleanup) are intentionally not addressed — Phase 2.
- **Type consistency:** `RenewalRow` (lib/rentvine.ts, Task 2) → consumed by sync route (Task 3) → Supabase columns (Task 1) → read route response shape adds `statusColor` (Task 4) → `RentvineTab.tsx` interface matches exactly (Task 5), including the literal union `"expired" | "expiring_soon" | "ok"` used consistently in Tasks 4 and 5.
