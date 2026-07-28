"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "../lib/supabase";
import styles from "./page.module.css";

// Loaded on demand (not bundled into the initial page compile) so switching
// tabs only compiles the tab you're actually viewing, instead of every tab's
// code compiling together on first load.
const BookingTab = dynamic(() => import("../components/booking/BookingTab"), {
  loading: () => <div style={{ padding: 24 }}>Loading Booking…</div>,
});
const LeadsTab = dynamic(() => import("../components/leads/LeadsTab"), {
  loading: () => <div style={{ padding: 24 }}>Loading Leads…</div>,
});
const MessagesTab = dynamic(() => import("../components/messages/MessagesTab"), {
  loading: () => <div style={{ padding: 24 }}>Loading Messages…</div>,
});
const RentvineTab = dynamic(() => import("../components/rentvine/RentvineTab"), {
  loading: () => <div style={{ padding: 24 }}>Loading Rentvine…</div>,
});

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
  pipeline_status?: string | null;
};

type AddressCount = {
  address: string;
  count: number;
};

type ApartmentPrice = {
  apt_address: string;
  current_price: number | null;
  price_effective_date: string | null;
  note: string | null;
  updated_at: string | null;
};

type ApartmentPriceHistory = {
  id: number;
  apt_address: string;
  previous_price: number | null;
  new_price: number;
  effective_date: string;
  note: string | null;
  created_at: string | null;
};

type PriceDraft = {
  newPrice: string;
  effectiveDate: string;
  note: string;
};

type ChartSeries = {
  id: string;
  label: string;
  color: string;
  values: Array<{ dateKey: string; value: number | null }>;
};

type ActiveView = "home" | "leads" | "human" | "booking" | "messages" | "rentvine";

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

const CHART_COLORS = [
  "#2563eb",
  "#059669",
  "#dc2626",
  "#7c3aed",
  "#d97706",
  "#0891b2",
  "#db2777",
  "#4f46e5",
  "#65a30d",
  "#ea580c",
];

function normalizeApartmentAddress(address: string | null | undefined) {
  return String(address || "")
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bterrace\b/g, "ter")
    .replace(/\broad\b/g, "rd")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\blane\b/g, "ln")
    .replace(/\bcourt\b/g, "ct")
    .replace(/\bplace\b/g, "pl")
    .replace(/\bhighway\b/g, "hwy")
    .replace(/\b(?:apartment|apt|unit)\b\s*#?\s*([a-z0-9-]+)/g, "#$1")
    .replace(/#\s+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function apartmentDisplayScore(address: string) {
  const lower = address.toLowerCase();
  let score = address.length;

  if (
    /\b(street|avenue|terrace|road|boulevard|drive|lane|court|place|highway)\b/.test(
      lower,
    )
  ) {
    score += 50;
  }

  if (/\b(apartment|unit)\b/.test(lower)) {
    score += 25;
  }

  return score;
}

function buildCanonicalApartmentList(rows: DashboardApartment[]) {
  const grouped = new Map<string, string>();

  for (const row of rows) {
    const address = String(row.apt_address || "").trim();
    const key = normalizeApartmentAddress(address);

    if (!key) continue;

    const existing = grouped.get(key);

    if (
      !existing ||
      apartmentDisplayScore(address) < apartmentDisplayScore(existing)
    ) {
      grouped.set(key, address);
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => a.localeCompare(b))
    .map((apt_address) => ({ apt_address }));
}

function canonicalAddressFor(
  address: string | null | undefined,
  canonicalByKey: Map<string, string>,
) {
  const raw = String(address || "").trim();
  const key = normalizeApartmentAddress(raw);

  return canonicalByKey.get(key) || raw || "No Address";
}

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
    date.getUTCDate(),
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
  endExclusiveKey: string,
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

function countLeadsByAddressForDate(
  leads: DashboardLead[],
  dateKey: string,
  canonicalByKey: Map<string, string>,
) {
  const counts = new Map<string, number>();

  for (const lead of leads) {
    const leadDateKey = dateKeyFromSheetDate(lead.created_at);

    if (leadDateKey !== dateKey) continue;

    const address = canonicalAddressFor(lead.apt_address, canonicalByKey);

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
    JSON.stringify(addresses),
  );
}

function clearStoredLiveApartments() {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(LIVE_APARTMENTS_STORAGE_KEY);
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "Not set";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function buildDateKeys(startKey: string, endKey: string, maxDays = 370) {
  if (!startKey || !endKey || startKey > endKey) return [];

  const keys: string[] = [];
  let current = startKey;

  while (current <= endKey && keys.length < maxDays) {
    keys.push(current);
    current = addDaysToDateKey(current, 1);
  }

  return keys;
}

function MultiLineChart({
  dateKeys,
  series,
  valuePrefix = "",
  stepped = false,
  emptyLabel,
}: {
  dateKeys: string[];
  series: ChartSeries[];
  valuePrefix?: string;
  stepped?: boolean;
  emptyLabel: string;
}) {
  const width = 1100;
  const height = 330;
  const padding = { top: 22, right: 24, bottom: 48, left: 64 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const allValues = series
    .flatMap((item) => item.values.map((point) => point.value))
    .filter(
      (value): value is number => value !== null && Number.isFinite(value),
    );

  if (!dateKeys.length || !series.length || !allValues.length) {
    return <div className={styles.analyticsEmpty}>{emptyLabel}</div>;
  }

  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const spread = Math.max(rawMax - rawMin, stepped ? 100 : 1);
  const yMin = stepped ? Math.max(0, rawMin - spread * 0.12) : 0;
  const yMax = rawMax + spread * 0.12;

  const xAt = (index: number) =>
    padding.left +
    (dateKeys.length === 1
      ? plotWidth / 2
      : (index / (dateKeys.length - 1)) * plotWidth);

  const yAt = (value: number) =>
    padding.top + ((yMax - value) / Math.max(yMax - yMin, 1)) * plotHeight;

  const tickCount = 5;
  const yTicks = Array.from({ length: tickCount }, (_, index) => {
    const ratio = index / (tickCount - 1);
    return yMax - ratio * (yMax - yMin);
  });

  const xTickIndexes = Array.from(
    new Set(
      Array.from({ length: Math.min(7, dateKeys.length) }, (_, index) =>
        Math.round(
          (index / Math.max(Math.min(7, dateKeys.length) - 1, 1)) *
          (dateKeys.length - 1),
        ),
      ),
    ),
  );

  function buildPath(values: ChartSeries["values"]) {
    const segments: string[] = [];
    let started = false;
    let previousX = 0;
    let previousY = 0;

    values.forEach((point, index) => {
      if (point.value === null || !Number.isFinite(point.value)) {
        started = false;
        return;
      }

      const x = xAt(index);
      const y = yAt(point.value);

      if (!started) {
        segments.push(`M ${x} ${y}`);
        started = true;
      } else if (stepped) {
        segments.push(`L ${x} ${previousY} L ${x} ${y}`);
      } else {
        segments.push(`L ${x} ${y}`);
      }

      previousX = x;
      previousY = y;
      void previousX;
    });

    return segments.join(" ");
  }

  return (
    <div className={styles.chartScroll}>
      <svg
        className={styles.analyticsChart}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Apartment analytics line chart"
      >
        {yTicks.map((tick) => {
          const y = yAt(tick);
          return (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="#e5e7eb"
                strokeWidth="1"
              />
              <text
                x={padding.left - 10}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#6b7280"
              >
                {valuePrefix}
                {Math.round(tick).toLocaleString()}
              </text>
            </g>
          );
        })}

        {xTickIndexes.map((index) => (
          <text
            key={dateKeys[index]}
            x={xAt(index)}
            y={height - 18}
            textAnchor="middle"
            fontSize="11"
            fill="#6b7280"
          >
            {formatDateKeyShort(dateKeys[index])}
          </text>
        ))}

        {series.map((item) => (
          <path
            key={item.id}
            d={buildPath(item.values)}
            fill="none"
            stroke={item.color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>
  );
}

function ApartmentAnalytics({
  apartments,
  activeApartments,
  leads,
  canonicalByKey,
}: {
  apartments: string[];
  activeApartments: string[];
  leads: DashboardLead[];
  canonicalByKey: Map<string, string>;
}) {
  const availableApartments = useMemo(
    () => (activeApartments.length ? activeApartments : apartments),
    [activeApartments, apartments],
  );

  const latestLeadDate = useMemo(() => getLatestSheetDateKey(leads), [leads]);
  const initialEnd = latestLeadDate || dateKeyFromUtcDate(new Date());
  const initialStart = addDaysToDateKey(initialEnd, -29);

  const [analyticsMode, setAnalyticsMode] = useState<"leads" | "prices">(
    "leads",
  );
  const [dateFrom, setDateFrom] = useState(initialStart);
  const [dateTo, setDateTo] = useState(initialEnd);
  const [visibleApartments, setVisibleApartments] = useState<string[]>([]);

  const [prices, setPrices] = useState<ApartmentPrice[]>([]);
  const [priceHistory, setPriceHistory] = useState<ApartmentPriceHistory[]>([]);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, PriceDraft>>(
    {},
  );
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [savingAddress, setSavingAddress] = useState<string | null>(null);
  const [priceNotice, setPriceNotice] = useState("");
  const [priceError, setPriceError] = useState("");

  useEffect(() => {
    setVisibleApartments((current) => {
      const availableKeys = new Set(
        availableApartments.map(normalizeApartmentAddress),
      );
      const cleaned = current.filter((address) =>
        availableKeys.has(normalizeApartmentAddress(address)),
      );

      return cleaned.length ? cleaned : availableApartments;
    });
  }, [availableApartments]);

  useEffect(() => {
    setPriceDrafts((current) => {
      const next = { ...current };
      const today = dateKeyFromUtcDate(new Date());

      for (const address of availableApartments) {
        if (!next[address]) {
          next[address] = {
            newPrice: "",
            effectiveDate: today,
            note: "",
          };
        }
      }

      return next;
    });
  }, [availableApartments]);

  async function loadPriceData() {
    setLoadingPrices(true);
    setPriceError("");

    try {
      const response = await fetch("/api/apartment-prices", {
        cache: "no-store",
      });
      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to load apartment prices");
      }

      setPrices(json.prices || []);
      setPriceHistory(json.history || []);
    } catch (error) {
      setPriceError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingPrices(false);
    }
  }

  useEffect(() => {
    loadPriceData();
  }, []);

  const dateKeys = useMemo(
    () => buildDateKeys(dateFrom, dateTo),
    [dateFrom, dateTo],
  );
  const visibleKeys = useMemo(
    () => new Set(visibleApartments.map(normalizeApartmentAddress)),
    [visibleApartments],
  );

  const priceByKey = useMemo(() => {
    const map = new Map<string, ApartmentPrice>();
    for (const row of prices) {
      map.set(normalizeApartmentAddress(row.apt_address), row);
    }
    return map;
  }, [prices]);

  const leadSeries = useMemo<ChartSeries[]>(() => {
    const counts = new Map<string, Map<string, number>>();

    for (const address of visibleApartments) {
      counts.set(normalizeApartmentAddress(address), new Map());
    }

    for (const lead of leads) {
      const dateKey = dateKeyFromSheetDate(lead.created_at);
      const address = canonicalAddressFor(lead.apt_address, canonicalByKey);
      const key = normalizeApartmentAddress(address);

      if (!dateKey || !visibleKeys.has(key)) continue;
      if (dateKey < dateFrom || dateKey > dateTo) continue;

      const addressCounts = counts.get(key);
      if (!addressCounts) continue;

      addressCounts.set(dateKey, (addressCounts.get(dateKey) || 0) + 1);
    }

    return visibleApartments.map((address, index) => {
      const key = normalizeApartmentAddress(address);
      const addressCounts = counts.get(key) || new Map<string, number>();

      return {
        id: key,
        label: address,
        color: CHART_COLORS[index % CHART_COLORS.length],
        values: dateKeys.map((dateKey) => ({
          dateKey,
          value: addressCounts.get(dateKey) || 0,
        })),
      };
    });
  }, [
    canonicalByKey,
    dateFrom,
    dateKeys,
    dateTo,
    leads,
    visibleApartments,
    visibleKeys,
  ]);

  const priceSeries = useMemo<ChartSeries[]>(() => {
    const rowsByKey = new Map<string, ApartmentPriceHistory[]>();

    for (const row of priceHistory) {
      const key = normalizeApartmentAddress(row.apt_address);
      const rows = rowsByKey.get(key) || [];
      rows.push(row);
      rowsByKey.set(key, rows);
    }

    for (const rows of rowsByKey.values()) {
      rows.sort(
        (a, b) =>
          a.effective_date.localeCompare(b.effective_date) || a.id - b.id,
      );
    }

    return visibleApartments.map((address, index) => {
      const key = normalizeApartmentAddress(address);
      const history = rowsByKey.get(key) || [];

      return {
        id: key,
        label: address,
        color: CHART_COLORS[index % CHART_COLORS.length],
        values: dateKeys.map((dateKey) => {
          const latest = history
            .filter((row) => row.effective_date <= dateKey)
            .at(-1);

          return {
            dateKey,
            value: latest ? Number(latest.new_price) : null,
          };
        }),
      };
    });
  }, [dateKeys, priceHistory, visibleApartments]);

  const totalLeadsInRange = useMemo(
    () =>
      leadSeries.reduce(
        (total, item) =>
          total +
          item.values.reduce((sum, point) => sum + Number(point.value || 0), 0),
        0,
      ),
    [leadSeries],
  );

  function toggleVisibleApartment(address: string) {
    setVisibleApartments((current) => {
      if (current.includes(address)) {
        return current.filter((item) => item !== address);
      }
      return [...current, address];
    });
  }

  function setPreset(days: number) {
    const end = latestLeadDate || dateKeyFromUtcDate(new Date());
    setDateTo(end);
    setDateFrom(addDaysToDateKey(end, -(days - 1)));
  }

  function updateDraft(address: string, patch: Partial<PriceDraft>) {
    setPriceDrafts((current) => ({
      ...current,
      [address]: {
        newPrice: current[address]?.newPrice || "",
        effectiveDate:
          current[address]?.effectiveDate || dateKeyFromUtcDate(new Date()),
        note: current[address]?.note || "",
        ...patch,
      },
    }));
  }

  async function saveApartmentPrice(address: string) {
    const draft = priceDrafts[address];
    const parsedPrice = Number(
      String(draft?.newPrice || "").replace(/[$,]/g, ""),
    );

    setPriceNotice("");
    setPriceError("");

    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setPriceError(`Enter a valid price for ${address}.`);
      return;
    }

    if (!draft?.effectiveDate) {
      setPriceError(`Choose an effective date for ${address}.`);
      return;
    }

    setSavingAddress(address);

    try {
      const response = await fetch("/api/apartment-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aptAddress: address,
          newPrice: parsedPrice,
          effectiveDate: draft.effectiveDate,
          note: draft.note,
        }),
      });
      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to save apartment price");
      }

      const result = Array.isArray(json.result) ? json.result[0] : json.result;
      setPriceNotice(
        `${address}: ${formatMoney(result?.previous_price)} → ${formatMoney(
          result?.current_price,
        )} effective ${draft.effectiveDate}.`,
      );
      updateDraft(address, { newPrice: "", note: "" });
      await loadPriceData();
    } catch (error) {
      setPriceError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingAddress(null);
    }
  }

  return (
    <section className={styles.analyticsCard}>
      <div className={styles.analyticsHeader}>
        <div>
          <div className={styles.sectionTitle}>Apartment Analytics</div>
          <div className={styles.sectionSubtitle}>
            Analyze lead volume and manage dated apartment price changes.
          </div>
        </div>

        <div className={styles.analyticsTabs}>
          <button
            type="button"
            className={`${styles.analyticsTab} ${analyticsMode === "leads" ? styles.analyticsTabActive : ""
              }`}
            onClick={() => setAnalyticsMode("leads")}
          >
            Lead Volume
          </button>
          <button
            type="button"
            className={`${styles.analyticsTab} ${analyticsMode === "prices" ? styles.analyticsTabActive : ""
              }`}
            onClick={() => setAnalyticsMode("prices")}
          >
            Price History
          </button>
        </div>
      </div>

      <div className={styles.analyticsControls}>
        <div className={styles.datePresetGroup}>
          <button type="button" onClick={() => setPreset(7)}>
            Last 7 Days
          </button>
          <button type="button" onClick={() => setPreset(30)}>
            Last 30 Days
          </button>
          <button type="button" onClick={() => setPreset(90)}>
            Last 90 Days
          </button>
        </div>

        <label className={styles.dateField}>
          <span>From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </label>

        <label className={styles.dateField}>
          <span>To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </label>
      </div>

      <div className={styles.apartmentToggleRow}>
        <button
          type="button"
          className={styles.toggleUtilityBtn}
          onClick={() => setVisibleApartments(availableApartments)}
        >
          All
        </button>
        <button
          type="button"
          className={styles.toggleUtilityBtn}
          onClick={() => setVisibleApartments([])}
        >
          None
        </button>

        {availableApartments.map((address, index) => {
          const enabled = visibleApartments.includes(address);
          return (
            <button
              key={address}
              type="button"
              className={`${styles.apartmentToggleBtn} ${enabled ? styles.apartmentToggleBtnActive : ""
                }`}
              onClick={() => toggleVisibleApartment(address)}
            >
              <span
                className={styles.apartmentToggleDot}
                style={{
                  background: CHART_COLORS[index % CHART_COLORS.length],
                }}
              />
              {address}
            </button>
          );
        })}
      </div>

      {analyticsMode === "leads" ? (
        <div className={styles.analyticsGraphPanel}>
          <div className={styles.analyticsGraphTop}>
            <div>
              <strong>Lead Volume by Apartment</strong>
              <span>
                {dateFrom && dateTo
                  ? `${formatDateKeyShort(dateFrom)} – ${formatDateKeyShort(dateTo)}`
                  : "Choose a date range"}
              </span>
            </div>
            <div className={styles.analyticsMetric}>
              <strong>{totalLeadsInRange}</strong>
              <span>leads in range</span>
            </div>
          </div>

          <MultiLineChart
            dateKeys={dateKeys}
            series={leadSeries}
            emptyLabel="Enable at least one apartment to view lead volume."
          />
        </div>
      ) : (
        <div className={styles.priceAnalyticsLayout}>
          <div className={styles.priceManagerPanel}>
            <div className={styles.priceManagerHeader}>
              <div>
                <strong>Price Manager</strong>
                <span>Saving records the effective date in price history.</span>
              </div>
              <button
                type="button"
                onClick={loadPriceData}
                disabled={loadingPrices}
              >
                {loadingPrices ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {priceNotice && (
              <div className={styles.priceSuccess}>{priceNotice}</div>
            )}
            {priceError && <div className={styles.errorText}>{priceError}</div>}

            <div className={styles.priceManagerList}>
              {availableApartments.map((address) => {
                const current = priceByKey.get(
                  normalizeApartmentAddress(address),
                );
                const draft = priceDrafts[address] || {
                  newPrice: "",
                  effectiveDate: dateKeyFromUtcDate(new Date()),
                  note: "",
                };
                const parsedDraftPrice = Number(
                  String(draft.newPrice || "").replace(/[$,]/g, ""),
                );
                const currentPrice =
                  current?.current_price === null ||
                    current?.current_price === undefined
                    ? null
                    : Number(current.current_price);
                const draftIsValid =
                  Number.isFinite(parsedDraftPrice) && parsedDraftPrice > 0;
                const isSameAsCurrent =
                  draftIsValid &&
                  currentPrice !== null &&
                  parsedDraftPrice === currentPrice;
                const saveDisabled =
                  savingAddress === address ||
                  !draftIsValid ||
                  !draft.effectiveDate ||
                  isSameAsCurrent;

                return (
                  <article className={styles.priceEditorRow} key={address}>
                    <div className={styles.priceEditorIdentity}>
                      <strong>{address}</strong>
                      <span>
                        Current: {formatMoney(current?.current_price)}
                        {current?.price_effective_date
                          ? ` · since ${formatDateKeyShort(current.price_effective_date)}`
                          : ""}
                      </span>
                    </div>

                    <label>
                      <span>New price</span>
                      <input
                        type="number"
                        min="1"
                        step="50"
                        placeholder="Enter new price"
                        value={draft.newPrice}
                        onChange={(event) =>
                          updateDraft(address, { newPrice: event.target.value })
                        }
                      />
                    </label>

                    <label>
                      <span>Effective date</span>
                      <input
                        type="date"
                        value={draft.effectiveDate}
                        onChange={(event) =>
                          updateDraft(address, {
                            effectiveDate: event.target.value,
                          })
                        }
                      />
                    </label>

                    <label className={styles.priceNoteField}>
                      <span>Note</span>
                      <input
                        type="text"
                        placeholder="Optional"
                        value={draft.note}
                        onChange={(event) =>
                          updateDraft(address, { note: event.target.value })
                        }
                      />
                    </label>

                    <button
                      type="button"
                      className={styles.priceSaveBtn}
                      disabled={saveDisabled}
                      onClick={() => saveApartmentPrice(address)}
                      title={
                        isSameAsCurrent
                          ? "Enter a price different from the current price."
                          : !draftIsValid
                            ? "Enter a valid new price."
                            : !draft.effectiveDate
                              ? "Choose an effective date."
                              : "Save this price change."
                      }
                    >
                      {savingAddress === address
                        ? "Saving..."
                        : isSameAsCurrent
                          ? "No Price Change"
                          : "Save Price"}
                    </button>
                  </article>
                );
              })}
            </div>
          </div>

          <div className={styles.analyticsGraphPanel}>
            <div className={styles.analyticsGraphTop}>
              <div>
                <strong>Price History</strong>
                <span>
                  Each line carries the saved price forward until the next
                  change.
                </span>
              </div>
            </div>

            <MultiLineChart
              dateKeys={dateKeys}
              series={priceSeries}
              valuePrefix="$"
              stepped
              emptyLabel="Save an apartment price to begin its history graph."
            />
          </div>
        </div>
      )}
    </section>
  );
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
          "lead_id, created_at, created_at_ts, lead_name, phone, apt_address, current_status, conversation_stage, needs_human_review_bool, notes, last_outbound_sms, last_outbound_at, pipeline_status",
        );

      const [apartmentsResponse, leadsResponse] = await Promise.all([
        apartmentsRequest,
        leadsRequest,
      ]);

      if (apartmentsResponse.error) {
        setErrorMessage(apartmentsResponse.error.message);
        setApartments([]);
      } else {
        setApartments(
          buildCanonicalApartmentList(apartmentsResponse.data || []),
        );
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

  const canonicalByKey = useMemo(() => {
    return new Map(
      apartments.map((apartment) => [
        normalizeApartmentAddress(apartment.apt_address),
        apartment.apt_address,
      ]),
    );
  }, [apartments]);

  useEffect(() => {
    if (!apartments.length) return;

    const canonicalizeSelection = (items: string[]) =>
      Array.from(
        new Set(
          items
            .map((address) =>
              canonicalByKey.get(normalizeApartmentAddress(address)),
            )
            .filter((address): address is string => Boolean(address)),
        ),
      );

    setSelectedApartments((current) => canonicalizeSelection(current));

    setActiveApartments((current) => {
      const cleaned = canonicalizeSelection(current);

      if (cleaned.length) {
        saveStoredLiveApartments(cleaned);
      } else {
        clearStoredLiveApartments();
      }

      return cleaned;
    });
  }, [apartments, canonicalByKey]);

  const filteredLeads = useMemo(() => {
    if (!activeApartments.length) {
      return leads;
    }

    const activeKeys = new Set(
      activeApartments.map((address) => normalizeApartmentAddress(address)),
    );

    return leads.filter((lead) =>
      activeKeys.has(normalizeApartmentAddress(lead.apt_address)),
    );
  }, [activeApartments, leads]);

  const processingRows = useMemo(() => {
    return filteredLeads
      .filter((lead) => {
        const isProcessing =
          String(lead.current_status || "")
            .trim()
            .toLowerCase() === "processing";

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
      label: "Leads",
      view: "leads" as ActiveView,
      count: leads.length,
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
    {
      label: "Messages",
      view: "messages" as ActiveView,
      count: 0,
    },
    {
      label: "Rentvine",
      view: "rentvine" as ActiveView,
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
        weekLastDayKey,
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
      const addressCounts = countLeadsByAddressForDate(
        filteredLeads,
        dateKey,
        canonicalByKey,
      );
      const total = countTotal(addressCounts);

      return {
        dayName,
        dateKey,
        addressCounts,
        total,
      };
    });
  }, [canonicalByKey, filteredLeads, stats.weekStartKey]);

  const monthDays = useMemo(() => {
    if (!stats.monthStartKey) return [];

    const monthStartDate = utcDateFromKey(stats.monthStartKey);
    const monthYear = monthStartDate.getUTCFullYear();
    const monthNumber = monthStartDate.getUTCMonth() + 1;
    const daysInMonth = new Date(
      Date.UTC(monthYear, monthNumber, 0),
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
        dateKey,
        canonicalByKey,
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
  }, [canonicalByKey, dashboardTodayKey, filteredLeads, stats.monthStartKey]);

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
                  <div className={styles.liveTitle}>All Scraped Apartments</div>

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
                              apartment.apt_address,
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

            <ApartmentAnalytics
              apartments={apartments.map((apartment) => apartment.apt_address)}
              activeApartments={activeApartments}
              leads={leads}
              canonicalByKey={canonicalByKey}
            />
          </>
        )}

        {activeView === "leads" && (
          <LeadsTab
            leads={leads}
            loading={loadingLeads}
            onRefresh={async () => {
              setLoadingLeads(true);

              const { data, error } = await supabase
                .from("dashboard_leads_clean")
                .select(
                  "lead_id, created_at, created_at_ts, lead_name, phone, apt_address, current_status, conversation_stage, needs_human_review_bool, notes, last_outbound_sms, last_outbound_at, pipeline_status",
                );

              if (error) {
                setErrorMessage(error.message);
                setLeads([]);
              } else {
                setLeads(data || []);
              }

              setLoadingLeads(false);
            }}
          />
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

        {activeView === "messages" && <MessagesTab />}

        {activeView === "rentvine" && <RentvineTab />}
      </section>
    </main>
  );
}