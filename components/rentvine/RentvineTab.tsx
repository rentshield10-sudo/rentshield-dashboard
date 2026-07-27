"use client";

import { useState, useEffect } from "react";
import styles from "./RentvineTab.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

type ApiResponse =
  | { ok: true; renewals: RenewalRow[]; total: number }
  | { ok: false; error: string; detail?: unknown };

interface ApartmentDetailRow {
  id: number;
  address: string;
  unit: string;
  tenant_name: string | null;
  activation_1: string | null;
  expiration_1: string | null;
  activation_2: string | null;
  expiration_2: string | null;
  new_rent: number | null;
  current_rent: number | null;
  security_deposit: number | null;
  lease_status: string | null;
  notes: string | null;
  lease_sent: string | null;
  lease_sent_date: string | null;
  link: string | null;
  rentvine_lease_id: string | null;
  rentvine_unit_id: string | null;
  rentvine_lease_renewal_id: string | null;
  source: string;
  updated_at: string;
}

type ApartmentDetailsApiResponse =
  | { ok: true; rows: ApartmentDetailRow[]; total: number }
  | { ok: false; error: string; detail?: unknown };

type RowActionState = "idle" | "saving" | "success" | "error";

interface RowActionStatus {
  supabase: RowActionState;
  sheet: RowActionState;
  rentvine: RowActionState;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function formatCurrency(amount: string | null): string {
  if (!amount || amount === "0") return "—";
  const n = parseFloat(amount);
  if (isNaN(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const CACHE_KEY = "rentvine_renewals_cache";

interface CachedData {
  renewals: RenewalRow[];
  total: number;
  fetchedAt: string;
}

function loadCache(): CachedData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedData) : null;
  } catch {
    return null;
  }
}

function saveCache(data: CachedData) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

function formatFetchedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  });
}

export default function RentvineTab() {
  const cached = typeof window !== "undefined" ? loadCache() : null;

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    cached ? "success" : "idle"
  );
  const [renewals, setRenewals] = useState<RenewalRow[]>(cached?.renewals ?? []);
  const [total, setTotal] = useState(cached?.total ?? 0);
  const [fetchedAt, setFetchedAt] = useState<string | null>(cached?.fetchedAt ?? null);
  const [errorMessage, setErrorMessage] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [apartmentRows, setApartmentRows] = useState<ApartmentDetailRow[]>([]);
  const [apartmentStatus, setApartmentStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [apartmentErrorMessage, setApartmentErrorMessage] = useState("");
  const [apartmentErrorDetail, setApartmentErrorDetail] = useState("");
  const [editedDates, setEditedDates] = useState<Record<number, { activation2: string; expiration2: string }>>({});
  const [rowActionStatus, setRowActionStatus] = useState<Record<number, RowActionStatus>>({});

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

  async function loadApartmentDetails() {
    setApartmentStatus("loading");
    setApartmentErrorMessage("");
    setApartmentErrorDetail("");
    try {
      const res = await fetch("/api/rentvine/apartment-details", { cache: "no-store" });
      const json: ApartmentDetailsApiResponse = await res.json();
      if (!json.ok) {
        setApartmentErrorMessage(json.error);
        setApartmentErrorDetail(json.detail !== undefined ? JSON.stringify(json.detail, null, 2) : "");
        setApartmentStatus("error");
        return;
      }
      setApartmentRows(json.rows);
      setApartmentStatus("success");
    } catch (err) {
      setApartmentErrorMessage(err instanceof Error ? err.message : "Unexpected error.");
      setApartmentStatus("error");
    }
  }

  async function syncAllApartments() {
    setApartmentStatus("loading");
    setApartmentErrorMessage("");
    setApartmentErrorDetail("");
    try {
      const syncRes = await fetch("/api/rentvine/apartment-details-sync", {
        method: "POST",
        cache: "no-store",
      });
      const syncJson: { ok: boolean; error?: string; detail?: unknown; synced?: number } =
        await syncRes.json();
      if (!syncJson.ok) {
        setApartmentErrorMessage(syncJson.error || "Sync failed.");
        setApartmentErrorDetail(
          syncJson.detail !== undefined ? JSON.stringify(syncJson.detail, null, 2) : "",
        );
        setApartmentStatus("error");
        return;
      }
      await loadApartmentDetails();
    } catch (err) {
      setApartmentErrorMessage(err instanceof Error ? err.message : "Unexpected error.");
      setApartmentStatus("error");
    }
  }

  function getEditedActivation2(row: ApartmentDetailRow): string {
    return editedDates[row.id]?.activation2 ?? row.activation_2 ?? "";
  }

  function getEditedExpiration2(row: ApartmentDetailRow): string {
    return editedDates[row.id]?.expiration2 ?? row.expiration_2 ?? "";
  }

  function setEditedActivation2(row: ApartmentDetailRow, value: string) {
    setEditedDates((prev) => ({
      ...prev,
      [row.id]: {
        activation2: value,
        expiration2: prev[row.id]?.expiration2 ?? row.expiration_2 ?? "",
      },
    }));
  }

  function setEditedExpiration2(row: ApartmentDetailRow, value: string) {
    setEditedDates((prev) => ({
      ...prev,
      [row.id]: {
        activation2: prev[row.id]?.activation2 ?? row.activation_2 ?? "",
        expiration2: value,
      },
    }));
  }

  function setRowStatus(rowId: number, patch: Partial<RowActionStatus>) {
    setRowActionStatus((prev) => ({
      ...prev,
      [rowId]: {
        supabase: prev[rowId]?.supabase ?? "idle",
        sheet: prev[rowId]?.sheet ?? "idle",
        rentvine: prev[rowId]?.rentvine ?? "idle",
        ...patch,
      },
    }));
  }

  async function saveToSupabase(row: ApartmentDetailRow) {
    setRowStatus(row.id, { supabase: "saving", errorMessage: undefined });
    try {
      const activation2 = getEditedActivation2(row);
      const expiration2 = getEditedExpiration2(row);
      const res = await fetch(`/api/rentvine/apartment-details/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activation2, expiration2 }),
      });
      const json: { ok: boolean; error?: string; row?: ApartmentDetailRow } = await res.json();
      if (!json.ok || !json.row) {
        setRowStatus(row.id, { supabase: "error", errorMessage: json.error || "Save failed." });
        return;
      }
      const updatedRow = json.row;
      setApartmentRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, activation_2: updatedRow.activation_2, expiration_2: updatedRow.expiration_2, updated_at: updatedRow.updated_at }
            : r,
        ),
      );
      setEditedDates((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      setRowStatus(row.id, { supabase: "success" });
    } catch (err) {
      setRowStatus(row.id, {
        supabase: "error",
        errorMessage: err instanceof Error ? err.message : "Unexpected error.",
      });
    }
  }

  async function saveToSheet(row: ApartmentDetailRow) {
    setRowStatus(row.id, { sheet: "saving", errorMessage: undefined });
    try {
      const res = await fetch(`/api/rentvine/apartment-details/${row.id}/push-sheet`, {
        method: "POST",
      });
      const json: { ok: boolean; error?: string } = await res.json();
      if (!json.ok) {
        setRowStatus(row.id, { sheet: "error", errorMessage: json.error || "Push to Sheet failed." });
        return;
      }
      setRowStatus(row.id, { sheet: "success" });
    } catch (err) {
      setRowStatus(row.id, {
        sheet: "error",
        errorMessage: err instanceof Error ? err.message : "Unexpected error.",
      });
    }
  }

  async function saveToRentvine(row: ApartmentDetailRow) {
    setRowStatus(row.id, { rentvine: "saving", errorMessage: undefined });
    try {
      const res = await fetch(`/api/rentvine/apartment-details/${row.id}/push-rentvine`, {
        method: "POST",
      });
      const json: { ok: boolean; error?: string } = await res.json();
      if (!json.ok) {
        setRowStatus(row.id, { rentvine: "error", errorMessage: json.error || "Push to Rentvine failed." });
        return;
      }
      setRowStatus(row.id, { rentvine: "success" });
    } catch (err) {
      setRowStatus(row.id, {
        rentvine: "error",
        errorMessage: err instanceof Error ? err.message : "Unexpected error.",
      });
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadApartmentDetails sets loading state synchronously as its first line; this mount-only fetch is intentional and matches the established pattern in this codebase (see components/messages/MessagesTab.tsx)
    loadApartmentDetails();
  }, []);

  const isLoading = status === "loading";
  const formalCount = renewals.filter((r) => r.source === "renewal").length;
  const expiringCount = renewals.filter((r) => r.source === "expiring").length;

  const highlightKeys = new Set(
    renewals.map((r) => `${r.address.trim().toLowerCase()}|${r.unit.trim().toLowerCase()}`),
  );

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Property Management</p>
          <h1>Lease Renewals</h1>
          <p className={styles.subtitle}>
            Formal renewals + active leases expiring within 120 days.
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.fetchGroup}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={syncNow}
              disabled={isLoading}
            >
              {isLoading ? "Syncing..." : "Sync Now"}
            </button>
            {fetchedAt && (
              <p className={styles.lastFetched}>
                Last fetched {formatFetchedAt(fetchedAt)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Error ── */}
      {status === "error" && (
        <div className={styles.errorBanner}>
          <div className={styles.errorLabel}>Failed to fetch renewals</div>
          <div>{errorMessage}</div>
          {errorDetail && <pre className={styles.errorDetail}>{errorDetail}</pre>}
        </div>
      )}

      {/* ── Idle ── */}
      {status === "idle" && (
        <div className={styles.prompt}>
          <div className={styles.promptTitle}>No data loaded</div>
          <div>Press &quot;Sync Now&quot; to pull lease renewals from Rentvine into Supabase.</div>
        </div>
      )}

      {/* ── Results ── */}
      {status === "success" && (
        <>
          <div className={styles.summaryBar}>
            <span>
              <span className={styles.summaryCount}>{total}</span>
              <span className={styles.summaryLabel}> {total === 1 ? "renewal" : "renewals"}</span>
            </span>
            <span className={styles.muted}>
              {formalCount} formal &middot; {expiringCount} expiring
            </span>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>Lease Renewals</span>
            </div>

            {renewals.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>&#10003;</div>
                <div>No lease renewals found.</div>
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Tenant(s)</th>
                      <th>Property</th>
                      <th>Portfolio</th>
                      <th>Status</th>
                      <th>Lease End</th>
                      <th>Days Left</th>
                      <th>Rent</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
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
                          <td>
                            <span className={r.source === "renewal" ? styles.badge : styles.badgeGray}>
                              {r.source === "renewal" ? "Renewal" : "Expiring"}
                            </span>
                          </td>
                          <td>{r.tenants.join(", ")}</td>
                          <td>
                            {r.address}{r.unit ? ` #${r.unit}` : ""}
                            <br />
                            <span className={styles.muted}>{r.city}, {r.state}</span>
                          </td>
                          <td>{r.portfolio || <span className={styles.muted}>—</span>}</td>
                          <td>
                            <span className={styles.badge}>{r.leaseStatus}</span>
                          </td>
                          <td><span className={styles.mono}>{formatDate(r.leaseEnd)}</span></td>
                          <td>
                            {days !== null ? (
                              <span className={isPast ? styles.badgeAlert : isUrgent ? styles.badgeUrgent : styles.mono}>
                                {isPast ? `${Math.abs(days)}d overdue` : `${days}d`}
                              </span>
                            ) : <span className={styles.muted}>—</span>}
                          </td>
                          <td>{formatCurrency(r.currentRent)}</td>
                          <td>
                            {r.hasOverdueBalance ? (
                              <span className={styles.badgeAlert}>
                                {formatCurrency(r.overdueBalance)} overdue
                              </span>
                            ) : (
                              <span className={styles.muted}>{formatCurrency(r.currentBalance)}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── All Apartments (Phase 2) ── */}
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Property Management</p>
          <h1>All Apartments</h1>
          <p className={styles.subtitle}>
            Full apartment/lease inventory from Rentvine, matching the team&apos;s tracking sheet.
            Highlighted rows have a renewal or expiring lease above.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={syncAllApartments}
            disabled={apartmentStatus === "loading"}
          >
            {apartmentStatus === "loading" ? "Fetching..." : "Fetch All Apartments"}
          </button>
        </div>
      </div>

      {apartmentStatus === "error" && (
        <div className={styles.errorBanner}>
          <div className={styles.errorLabel}>Failed to load apartment details</div>
          <div>{apartmentErrorMessage}</div>
          {apartmentErrorDetail && <pre className={styles.errorDetail}>{apartmentErrorDetail}</pre>}
        </div>
      )}

      {apartmentStatus === "idle" && (
        <div className={styles.prompt}>
          <div className={styles.promptTitle}>No apartment data loaded</div>
          <div>Press &quot;Fetch All Apartments&quot; to pull the full apartment/lease list from Rentvine.</div>
        </div>
      )}

      {(apartmentStatus === "success" || apartmentStatus === "loading") && apartmentRows.length > 0 && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>All Apartments</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Unit</th>
                  <th>Tenant</th>
                  <th>Activation 1</th>
                  <th>Expiration 1</th>
                  <th>Activation 2</th>
                  <th>Expiration 2</th>
                  <th>New Rent</th>
                  <th>Current Rent</th>
                  <th>Security Deposit</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {apartmentRows.map((row) => {
                  const key = `${row.address.trim().toLowerCase()}|${row.unit.trim().toLowerCase()}`;
                  const isHighlighted = highlightKeys.has(key);
                  const actionStatus = rowActionStatus[row.id];

                  return (
                    <tr key={row.id} className={isHighlighted ? styles.rowHighlighted : undefined}>
                      <td>{row.address}</td>
                      <td>{row.unit || <span className={styles.muted}>—</span>}</td>
                      <td>{row.tenant_name || <span className={styles.muted}>—</span>}</td>
                      <td><span className={styles.mono}>{formatDate(row.activation_1)}</span></td>
                      <td><span className={styles.mono}>{formatDate(row.expiration_1)}</span></td>
                      <td>
                        <input
                          type="date"
                          className={styles.dateInput}
                          value={getEditedActivation2(row)}
                          onChange={(e) => setEditedActivation2(row, e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          className={styles.dateInput}
                          value={getEditedExpiration2(row)}
                          onChange={(e) => setEditedExpiration2(row, e.target.value)}
                        />
                      </td>
                      <td>{formatCurrency(row.new_rent !== null ? String(row.new_rent) : null)}</td>
                      <td>{formatCurrency(row.current_rent !== null ? String(row.current_rent) : null)}</td>
                      <td>{formatCurrency(row.security_deposit !== null ? String(row.security_deposit) : null)}</td>
                      <td>{row.notes || <span className={styles.muted}>—</span>}</td>
                      <td>
                        <div className={styles.rowActions}>
                          <button
                            type="button"
                            className={styles.smallButton}
                            onClick={() => saveToSupabase(row)}
                            disabled={actionStatus?.supabase === "saving"}
                          >
                            {actionStatus?.supabase === "saving" ? "..." : "→ Supabase"}
                          </button>
                          <button
                            type="button"
                            className={styles.smallButton}
                            onClick={() => saveToSheet(row)}
                            disabled={actionStatus?.sheet === "saving"}
                          >
                            {actionStatus?.sheet === "saving" ? "..." : "→ Sheet"}
                          </button>
                          <button
                            type="button"
                            className={styles.smallButton}
                            onClick={() => saveToRentvine(row)}
                            disabled={actionStatus?.rentvine === "saving"}
                          >
                            {actionStatus?.rentvine === "saving" ? "..." : "→ Rentvine"}
                          </button>
                        </div>
                        {actionStatus?.errorMessage && (
                          <div className={styles.rowActionError}>{actionStatus.errorMessage}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
