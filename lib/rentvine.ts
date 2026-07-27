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
