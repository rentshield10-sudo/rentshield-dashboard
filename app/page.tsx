"use client";

import { useEffect, useMemo, useState } from "react";
import BookingTab from "../components/booking/BookingTab";
import { supabase } from "../lib/supabase";
import styles from "./page.module.css";

type DashboardApartment = {
  apt_address: string;
};

type DashboardLead = {
  lead_id: string | null;
  created_at: string | null;
  created_at_ts: string | null;
  lead_name: string | null;
  phone: string | null;
  apt_address: string | null;
  current_status: string | null;
  conversation_stage: string | null;
  needs_human_review_bool: boolean | null;
  notes: string | null;
  last_outbound_sms: string | null;
  last_outbound_at: string | null;
};

type AddressCount = {
  address: string;
  count: number;
};

type ActiveView = "home" | "human" | "booking";

const LIVE_APARTMENTS_STORAGE_KEY = "mission_control_live_apartments";

const weekDays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const monthWeekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function dateKeyFromSheetDate(value: string | null) {
  const raw = String(value || "").trim();

  if (!raw) return "";

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const sheetMatch = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);

  if (sheetMatch) {
    const monthName = sheetMatch[1].toLowerCase();
    const month = MONTH_INDEX[monthName];
    const day = Number(sheetMatch[2]);
    const year = Number(sheetMatch[3]);

    if (month && day && year) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  return "";
}

function utcDateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKeyFromUtcDate(date: Date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
    date.getUTCDate()
  )}`;
}

function addDaysToDateKey(dateKey: string, days: number) {
  const date = utcDateFromKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);

  return dateKeyFromUtcDate(date);
}

function getMondayDateKey(dateKey: string) {
  const date = utcDateFromKey(dateKey);
  const day = date.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;

  return addDaysToDateKey(dateKey, diffToMonday);
}

function getMonthStartKey(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`;
}

function getNextMonthStartKey(dateKey: string) {
  const [year, month] = dateKey.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1));

  return dateKeyFromUtcDate(nextMonth);
}

function isDateKeyInRange(
  dateKey: string,
  startKey: string,
  endExclusiveKey: string
) {
  return dateKey >= startKey && dateKey < endExclusiveKey;
}

function formatDateKeyShort(dateKey: string) {
  if (!dateKey) return "";

  return utcDateFromKey(dateKey).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

function formatMonthLabel(dateKey: string) {
  if (!dateKey) return "";

  return utcDateFromKey(dateKey).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
}

function getLatestSheetDateKey(leads: DashboardLead[]) {
  const keys = leads
    .map((lead) => dateKeyFromSheetDate(lead.created_at))
    .filter(Boolean)
    .sort();

  return keys[keys.length - 1] || "";
}

function countLeadsByAddressForDate(leads: DashboardLead[], dateKey: string) {
  const counts = new Map<string, number>();

  for (const lead of leads) {
    const leadDateKey = dateKeyFromSheetDate(lead.created_at);

    if (leadDateKey !== dateKey) continue;

    const address = String(lead.apt_address || "No Address").trim();

    counts.set(address, (counts.get(address) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([address, count]) => ({ address, count }))
    .sort((a, b) => b.count - a.count || a.address.localeCompare(b.address));
}

function countTotal(items: AddressCount[]) {
  return items.reduce((sum, item) => sum + item.count, 0);
}

function statusOptions(value: string | null) {
  const current = String(value || "").trim();

  const options = ["processing", "contacted"];

  if (current && !options.includes(current)) {
    options.push(current);
  }

  return options.map((option) => (
    <option key={option} value={option}>
      {option}
    </option>
  ));
}

function stageOptions(value: string | null) {
  const current = String(value || "").trim();

  const options = ["intro_sending", "intro_sent"];

  if (current && !options.includes(current)) {
    options.push(current);
  }

  return options.map((option) => (
    <option key={option} value={option}>
      {option}
    </option>
  ));
}

function getStoredLiveApartments() {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(LIVE_APARTMENTS_STORAGE_KEY);

    if (!raw) return [];

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item) => typeof item === "string");
  } catch {
    return [];
  }
}

function saveStoredLiveApartments(addresses: string[]) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    LIVE_APARTMENTS_STORAGE_KEY,
    JSON.stringify(addresses)
  );
}

function clearStoredLiveApartments() {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(LIVE_APARTMENTS_STORAGE_KEY);
}

export default function DashboardPage() {
  const [activeView, setActiveView] = useState<ActiveView>("home");

  const [apartments, setApartments] = useState<DashboardApartment[]>([]);
  const [leads, setLeads] = useState<DashboardLead[]>([]);

  const [selectedApartments, setSelectedApartments] = useState<string[]>([]);
  const [activeApartments, setActiveApartments] = useState<string[]>([]);

  const [loadingApartments, setLoadingApartments] = useState(true);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const storedLiveApartments = getStoredLiveApartments();

    if (storedLiveApartments.length) {
      setSelectedApartments(storedLiveApartments);
      setActiveApartments(storedLiveApartments);
    }
  }, []);

  useEffect(() => {
    async function loadDashboardData() {
      setErrorMessage("");
      setLoadingApartments(true);
      setLoadingLeads(true);

      const apartmentsRequest = supabase
        .from("dashboard_apartments")
        .select("apt_address")
        .order("apt_address");

      const leadsRequest = supabase
        .from("dashboard_leads_clean")
        .select(
          "lead_id, created_at, created_at_ts, lead_name, phone, apt_address, current_status, conversation_stage, needs_human_review_bool, notes, last_outbound_sms, last_outbound_at"
        );

      const [apartmentsResponse, leadsResponse] = await Promise.all([
        apartmentsRequest,
        leadsRequest,
      ]);

      if (apartmentsResponse.error) {
        setErrorMessage(apartmentsResponse.error.message);
        setApartments([]);
      } else {
        setApartments(apartmentsResponse.data || []);
      }

      if (leadsResponse.error) {
        setErrorMessage(leadsResponse.error.message);
        setLeads([]);
      } else {
        setLeads(leadsResponse.data || []);
      }

      setLoadingApartments(false);
      setLoadingLeads(false);
    }

    loadDashboardData();
  }, []);

  useEffect(() => {
    if (!apartments.length) return;

    const validAddresses = new Set(
      apartments.map((apartment) => apartment.apt_address)
    );

    setSelectedApartments((current) =>
      current.filter((address) => validAddresses.has(address))
    );

    setActiveApartments((current) => {
      const cleaned = current.filter((address) => validAddresses.has(address));

      if (cleaned.length) {
        saveStoredLiveApartments(cleaned);
      } else {
        clearStoredLiveApartments();
      }

      return cleaned;
    });
  }, [apartments]);

  const filteredLeads = useMemo(() => {
    if (!activeApartments.length) {
      return leads;
    }

    return leads.filter((lead) =>
      activeApartments.includes(String(lead.apt_address || "").trim())
    );
  }, [activeApartments, leads]);

  const processingRows = useMemo(() => {
    return filteredLeads
      .filter((lead) => {
        const isProcessing =
          String(lead.current_status || "").trim().toLowerCase() ===
          "processing";

        return isProcessing && !lead.needs_human_review_bool;
      })
      .slice(-25)
      .reverse();
  }, [filteredLeads]);

  const humanReviewRows = useMemo(() => {
    return leads
      .filter((lead) => Boolean(lead.needs_human_review_bool))
      .slice(-25)
      .reverse();
  }, [leads]);

  const navItems = [
    {
      label: "Home",
      view: "home" as ActiveView,
      count: processingRows.length,
    },
    {
      label: "Human Review",
      view: "human" as ActiveView,
      count: humanReviewRows.length,
    },
    {
      label: "Booking",
      view: "booking" as ActiveView,
      count: 0,
    },
  ];

  const dashboardTodayKey = useMemo(() => {
    return getLatestSheetDateKey(filteredLeads);
  }, [filteredLeads]);

  const stats = useMemo(() => {
    if (!dashboardTodayKey) {
      return {
        capturedToday: 0,
        capturedThisWeek: 0,
        capturedThisMonth: 0,
        processingNow: 0,
        weekLabel: "",
        monthLabel: "",
        weekStartKey: "",
        weekEndKey: "",
        weekLastDayKey: "",
        monthStartKey: "",
        monthEndKey: "",
      };
    }

    const weekStartKey = getMondayDateKey(dashboardTodayKey);
    const weekEndKey = addDaysToDateKey(weekStartKey, 7);
    const weekLastDayKey = addDaysToDateKey(weekStartKey, 6);

    const monthStartKey = getMonthStartKey(dashboardTodayKey);
    const monthEndKey = getNextMonthStartKey(monthStartKey);

    const capturedToday = filteredLeads.filter((lead) => {
      const dateKey = dateKeyFromSheetDate(lead.created_at);
      return dateKey === dashboardTodayKey;
    }).length;

    const capturedThisWeek = filteredLeads.filter((lead) => {
      const dateKey = dateKeyFromSheetDate(lead.created_at);
      return dateKey && isDateKeyInRange(dateKey, weekStartKey, weekEndKey);
    }).length;

    const capturedThisMonth = filteredLeads.filter((lead) => {
      const dateKey = dateKeyFromSheetDate(lead.created_at);
      return dateKey && isDateKeyInRange(dateKey, monthStartKey, monthEndKey);
    }).length;

    return {
      capturedToday,
      capturedThisWeek,
      capturedThisMonth,
      processingNow: processingRows.length,
      weekLabel: `${formatDateKeyShort(weekStartKey)} - ${formatDateKeyShort(
        weekLastDayKey
      )}`,
      monthLabel: formatMonthLabel(monthStartKey),
      weekStartKey,
      weekEndKey,
      weekLastDayKey,
      monthStartKey,
      monthEndKey,
    };
  }, [dashboardTodayKey, filteredLeads, processingRows.length]);

  const weeklyCards = useMemo(() => {
    if (!stats.weekStartKey) return [];

    return weekDays.map((dayName, index) => {
      const dateKey = addDaysToDateKey(stats.weekStartKey, index);
      const addressCounts = countLeadsByAddressForDate(filteredLeads, dateKey);
      const total = countTotal(addressCounts);

      return {
        dayName,
        dateKey,
        addressCounts,
        total,
      };
    });
  }, [filteredLeads, stats.weekStartKey]);

  const monthDays = useMemo(() => {
    if (!stats.monthStartKey) return [];

    const monthStartDate = utcDateFromKey(stats.monthStartKey);
    const monthYear = monthStartDate.getUTCFullYear();
    const monthNumber = monthStartDate.getUTCMonth() + 1;
    const daysInMonth = new Date(
      Date.UTC(monthYear, monthNumber, 0)
    ).getUTCDate();
    const leadingBlanks = monthStartDate.getUTCDay();

    const cells: Array<{
      type: "blank" | "day";
      dayNumber?: number;
      dateKey?: string;
      addressCounts?: AddressCount[];
      total?: number;
      isToday?: boolean;
    }> = [];

    for (let i = 0; i < leadingBlanks; i++) {
      cells.push({ type: "blank" });
    }

    for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {
      const dateKey = `${monthYear}-${pad2(monthNumber)}-${pad2(dayNumber)}`;
      const allAddressCounts = countLeadsByAddressForDate(
        filteredLeads,
        dateKey
      );
      const addressCounts = allAddressCounts.slice(0, 3);
      const total = countTotal(allAddressCounts);

      cells.push({
        type: "day",
        dayNumber,
        dateKey,
        addressCounts,
        total,
        isToday: dateKey === dashboardTodayKey,
      });
    }

    return cells;
  }, [dashboardTodayKey, filteredLeads, stats.monthStartKey]);

  function toggleApartment(address: string) {
    setSelectedApartments((current) => {
      if (current.includes(address)) {
        return current.filter((item) => item !== address);
      }

      return [...current, address];
    });
  }

  function clearSelectedApartments() {
    setSelectedApartments([]);
    setActiveApartments([]);
    clearStoredLiveApartments();
  }

  function applySelectedApartments() {
    setActiveApartments(selectedApartments);
    saveStoredLiveApartments(selectedApartments);
  }

  const isLoading = loadingApartments || loadingLeads;

  return (
    <main className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandTitle}>Mission Control</div>
          <div className={styles.brandSubtitle}>AI Leasing Dashboard</div>
        </div>

        <nav className={styles.nav}>
          {navItems.map((item) => (
            <button
              key={item.view}
              className={`${styles.navItem} ${activeView === item.view ? styles.navItemActive : ""
                }`}
              type="button"
              onClick={() => setActiveView(item.view)}
            >
              <span>{item.label}</span>
              <span className={styles.navCount}>{item.count}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className={styles.mainPane}>
        {activeView === "home" && (
          <>
            <section className={styles.liveCard}>
              <div className={styles.liveGrid}>
                <div>
                  <div className={styles.liveTitle}>
                    All Scraped Apartments
                  </div>

                  {loadingApartments ? (
                    <div className={styles.muted}>Loading apartments...</div>
                  ) : errorMessage ? (
                    <div className={styles.errorText}>{errorMessage}</div>
                  ) : apartments.length ? (
                    <div className={styles.aptList}>
                      {apartments.map((apartment) => (
                        <label
                          className={styles.aptCheck}
                          key={apartment.apt_address}
                        >
                          <input
                            type="checkbox"
                            checked={selectedApartments.includes(
                              apartment.apt_address
                            )}
                            onChange={() =>
                              toggleApartment(apartment.apt_address)
                            }
                          />
                          <span>{apartment.apt_address}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.muted}>No apartments found.</div>
                  )}
                </div>

                <div>
                  <div className={styles.liveTitle}>
                    Selected Live Apartments
                  </div>

                  <div className={styles.selectedList}>
                    {selectedApartments.length ? (
                      selectedApartments.map((address) => (
                        <div className={styles.selectedApt} key={address}>
                          {address}
                        </div>
                      ))
                    ) : (
                      <div className={styles.muted}>
                        No live apartments selected. Showing all apartments.
                      </div>
                    )}
                  </div>
                </div>

                <div className={styles.filterActions}>
                  <button
                    className={styles.applyBtn}
                    type="button"
                    onClick={applySelectedApartments}
                  >
                    Apply
                  </button>

                  <button
                    className={styles.clearBtn}
                    type="button"
                    onClick={clearSelectedApartments}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </section>

            <section className={styles.statsGrid}>
              <div className={styles.statCard}>
                <div className={styles.statLabel}>Captured Today</div>
                <div className={styles.statValue}>
                  {isLoading ? "..." : stats.capturedToday}
                </div>
                <div className={styles.statFooter}>
                  {activeApartments.length
                    ? "Selected live apartments"
                    : "All apartments"}
                </div>
              </div>

              <div className={styles.statCard}>
                <div className={styles.statLabel}>Selected Week</div>
                <div className={styles.statValue}>
                  {isLoading ? "..." : stats.capturedThisWeek}
                </div>
                <div className={styles.statFooter}>{stats.weekLabel}</div>
              </div>

              <div className={styles.statCard}>
                <div className={styles.statLabel}>Selected Month</div>
                <div className={styles.statValue}>
                  {isLoading ? "..." : stats.capturedThisMonth}
                </div>
                <div className={styles.statFooter}>{stats.monthLabel}</div>
              </div>

              <div className={styles.statCard}>
                <div className={styles.statLabel}>Processing Now</div>
                <div className={styles.statValue}>
                  {isLoading ? "..." : stats.processingNow}
                </div>
                <div className={styles.statFooter}>
                  {activeApartments.length
                    ? "Selected live apartments"
                    : "All apartments"}
                </div>
              </div>
            </section>

            <section className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>
                  Weekly Captured Leads Per Address
                </div>
                <div className={styles.sectionSubtitle}>{stats.weekLabel}</div>
              </div>

              <div className={styles.sectionActions}>
                <button className={styles.smallNavBtn} type="button">
                  Previous Week
                </button>
                <button className={styles.smallNavBtn} type="button">
                  This Week
                </button>
                <button className={styles.smallNavBtnPrimary} type="button">
                  Next Week
                </button>
              </div>
            </section>

            <section className={styles.weekGrid}>
              {weeklyCards.map((card) => (
                <div className={styles.dayCard} key={card.dateKey}>
                  <div className={styles.dayHead}>
                    <div>
                      <div className={styles.dayName}>{card.dayName}</div>
                      <div className={styles.dayDate}>
                        {formatDateKeyShort(card.dateKey)}
                      </div>
                    </div>
                    <div className={styles.dayTotal}>{card.total}</div>
                  </div>

                  <div className={styles.dayList}>
                    {card.addressCounts.length ? (
                      card.addressCounts.map((item) => (
                        <div
                          className={styles.dayAddressRow}
                          key={item.address}
                        >
                          <span>{item.address}</span>
                          <strong>{item.count}</strong>
                        </div>
                      ))
                    ) : (
                      <div className={styles.dayEmpty}>No leads</div>
                    )}
                  </div>
                </div>
              ))}
            </section>

            <section className={styles.monthCard}>
              <section className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionTitle}>Month View Count</div>
                  <div className={styles.sectionSubtitle}>
                    {stats.monthLabel}
                  </div>
                </div>

                <div className={styles.sectionActions}>
                  <button className={styles.smallNavBtn} type="button">
                    Previous Month
                  </button>
                  <button className={styles.smallNavBtn} type="button">
                    This Month
                  </button>
                  <button className={styles.smallNavBtnPrimary} type="button">
                    Next Month
                  </button>
                </div>
              </section>

              <div className={styles.monthGrid}>
                {monthWeekDays.map((day) => (
                  <div className={styles.monthWeekday} key={day}>
                    {day}
                  </div>
                ))}

                {monthDays.map((cell, index) => {
                  if (cell.type === "blank") {
                    return (
                      <div
                        className={`${styles.monthDay} ${styles.monthEmptyCell}`}
                        key={`blank-${index}`}
                      />
                    );
                  }

                  return (
                    <div
                      className={`${styles.monthDay} ${cell.isToday ? styles.monthToday : ""
                        }`}
                      key={cell.dateKey}
                    >
                      <div className={styles.monthDayHead}>
                        <span>{cell.dayNumber}</span>
                        <strong>{cell.total}</strong>
                      </div>

                      <div className={styles.monthDayList}>
                        {cell.addressCounts && cell.addressCounts.length ? (
                          cell.addressCounts.map((item) => (
                            <div
                              className={styles.monthAddressRow}
                              key={item.address}
                            >
                              <span>{item.address}</span>
                              <strong>{item.count}</strong>
                            </div>
                          ))
                        ) : (
                          <div className={styles.monthNoLeads}>No leads</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {activeView === "human" && (
          <section className={styles.tableWrap}>
            {humanReviewRows.length ? (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Lead ID</th>
                    <th>Created</th>
                    <th>Lead</th>
                    <th>Apartment</th>
                    <th>Status</th>
                    <th>Stage</th>
                    <th>Notes</th>
                    <th>Last SMS</th>
                    <th>Last Outbound At</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {humanReviewRows.map((lead) => (
                    <tr key={`human-${lead.lead_id}-${lead.phone}`}>
                      <td>
                        <strong>#{lead.lead_id}</strong>
                      </td>

                      <td>{lead.created_at}</td>

                      <td>
                        <div className={styles.leadName}>{lead.lead_name}</div>
                        <div className={styles.muted}>{lead.phone}</div>
                      </td>

                      <td>{lead.apt_address}</td>

                      <td>
                        <select defaultValue={lead.current_status || ""}>
                          {statusOptions(lead.current_status)}
                        </select>
                      </td>

                      <td>
                        <select defaultValue={lead.conversation_stage || ""}>
                          {stageOptions(lead.conversation_stage)}
                        </select>
                      </td>

                      <td>
                        <textarea defaultValue={lead.notes || ""} />
                      </td>

                      <td>
                        <textarea defaultValue={lead.last_outbound_sms || ""} />
                      </td>

                      <td>
                        <div className={styles.muted}>
                          {lead.last_outbound_at || "Updates when saved"}
                        </div>
                      </td>

                      <td>
                        <button className={styles.saveBtn} type="button">
                          Save
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className={styles.empty}>
                <h2>No rows found</h2>
                <p>No rows where needs_human_review is TRUE.</p>
              </div>
            )}
          </section>
        )}

        {activeView === "booking" && (
          <BookingTab
            activeDateKey={dashboardTodayKey || "2026-06-01"}
            availableApartments={
              activeApartments.length
                ? activeApartments
                : apartments.map((apartment) => apartment.apt_address)
            }
          />
        )}
      </section>
    </main>
  );
}