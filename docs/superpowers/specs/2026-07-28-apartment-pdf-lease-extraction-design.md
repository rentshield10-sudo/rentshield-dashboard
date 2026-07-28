# Apartment Lease PDF Extraction (Phase 3) — Design

**Date:** 2026-07-28
**Status:** Approved
**Depends on:** Phase 2 (`docs/superpowers/specs/2026-07-27-apartment-lease-details-sheet-sync-design.md`) — the `apartment_lease_details` table, the All Apartments table UI, and the existing Save to Supabase/Sheet/Rentvine buttons are extended here, not replaced.

## Background

The team generates signed lease documents in PandaDoc (e.g. "423 South 14th St. Newark, NJ - Apt 1 - Lease Agreement 2025"). Two values from each signed document need to land in the dashboard and the team's Google Sheet: the lease term dates (Section 3, "TERM OF LEASE") and the monthly rent (Section 6, "RENT PAYMENTS"). Today these are read-only, Rentvine-sourced-only fields (`activation_1`, `expiration_1`, `current_rent`) with no way to enter data from a signed document directly.

PandaDoc's real-time API was ruled out — the account doesn't have API access set up and PandaDoc charges for API usage. A plain PandaDoc document URL (e.g. `https://app.pandadoc.com/a/#/documents/{id}`) also doesn't work for server-side extraction — confirmed by fetching it directly: it returns only PandaDoc's JavaScript single-page-app shell, not the document content, since the actual content loads via an authenticated session in the browser.

Instead: the user downloads the PDF from PandaDoc (via its "Download" button) and uploads it directly to Mission Control, which extracts the two values with server-side text parsing.

## Confirmed extraction source text

From the real PDF sample:

```
3. TERM OF LEASE: This Lease shall commence on, 11/15/2025, and extend until its expiration on,  10/31/2026,
unless renewed or extended pursuant to the terms herein.
```

```
6. RENT PAYMENTS: Tenant agrees to pay rent unto the Landlord during the term of this Lease in equal monthly
installments of $2,350, said installment for each month being due and payable on or before the 1st day of the month...
```

Target fields (confirmed via user's annotated screenshot, cross-referencing the dashboard's own column headers against the Google Sheet's column headers):

- Lease commence date → `activation_1` (dashboard "Activation 1" column, sheet column D)
- Lease expiration date → `expiration_1` (dashboard "Expiration 1" column, sheet column E)
- Rent amount → `current_rent` (dashboard "Current Rent" column, sheet column I)

This is **current lease terms**, not renewal terms — distinct from `activation_2`/`expiration_2`/sheet columns F/G, which remain what they were in Phase 2 (the renewal-in-progress date pair).

## Architecture

```
Per-row: file input (accept="application/pdf") + "Extract" button (All Apartments table)
  → POST /api/rentvine/apartment-details/:id/extract-pdf (multipart/form-data)
      → parse PDF text server-side (pdf-parse library)
      → regex match "commence on,? (date) ... expiration on,? (date)" → activation1, expiration1
      → regex match "installments of \$(amount)" → currentRent
      → convert MM/DD/YYYY → YYYY-MM-DD
      → return { ok: true, activation1, expiration1, currentRent } — NOT persisted yet
  → UI populates the row's local edit state for Activation 1/Expiration 1/Current Rent
    (same edit-then-save pattern already used for Activation 2/Expiration 2 since Phase 2)
  → user reviews/corrects in the now-editable fields, then:
      "Save to Supabase" (extended) → PATCH also writes activation_1, expiration_1, current_rent
      "Save to Sheet" (extended) → pushes whichever of the 5 fields have local edits, via an
        updated n8n batch-update workflow that writes D/E, F/G, and/or I as applicable
```

## Extraction route

`POST /api/rentvine/apartment-details/:id/extract-pdf`

- Accepts `multipart/form-data` with a single `file` field.
- Validates: content-type must resolve to a PDF, size capped at 10MB — reject early with a clear error otherwise (no parsing attempted).
- Extracts text via `pdf-parse`.
- Regex patterns (case-insensitive, tolerant of extra whitespace and missing/extra commas around the dates, since PandaDoc's own template formatting is slightly inconsistent — e.g. the sample has a double-space before the expiration date):
  - Dates: `/commence\s+on,?\s*(\d{1,2}\/\d{1,2}\/\d{4})[\s\S]*?expiration\s+on,?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i`
  - Rent: `/installments\s+of\s*\$([\d,]+(?:\.\d{2})?)/i`
- If either pattern fails to match: return `{ ok: false, error: "Could not find lease dates in this PDF" }` (or the rent-specific equivalent) rather than guessing or returning partial garbage — the fields stay editable so the user can type the values in by hand instead.
- Response on success: `{ ok: true, activation1: "2025-11-15", expiration1: "2026-10-31", currentRent: 2350 }`.
- This route does not touch Supabase at all — purely stateless extraction. The `:id` in the URL is accepted for consistency with sibling routes and future logging, but not required for the extraction logic itself.

## Data model changes

None — `activation_1`, `expiration_1`, `current_rent` already exist as columns on `apartment_lease_details` (Phase 2). This phase only changes which fields are *editable* in the UI and *writable* through the existing PATCH/push-sheet routes; no migration needed.

## Save to Supabase (extended)

`PATCH /api/rentvine/apartment-details/:id` gains `activation1`, `expiration1`, `currentRent` as optional body fields alongside the existing `activation2`/`expiration2`, all written in the same update call. Fields not present in the request body are left unchanged (matches the existing partial-update-friendly pattern already used for the sync route's manual-field exclusion).

## Save to Sheet (extended) — n8n workflow change

The existing n8n workflow (`docs/superpowers/n8n-mission-control-update-renewal-dates.json`) does a single fixed-range write to `F{row}:G{row}`. This phase replaces that single-range write with a **batch update**:

```
Mission Control push-sheet route
  → POST to n8n webhook: { address, unit, cells: { D?: activation1, E?: expiration1, F?: activation2, G?: expiration2, I?: currentRent } }
      (only fields with a real value are included — e.g. if only Activation 1/Expiration 1 changed,
       cells = { D: "...", E: "..." })
  → n8n: Webhook → read all rows → find matching row (Address + Room Floor, same as Phase 2)
      → Code node builds a batchUpdate `data` array: one { range: "Sheet1!{col}{row}", values: [[value]] }
        entry per key present in `cells`
      → HTTP Request node: POST https://sheets.googleapis.com/v4/spreadsheets/{id}/values:batchUpdate
        with { valueInputOption: "USER_ENTERED", data: [...] }
  → Respond to Webhook
```

This requires re-importing an updated n8n workflow JSON (new file, not an in-place edit of the old one, so the old workflow can be compared/rolled back if needed) and re-verifying the Google Sheets credential on the changed HTTP Request node — same one-time step as the original import.

## UI changes

- New per-row control in the All Apartments table: `<input type="file" accept="application/pdf">` + "Extract" button, placed near the existing 3 save buttons.
- `activation_1`, `expiration_1` become `<input type="date">` (matching the existing Activation 2/Expiration 2 pattern); `current_rent` becomes a number input. All three are editable regardless of whether an extraction ever ran — a user can also just type values in directly.
- On successful extraction, the three fields' local edit state is populated with the extracted values (not yet saved — same "edit, then click Save" flow already established).
- Extraction errors render inline under that row (same visual pattern as the existing per-button `rowActionError`).
- "Save to Sheet" button's request now includes whichever of the 5 fields (activation_1/expiration_1/activation_2/expiration_2/current_rent) have a local edit pending, so a single click can push a mix of renewal-date and current-lease-term changes in one call.

## Error handling

- Extraction failures never crash the row or block manual entry — the fields are editable either way.
- File-type/size validation happens before any parsing attempt.
- Same structured `{ok:false, error, detail?}` shape as all other routes in this app.

## Testing / verification

Same approach as Phases 1–2 — no automated test framework in this repo. Verification via `npx tsc --noEmit`, `npm run lint`, and a real extraction test against the actual sample PDF the user provided (safe — it's a completed/signed document already, extraction is read-only). The Sheet-push extension follows the same safety rule as Phase 2: no unsupervised build agent triggers a real write to the live Google Sheet; that verification is reserved for the controller and user together.

## Out of scope (this phase)

- Extracting anything beyond the two confirmed fields (lease dates, rent) — e.g. security deposit, tenant names, are not part of this phase's regex targets even though they may appear elsewhere in the PDF.
- Handling PDF templates with substantially different wording than the confirmed sample (a differently-phrased lease template would need its own regex pattern, added later if it comes up).
- OCR / scanned-image PDF support — `pdf-parse` only reads embedded text, not image content.
- Automatically re-running extraction if the same file is re-uploaded — each click of "Extract" re-parses whatever file is currently selected.
