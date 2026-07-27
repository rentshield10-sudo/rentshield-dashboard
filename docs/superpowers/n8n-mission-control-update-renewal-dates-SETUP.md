# Setup notes: n8n-mission-control-update-renewal-dates.json

This is a best-effort export I wrote by hand (not exported from a live n8n instance), since I have no direct access to your n8n. A few things will almost certainly need a quick fix in the n8n UI after import — this isn't a sign anything is broken, just the parts no JSON file can know about your instance.

## Import steps

1. n8n → Workflows → Import from File → select `n8n-mission-control-update-renewal-dates.json`.
2. **Fix the credential on both Google-related nodes** ("Get All Rows" and "Write Renewal Dates to F/G"): the JSON has a placeholder `REPLACE_WITH_YOUR_CREDENTIAL_ID` — open each node and reselect your existing "Google Sheets account" credential from the dropdown (the one already used in your other workflows, e.g. "Mark Sheet Intro Sending").
3. **Confirm the sheet tab name** on "Get All Rows": I guessed `gid=0` maps to a tab — use n8n's "From list" picker on that node to select the actual tab (likely shows as its real name, e.g. "Sheet1" or something else) instead of my placeholder.
4. **Confirm the tab name in the HTTP Request node's URL** ("Write Renewal Dates to F/G"): the URL hardcodes `Sheet1` in `Sheet1!F{row}:G{row}` — if your tab's actual name isn't literally "Sheet1", edit that part of the URL to match (whatever you find in step 3).
5. Activate the workflow, copy its Webhook URL (Test or Production, your choice), and give it to me — I'll wire Mission Control's "Save to Sheet" button to POST there via a new env var (`N8N_APARTMENT_SHEET_WEBHOOK_URL`).

## What it does

1. **Webhook** receives `{ address, unit, activation2, expiration2 }` from Mission Control.
2. **Get All Rows** reads the whole sheet (needed because Address repeats across units — there's no single unique column to match on directly).
3. **Find Matching Row** (Code node) finds the row where Address + Room Floor match what was sent, and grabs its `row_number`. Throws a clear error if no match is found (surfaces back to Mission Control as a failure, not a silent no-op).
4. **Write Renewal Dates to F/G** does a direct Google Sheets API `values.update` call to that exact row's F and G cells (the second Activation/Expiration pair) — bypasses n8n's column-name mapping entirely, which matters because your sheet has two columns both literally named "Activation" and two named "Expiration," and name-based mapping can't disambiguate them.
5. **Respond Success** sends a confirmation back.

## Testing it yourself before wiring it to Mission Control

You can test this directly in n8n once imported: click "Execute Workflow," then send a test POST (e.g. via a browser extension or curl) to the Webhook's Test URL with a body like:

```json
{
  "address": "1208 43rd St",
  "unit": "2R",
  "activation2": "2026-08-01",
  "expiration2": "2027-07-31"
}
```

then check the sheet to confirm F2/G2 (Jose Munoz's row) updated. If the address/unit text doesn't match exactly (case differences are already handled, but extra whitespace or a typo won't be), the Code node will throw — that's the error surfacing correctly, not a bug.
