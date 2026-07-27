# Mission Control — Daily Handoff

**Date:** 2026-07-16  
**Scope:** Cloudflare/Quo webhook recovery, Human Review verification, requirements-SMS duplicate investigation, and new Home-tab apartment analytics with price history.

---

## 1. Executive summary

Today’s work covered two separate areas:

1. **Quo/OpenPhone inbound webhook recovery**
   - The old temporary Cloudflare Quick Tunnel had stopped delivering new inbound Quo messages to Mission Control.
   - A new tunnel was started to `localhost:3002`.
   - The Quo webhook URL was updated.
   - A new real inbound message then appeared in Human Review, confirming the webhook path works again.

2. **Home-tab apartment analytics**
   - Added an Apartment Analytics section to the Home tab.
   - Added date-range lead-volume graphing.
   - Added apartment enable/disable chips.
   - Added apartment current-price management.
   - Added dated price-history storage and a price-history graph.
   - Apartment names continue to come from the existing `dashboard_apartments` list.
   - Apartment-name normalization is JavaScript-only and does not rewrite Supabase apartment data.

---

## 2. Cloudflare / Quo webhook recovery

### New Quick Tunnel started

The tunnel was restarted with the local target:

```text
http://localhost:3002
```

The new temporary hostname shown by `cloudflared` was:

```text
https://dakota-amp-prospects-xbox.trycloudflare.com
```

The Quo webhook endpoint became:

```text
https://dakota-amp-prospects-xbox.trycloudflare.com/api/messages-automation/webhook
```

### Webhook test result

Quo successfully sent a test request and received:

```text
HTTP 200
```

The test payload was ignored with:

```json
{
  "ok": true,
  "ignored": true,
  "reason": "non_primary_inbox_message_ignored"
}
```

That was expected because Quo’s generated test payload used a sample/non-primary `phoneNumberId`. The result proved:

```text
Quo
→ Cloudflare tunnel
→ Mission Control port 3002
→ /api/messages-automation/webhook
```

was reachable.

### Real-message confirmation

After the new URL was active, a new real inbound message appeared in Human Review. This strongly confirms the earlier missing-message problem was the dead/changed temporary tunnel URL.

### Important operational rule

A `trycloudflare.com` Quick Tunnel usually gets a different hostname after restart.

Therefore, after any restart:

1. Start `cloudflared` against `http://localhost:3002`.
2. Copy the new `https://...trycloudflare.com` hostname.
3. Update the Quo/OpenPhone webhook endpoint.
4. Keep the Cloudflare terminal running.
5. Send a new real inbound test message.

Older events missed while the old tunnel was down may not be replayed automatically.

### Recommended permanent fix

Replace the Quick Tunnel later with either:

- a named Cloudflare Tunnel and permanent hostname; or
- a deployed public HTTPS Mission Control server.

---

## 3. Messaging automation review

### Main files inspected

```text
app/api/messages-automation/webhook/route.ts
components/messages/MessagesTab.tsx
```

### Current webhook behavior

The webhook route currently:

```text
receives Quo/OpenPhone webhook
→ extracts message fields
→ checks Primary inbox
→ checks inbound direction
→ dedupes by external_message_id
→ inserts inbound row into public.messages
→ applies positive/negative reply rules
→ calls find_single_contacted_lead_for_auto_reply
→ renders 02_requirements_request_v1 through QuoSender
→ sends through AnyClick
→ calls mark_lead_requirements_sent
→ logs public.ai_decisions
→ creates public.human_escalations when required
```

### Current eligibility rule

The automatic requirements reply uses:

```text
current_status = contacted
conversation_stage = intro_sent
```

It does not rely only on:

```text
pipeline_status = contacted
```

because older rows can still have `pipeline_status = new_lead` after intro delivery.

---

## 4. Duplicate requirements-SMS investigation

The affected test lead was:

```text
Lead ID: 653
Name: Anaya Ezeike
Phone: +1 973-489-0231
Apartment: 242 Hillcrest Ter
```

### What the database proved

The first requirements message was sent automatically after this inbound reply:

```text
"Yes, I would like to schedule an appointment. The price is fine. Thank you."
```

The `ai_decisions` record showed:

```text
decision = template_sent
templateKey = 02_requirements_request_v1
sent = true
```

and the RPC result was:

```json
[
  {
    "updated_lead_id": "653",
    "updated_pipeline_status": "requirements_sent"
  }
]
```

The current lead row also showed:

```text
conversation_stage = requirements_sent
pipeline_status = requirements_sent
```

Therefore, the pipeline update did work for this lead.

### Why the requirements message appeared twice

The second requirements message was not another automatic webhook send.

It was logged as:

```text
decision = manual_template_sent
templateKey = 02_requirements_request_v1
source = Human Review manual queue
```

So the duplicate happened because the Human Review workstation manually sent the same requirements template after automation had already sent it.

### Dedupe also worked

The same inbound webhook event was delivered more than once, but the duplicate event was logged as:

```text
decision = webhook_duplicate_message
```

and did not trigger another automatic SMS.

### Recommended future guard

The Human Review UI should later disable or warn on:

```text
02_requirements_request_v1
```

when the matched lead is already at:

```text
requirements_sent
schedule_sent
booked
confirmed
showed
```

This guard was identified but was not the primary focus of today’s Home-tab implementation.

---

## 5. Confirmation inbox limitation discovered

The confirmation inbox ID is:

```text
PNosRkPayL
```

The current requirements webhook branch records those events as:

```text
confirmation_inbox_message_not_processed_by_requirements_flow
```

with:

```text
needs_human = false
should_send = false
sent = false
```

That means some valid inbound confirmation-number messages are visible in `ai_decisions` but are not automatically inserted into Human Review.

This remains an open improvement:

```text
Inbound confirmation inbox message
→ save message
→ create Human Review item unless a dedicated confirmation workflow handles it
```

---

## 6. Home-tab Apartment Analytics added

### Existing apartment source remains unchanged

The main apartment source of truth remains:

```text
public.dashboard_apartments
```

The Home page already fetches it with:

```ts
supabase
  .from("dashboard_apartments")
  .select("apt_address")
  .order("apt_address");
```

No second apartment master table was added.

### JavaScript-only apartment normalization

The updated `app/page.tsx` includes JavaScript helpers that group display variants such as:

```text
15 Webster St #3
15 Webster Street #3
```

under one canonical UI label.

Normalization covers common variations including:

```text
Street → St
Avenue → Ave
Terrace → Ter
Road → Rd
Boulevard → Blvd
Drive → Dr
Lane → Ln
Court → Ct
Place → Pl
Highway → Hwy
Apartment/Apt/Unit → #unit
```

Important:

- This does not update or merge Supabase rows.
- It is only used for UI grouping, graph aggregation, and matching price rows to displayed apartment names.
- `dashboard_apartments` remains the list fetched by the dashboard.

### New Apartment Analytics features

The Home tab now includes:

```text
Apartment Analytics
├─ Lead Volume tab
└─ Price History tab
```

Shared controls:

```text
Last 7 Days
Last 30 Days
Last 90 Days
From date
To date
All apartments
No apartments
Per-apartment enable/disable buttons
```

The small apartment buttons are limited by the main global apartment filter:

```text
Main global filter
→ determines available apartments

Analytics apartment chips
→ determine which lines appear in the graph
```

### Lead Volume graph

The Lead Volume tab:

- uses the existing `dashboard_leads_clean` data already loaded by `page.tsx`;
- groups leads by canonical apartment and date;
- fills missing dates with zero;
- shows the total leads in the selected date range;
- renders one line per enabled apartment.

### Price Manager

The Price History tab includes a Price Manager row for every available apartment:

```text
Apartment
Current price
New price
Effective date
Optional note
Save Price
```

Rules:

- Effective date defaults to today.
- New price must be positive.
- Save is disabled if new price is blank or invalid.
- Save is disabled if the new price equals the current price.
- Saving writes current price and one dated history record.

### Price History graph

The graph:

- uses one line per enabled apartment;
- carries the latest saved price forward until the next effective date;
- uses the same date-range controls;
- starts showing a line after at least one price history row exists.

### Chart implementation

No graph package was installed.

The graphs are rendered with native responsive SVG inside `app/page.tsx`.

---

## 7. New Supabase objects

### `public.apartment_prices`

Stores the latest/current price for an apartment label selected from the dashboard list.

```sql
apt_address text primary key
current_price numeric(12,2)
price_effective_date date
note text
updated_at timestamptz not null default now()
```

### `public.apartment_price_history`

Stores every saved price change.

```sql
id bigint generated by default as identity primary key
apt_address text not null
previous_price numeric(12,2)
new_price numeric(12,2) not null check (new_price > 0)
effective_date date not null
note text
created_at timestamptz not null default now()
```

Index:

```sql
apartment_price_history_address_date_idx
(apt_address, effective_date, id)
```

### RPC: `public.set_apartment_price`

Signature:

```sql
set_apartment_price(
  p_apt_address text,
  p_new_price numeric,
  p_effective_date date,
  p_note text
)
```

Purpose:

```text
lock/create current apartment price row
→ read previous price
→ reject same-price update
→ insert price-history record
→ update current price/effective date/note
→ return updated values and history ID
```

The RPC does not normalize or validate against another apartment table. The dashboard supplies the selected apartment label.

### Security

- Both price tables have RLS enabled.
- Browser anon/authenticated access is revoked.
- The Next.js server route uses `SUPABASE_SERVICE_ROLE_KEY`.
- RPC execute permission is granted to `service_role`.

---

## 8. New API route

File:

```text
app/api/apartment-prices/route.ts
```

### `GET /api/apartment-prices`

Returns:

```json
{
  "ok": true,
  "prices": [],
  "history": []
}
```

Reads:

```text
public.apartment_prices
public.apartment_price_history
```

### `POST /api/apartment-prices`

Input:

```json
{
  "aptAddress": "242 Hillcrest Ter",
  "newPrice": 2600,
  "effectiveDate": "2026-07-16",
  "note": "Price reduced"
}
```

Calls:

```text
public.set_apartment_price
```

### Error handling fix

The initial API route converted Supabase error objects with `String(error)`, which displayed:

```text
[object Object]
```

The route now extracts:

```text
message
code
details
hint
```

and returns the real Supabase error message.

Expected validation errors use an appropriate non-500 response where possible.

---

## 9. UI fixes made after first test

### Save button visibility / responsive layout

Initial Price Manager rows were too wide and required scrolling to find the Save button.

CSS was updated so:

- Save Price spans the full row.
- Price Manager and Price History stack on narrower layouts.
- The manager no longer uses a fixed-height internal scroll area.
- Rows change to two columns and then one column on small screens.
- The section height expands automatically.

### Same-price protection

When current price and entered price are equal:

```text
Current: $1,950
New price: $1,950
```

the Save button is disabled and displays:

```text
No Price Change
```

### Hardcoded `2600` placeholder removed

The initial New Price input used:

```tsx
placeholder="2600"
```

which made every apartment appear to have a new price of 2600.

It was changed to:

```tsx
placeholder="Enter new price"
```

The only real price shown is now the saved `Current:` value.

---

## 10. Files added or changed today

### Added

```text
app/api/apartment-prices/route.ts
```

### Updated

```text
app/page.tsx
app/page.module.css
```

### Supabase SQL added

```text
public.apartment_prices
public.apartment_price_history
public.set_apartment_price(...)
RLS and service-role grants
```

### No package changes required

The project still uses the existing dependencies. No chart library was added.

---

## 11. Verification queries

### Current prices

```sql
select
  apt_address,
  current_price,
  price_effective_date,
  note,
  updated_at
from public.apartment_prices
order by apt_address;
```

### Price history

```sql
select
  id,
  apt_address,
  previous_price,
  new_price,
  effective_date,
  note,
  created_at
from public.apartment_price_history
order by effective_date desc, id desc;
```

### Test RPC manually

```sql
select *
from public.set_apartment_price(
  '242 Hillcrest Ter',
  2600,
  '2026-07-16',
  'Test price update'
);
```

Do not run that test with a value equal to the current stored price.

---

## 12. Current open items

1. Replace the temporary Quick Tunnel with a permanent public hostname.
2. Route confirmation-inbox inbound messages into Human Review or a dedicated confirmation workflow.
3. Add a Human Review guard against manually sending the requirements template after `requirements_sent`.
4. Continue the next automation branch:
   ```text
   positive requirements reply
   → find next dashboard showing schedule
   → queue 03_showing_invitation_v1
   → update pipeline to schedule_sent
   ```
5. Confirm the final responsive CSS has been appended only once; older duplicate style blocks can be cleaned later.
6. Consider moving `ApartmentAnalytics` from `app/page.tsx` into:
   ```text
   components/home/ApartmentAnalytics.tsx
   components/home/ApartmentAnalytics.module.css
   ```
   after behavior is stable.

---

## 13. Resume point

The webhook is receiving new real messages again through the new Cloudflare URL. The requirements pipeline update was verified as working; the observed duplicate was a manual Human Review send. The Home tab now has JavaScript-normalized apartment analytics, lead-volume charting, a server-backed apartment Price Manager, and dated price-history graphing through two new Supabase tables and `set_apartment_price`.
