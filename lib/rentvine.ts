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

  const [allLeases, renewalsData] = await Promise.all([
    fetchAllLeasesPaginated(baseUrl, auth),
    rentvineGet(baseUrl, "/leases/renewals?per-page=100", auth),
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

  return allLeases.map((item) => {
    const lease = item.lease as Record<string, unknown>;
    const unit = item.unit as Record<string, unknown>;
    const leaseId = String(lease?.leaseID ?? "");
    const renewal = renewalByLeaseId.get(leaseId);

    return {
      address: String(unit?.address ?? ""),
      unit: String(unit?.address2 ?? ""),
      tenantName: ((lease?.tenants as string[]) ?? []).join(", "),
      activation1: String(renewal?.previousStartDate ?? lease?.startDate ?? ""),
      expiration1: String(renewal?.previousEndDate ?? lease?.endDate ?? ""),
      activation2: String(renewal?.startDate ?? ""),
      expiration2: String(renewal?.endDate ?? ""),
      currentRent: String(unit?.rent ?? ""),
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
    };
  });
}

// ---------------------------------------------------------------------------
// Rentvine renewal-date write (Phase 2 — "Save to Rentvine")
// ---------------------------------------------------------------------------

export async function updateRentvineLeaseRenewalDates(
  leaseRenewalId: string,
  dates: { startDate: string; endDate: string },
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
// Month-to-Month leases): writes the same dates + rent directly onto the
// lease itself instead of a renewal sub-object.
export async function updateRentvineLeaseFields(
  leaseId: string,
  fields: { startDate: string; endDate: string; currentRent?: number },
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
    method: "PATCH",
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
    throw new Error(`Rentvine PATCH /leases/${leaseId} → ${res.status} ${res.statusText}: ${text}`);
  }

  return json;
}
