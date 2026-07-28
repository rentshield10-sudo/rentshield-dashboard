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
