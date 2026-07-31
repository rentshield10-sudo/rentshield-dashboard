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

// ---------------------------------------------------------------------------
// Full apartment/lease inventory (Phase 2 — "Fetch All Apartments")
// ---------------------------------------------------------------------------

export interface ApartmentDetailRow {
  address: string;
  unit: string;
  city: string;
  tenantName: string;
  activation1: string;
  expiration1: string;
  activation2: string;
  expiration2: string;
  currentRent: string;
  securityDeposit: string;
  notes: string;
  rentvineLeaseId: string;
  rentvineUnitId: string;
  rentvineLeaseRenewalId: string;
  isActive: boolean;
  leaseStatus: string;
}

// Maps Rentvine's own (granular, account-configurable) lease status names
// down to the dashboard's fixed 7-option dropdown
// (Active/Month to Month/Notice/Pending Move-In/Pending Move-Out/Eviction/
// Past), confirmed against the real status list via GET /leases/statuses:
// Pending, Active, Active - Notice Given, Active - Vacated,
// Active - Evicting, Closed, Closed - Moved Out, Closed - Evicted,
// Closed - Lease Broken. isMonthToMonth is a separate flag on the lease
// itself, not part of the status, so it's applied on top of "Active".
function mapRentvineLeaseStatus(rawStatusName: string, isMonthToMonth: boolean): string {
  const name = rawStatusName.toLowerCase();
  if (name.startsWith("closed")) return "Past";
  if (name.includes("evicting")) return "Eviction";
  if (name.includes("notice given")) return "Notice";
  if (name.includes("vacated")) return "Pending Move-Out";
  if (name === "pending") return "Pending Move-In";
  if (name === "active") return isMonthToMonth ? "Month to Month" : "Active";
  return rawStatusName;
}

const APARTMENT_FETCH_MAX_PAGES = 50;

async function fetchAllLeasesPaginated(
  baseUrl: string,
  auth: string,
): Promise<Record<string, unknown>[]> {
  const allLeases: Record<string, unknown>[] = [];
  let page = 1;

  while (page <= APARTMENT_FETCH_MAX_PAGES) {
    const pageData = (await rentvineGet(baseUrl, `/leases?page=${page}&per-page=25`, auth)) as unknown;
    const pageLeases = Array.isArray(pageData) ? (pageData as Record<string, unknown>[]) : [];
    if (pageLeases.length === 0) break;
    allLeases.push(...pageLeases);
    page += 1;
  }

  return allLeases;
}

// Runs `fn` over `items` with at most `limit` in flight at once -- Rentvine
// has no documented rate limit, but past testing saw an HTML error page
// under rapid concurrent requests, so this stays conservative.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Rentvine has no simple "current rent" field -- unit.rent is a static
// placeholder (confirmed live: nearly every unit in this account shows
// exactly 1500.00 or 1700.00 regardless of the tenant's real rent, which
// ranges from ~$780 to $5300 per actual recurring-charge data). The real
// current rent is the lease's recurring charge(s) flagged isRent=1 on the
// linked account, same flag used by findRentvineRentCharge below -- summed
// here since some leases split rent across multiple isRent charges (e.g. a
// Section 8 lease with separate "Government Assistance Rent" + "Rent
// Income" charges that together make up the total).
async function fetchLeaseCurrentRent(baseUrl: string, auth: string, leaseId: string): Promise<number | null> {
  try {
    const data = (await rentvineGet(baseUrl, `/leases/${leaseId}/recurring-charges`, auth)) as unknown;
    const items = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    let total = 0;
    let found = false;
    for (const item of items) {
      const charge = item.recurringCharge as Record<string, unknown>;
      const account = item.account as Record<string, unknown>;
      if (String(account?.isRent ?? "") === "1") {
        const amount = Number(charge?.amount ?? 0);
        if (Number.isFinite(amount)) {
          total += amount;
          found = true;
        }
      }
    }
    return found ? total : null;
  } catch {
    return null; // best-effort; falls back to unit.rent below
  }
}

export async function fetchAllApartmentDetails(): Promise<ApartmentDetailRow[]> {
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

  const [allLeases, renewalsData, statusesData] = await Promise.all([
    fetchAllLeasesPaginated(baseUrl, auth),
    rentvineGet(baseUrl, "/leases/renewals?per-page=100", auth),
    rentvineGet(baseUrl, "/leases/statuses", auth).catch(() => []), // status names are best-effort
  ]);

  const formalRenewals = (
    Array.isArray((renewalsData as Record<string, unknown>)?.data)
      ? (renewalsData as Record<string, unknown>).data
      : Array.isArray(renewalsData)
        ? renewalsData
        : []
  ) as Record<string, unknown>[];

  const renewalByLeaseId = new Map<string, Record<string, unknown>>();
  for (const r of formalRenewals) {
    const lease = r.lease as Record<string, unknown>;
    const renewal = r.renewal as Record<string, unknown>;
    const leaseId = String(lease?.leaseID ?? "");
    if (leaseId) renewalByLeaseId.set(leaseId, renewal);
  }

  const statusNameById = new Map<string, string>();
  for (const item of (Array.isArray(statusesData) ? statusesData : []) as Record<string, unknown>[]) {
    const status = item.leaseStatus as Record<string, unknown>;
    const id = String(status?.leaseStatusID ?? "");
    if (id) statusNameById.set(id, String(status?.name ?? ""));
  }

  const leaseIds = allLeases
    .map((item) => String((item.lease as Record<string, unknown>)?.leaseID ?? ""))
    .filter(Boolean);
  const rentResults = await mapWithConcurrency(leaseIds, 5, (leaseId) =>
    fetchLeaseCurrentRent(baseUrl, auth, leaseId),
  );
  const currentRentByLeaseId = new Map<string, number | null>();
  leaseIds.forEach((leaseId, i) => currentRentByLeaseId.set(leaseId, rentResults[i]));

  return allLeases.map((item) => {
    const lease = item.lease as Record<string, unknown>;
    const unit = item.unit as Record<string, unknown>;
    const leaseId = String(lease?.leaseID ?? "");
    const renewal = renewalByLeaseId.get(leaseId);
    const rawStatusName = statusNameById.get(String(lease?.leaseStatusID ?? "")) ?? "";
    const realRent = currentRentByLeaseId.get(leaseId);

    return {
      address: String(unit?.address ?? ""),
      unit: String(unit?.address2 ?? ""),
      city: String(unit?.city ?? ""),
      tenantName: ((lease?.tenants as string[]) ?? []).join(", "),
      activation1: String(renewal?.previousStartDate ?? lease?.startDate ?? ""),
      expiration1: String(renewal?.previousEndDate ?? lease?.endDate ?? ""),
      activation2: String(renewal?.startDate ?? ""),
      expiration2: String(renewal?.endDate ?? ""),
      currentRent: realRent != null ? String(realRent) : String(unit?.rent ?? ""),
      securityDeposit: String(unit?.deposit ?? ""),
      notes: String(unit?.leaseNotes ?? ""),
      rentvineLeaseId: leaseId,
      rentvineUnitId: String(unit?.unitID ?? ""),
      rentvineLeaseRenewalId: String(renewal?.leaseRenewalID ?? ""),
      // leaseStatusID "2" = Active in Rentvine, the same value used to filter
      // "/leases?leaseStatusID=2" elsewhere in this file. A unit can have
      // multiple lease records (e.g. a past tenant who moved out plus the
      // current tenant) sharing the same (address, unit) — isActive lets the
      // sync route prefer the current lease over a closed one when deduping.
      isActive: String(lease?.leaseStatusID ?? "") === "2",
      leaseStatus: rawStatusName
        ? mapRentvineLeaseStatus(rawStatusName, String(lease?.isMonthToMonth ?? "") === "1")
        : "",
    };
  });
}

// ---------------------------------------------------------------------------
// Rentvine renewal-date write (Phase 2 — "Save to Rentvine")
// ---------------------------------------------------------------------------

export interface RentvineLeaseSnapshot {
  startDate: string | null;
  endDate: string | null;
}

// Reads a lease's current Start/End Date straight from Rentvine, for
// showing a before/after comparison before actually writing.
export async function getRentvineLeaseSnapshot(leaseId: string): Promise<RentvineLeaseSnapshot> {
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

  const data = (await rentvineGet(baseUrl, `/leases/${leaseId}`, auth)) as Record<string, unknown>;
  const lease = data?.lease as Record<string, unknown> | undefined;

  return {
    startDate: lease?.startDate ? String(lease.startDate) : null,
    endDate: lease?.endDate ? String(lease.endDate) : null,
  };
}

export interface RentvineRentCharge {
  chargeId: string;
  description: string;
  accountName: string;
  amount: string;
}

export type RentvineRentChargeLookup =
  | { status: "found"; charge: RentvineRentCharge }
  | { status: "not_found" }
  | { status: "ambiguous"; candidates: RentvineRentCharge[] };

// Rentvine has no simple "rent" field on a lease — it's a recurring charge.
// The linked chart-of-accounts entry has an authoritative account.isRent
// flag ("1"/"0"), confirmed against a live lease's real recurring-charges
// response — that's the primary match. Free-text description/account-name
// matching is only a fallback if isRent is ever absent. Either way, exactly
// one match is required before allowing a write, since guessing wrong would
// overwrite the wrong charge's amount (e.g. a pet fee) with a rent value.
export async function findRentvineRentCharge(leaseId: string): Promise<RentvineRentChargeLookup> {
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

  const data = (await rentvineGet(
    baseUrl,
    `/leases/${leaseId}/recurring-charges`,
    auth,
  )) as unknown;

  const items = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];

  const mapped = items.map((item) => {
    const charge = item.recurringCharge as Record<string, unknown>;
    const account = item.account as Record<string, unknown>;
    return {
      chargeId: String(charge?.leaseRecurringChargeID ?? ""),
      description: String(charge?.description ?? ""),
      accountName: String(account?.name ?? ""),
      amount: String(charge?.amount ?? ""),
      isRentAccount: String(account?.isRent ?? "") === "1",
    };
  });

  const byFlag = mapped.filter((c) => c.isRentAccount);
  const candidates = byFlag.length > 0
    ? byFlag
    : mapped.filter((c) => /rent/i.test(c.description) || /rent/i.test(c.accountName));

  if (candidates.length === 0) return { status: "not_found" };
  if (candidates.length > 1) return { status: "ambiguous", candidates };
  const { chargeId, description, accountName, amount } = candidates[0];
  return { status: "found", charge: { chargeId, description, accountName, amount } };
}

export async function updateRentvineRecurringCharge(
  leaseId: string,
  chargeId: string,
  fields: { amount: number },
): Promise<unknown> {
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

  const res = await fetch(`${baseUrl}/leases/${leaseId}/recurring-charges/${chargeId}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: fields.amount }),
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(
      `Rentvine POST /leases/${leaseId}/recurring-charges/${chargeId} → ${res.status} ${res.statusText}: ${text}`,
    );
  }

  return json;
}

export async function updateRentvineLeaseRenewalDates(
  leaseRenewalId: string,
  dates: { startDate?: string; endDate?: string },
): Promise<unknown> {
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

  const res = await fetch(`${baseUrl}/leases/renewals/${leaseRenewalId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(dates),
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(
      `Rentvine PATCH /leases/renewals/${leaseRenewalId} → ${res.status} ${res.statusText}: ${text}`,
    );
  }

  return json;
}

// Fallback for leases with no formal renewal record in Rentvine (e.g.
// Month-to-Month leases): writes the dates directly onto the lease itself.
//
// Per Rentvine's published OpenAPI spec (docs.rentvine.com), "Update Lease"
// is POST /leases/{leaseID} — there is no PATCH/PUT on this resource at all,
// which is why earlier PATCH attempts returned 404 (confirmed: OPTIONS on
// the same URL also 404s, meaning the method itself isn't routed). The
// documented request schema for this endpoint has no rent field, so rent
// isn't sent here — it's a separate resource we don't currently write to.
export async function updateRentvineLeaseFields(
  leaseId: string,
  fields: { startDate?: string; endDate?: string },
): Promise<unknown> {
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

  const res = await fetch(`${baseUrl}/leases/${leaseId}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(fields),
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`Rentvine POST /leases/${leaseId} → ${res.status} ${res.statusText}: ${text}`);
  }

  return json;
}

// ---------------------------------------------------------------------------
// Lease PDF detection ("does this lease already have a document in
// Rentvine?") and upload
// ---------------------------------------------------------------------------
//
// Rentvine's public Manager API only documents POST /files (upload) — there
// is no documented GET, and the undocumented GET that exists ignores every
// objectID/objectTypeID filter combination tested (confirmed live: a real
// lease ID, a bogus ID, and no filter at all all return the same
// account-wide "most recent files" list). The only way to know whether a
// specific lease has a PDF is to page through that full account-wide list
// once and match by filename against the address — confirmed working
// against a real file ("44 Thomas Street, Bloomfield, NJ - 1R - Lease
// Agreement 2026.pdf"). This is a heuristic, not a guaranteed link, so it's
// paired with a manual override column in Supabase for anything it misses.

export interface RentvineFileSummary {
  fileId: string;
  title: string;
  dateCreated: string;
}

const FILES_FETCH_MAX_PAGES = 50;

export async function fetchAllRentvineFiles(): Promise<RentvineFileSummary[]> {
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

  const files: RentvineFileSummary[] = [];
  let page = 1;

  while (page <= FILES_FETCH_MAX_PAGES) {
    const pageData = (await rentvineGet(baseUrl, `/files?page=${page}&per-page=50`, auth)) as unknown;
    const items = Array.isArray(pageData) ? (pageData as Record<string, unknown>[]) : [];
    if (items.length === 0) break;
    for (const item of items) {
      const file = item.file as Record<string, unknown>;
      if (!file) continue;
      files.push({
        fileId: String(file.fileID ?? ""),
        title: String(file.title ?? ""),
        dateCreated: String(file.dateTimeCreated ?? ""),
      });
    }
    page += 1;
  }

  return files;
}

// Requires the title to contain the street address and the word "lease" --
// an address-only match produces false positives (e.g. a vendor invoice
// titled "...invoice_44_Thomas_Bloomfield.pdf" matched on address alone
// during testing). Rentvine's own file-naming convention, confirmed against
// a real upload, is "{address}, {city}, {state} - {unit} - Lease Agreement
// {year}.pdf" -- so when a unit is given, it's also required in the title.
// Without that, a multi-unit building's single uploaded lease matches every
// unit at that address (confirmed live: 44 Thomas Street's one PDF for unit
// 1R matched all four units before this check was added).
export function matchLeasePdfFile(
  files: RentvineFileSummary[],
  address: string,
  unit?: string,
): RentvineFileSummary | null {
  const normalizedAddress = address.trim().toLowerCase();
  if (!normalizedAddress) return null;
  const normalizedUnit = unit?.trim().toLowerCase() ?? "";

  for (const file of files) {
    const title = file.title.toLowerCase();
    if (!title.includes(normalizedAddress) || !title.includes("lease")) continue;
    if (normalizedUnit && !title.includes(normalizedUnit)) continue;
    return file;
  }
  return null;
}

export async function uploadFileToRentvineLease(
  leaseId: string,
  fileBuffer: Buffer,
  fileName: string,
): Promise<{ fileId: string }> {
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

  // objectTypeID 4 = Lease, per Rentvine's Object Types table.
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(fileBuffer)], { type: "application/pdf" }), fileName);

  const res = await fetch(`${baseUrl}/files?objectTypeID=4&objectID=${leaseId}`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    body: form,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Rentvine POST /files → ${res.status} ${res.statusText}: ${text}`);
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Rentvine POST /files returned non-JSON response: ${text}`);
  }

  // Rentvine's own spec documents a required top-level "file" object, but
  // the live response for this account instead came back as
  // { fileAttachment: { fileID, ... } } with no "file" key at all --
  // confirmed live. Check both shapes rather than trusting the spec.
  const file = json.file as Record<string, unknown> | undefined;
  const fileAttachment = json.fileAttachment as Record<string, unknown> | undefined;
  const fileId = String(file?.fileID ?? fileAttachment?.fileID ?? "");
  if (!fileId) {
    throw new Error(`Rentvine POST /files response missing a recognizable fileID: ${text}`);
  }

  return { fileId };
}

// Confirmed live: GET /files/{id}/download returns the raw PDF bytes
// (unlike the broken GET /files listing endpoint, this one actually works
// as documented-by-convention, even though it isn't in the published spec).
export async function downloadRentvineFile(fileId: string): Promise<{ buffer: Buffer; contentType: string }> {
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

  const res = await fetch(`${baseUrl}/files/${fileId}/download`, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!res.ok) {
    throw new Error(`Rentvine GET /files/${fileId}/download → ${res.status} ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType: res.headers.get("content-type") || "application/pdf" };
}
