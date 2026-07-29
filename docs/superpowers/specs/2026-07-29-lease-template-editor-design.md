# Lease Template Editor — Design

**Date:** 2026-07-29
**Status:** Approved, proceeding to implementation plan

## Problem

Drafting a lease agreement for signature currently means manually retyping
tenant names, addresses, dates, and rent into a document outside Mission
Control (e.g. PandaDoc). The user wants a lightweight, in-app version: one
fixed lease template PDF, with clickable fields that autopopulate from data
already in Mission Control (or a remembered value typed before), without
building a full PandaDoc-equivalent (no field-type toolbar, no
multi-template management, no e-signature audit trail).

## Scope

**In scope (v1):**
- A new tab + component module, separate from the Rentvine tab.
- One fixed lease template PDF, rendered in the browser.
- **Design mode**: click-and-drag to draw a box anywhere on the rendered
  page, label it freely (e.g. "Landlord Name", "Tenant 2", "County"), pick a
  field type (Text, Date, Signature). Boxes can be moved, resized, deleted.
  This is how the multi-tenant case is handled — just add another generic
  text box, no special-casing.
- **Fill mode**: click an existing box → a modal shows candidate values,
  each tagged with where it came from (Rentvine / Supabase / Remembered).
  Selecting one fills the box; typing a new value fills it and saves that
  value to "remembered" for next time.
- Values are looked up by matching the box's **label** against:
  1. A live Rentvine field (if the label matches a known Rentvine concept
     for the currently-selected apartment, e.g. tenant name/address/rent).
  2. The apartment's Supabase `apartment_lease_details` row.
  3. `lease_template_remembered_values` — freeform values typed under that
     same label before, most-recently-used first.
- Basic signature field: type-your-name-in-script or draw-with-mouse. No
  audit trail, no identity verification.

**Out of scope (v1, explicitly deferred):**
- No drag-and-drop field-type palette/sidebar like PandaDoc's.
- No multi-template management UI — one template, fields edited directly
  on it.
- No Telegram approval workflow or emailing the draft to tenants — a later
  phase once this pass produces a working fillable draft.
- No legally-binding e-signature audit trail.

## Data Model

New Supabase tables:

- **`lease_template_fields`** — one row per box on the template.
  - `id`, `page_number`, `x`, `y`, `width`, `height` (all percentages of
    page dimensions, so boxes stay aligned regardless of zoom/screen size),
    `label` (text), `field_type` (`text` | `date` | `signature`),
    `created_at`.
- **`lease_template_remembered_values`** — freeform autofill memory.
  - `id`, `label`, `value`, `last_used_at`. Looked up by exact label match;
    most-recently-used values surface first in the fill modal.
- **`lease_template_filled_values`** — per-draft answers (so a specific
  in-progress draft's filled boxes survive a page reload).
  - `id`, `draft_id`, `field_id` (FK to `lease_template_fields`), `value`,
    `updated_at`.
- **`lease_template_drafts`** — one row per lease draft in progress.
  - `id`, `apartment_lease_details_id` (nullable FK, links a draft to a
    specific apartment/tenant when known), `created_at`, `updated_at`.

The template PDF itself ships as a static file (`public/lease-template.pdf`)
rather than a database/storage upload — it's a single fixed template, not a
per-row upload like the PDF-extraction feature (which parses an upload
in-memory and never persists the file). If the template ever needs to
change, replacing that file is the whole process.

## Component Design

- `app/lease-template/page.tsx` (or a new nav tab, matching the existing
  `app/page.tsx` tab-switching pattern) — entry point.
- `components/lease-template/LeaseTemplateTab.tsx` — main component: PDF
  render + mode toggle (Design / Fill) + field overlay.
- `components/lease-template/FieldBox.tsx` — a single positioned overlay
  box; renders differently per mode (drag handles in Design mode, click
  target in Fill mode).
- `components/lease-template/FieldEditorModal.tsx` — Design mode: label +
  field-type form when creating/editing a box.
- `components/lease-template/FillValueModal.tsx` — Fill mode: shows
  candidate values (tagged by source) for the clicked box.
- PDF rendering via `pdfjs-dist` (already a project dependency from the
  extraction feature) — render each page to a canvas; overlay boxes are
  absolutely-positioned `<div>`s using percentage coordinates on top of
  that canvas.

## API Routes

- `GET/POST /api/lease-template/fields` — list/create field definitions.
- `PATCH/DELETE /api/lease-template/fields/[id]` — edit/remove a field.
- `GET /api/lease-template/fill-suggestions?label=...&apartmentId=...` —
  returns candidate values for a given label: Rentvine (if applicable),
  Supabase apartment row, and remembered values, each tagged with source.
- `POST /api/lease-template/remembered-values` — save a freeform value
  under a label (upserts `last_used_at`).
- `GET/POST /api/lease-template/drafts` and
  `PATCH /api/lease-template/drafts/[id]/values` — draft creation and
  per-field value persistence.

## Error Handling

- Fill-suggestions lookup failures (e.g. Rentvine API down) degrade
  gracefully — show whatever sources succeeded, note which one failed,
  never block manual typing.
- Deleting a field with saved draft values prompts for confirmation (data
  loss).

## Testing

- Manual verification in a real browser (no automated browser testing
  available in this environment) — placing boxes, filling them, reloading
  to confirm persistence, and confirming multi-tenant (duplicate box)
  labeling works as expected.
