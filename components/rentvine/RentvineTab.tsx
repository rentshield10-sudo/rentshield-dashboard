"use client";

import { useState } from "react";
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
}

type ApiResponse =
  | { ok: true; renewals: RenewalRow[]; total: number }
  | { ok: false; error: string; detail?: unknown };

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

  async function fetchRenewals() {
    setStatus("loading");
    setErrorMessage("");
    setErrorDetail("");

    try {
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

  const isLoading = status === "loading";
  const formalCount = renewals.filter((r) => r.source === "renewal").length;
  const expiringCount = renewals.filter((r) => r.source === "expiring").length;

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
              onClick={fetchRenewals}
              disabled={isLoading}
            >
              {isLoading ? "Fetching..." : "Fetch Renewals"}
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
          <div>Press &quot;Fetch Renewals&quot; to load lease renewals from Rentvine.</div>
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

                      return (
                        <tr key={`${r.source}-${r.leaseID}`}>
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
    </div>
  );
}
