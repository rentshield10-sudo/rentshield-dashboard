# Lease Template Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new tab where a fixed lease template PDF renders with clickable/draggable field boxes; Design mode creates/edits boxes, Fill mode populates them from Rentvine/Supabase/remembered values via a comparison-style modal, and filled values persist per draft.

**Architecture:** `pdfjs-dist` renders the template PDF to canvas; percentage-positioned `<div>` overlays sit on top as field boxes. Four new Supabase tables back field definitions, remembered autofill values, drafts, and per-draft filled values. A new `components/lease-template/` module and `/api/lease-template/*` routes mirror the existing Rentvine tab's patterns (CSS Modules, `supabaseServer`, JSON error shapes).

**Tech Stack:** Next.js App Router, TypeScript, `pdfjs-dist` (already a dependency), Supabase (`supabaseServer`), CSS Modules.

## Global Constraints

- Field box positions are stored as **percentages** of page width/height, not pixels — this is what keeps boxes aligned across zoom levels/screen sizes.
- The template PDF ships as a static file: `public/lease-template.pdf`.
- Every new Supabase table follows this project's existing pattern: RLS enabled, no policies (service-role-only access via `supabaseServer`), matching every other table in `supabase/migrations/`.
- API routes return `{ ok: true, ... }` / `{ ok: false, error, detail? }` JSON shapes, matching every existing route in `app/api/rentvine/`.
- No drag-and-drop field-type palette/sidebar, no multi-template management, no Telegram/email integration, no signature audit trail — all explicitly out of scope per the design doc (`docs/superpowers/specs/2026-07-29-lease-template-editor-design.md`).

---

### Task 1: Supabase schema

**Files:**
- Create: `supabase/migrations/2026-07-29-lease-template.sql`

**Interfaces:**
- Produces: four tables — `lease_template_fields`, `lease_template_remembered_values`, `lease_template_drafts`, `lease_template_filled_values` — that all later tasks read/write via `supabaseServer`.

- [ ] **Step 1: Write the migration**

```sql
create table if not exists lease_template_fields (
  id bigint generated always as identity primary key,
  page_number integer not null default 1,
  x numeric not null,
  y numeric not null,
  width numeric not null,
  height numeric not null,
  label text not null,
  field_type text not null default 'text' check (field_type in ('text', 'date', 'signature')),
  created_at timestamptz not null default now()
);

alter table lease_template_fields enable row level security;

create table if not exists lease_template_remembered_values (
  id bigint generated always as identity primary key,
  label text not null,
  value text not null,
  last_used_at timestamptz not null default now()
);

alter table lease_template_remembered_values enable row level security;

create table if not exists lease_template_drafts (
  id bigint generated always as identity primary key,
  apartment_lease_details_id bigint references apartment_lease_details(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table lease_template_drafts enable row level security;

create table if not exists lease_template_filled_values (
  id bigint generated always as identity primary key,
  draft_id bigint not null references lease_template_drafts(id) on delete cascade,
  field_id bigint not null references lease_template_fields(id) on delete cascade,
  value text not null,
  updated_at timestamptz not null default now(),
  unique (draft_id, field_id)
);

alter table lease_template_filled_values enable row level security;
```

- [ ] **Step 2: Run it in Supabase's SQL editor** (this project runs migrations manually, not via CLI — confirmed by every prior migration in this repo).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-07-29-lease-template.sql
git commit -m "Add Supabase schema for lease template editor"
```

---

### Task 2: Field CRUD API routes

**Files:**
- Create: `app/api/lease-template/fields/route.ts`
- Create: `app/api/lease-template/fields/[id]/route.ts`
- Test: manual `curl` verification (no test framework in this project — every existing route is verified this way).

**Interfaces:**
- Consumes: `lease_template_fields` table from Task 1.
- Produces:
  - `GET /api/lease-template/fields` → `{ ok: true, fields: FieldRow[] }`
  - `POST /api/lease-template/fields` body `{ pageNumber, x, y, width, height, label, fieldType }` → `{ ok: true, field: FieldRow }`
  - `PATCH /api/lease-template/fields/[id]` body `Partial<{ x, y, width, height, label, fieldType }>` → `{ ok: true, field: FieldRow }`
  - `DELETE /api/lease-template/fields/[id]` → `{ ok: true }`
  - `FieldRow = { id: number; page_number: number; x: number; y: number; width: number; height: number; label: string; field_type: "text" | "date" | "signature"; created_at: string }`

- [ ] **Step 1: Write `app/api/lease-template/fields/route.ts`**

```ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export async function GET() {
  try {
    const { data, error } = await supabaseServer
      .from("lease_template_fields")
      .select("id, page_number, x, y, width, height, label, field_type, created_at")
      .order("id", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ ok: true, fields: data });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const pageNumber = Number(body?.pageNumber ?? 1);
    const x = Number(body?.x);
    const y = Number(body?.y);
    const width = Number(body?.width);
    const height = Number(body?.height);
    const label = String(body?.label ?? "").trim();
    const fieldType = String(body?.fieldType ?? "text");

    if (!label) {
      return NextResponse.json({ ok: false, error: "label is required." }, { status: 400 });
    }
    if (![x, y, width, height].every(Number.isFinite)) {
      return NextResponse.json({ ok: false, error: "x, y, width, height must be numbers." }, { status: 400 });
    }
    if (!["text", "date", "signature"].includes(fieldType)) {
      return NextResponse.json({ ok: false, error: "fieldType must be text, date, or signature." }, { status: 400 });
    }

    const { data, error } = await supabaseServer
      .from("lease_template_fields")
      .insert({ page_number: pageNumber, x, y, width, height, label, field_type: fieldType })
      .select("id, page_number, x, y, width, height, label, field_type, created_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, field: data });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write `app/api/lease-template/fields/[id]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);
    const body = await request.json();

    const patch: Record<string, unknown> = {};
    for (const key of ["x", "y", "width", "height"] as const) {
      if (body?.[key] !== undefined) {
        const n = Number(body[key]);
        if (!Number.isFinite(n)) {
          return NextResponse.json({ ok: false, error: `${key} must be a number.` }, { status: 400 });
        }
        patch[key] = n;
      }
    }
    if (body?.label !== undefined) patch.label = String(body.label).trim();
    if (body?.fieldType !== undefined) {
      if (!["text", "date", "signature"].includes(body.fieldType)) {
        return NextResponse.json({ ok: false, error: "fieldType must be text, date, or signature." }, { status: 400 });
      }
      patch.field_type = body.fieldType;
    }

    const { data, error } = await supabaseServer
      .from("lease_template_fields")
      .update(patch)
      .eq("id", id)
      .select("id, page_number, x, y, width, height, label, field_type, created_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, field: data });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);
    const { error } = await supabaseServer.from("lease_template_fields").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify**

Run `npx tsc --noEmit` and `npm run lint` — expect no new errors (project convention, no automated test suite).

- [ ] **Step 4: Commit**

```bash
git add app/api/lease-template/fields
git commit -m "Add field CRUD API routes for lease template editor"
```

---

### Task 3: Remembered-values and fill-suggestions API routes

**Files:**
- Create: `app/api/lease-template/remembered-values/route.ts`
- Create: `app/api/lease-template/fill-suggestions/route.ts`

**Interfaces:**
- Consumes: `lease_template_remembered_values` table (Task 1), `apartment_lease_details` table (existing), `getRentvineLeaseSnapshot`/live Rentvine data is NOT required here — Rentvine-sourced data for suggestions comes from `apartment_lease_details` (already synced from Rentvine), not a fresh live API call. Label-to-Rentvine-field matching is a simple keyword heuristic (see Step 2).
- Produces:
  - `POST /api/lease-template/remembered-values` body `{ label, value }` → `{ ok: true }` (upserts, bumping `last_used_at` if the same label+value already exists)
  - `GET /api/lease-template/fill-suggestions?label=...&apartmentId=...` →
    `{ ok: true, suggestions: { source: "rentvine" | "supabase" | "remembered"; value: string }[] }`

- [ ] **Step 1: Write `app/api/lease-template/remembered-values/route.ts`**

```ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const label = String(body?.label ?? "").trim();
    const value = String(body?.value ?? "").trim();

    if (!label || !value) {
      return NextResponse.json({ ok: false, error: "label and value are required." }, { status: 400 });
    }

    const { data: existing, error: findError } = await supabaseServer
      .from("lease_template_remembered_values")
      .select("id")
      .eq("label", label)
      .eq("value", value)
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      const { error } = await supabaseServer
        .from("lease_template_remembered_values")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabaseServer
        .from("lease_template_remembered_values")
        .insert({ label, value });
      if (error) throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write `app/api/lease-template/fill-suggestions/route.ts`**

Matches a field's `label` against `apartment_lease_details` columns via simple
keyword heuristics (case-insensitive substring match on the label), when an
`apartmentId` query param is provided:

```ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

type Suggestion = { source: "rentvine" | "supabase" | "remembered"; value: string };

const LABEL_KEYWORD_MAP: { keywords: string[]; column: string }[] = [
  { keywords: ["tenant", "lessee", "resident"], column: "tenant_name" },
  { keywords: ["address"], column: "address" },
  { keywords: ["unit", "apt"], column: "unit" },
  { keywords: ["rent", "price"], column: "current_rent" },
  { keywords: ["commence", "start", "activation"], column: "activation_1" },
  { keywords: ["expir", "end"], column: "expiration_1" },
];

function matchColumn(label: string): string | null {
  const lower = label.toLowerCase();
  for (const entry of LABEL_KEYWORD_MAP) {
    if (entry.keywords.some((k) => lower.includes(k))) return entry.column;
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const label = url.searchParams.get("label") ?? "";
    const apartmentId = url.searchParams.get("apartmentId");

    const suggestions: Suggestion[] = [];

    if (apartmentId) {
      const column = matchColumn(label);
      if (column) {
        const { data, error } = await supabaseServer
          .from("apartment_lease_details")
          .select(column)
          .eq("id", apartmentId)
          .maybeSingle();
        if (error) throw error;
        const raw = (data as Record<string, unknown> | null)?.[column];
        if (raw !== null && raw !== undefined && raw !== "") {
          suggestions.push({ source: "supabase", value: String(raw) });
        }
      }
    }

    const { data: remembered, error: rememberedError } = await supabaseServer
      .from("lease_template_remembered_values")
      .select("value")
      .eq("label", label)
      .order("last_used_at", { ascending: false })
      .limit(5);

    if (rememberedError) throw rememberedError;

    for (const row of remembered ?? []) {
      suggestions.push({ source: "remembered", value: row.value as string });
    }

    return NextResponse.json({ ok: true, suggestions });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
```

Note: "rentvine" as a distinct live-API source is deferred — `apartment_lease_details`
already mirrors synced Rentvine data, so the `"supabase"` source covers it for v1.
If live (not-yet-synced) Rentvine values are needed later, add a Rentvine API call
here following the same pattern as `lib/rentvine.ts`.

- [ ] **Step 3: Verify**

`npx tsc --noEmit`, `npm run lint` — no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/lease-template/remembered-values app/api/lease-template/fill-suggestions
git commit -m "Add remembered-values and fill-suggestions API routes"
```

---

### Task 4: Draft CRUD + filled-value persistence API routes

**Files:**
- Create: `app/api/lease-template/drafts/route.ts`
- Create: `app/api/lease-template/drafts/[id]/values/route.ts`

**Interfaces:**
- Consumes: `lease_template_drafts`, `lease_template_filled_values` tables (Task 1).
- Produces:
  - `POST /api/lease-template/drafts` body `{ apartmentLeaseDetailsId?: number }` → `{ ok: true, draft: { id, apartment_lease_details_id, created_at, updated_at } }`
  - `GET /api/lease-template/drafts/[id]/values` → `{ ok: true, values: { field_id: number; value: string }[] }`
  - `PATCH /api/lease-template/drafts/[id]/values` body `{ fieldId: number; value: string }` → `{ ok: true }` (upserts one field's value; called once per box filled, not batched, matching how the existing Rentvine tab saves one field's edit at a time)

- [ ] **Step 1: Write `app/api/lease-template/drafts/route.ts`**

```ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const apartmentLeaseDetailsId = body?.apartmentLeaseDetailsId ?? null;

    const { data, error } = await supabaseServer
      .from("lease_template_drafts")
      .insert({ apartment_lease_details_id: apartmentLeaseDetailsId })
      .select("id, apartment_lease_details_id, created_at, updated_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, draft: data });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write `app/api/lease-template/drafts/[id]/values/route.ts`**

```ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);
    const { data, error } = await supabaseServer
      .from("lease_template_filled_values")
      .select("field_id, value")
      .eq("draft_id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true, values: data });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);
    const body = await request.json();
    const fieldId = Number(body?.fieldId);
    const value = String(body?.value ?? "");

    if (!Number.isFinite(fieldId)) {
      return NextResponse.json({ ok: false, error: "fieldId must be a number." }, { status: 400 });
    }

    const { error } = await supabaseServer
      .from("lease_template_filled_values")
      .upsert(
        { draft_id: Number(id), field_id: fieldId, value, updated_at: new Date().toISOString() },
        { onConflict: "draft_id,field_id" },
      );

    if (error) throw error;

    await supabaseServer
      .from("lease_template_drafts")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify**

`npx tsc --noEmit`, `npm run lint` — no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/lease-template/drafts
git commit -m "Add draft and filled-value persistence API routes"
```

---

### Task 5: Template PDF asset + PDF rendering

**Files:**
- Create: `public/lease-template.pdf` (placeholder — user supplies the real file; see note below)
- Create: `components/lease-template/LeaseTemplateTab.tsx`
- Create: `components/lease-template/LeaseTemplateTab.module.css`

**Interfaces:**
- Consumes: `pdfjs-dist` (existing dependency).
- Produces: `LeaseTemplateTab` default export, a client component rendering the PDF to a `<canvas>` with a container `<div>` (`pageContainerRef`) that Task 6's overlay boxes position themselves inside via percentage `left/top/width/height`.

**Note:** the actual `31 Linden Ave` lease PDF shown in the screenshot needs
to be supplied by the user and dropped at `public/lease-template.pdf` — this
task scaffolds the rendering code against whatever PDF is present at that
path (falls back to a clear "no template uploaded" empty state if missing).

- [ ] **Step 1: Write `LeaseTemplateTab.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./LeaseTemplateTab.module.css";

export default function LeaseTemplateTab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const doc = await pdfjs.getDocument("/lease-template.pdf").promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (!cancelled) setPageSize({ width: viewport.width, height: viewport.height });
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load the lease template PDF.",
          );
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Lease Template</h1>
      </div>
      {error && <div className={styles.errorBanner}>{error}</div>}
      <div className={styles.pageContainer} ref={containerRef}>
        <canvas ref={canvasRef} className={styles.canvas} />
        {/* Task 6 adds field box overlays here, positioned against pageSize */}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Copy the PDF.js worker file so it's servable as a static asset**

`pdfjs-dist`'s worker must be reachable at a URL the browser can fetch
directly (it runs in its own thread, outside Next.js's module bundling).

```bash
cp node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs public/pdf.worker.min.mjs
```

- [ ] **Step 3: Write `LeaseTemplateTab.module.css`**

```css
.page {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 18px;
}

.header h1 {
    margin: 0;
    color: #0f172a;
    font-size: 24px;
}

.errorBanner {
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 12px;
    padding: 14px 18px;
    color: #991b1b;
    font-size: 13px;
}

.pageContainer {
    position: relative;
    display: inline-block;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
}

.canvas {
    display: block;
}
```

- [ ] **Step 4: Verify**

`npx tsc --noEmit`, `npm run lint` — no new errors. Manual browser check:
navigate to the tab, confirm either the PDF renders or the clear "could not
load" error banner shows (since the real template file isn't supplied yet).

- [ ] **Step 5: Commit**

```bash
git add components/lease-template public/pdf.worker.min.mjs
git commit -m "Add lease template tab with PDF rendering"
```

---

### Task 6: Field box overlay — Design mode (create/move/resize/delete)

**Files:**
- Create: `components/lease-template/FieldBox.tsx`
- Create: `components/lease-template/FieldEditorModal.tsx`
- Modify: `components/lease-template/LeaseTemplateTab.tsx`
- Modify: `components/lease-template/LeaseTemplateTab.module.css`

**Interfaces:**
- Consumes: `GET/POST /api/lease-template/fields`, `PATCH/DELETE /api/lease-template/fields/[id]` (Task 2); `pageSize` from Task 5.
- Produces: `FieldBox` component (props: `field: FieldRow`, `mode: "design" | "fill"`, `onEdit`, `onDelete`, `onClick`); `FieldEditorModal` component (props: `initialLabel`, `initialFieldType`, `onSave`, `onCancel`).

- [ ] **Step 1: Write `FieldEditorModal.tsx`**

```tsx
"use client";

import { useState } from "react";
import styles from "./LeaseTemplateTab.module.css";

export type FieldType = "text" | "date" | "signature";

export default function FieldEditorModal({
  initialLabel,
  initialFieldType,
  onSave,
  onCancel,
}: {
  initialLabel: string;
  initialFieldType: FieldType;
  onSave: (label: string, fieldType: FieldType) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [fieldType, setFieldType] = useState<FieldType>(initialFieldType);

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>Field</h2>
        <div className={styles.modalField}>
          <label className={styles.modalLabel}>Label</label>
          <input
            className={styles.modalInput}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
          />
        </div>
        <div className={styles.modalField}>
          <label className={styles.modalLabel}>Type</label>
          <select
            className={styles.modalInput}
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as FieldType)}
          >
            <option value="text">Text</option>
            <option value="date">Date</option>
            <option value="signature">Signature</option>
          </select>
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={styles.smallButton} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => label.trim() && onSave(label.trim(), fieldType)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `FieldBox.tsx`**

```tsx
"use client";

import styles from "./LeaseTemplateTab.module.css";

export interface FieldRow {
  id: number;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  field_type: "text" | "date" | "signature";
}

export default function FieldBox({
  field,
  mode,
  value,
  onClick,
  onDelete,
}: {
  field: FieldRow;
  mode: "design" | "fill";
  value?: string;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={mode === "design" ? styles.fieldBoxDesign : styles.fieldBoxFill}
      style={{
        left: `${field.x}%`,
        top: `${field.y}%`,
        width: `${field.width}%`,
        height: `${field.height}%`,
      }}
      onClick={onClick}
      title={field.label}
    >
      <span className={styles.fieldBoxLabel}>{value || field.label}</span>
      {mode === "design" && onDelete && (
        <button
          type="button"
          className={styles.fieldBoxDelete}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire Design mode into `LeaseTemplateTab.tsx`**

Add: a mode toggle (Design/Fill buttons), field list state loaded from
`GET /api/lease-template/fields` on mount, mouse-down/move/up handlers on
`pageContainerRef` that (in Design mode only) track a drag rectangle in
pixels, convert to percentages of `pageSize` on mouse-up, and open
`FieldEditorModal` to name the new box before `POST`-ing it. Render
`FieldBox` for each existing field, passing `mode="design"` with a delete
handler that calls `DELETE /api/lease-template/fields/[id]` and removes it
from local state. Clicking an existing box in Design mode reopens
`FieldEditorModal` pre-filled, saving via `PATCH`.

- [ ] **Step 4: Add box/modal CSS to `LeaseTemplateTab.module.css`**

```css
.fieldBoxDesign, .fieldBoxFill {
    position: absolute;
    border: 2px dashed #2563eb;
    background: rgba(37, 99, 235, 0.08);
    cursor: pointer;
    display: flex;
    align-items: center;
    padding: 2px 4px;
    font-size: 10px;
    color: #1d4ed8;
    overflow: hidden;
}

.fieldBoxFill {
    border-style: solid;
    background: rgba(37, 99, 235, 0.04);
}

.fieldBoxLabel {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.fieldBoxDelete {
    position: absolute;
    top: -8px;
    right: -8px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 1px solid #dc2626;
    background: #ffffff;
    color: #dc2626;
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
}

.modeToggle {
    display: flex;
    gap: 8px;
}

.modalField {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
}

.modalLabel {
    font-size: 12px;
    font-weight: 700;
    color: #374151;
}

.modalInput {
    border: 1px solid #d1d5db;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 14px;
    font-family: inherit;
}
```

Note: `.modalOverlay`, `.modalCard`, `.modalTitle`, `.modalActions`,
`.smallButton`, `.primaryButton` follow the same names/shapes already
established in `components/rentvine/RentvineTab.module.css` — duplicate
those rules here (this module is a separate CSS Modules file, no cross-file
sharing) rather than inventing new class names.

- [ ] **Step 5: Verify**

`npx tsc --noEmit`, `npm run lint` — no new errors. Manual browser check:
switch to Design mode, drag to create a box, name it, confirm it persists
after a page reload (re-fetches from `GET /api/lease-template/fields`);
delete a box, confirm it's gone after reload too.

- [ ] **Step 6: Commit**

```bash
git add components/lease-template
git commit -m "Add Design mode: create, move, and delete field boxes"
```

---

### Task 7: Fill mode — value modal with tagged suggestions

**Files:**
- Create: `components/lease-template/FillValueModal.tsx`
- Modify: `components/lease-template/LeaseTemplateTab.tsx`
- Modify: `components/lease-template/LeaseTemplateTab.module.css`

**Interfaces:**
- Consumes: `GET /api/lease-template/fill-suggestions`, `POST /api/lease-template/remembered-values`, `PATCH /api/lease-template/drafts/[id]/values` (Tasks 3–4).
- Produces: `FillValueModal` component (props: `field: FieldRow`, `currentValue`, `suggestions: Suggestion[]`, `onSelect: (value) => void`, `onCancel`).

- [ ] **Step 1: Write `FillValueModal.tsx`**

```tsx
"use client";

import { useState } from "react";
import styles from "./LeaseTemplateTab.module.css";
import type { FieldRow } from "./FieldBox";

export type Suggestion = { source: "rentvine" | "supabase" | "remembered"; value: string };

const SOURCE_LABELS: Record<Suggestion["source"], string> = {
  rentvine: "From Rentvine",
  supabase: "From Supabase",
  remembered: "Remembered",
};

export default function FillValueModal({
  field,
  currentValue,
  suggestions,
  onSelect,
  onCancel,
}: {
  field: FieldRow;
  currentValue: string;
  suggestions: Suggestion[];
  onSelect: (value: string) => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState(currentValue);

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>{field.label}</h2>

        {suggestions.length > 0 && (
          <div className={styles.suggestionList}>
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                className={styles.suggestionItem}
                onClick={() => onSelect(s.value)}
              >
                <span className={styles.suggestionSource}>{SOURCE_LABELS[s.source]}</span>
                <span>{s.value}</span>
              </button>
            ))}
          </div>
        )}

        <div className={styles.modalField}>
          <label className={styles.modalLabel}>Or type a value</label>
          <input
            className={styles.modalInput}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
          />
        </div>

        <div className={styles.modalActions}>
          <button type="button" className={styles.smallButton} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => onSelect(typed)}
          >
            Use this value
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire Fill mode into `LeaseTemplateTab.tsx`**

Add: `draftId` state (created via `POST /api/lease-template/drafts` on
first entering Fill mode, or reused if one already exists for the session),
`filledValues: Record<fieldId, string>` loaded from
`GET /api/lease-template/drafts/[id]/values`. Clicking a `FieldBox` in Fill
mode fetches `GET /api/lease-template/fill-suggestions?label=...` and opens
`FillValueModal`. On select: `PATCH` the draft value, `POST` to
remembered-values (so typed/selected values feed back into future
suggestions), update local `filledValues`, close the modal. Render each
`FieldBox` with `value={filledValues[field.id]}` so filled boxes show their
answer instead of the label.

- [ ] **Step 3: Add suggestion-list CSS to `LeaseTemplateTab.module.css`**

```css
.suggestionList {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
}

.suggestionItem {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 8px 10px;
    background: #ffffff;
    cursor: pointer;
    font-size: 13px;
    text-align: left;
}

.suggestionItem:hover {
    background: #f8fafc;
}

.suggestionSource {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #6b7280;
}
```

- [ ] **Step 4: Verify**

`npx tsc --noEmit`, `npm run lint` — no new errors. Manual browser check:
switch to Fill mode, click a box, confirm the modal shows remembered
suggestions (after Task 6/7 testing has created at least one), pick or type
a value, reload the page, confirm the filled value persists.

- [ ] **Step 5: Commit**

```bash
git add components/lease-template
git commit -m "Add Fill mode: tagged suggestions and value persistence"
```

---

### Task 8: Wire the new tab into the dashboard nav

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `LeaseTemplateTab` (Task 5).
- Produces: a new `"lease-template"` entry in the `ActiveView` union, `navItems` array, and `VALID_ACTIVE_VIEWS` (added in the earlier tab-persistence fix), plus a dynamic import matching the existing `BookingTab`/`LeadsTab`/etc. pattern.

- [ ] **Step 1: Add the dynamic import**

```tsx
const LeaseTemplateTab = dynamic(() => import("../components/lease-template/LeaseTemplateTab"), {
  loading: () => <div style={{ padding: 24 }}>Loading Lease Template…</div>,
});
```

- [ ] **Step 2: Extend `ActiveView` and `VALID_ACTIVE_VIEWS`**

```ts
type ActiveView = "home" | "leads" | "human" | "booking" | "messages" | "rentvine" | "lease-template";

const VALID_ACTIVE_VIEWS: ActiveView[] = ["home", "leads", "human", "booking", "messages", "rentvine", "lease-template"];
```

- [ ] **Step 3: Add a nav item and render branch**

Add `{ view: "lease-template", label: "Lease Template", count: 0 }` to
`navItems` (matching the shape of existing entries), and
`{activeView === "lease-template" && <LeaseTemplateTab />}` alongside the
other `activeView === "..."` render branches.

- [ ] **Step 4: Verify**

`npx tsc --noEmit`, `npm run lint`, `npm run build` — no new errors, new
route/tab appears in the build output. Manual browser check: click the new
nav item, confirm the tab loads.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "Wire Lease Template tab into dashboard navigation"
```
