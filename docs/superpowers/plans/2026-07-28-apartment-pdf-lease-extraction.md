# Apartment Lease PDF Extraction (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload a signed lease PDF per apartment row, extract the lease term dates and rent via server-side text parsing, review/edit the extracted values inline, and save them to Supabase and/or push them to the team's Google Sheet — making Activation 1, Expiration 1, and Current Rent editable for the first time.

**Architecture:** A new stateless extraction route parses an uploaded PDF's text with `pdf-parse` and regex-matches the two confirmed patterns (lease term dates, rent). The existing PATCH route is extended to persist the three newly-editable fields. The existing push-sheet route is extended to send a flexible `cells` object (instead of a fixed activation2/expiration2 pair) to an updated n8n workflow that does a Google Sheets `values:batchUpdate` instead of a single-range write.

**Tech Stack:** Next.js 16 App Router API routes, TypeScript, `pdf-parse` (new dependency), Supabase, n8n (external, user-maintained).

## Global Constraints

- Never expose `SUPABASE_SERVICE_ROLE_KEY` or the n8n webhook URL to browser code — all external calls happen server-side in route handlers (matches Phases 1–2).
- Error responses use the structured shape `{ok:false, error, detail?}`, matching sibling routes.
- No automated test framework exists in this repo — verification is `npx tsc --noEmit`, `npm run lint`, curl, and manual checks against the real sample PDF the user already provided.
- Extraction failures must never block manual entry — all affected fields stay editable regardless of whether extraction succeeded (spec: Error handling).
- **After Task 4, the user must update `N8N_APARTMENT_SHEET_WEBHOOK_URL` in `.env.local` to the new workflow's webhook URL** before "Save to Sheet" will work correctly — the old n8n workflow expects a different payload shape (`activation2`/`expiration2` directly) than what the updated push-sheet route now sends (`cells`), so leaving the old URL configured would cause silent/confusing failures once Task 3 ships.
- Live writes to the real Google Sheet (via the n8n webhook) must NOT be triggered by an unsupervised task implementer — same rule as Phase 2. Extraction against the real sample PDF IS safe to test for real (it's read-only, no external system is written to).

---

### Task 1: Add `pdf-parse` dependency and the extraction route

**Files:**
- Modify: `package.json` (add `pdf-parse` dependency)
- Create: `app/api/rentvine/apartment-details/[id]/extract-pdf/route.ts`
- Test: manual `curl` verification against the real sample PDF

**Interfaces:**
- Produces: `POST /api/rentvine/apartment-details/:id/extract-pdf` (multipart/form-data, field name `file`) → `{ ok: true, activation1: "YYYY-MM-DD", expiration1: "YYYY-MM-DD", currentRent: number }` or `{ ok: false, error: string }`. Consumed by `RentvineTab.tsx`'s "Extract" button (Task 5). The `:id` route param exists for URL consistency with sibling routes but is not used in this route's logic — this route is stateless and touches no database.

- [ ] **Step 1: Add the `pdf-parse` dependency**

```bash
npm install pdf-parse
```

Confirm `package.json`'s `dependencies` now includes `"pdf-parse"` (any recent `^1.x` version installed by npm is fine).

- [ ] **Step 2: Write the extraction route**

```ts
// app/api/rentvine/apartment-details/[id]/extract-pdf/route.ts
import { NextResponse } from "next/server";
import pdfParse from "pdf-parse";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

function convertUsDateToIso(value: string): string | null {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "No file uploaded." }, { status: 400 });
    }

    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json({ ok: false, error: "File must be a PDF." }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ ok: false, error: "File is too large (max 10MB)." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const parsed = await pdfParse(buffer);
    const text = parsed.text;

    const dateMatch = text.match(
      /commence\s+on,?\s*(\d{1,2}\/\d{1,2}\/\d{4})[\s\S]*?expiration\s+on,?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    );

    if (!dateMatch) {
      return NextResponse.json(
        { ok: false, error: "Could not find lease dates in this PDF." },
        { status: 422 },
      );
    }

    const activation1 = convertUsDateToIso(dateMatch[1]);
    const expiration1 = convertUsDateToIso(dateMatch[2]);

    if (!activation1 || !expiration1) {
      return NextResponse.json(
        { ok: false, error: "Found lease dates but couldn't parse their format." },
        { status: 422 },
      );
    }

    const rentMatch = text.match(/installments\s+of\s*\$([\d,]+(?:\.\d{2})?)/i);

    if (!rentMatch) {
      return NextResponse.json(
        { ok: false, error: "Could not find the rent amount in this PDF." },
        { status: 422 },
      );
    }

    const currentRent = Number(rentMatch[1].replace(/,/g, ""));

    if (!Number.isFinite(currentRent)) {
      return NextResponse.json(
        { ok: false, error: "Found a rent amount but couldn't parse it as a number." },
        { status: 422 },
      );
    }

    return NextResponse.json({ ok: true, activation1, expiration1, currentRent });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to parse PDF." },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: only the pre-existing unrelated error in `.next/dev/types/validator.ts` about `app/api/quo/conversations/route.ts` (confirmed present on `main`, not yours to fix). No new errors. If `pdf-parse` has no bundled types and TypeScript complains about an implicit `any` import, add a minimal ambient module declaration file `types/pdf-parse.d.ts` with:

```ts
declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
  }
  function pdfParse(data: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}
```

Only add this file if `tsc` actually errors without it — `pdf-parse` may already ship usable types.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Manually verify extraction against the real sample PDF**

Ask the user for the sample PDF file (the "423 South 14th St... Lease Agreement 2025" document used to design this spec) if you don't already have a local copy — you'll need actual file bytes to test with, not just the text excerpt from the spec.

With `npm run dev` running (note the port):

```bash
curl -s -X POST http://localhost:3002/api/rentvine/apartment-details/1/extract-pdf \
  -F "file=@/path/to/sample-lease.pdf"
```

Expected: `{"ok":true,"activation1":"2025-11-15","expiration1":"2026-10-31","currentRent":2350}` — matching the spec's confirmed source values (`commence on, 11/15/2025`, `expiration on, 10/31/2026`, `installments of $2,350`).

If you cannot obtain the actual PDF file, report this in your task report as a gap (BLOCKED-adjacent — you may still mark DONE_WITH_CONCERNS if the code review of the regex against the exact spec'd text is your only verification) and note it clearly so the controller can arrange a real test with the user.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json "app/api/rentvine/apartment-details/[id]/extract-pdf/route.ts"
git add types/pdf-parse.d.ts 2>/dev/null || true
git commit -m "feat: add PDF lease-data extraction route"
```

---

### Task 2: Extend the Supabase save route for the 3 new editable fields

**Files:**
- Modify: `app/api/rentvine/apartment-details/[id]/route.ts`
- Test: manual `curl` verification

**Interfaces:**
- Consumes: `supabaseServer` from `lib/supabase-server.ts`; `apartment_lease_details` table.
- Produces: `PATCH /api/rentvine/apartment-details/:id` now accepts `{ activation1, expiration1, activation2, expiration2, currentRent }` (all optional/nullable strings except `currentRent` which is a number or numeric string) → `{ ok: true, row: { id, address, unit, activation_1, expiration_1, activation_2, expiration_2, current_rent, updated_at } }`. The response row shape grows from Phase 2's 5 fields to 8 — Task 5's UI consumes the new fields too.

- [ ] **Step 1: Rewrite the route**

```ts
// app/api/rentvine/apartment-details/[id]/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

function toDateOrNull(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);
    const body = await request.json();

    const activation1 = toDateOrNull(body?.activation1);
    const expiration1 = toDateOrNull(body?.expiration1);
    const activation2 = toDateOrNull(body?.activation2);
    const expiration2 = toDateOrNull(body?.expiration2);
    const currentRent = toNumberOrNull(body?.currentRent);

    const { data, error } = await supabaseServer
      .from("apartment_lease_details")
      .update({
        activation_1: activation1,
        expiration_1: expiration1,
        activation_2: activation2,
        expiration_2: expiration2,
        current_rent: currentRent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(
        "id, address, unit, activation_1, expiration_1, activation_2, expiration_2, current_rent, updated_at",
      )
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, row: data });
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

Note: this always writes all 5 fields (not a true partial-update). This is intentional and matches how Task 5's UI will call it — the UI always sends the row's complete current edit-state snapshot (a mix of freshly-edited and untouched-but-known values), so a full overwrite with that snapshot is equivalent to a partial update from the user's perspective, and keeps this route simple.

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit` — expect only the pre-existing unrelated error.
Run: `npm run lint` — expect no new errors.

- [ ] **Step 3: Manually verify**

Pick a real `id` from `GET /api/rentvine/apartment-details`, note its current `activation_1`/`expiration_1`/`current_rent` values, then:

```bash
curl -s -X PATCH http://localhost:3002/api/rentvine/apartment-details/<id> \
  -H "Content-Type: application/json" \
  -d '{"activation1":"2025-11-15","expiration1":"2026-10-31","activation2":"","expiration2":"","currentRent":2350}'
```

Expected: `{"ok":true,"row":{"id":<id>,...,"activation_1":"2025-11-15","expiration_1":"2026-10-31","activation_2":null,"expiration_2":null,"current_rent":2350,...}}`.

**Restore the row's original values afterward** (same discipline as Phase 2's Task 5) — PATCH it back to whatever you captured before the test, so this row stays clean for any later verification that assumes unedited data.

- [ ] **Step 4: Commit**

```bash
git add "app/api/rentvine/apartment-details/[id]/route.ts"
git commit -m "feat: extend apartment details PATCH route to save activation_1/expiration_1/current_rent"
```

---

### Task 3: Extend the Sheet push route to send a flexible cells payload

**Files:**
- Modify: `app/api/rentvine/apartment-details/[id]/push-sheet/route.ts`
- Test: type-check, lint, and the same safe 404-only check as Phase 2 — **do NOT invoke the real n8n webhook** (see Global Constraints)

**Interfaces:**
- Consumes: `supabaseServer`; `apartment_lease_details` table; `process.env.N8N_APARTMENT_SHEET_WEBHOOK_URL`.
- Produces: `POST /api/rentvine/apartment-details/:id/push-sheet` — same response shape as Phase 2 (`{ok:true, n8nResponse}` / `{ok:false, error, detail?}`), but the outbound webhook payload changes from `{address, unit, activation2, expiration2}` to `{address, unit, cells: {D?, E?, F?, G?, I?}}`. This is a breaking change to the webhook contract — Task 4's updated n8n workflow is the counterpart that understands the new shape.

- [ ] **Step 1: Rewrite the route**

```ts
// app/api/rentvine/apartment-details/[id]/push-sheet/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);

    const webhookUrl = process.env.N8N_APARTMENT_SHEET_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json(
        { ok: false, error: "Missing env var: N8N_APARTMENT_SHEET_WEBHOOK_URL" },
        { status: 500 },
      );
    }

    const { data: row, error: fetchError } = await supabaseServer
      .from("apartment_lease_details")
      .select("address, unit, activation_1, expiration_1, activation_2, expiration_2, current_rent")
      .eq("id", id)
      .single();

    if (fetchError) throw fetchError;
    if (!row) {
      return NextResponse.json(
        { ok: false, error: `No apartment_lease_details row with id ${id}` },
        { status: 404 },
      );
    }

    const cells: Record<string, string> = {};
    if (row.activation_1) cells.D = row.activation_1;
    if (row.expiration_1) cells.E = row.expiration_1;
    if (row.activation_2) cells.F = row.activation_2;
    if (row.expiration_2) cells.G = row.expiration_2;
    if (row.current_rent !== null) cells.I = String(row.current_rent);

    const n8nRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: row.address,
        unit: row.unit,
        cells,
      }),
    });

    const n8nText = await n8nRes.text();
    let n8nJson: unknown;
    try {
      n8nJson = JSON.parse(n8nText);
    } catch {
      n8nJson = { raw: n8nText };
    }

    if (!n8nRes.ok) {
      return NextResponse.json(
        { ok: false, error: `n8n webhook returned ${n8nRes.status}`, detail: n8nJson },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, n8nResponse: n8nJson });
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

Run: `npx tsc --noEmit` — expect only the pre-existing unrelated error.
Run: `npm run lint` — expect no new errors.

- [ ] **Step 3: Verify WITHOUT calling the real webhook**

Same safe-only test as Phase 2's Task 6:

```bash
curl -s -X POST http://localhost:3002/api/rentvine/apartment-details/999999999/push-sheet
```

Expected: `{"ok":false,"error":"No apartment_lease_details row with id 999999999"}`, 404 — this path never reaches the webhook call.

Re-read the code to confirm: the `cells` object only includes keys for non-null Supabase fields (do not test this by calling the real webhook — confirm by code inspection that the conditional `if (row.x) cells.Y = ...` lines are present for all 5 fields).

- [ ] **Step 4: Commit**

```bash
git add "app/api/rentvine/apartment-details/[id]/push-sheet/route.ts"
git commit -m "feat: send flexible cells payload to n8n instead of fixed activation2/expiration2"
```

---

### Task 4: Update the n8n workflow to a batch-update shape

**Files:**
- Create: `docs/superpowers/n8n-mission-control-update-apartment-cells.json` (new workflow file — the old `n8n-mission-control-update-renewal-dates.json` stays as-is/untouched for comparison/rollback)
- Create: `docs/superpowers/n8n-mission-control-update-apartment-cells-SETUP.md`
- Test: none automatable — this is an n8n workflow JSON the user imports into their own n8n instance; verification happens when they do that

**Interfaces:**
- Produces: an n8n webhook that accepts `POST { address, unit, cells: { [column: string]: string } }` and writes each `cells` entry to the matching sheet row's corresponding column via a Google Sheets `values:batchUpdate` call. Consumed by Task 3's push-sheet route once the user points `N8N_APARTMENT_SHEET_WEBHOOK_URL` at this new workflow's webhook.

- [ ] **Step 1: Write the workflow JSON**

```json
{
  "name": "Mission Control - Update Apartment Cells (Batch)",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "mission-control/update-apartment-cells",
        "responseMode": "responseNode",
        "options": {}
      },
      "id": "webhook-trigger",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [200, 300],
      "webhookId": "mission-control-update-apartment-cells"
    },
    {
      "parameters": {
        "resource": "sheet",
        "operation": "read",
        "documentId": {
          "__rl": true,
          "value": "1i9Q3Bcul0C4tYwfUTHw6dYjKtEq6LGSOMRm4k115UGg",
          "mode": "id"
        },
        "sheetName": {
          "__rl": true,
          "value": "gid=0",
          "mode": "list"
        },
        "options": {}
      },
      "id": "get-all-rows",
      "name": "Get All Rows",
      "type": "n8n-nodes-base.googleSheets",
      "typeVersion": 4.5,
      "position": [420, 300],
      "credentials": {
        "googleSheetsOAuth2Api": {
          "id": "REPLACE_WITH_YOUR_CREDENTIAL_ID",
          "name": "Google Sheets account"
        }
      }
    },
    {
      "parameters": {
        "jsCode": "const body = $('Webhook').first().json.body;\nconst targetAddress = String(body.address || '').trim().toLowerCase();\nconst targetUnit = String(body.unit || '').trim().toLowerCase();\nconst cells = body.cells || {};\n\nconst match = items.find((item) => {\n  const addr = String(item.json['Address'] || '').trim().toLowerCase();\n  const unit = String(item.json['Room Floor'] || '').trim().toLowerCase();\n  return addr === targetAddress && unit === targetUnit;\n});\n\nif (!match) {\n  throw new Error(`No sheet row found matching address \"${targetAddress}\" + unit \"${targetUnit}\"`);\n}\n\nconst rowNumber = match.json.row_number;\nconst columns = Object.keys(cells);\n\nif (columns.length === 0) {\n  throw new Error('No cells provided to write.');\n}\n\nconst data = columns.map((col) => ({\n  range: `Sheet1!${col}${rowNumber}:${col}${rowNumber}`,\n  values: [[cells[col]]]\n}));\n\nreturn [{ json: { data } }];"
      },
      "id": "find-matching-row",
      "name": "Find Matching Row",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [640, 300]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://sheets.googleapis.com/v4/spreadsheets/1i9Q3Bcul0C4tYwfUTHw6dYjKtEq6LGSOMRm4k115UGg/values:batchUpdate",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "googleSheetsOAuth2Api",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ { valueInputOption: \"USER_ENTERED\", data: $json.data } }}",
        "options": {}
      },
      "id": "batch-write-cells",
      "name": "Batch Write Cells",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [860, 300],
      "credentials": {
        "googleSheetsOAuth2Api": {
          "id": "REPLACE_WITH_YOUR_CREDENTIAL_ID",
          "name": "Google Sheets account"
        }
      }
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ { ok: true, response: $json } }}",
        "options": {}
      },
      "id": "respond-success",
      "name": "Respond Success",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [1080, 300]
    }
  ],
  "connections": {
    "Webhook": {
      "main": [
        [
          {
            "node": "Get All Rows",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Get All Rows": {
      "main": [
        [
          {
            "node": "Find Matching Row",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Find Matching Row": {
      "main": [
        [
          {
            "node": "Batch Write Cells",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Batch Write Cells": {
      "main": [
        [
          {
            "node": "Respond Success",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  }
}
```

- [ ] **Step 2: Write the setup notes**

```markdown
# Setup notes: n8n-mission-control-update-apartment-cells.json

This replaces the Phase 2 workflow (`n8n-mission-control-update-renewal-dates.json`) with a
more flexible version that can write any combination of columns D, E, F, G, I in one call,
instead of always writing F/G only. The old workflow is left in place/untouched in n8n for
comparison — you can deactivate it once this one is confirmed working, or keep both.

## Import steps

1. n8n → Workflows → Import from File → select `n8n-mission-control-update-apartment-cells.json`.
2. Fix the credential on both Google-related nodes ("Get All Rows" and "Batch Write Cells"):
   reselect your existing "Google Sheets account" credential (same as last time).
3. Confirm the sheet tab name on "Get All Rows" via its "From list" picker.
4. Confirm the tab name inside "Batch Write Cells"'s JSON body matches (it references `Sheet1` —
   the ranges are built in the Code node, so check the "Find Matching Row" node's code if your
   tab isn't literally named "Sheet1").
5. Activate the workflow, copy its Webhook URL (Production), and **update
   `N8N_APARTMENT_SHEET_WEBHOOK_URL` in Mission Control's `.env.local`** to this new URL —
   the old URL will not work correctly with the updated "Save to Sheet" button once Task 3 of
   the Phase 3 plan is merged, since it now sends a `cells` object instead of
   `activation2`/`expiration2` directly.

## What changed vs. the Phase 2 workflow

- Old: single fixed-range write to `F{row}:G{row}`.
- New: reads a `cells` object (e.g. `{ "D": "2025-11-15", "E": "2026-10-31", "I": "2350" }`) from
  the webhook body and writes each key/value pair to its own cell via one `values:batchUpdate`
  call — works for any combination of columns, not just F/G.

## Testing it yourself before relying on it

Test directly in n8n once imported: "Execute Workflow," then POST to the Webhook's Test URL:

```json
{
  "address": "1208 43rd St",
  "unit": "2R",
  "cells": {
    "D": "2025-11-15",
    "E": "2026-10-31",
    "I": "2350"
  }
}
```

then check the sheet to confirm D2/E2/I2 (Jose Munoz's row, "1208 43rd St" #2R) updated.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/n8n-mission-control-update-apartment-cells.json docs/superpowers/n8n-mission-control-update-apartment-cells-SETUP.md
git commit -m "feat: add batch-update n8n workflow for flexible apartment cell writes"
```

---

### Task 5: Update `RentvineTab.tsx` — editable Activation 1/Expiration 1/Current Rent + PDF upload/extract UI

**Files:**
- Modify: `components/rentvine/RentvineTab.tsx`
- Modify: `components/rentvine/RentvineTab.module.css`
- Test: `tsc`/`lint` + curl-level "page still serves 200" check (no browser tooling available to implementers, same as Phases 1–2) — human visual verification is a disclosed follow-up

**Interfaces:**
- Consumes: `PATCH /api/rentvine/apartment-details/:id` (Task 2, now accepting 5 fields), `POST /api/rentvine/apartment-details/:id/push-sheet` (Task 3, unchanged client-side call), `POST /api/rentvine/apartment-details/:id/extract-pdf` (Task 1).

- [ ] **Step 1: Replace the `editedDates` state and its getter/setter functions with a generic version covering 5 fields**

Remove this existing state declaration:

```tsx
  const [editedDates, setEditedDates] = useState<Record<number, { activation2: string; expiration2: string }>>({});
```

Replace with:

```tsx
  type EditableField = "activation1" | "expiration1" | "activation2" | "expiration2" | "currentRent";

  interface EditedFields {
    activation1: string;
    expiration1: string;
    activation2: string;
    expiration2: string;
    currentRent: string;
  }

  const [editedFields, setEditedFields] = useState<Record<number, EditedFields>>({});
```

Remove these existing functions entirely:

```tsx
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
```

Replace with:

```tsx
  function defaultEditedFields(row: ApartmentDetailRow): EditedFields {
    return {
      activation1: row.activation_1 ?? "",
      expiration1: row.expiration_1 ?? "",
      activation2: row.activation_2 ?? "",
      expiration2: row.expiration_2 ?? "",
      currentRent: row.current_rent !== null ? String(row.current_rent) : "",
    };
  }

  function getEditedField(row: ApartmentDetailRow, field: EditableField): string {
    return editedFields[row.id]?.[field] ?? defaultEditedFields(row)[field];
  }

  function setEditedField(row: ApartmentDetailRow, field: EditableField, value: string) {
    setEditedFields((prev) => ({
      ...prev,
      [row.id]: {
        ...(prev[row.id] ?? defaultEditedFields(row)),
        [field]: value,
      },
    }));
  }
```

- [ ] **Step 2: Rewrite `saveToSupabase` to send and receive all 5 fields**

Replace the existing `saveToSupabase` function with:

```tsx
  async function saveToSupabase(row: ApartmentDetailRow) {
    setRowStatus(row.id, { supabase: "saving", errorMessage: undefined });
    try {
      const activation1 = getEditedField(row, "activation1");
      const expiration1 = getEditedField(row, "expiration1");
      const activation2 = getEditedField(row, "activation2");
      const expiration2 = getEditedField(row, "expiration2");
      const currentRent = getEditedField(row, "currentRent");
      const res = await fetch(`/api/rentvine/apartment-details/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activation1, expiration1, activation2, expiration2, currentRent }),
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
            ? {
                ...r,
                activation_1: updatedRow.activation_1,
                expiration_1: updatedRow.expiration_1,
                activation_2: updatedRow.activation_2,
                expiration_2: updatedRow.expiration_2,
                current_rent: updatedRow.current_rent,
                updated_at: updatedRow.updated_at,
              }
            : r,
        ),
      );
      setEditedFields((prev) => {
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
```

`saveToSheet` and `saveToRentvine` need no changes — they already just POST with no body, and the server-side changes (Task 3) handle the new payload shape internally.

- [ ] **Step 3: Add PDF upload/extraction state and the `extractFromPdf` function**

Add this state alongside the other `useState` declarations (after `focusedApartmentRowId`):

```tsx
  const [selectedFiles, setSelectedFiles] = useState<Record<number, File | null>>({});
  const [extractStatus, setExtractStatus] = useState<Record<number, "idle" | "extracting" | "error">>({});
  const [extractErrorMessage, setExtractErrorMessage] = useState<Record<number, string>>({});
```

Add these functions after `saveToRentvine`:

```tsx
  function handleFileSelected(row: ApartmentDetailRow, fileList: FileList | null) {
    setSelectedFiles((prev) => ({ ...prev, [row.id]: fileList?.[0] ?? null }));
  }

  async function extractFromPdf(row: ApartmentDetailRow) {
    const file = selectedFiles[row.id];
    if (!file) {
      setExtractStatus((prev) => ({ ...prev, [row.id]: "error" }));
      setExtractErrorMessage((prev) => ({ ...prev, [row.id]: "Choose a PDF file first." }));
      return;
    }

    setExtractStatus((prev) => ({ ...prev, [row.id]: "extracting" }));
    setExtractErrorMessage((prev) => ({ ...prev, [row.id]: "" }));

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/rentvine/apartment-details/${row.id}/extract-pdf`, {
        method: "POST",
        body: formData,
      });
      const json: {
        ok: boolean;
        error?: string;
        activation1?: string;
        expiration1?: string;
        currentRent?: number;
      } = await res.json();

      if (!json.ok) {
        setExtractStatus((prev) => ({ ...prev, [row.id]: "error" }));
        setExtractErrorMessage((prev) => ({ ...prev, [row.id]: json.error || "Extraction failed." }));
        return;
      }

      setEditedFields((prev) => {
        const existing = prev[row.id] ?? defaultEditedFields(row);
        return {
          ...prev,
          [row.id]: {
            ...existing,
            activation1: json.activation1 ?? existing.activation1,
            expiration1: json.expiration1 ?? existing.expiration1,
            currentRent: json.currentRent !== undefined ? String(json.currentRent) : existing.currentRent,
          },
        };
      });

      setExtractStatus((prev) => ({ ...prev, [row.id]: "idle" }));
    } catch (err) {
      setExtractStatus((prev) => ({ ...prev, [row.id]: "error" }));
      setExtractErrorMessage((prev) => ({
        ...prev,
        [row.id]: err instanceof Error ? err.message : "Unexpected error.",
      }));
    }
  }
```

- [ ] **Step 4: Update the table header row**

Change:

```tsx
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
```

To:

```tsx
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
                  <th>Extract PDF</th>
                  <th>Actions</th>
                </tr>
```

- [ ] **Step 5: Update the table body row — make Activation 1/Expiration 1/Current Rent editable, add the Extract cell**

Replace this block:

```tsx
                      <td>{row.address}</td>
                      <td>{row.unit || <span className={styles.muted}>—</span>}</td>
                      <td>{row.tenant_name || <span className={styles.muted}>—</span>}</td>
                      <td><span className={styles.mono}>{formatDate(row.activation_1)}</span></td>
                      <td><span className={styles.mono}>{formatDate(row.expiration_1)}</span></td>
                      <td>
                        <input
                          id={`apartment-activation2-${row.id}`}
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
```

With:

```tsx
                      <td>{row.address}</td>
                      <td>{row.unit || <span className={styles.muted}>—</span>}</td>
                      <td>{row.tenant_name || <span className={styles.muted}>—</span>}</td>
                      <td>
                        <input
                          type="date"
                          className={styles.dateInput}
                          value={getEditedField(row, "activation1")}
                          onChange={(e) => setEditedField(row, "activation1", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          className={styles.dateInput}
                          value={getEditedField(row, "expiration1")}
                          onChange={(e) => setEditedField(row, "expiration1", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          id={`apartment-activation2-${row.id}`}
                          type="date"
                          className={styles.dateInput}
                          value={getEditedField(row, "activation2")}
                          onChange={(e) => setEditedField(row, "activation2", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          className={styles.dateInput}
                          value={getEditedField(row, "expiration2")}
                          onChange={(e) => setEditedField(row, "expiration2", e.target.value)}
                        />
                      </td>
                      <td>{formatCurrency(row.new_rent !== null ? String(row.new_rent) : null)}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          className={styles.dateInput}
                          value={getEditedField(row, "currentRent")}
                          onChange={(e) => setEditedField(row, "currentRent", e.target.value)}
                        />
                      </td>
                      <td>{formatCurrency(row.security_deposit !== null ? String(row.security_deposit) : null)}</td>
                      <td>{row.notes || <span className={styles.muted}>—</span>}</td>
                      <td>
                        <div className={styles.rowActions}>
                          <input
                            type="file"
                            accept="application/pdf"
                            className={styles.fileInput}
                            onChange={(e) => handleFileSelected(row, e.target.files)}
                          />
                          <button
                            type="button"
                            className={styles.smallButton}
                            onClick={() => extractFromPdf(row)}
                            disabled={extractStatus[row.id] === "extracting"}
                          >
                            {extractStatus[row.id] === "extracting" ? "..." : "Extract"}
                          </button>
                        </div>
                        {extractStatus[row.id] === "error" && extractErrorMessage[row.id] && (
                          <div className={styles.rowActionError}>{extractErrorMessage[row.id]}</div>
                        )}
                      </td>
                      <td>
```

(The trailing `<td>` you're replacing into is the start of the existing Actions cell with the 3 save buttons — leave everything from that point onward in the file unchanged.)

- [ ] **Step 6: Add the `.fileInput` CSS class**

Append to `components/rentvine/RentvineTab.module.css`:

```css
.fileInput {
    font-size: 10px;
    max-width: 150px;
}
```

- [ ] **Step 7: Type-check and lint**

Run: `npx tsc --noEmit` — expect only the pre-existing unrelated error.
Run: `npm run lint` — expect no new errors in `RentvineTab.tsx`.

- [ ] **Step 8: Manually verify via curl-level check**

With `npm run dev` running:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002
```

Expected: `200`.

Note in your report: a human still needs to open the Rentvine tab in a real browser to confirm the new editable fields, file input, and Extract button render and behave correctly — same disclosed limitation as Phases 1–2 (no browser automation tooling available to agentic implementers in this environment). Also note that a full end-to-end test (upload real PDF → Extract → verify fields populate → Save to Supabase → Save to Sheet with the new n8n workflow) requires the user's own browser and their real sample PDF, and per Global Constraints the Sheet-write leg specifically must not be triggered by you.

- [ ] **Step 9: Commit**

```bash
git add components/rentvine/RentvineTab.tsx components/rentvine/RentvineTab.module.css
git commit -m "feat: make Activation 1/Expiration 1/Current Rent editable, add PDF upload + Extract"
```

---

## Self-Review Notes

- **Spec coverage:** Extraction route (Task 1), confirmed regex patterns and field mapping (Task 1), data model (none needed — Task 2 note), Save to Supabase extension (Task 2), Save to Sheet extension + n8n batch-update (Tasks 3–4), UI changes (Task 5), error handling (extraction failures never block manual entry — fields stay editable regardless, Task 5), testing/verification (per-task, matching Phases 1–2's approach) are all covered. Out-of-scope items (other extraction targets, non-matching PDF templates, OCR, auto-re-extraction) are intentionally not addressed.
- **Type consistency:** the `ApartmentDetailRow` type in `RentvineTab.tsx` (Task 5) already has `activation_1`, `expiration_1`, `current_rent` as fields from Phase 2 — no interface changes needed there, only which fields are editable and what gets sent/received changes. The PATCH route's response shape (Task 2) grows to include all 5 relevant fields, matching what Task 5's `saveToSupabase` expects back. The push-sheet route's new `cells` payload shape (Task 3) matches exactly what the new n8n workflow's Code node expects (Task 4) — both use bare column letters (`D`, `E`, `F`, `G`, `I`) as keys.
- **Placeholder scan:** no TBD/TODO markers; all code blocks are complete and copy-pasteable. The one genuinely conditional step (Task 1's ambient module declaration) is explicitly scoped to "only add if tsc actually errors," which is a real verification-driven condition, not a placeholder.
