# Mission Control — Full Project Handoff

**Prepared:** 2026-07-16  
**Purpose:** Reusable context document for continuing this project with another AI or developer.  
**Primary application:** `mission-control-dashboard` on `http://localhost:3002`

---

## 1. Project mission

Mission Control is an AI-assisted leasing operations dashboard for rental leads.

The target end-to-end flow is:

```text
Zillow inquiry
→ Chrome extension scrapes lead
→ Google Sheets staging row
→ n8n automation
→ Supabase lead/message state
→ Quo/OpenPhone SMS
→ Mission Control webhook and decision logic
→ automatic SMS or Human Review
→ local AnyClick browser sender
→ showing schedule / appointment
→ pipeline updates and reporting
```

Mission Control is becoming the main control center. Existing local tools remain supporting services for templates and browser-based sending.

---

## 2. Current system architecture

### 2.1 Zillow scraper Chrome extension

Purpose:

- Reads Zillow inbox/message leads.
- Extracts lead name, phone, apartment/address, source content, and date.
- Writes rows to Google Sheets.

Typical flow:

```text
Zillow Inbox
→ Chrome extension
→ Google Sheets
```

### 2.2 Google Sheets

Purpose:

- Initial staging area for scraped leads.
- n8n watches for new rows.
- A Properties sheet has also been used manually for apartment prices, but price history is now moving to Supabase.

### 2.3 n8n

Purpose:

- Watches Google Sheet rows.
- Normalizes lead data.
- Writes/upserts Supabase.
- Starts intro-message automation.
- Calls the sender service where applicable.
- Updates Google Sheet and/or Supabase state.

Expected intro flow:

```text
Google Sheet row
→ normalize
→ create/update lead
→ send initial outreach
→ mark contacted / intro_sent
```

### 2.4 Supabase

Purpose:

- Main PostgreSQL database.
- Stores dashboard leads, message history, automation decisions, Human Review, message queue, booking schedules, appointments, and apartment price history.
- Exposes PostgREST and RPC functions.
- Browser uses anon client for allowed reads.
- Next.js server routes use the service-role client for protected work.

### 2.5 Quo/OpenPhone

Purpose:

- Live SMS inbox.
- Sends `message.received` webhook events to Mission Control.
- Two known inbox IDs:

```text
Primary leasing inbox: PNAO2aXSml
Confirmation inbox:    PNosRkPayL
```

### 2.6 QuoSender / Template Builder

Local URL:

```text
http://localhost:3000
```

Purpose:

- Template/property editor.
- Current live template renderer.
- Renders apartment variables into SMS templates.

Mission Control server helper:

```text
lib/quosender.ts
```

Renderer endpoint:

```text
POST http://127.0.0.1:3000/api/templates/render-by-address
```

### 2.7 AnyClick / local auto-click sender

Local URL:

```text
http://localhost:3001
```

Purpose:

- Sends SMS by controlling the Quo/OpenPhone web UI.
- Avoids direct paid API sending.
- Must not receive uncontrolled concurrent sends.

Known flow ID:

```text
flow_1776996361867_nxr811
```

Run endpoint:

```text
POST http://127.0.0.1:3001/flows/flow_1776996361867_nxr811/run
```

Payload:

```json
{
  "inputs": {
    "parameters": "+12015551234",
    "message": "Rendered SMS body",
    "phone": "+12015551234"
  }
}
```

### 2.8 Mission Control dashboard

Local URL:

```text
http://localhost:3002
```

Current sidebar:

```text
Home
Leads
Human Review
Booking
Messages
```

### 2.9 Cloudflare Tunnel

Local webhook development uses Cloudflare Tunnel:

```text
public HTTPS URL
→ localhost:3002
```

Current temporary URL observed on 2026-07-16:

```text
https://dakota-amp-prospects-xbox.trycloudflare.com
```

Current webhook path:

```text
/api/messages-automation/webhook
```

A Quick Tunnel hostname is temporary and normally changes on restart.

---

## 3. Technology stack

### Mission Control package versions

```text
Next.js                 16.2.7
React                   19.2.4
React DOM               19.2.4
TypeScript              project language
@supabase/supabase-js   2.106.2
CSS Modules             page/component styling
Node.js                 local application runtime
```

Development dependencies include:

```text
ESLint 9
eslint-config-next 16.2.7
Tailwind CSS 4 packages are installed
@types/node 20
@types/react 19
```

Current Home analytics graphs use native SVG and do not require a graph package.

### External services/tools

```text
Supabase PostgreSQL/PostgREST/RPC
Quo/OpenPhone
Cloudflare Tunnel
n8n
Google Sheets
Chrome extension
AnyClick browser automation
```

---

## 4. Important environment variables

Mission Control `.env.local` should contain values equivalent to:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

QUO_API_KEY=...
QUO_BASE_URL=https://api.openphone.com
QUO_PRIMARY_INBOX_ID=PNAO2aXSml
QUO_CONFIRMATION_INBOX_ID=PNosRkPayL

QUOSENDER_BASE_URL=http://127.0.0.1:3000

ANYCLICK_BASE_URL=http://127.0.0.1:3001
ANYCLICK_TEMPLATE_SEND_FLOW_ID=flow_1776996361867_nxr811
```

Security rules:

- Never expose `QUO_API_KEY` with a `NEXT_PUBLIC_` prefix.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser code.
- Browser client stays in `lib/supabase.ts`.
- Server client stays in `lib/supabase-server.ts`.

---

## 5. Important project structure

```text
mission-control-dashboard/
├─ app/
│  ├─ api/
│  │  ├─ apartment-prices/
│  │  │  └─ route.ts
│  │  ├─ messages-automation/
│  │  │  ├─ webhook/route.ts
│  │  │  ├─ monitor/route.ts
│  │  │  ├─ run-now/route.ts
│  │  │  └─ human-review/
│  │  │     ├─ [id]/route.ts
│  │  │     ├─ messages/route.ts
│  │  │     ├─ render-template/route.ts
│  │  │     └─ send-queue/...
│  │  └─ quo/
│  │     └─ conversations/...
│  ├─ page.tsx
│  ├─ page.module.css
│  ├─ layout.tsx
│  └─ globals.css
├─ components/
│  ├─ booking/
│  ├─ leads/
│  └─ messages/
│     ├─ MessagesTab.tsx
│     └─ MessagesTab.module.css
├─ lib/
│  ├─ quo.ts
│  ├─ quosender.ts
│  ├─ supabase.ts
│  └─ supabase-server.ts
├─ public/
├─ package.json
└─ .env.local
```

The current `ApartmentAnalytics` implementation is inside `app/page.tsx`. It can be extracted into `components/home/` later.

---

## 6. Dashboard tabs

### 6.1 Home

Current responsibilities:

- Fetch master apartment display list from `dashboard_apartments`.
- Store selected live apartments in localStorage.
- Show captured-today, selected-week, selected-month, and processing counts.
- Show weekly per-address cards.
- Show monthly calendar counts.
- Show new Apartment Analytics.

LocalStorage key:

```text
mission_control_live_apartments
```

Main apartment fetch:

```ts
supabase
  .from("dashboard_apartments")
  .select("apt_address")
  .order("apt_address");
```

Lead fetch:

```ts
supabase
  .from("dashboard_leads_clean")
  .select(...)
```

### Apartment Analytics

Tabs:

```text
Lead Volume
Price History
```

Features:

- Last 7 / 30 / 90 days.
- Custom From and To dates.
- All / None apartment selection.
- Per-apartment chips.
- Main global apartment filter limits available apartment choices.
- JavaScript-only address normalization.
- Native SVG multi-line graphs.
- Current-price manager.
- Effective-date price history.

### 6.2 Leads

Reads:

```text
public.dashboard_leads_clean
```

Pipeline filters:

```text
All
Follow-up Pool
New Lead
Contacted
Requirements Sent
Schedule Sent
Booked
Confirmed
Showed
No Show
Reschedule Needed
Cancelled
Nurture
Lost
```

Lead rows show:

```text
name
phone
apartment
status
conversation stage
pipeline status
last SMS
created date
```

Leads can be selected/copied for QuoSender workflows.

### 6.3 Human Review

The current advanced workstation includes:

- Review-item list.
- Open/resolved status.
- Selected escalation details.
- Recent messages.
- Property-matched templates.
- Manual composer.
- Queue insertion.
- AnyClick send processing.
- Manual send decision logging.

Important current risk:

- The workstation can manually send `02_requirements_request_v1` even after automation already sent it.
- Add stage/template guard later.

### 6.4 Booking

Current dashboard source tables:

```text
public.dashboard_showing_schedules
public.dashboard_showing_appointments
```

The Booking tab manually manages schedules and appointments.

Important:

- Do not hardcode Monday/Wednesday/Friday/Saturday.
- Use the actual dashboard schedule table.
- Old `showing_schedules` and `showing_appointments` are stale/legacy.

### 6.5 Messages

`MessagesTab.tsx` currently displays:

- Automation status.
- Polling controls.
- Queue summary.
- Template send queue.
- Processing timeline from `ai_decisions`.
- Human Review workstation.
- Manual queue status.
- AnyClick payload/result where available.

---

## 7. Lead pipeline states

Allowed values:

```text
new_lead
contacted
requirements_sent
schedule_sent
booked
confirmed
showed
no_show
reschedule_needed
cancelled
nurture
lost
```

Happy path:

```text
New Lead
→ Contacted
→ Requirements Sent
→ Schedule Sent
→ Booked
→ Confirmed
→ Showed
```

Side outcomes:

```text
No Show
Reschedule Needed
Cancelled
Nurture
Lost
```

Expected state transitions:

### Intro sent

```text
current_status = contacted
conversation_stage = intro_sent
pipeline_status = contacted or sometimes still new_lead in older rows
```

### Requirements sent

```text
conversation_stage = requirements_sent
pipeline_status = requirements_sent
last_inbound_sms = triggering reply
last_inbound_at = now()::text
last_outbound_sms = requirements SMS
last_outbound_at = now()::text
```

### Schedule invitation sent

```text
conversation_stage = schedule_sent
pipeline_status = schedule_sent
```

### Appointment booked

```text
pipeline_status = booked
appointment_status = booked
confirmation_status = pending_confirmation
attendance_status = pending
showing_at = selected time
```

### Confirmed

```text
pipeline_status = confirmed
confirmation_status = confirmed
```

### Outcome

```text
showed
no_show
reschedule_needed
cancelled
nurture
lost
```

---

## 8. Current messaging automation

### 8.1 Current working intro-reply flow

```text
Inbound Quo message.received
→ Primary inbox check
→ dedupe external_message_id
→ save inbound public.messages row
→ classify reply
→ find eligible lead
→ render 02_requirements_request_v1 through QuoSender
→ send through AnyClick
→ mark lead requirements_sent
→ log ai_decisions
```

### 8.2 Current practical eligibility

Automatic requirements SMS is eligible when:

```text
current_status = contacted
conversation_stage = intro_sent
exactly one eligible lead matches normalized phone
automation is not stopped
lead is not already marked for Human Review
```

Positive reply signals include words such as:

```text
yes
yeah
yep
ok
okay
sure
interested
available
schedule
showing
tour
see
coming
today
tomorrow
weekday names
what time
appointment
appt
```

Hard negative/unsafe signals include:

```text
stop
unsubscribe
wrong number
not interested
no longer interested
already found
too expensive
scam
who is this
```

### 8.3 Dedupe

Dedupe key:

```text
public.messages.external_message_id
```

Duplicate webhook outcome:

```text
decision = webhook_duplicate_message
no second send
```

### 8.4 Human Review fallback

Reasons include:

```text
automation:lead_reply_not_clearly_positive
automation:no_matching_eligible_lead
automation:multiple_matching_eligible_leads
automation:matched_lead_missing_apt_address
automation:template_render_empty
automation:template_render_or_anyclick_send_failed
automation:pipeline_update_failed_after_template_sent
```

### 8.5 Confirmation inbox limitation

Messages from:

```text
PNosRkPayL
```

currently log:

```text
confirmation_inbox_message_not_processed_by_requirements_flow
```

and may not create Human Review rows.

### 8.6 Cloudflare requirement

Quo webhooks need a public HTTPS URL. During local development:

```text
cloudflared tunnel --url http://localhost:3002
```

Then configure:

```text
https://<current-host>.trycloudflare.com/api/messages-automation/webhook
```

Quick Tunnel URLs are temporary.

---

## 9. Message templates

Known template keys:

```text
01_initial_outreach_intro_v1
02_requirements_request_v1
03_showing_invitation_v1
04_appointment_confirmed_v1
05_same_day_confirmation_v1
06_still_interested_followup_v1
07_keep_posted_schedule_v1
08_missed_call_reply_v1
09_only_time_available_v1
```

Current live rendering source:

```text
QuoSender / Template Builder
```

`public.templates` existed but was empty at the latest historical inspection.

Current automation:

```text
01_initial_outreach_intro_v1
→ positive reply
→ 02_requirements_request_v1
```

Next planned automation:

```text
positive reply after requirements
→ choose next dashboard showing schedule
→ queue 03_showing_invitation_v1
→ set schedule_sent
```

Later:

```text
positive reply to showing invitation
→ create appointment
→ set booked
→ send 04_appointment_confirmed_v1
```

---

## 10. Supabase catalog

This section consolidates the schemas and relationships discovered across prior handoffs and the 2026-07-16 work.

### 10.1 `public.dashboard_apartments`

Current source of truth for apartment names displayed by Home/global filtering.

Known schema:

```text
apt_address text nullable
```

Important:

- This is the list fetched by JavaScript.
- UI normalization groups variants only in the browser.
- No database merge/normalization RPC should be added for this feature.

### 10.2 `public.apartment_prices` — added 2026-07-16

Current/latest price per displayed apartment label.

```text
apt_address text primary key
current_price numeric(12,2)
price_effective_date date
note text
updated_at timestamptz not null default now()
```

RLS:

```text
enabled
browser table privileges revoked
service_role allowed
```

### 10.3 `public.apartment_price_history` — added 2026-07-16

Immutable history of saved changes.

```text
id bigint identity primary key
apt_address text not null
previous_price numeric(12,2)
new_price numeric(12,2) not null check > 0
effective_date date not null
note text
created_at timestamptz not null default now()
```

Index:

```text
apartment_price_history_address_date_idx
(apt_address, effective_date, id)
```

### 10.4 `public.dashboard_leads`

Main dashboard pipeline table.

Known columns:

```text
lead_id text
created_at text
lead_name text
phone text
apt_address text
source text
current_status text
conversation_stage text
last_inbound_sms text
last_inbound_at text
last_outbound_sms text
last_outbound_at text
selected_slot text
needs_human_review text
stop_automation text
notes text
imported_at timestamptz
pipeline_stage text default 'new_lead'
appointment_status text
confirmation_status text
attendance_status text
showing_at text
last_pipeline_update_at text
updated_at timestamptz
pipeline_status text default 'new_lead'
```

Important type issue:

```text
created_at and several timestamp-like fields are text
```

RPCs often need:

```sql
now()::text
```

Indexes previously observed:

```text
dashboard_leads_phone_idx
dashboard_leads_lead_id_idx
dashboard_leads_apt_address_idx
dashboard_leads_current_status_idx
dashboard_leads_needs_human_review_idx
dashboard_leads_created_at_idx
```

### 10.5 `public.dashboard_leads_clean`

Read view used by the dashboard.

Known columns:

```text
lead_id
created_at
lead_name
phone
apt_address
source
current_status
conversation_stage
last_inbound_sms
last_inbound_at
last_outbound_sms
last_outbound_at
selected_slot
needs_human_review
stop_automation
notes
created_at_ts timestamptz
last_inbound_at_ts timestamptz
last_outbound_at_ts timestamptz
needs_human_review_bool boolean
stop_automation_bool boolean
pipeline_status
```

### 10.6 `public.leads`

Core older/relational lead table.

Known relationships:

```text
properties.lead_id → leads.id
conversations.lead_id → leads.id
messages.lead_id → leads.id
```

Known pipeline-status constraint uses the same allowed statuses as `dashboard_leads`.

Mission Control Leads tab currently reads `dashboard_leads_clean`, not this table.

### 10.7 `public.properties`

Observed schema:

```text
id bigint primary key
created_at timestamptz default now()
updated_at timestamptz default now()
lead_id bigint
phone text
apt_address text
city text
state text
zip text
property_status text default 'active'
notes text
price text
bedrooms text
```

Important:

- This table contains repeated apartment rows tied to leads.
- It is not the canonical apartment-price table for the new Home Price Manager.
- Existing `price` values were commonly null in the inspected sample.

### 10.8 `public.conversations`

Known columns:

```text
id bigint
created_at timestamptz
updated_at timestamptz
lead_id bigint
property_id bigint
phone text
channel text default 'sms'
status text default 'active'
last_message_at timestamptz
last_message_text text
needs_human boolean default false
stop_automation boolean default false
summary text
```

Relationships:

```text
conversations.lead_id → leads.id
conversations.property_id → properties.id
```

### 10.9 `public.messages`

Known columns:

```text
id
created_at
conversation_id
lead_id
property_id
phone
channel
direction
message_text
external_message_id
external_conversation_id
processed
intent
template_key
duplicate_of
```

Relationships:

```text
messages.conversation_id → conversations.id
messages.lead_id → leads.id
messages.property_id → properties.id
messages.duplicate_of → messages.id
```

Important constraint:

```text
messages_external_message_id_key UNIQUE (external_message_id)
```

Indexes:

```text
idx_messages_conversation_id
idx_messages_external_message_id
idx_messages_phone
```

Common values:

```text
channel = quo
direction = inbound | outbound
intent = webhook_received | human_review | requirements_sent | initial_outreach
```

### 10.10 `public.ai_decisions`

Known columns:

```text
id bigint
created_at timestamptz
message_id bigint
conversation_id bigint
lead_id bigint
property_id bigint
intent text
confidence numeric
matched_template_id bigint
decision text
reply_text text
needs_human boolean default false
human_reason text
should_send boolean default false
sent boolean default false
error text
model_used text
prompt_version text
```

Relationships:

```text
message_id → messages.id
conversation_id → conversations.id
lead_id → leads.id
property_id → properties.id
matched_template_id → templates.id
```

Current automation markers:

```text
model_used = rule_based
prompt_version = message_automation_v1
```

Observed decisions:

```text
template_sent
template_send_failed
template_sent_but_pipeline_update_failed
human_review
webhook_ignored
webhook_duplicate_message
webhook_error
manual_template_sent
confirmation_inbox_message_not_processed_by_requirements_flow
```

### 10.11 `public.human_escalations`

Known columns:

```text
id bigint
created_at timestamptz
updated_at timestamptz
lead_id bigint
property_id bigint
conversation_id bigint
message_id bigint
phone text
reason text
priority text default 'normal'
status text default 'open'
assigned_to text
human_notes text
resolved_at timestamptz
```

Relationships:

```text
lead_id → leads.id
property_id → properties.id
conversation_id → conversations.id
message_id → messages.id
```

Automation reasons are prefixed with:

```text
automation:
```

### 10.12 `public.message_send_jobs`

Known fields from rows/code:

```text
id
phone
lead_id
apt_address
message_text
template_key
source
status
escalation_id
anyclick_payload
anyclick_result
sent_at
error
created_at
updated_at
```

Relationship:

```text
escalation_id → human_escalations.id
```

Known statuses:

```text
pending
running
sent
failed
```

Human Review code may use UI labels:

```text
queued
sending
sent
failed
```

Known sources:

```text
human_review
auto_booking (recommended)
```

Indexes:

```text
message_send_jobs_pkey
message_send_jobs_phone_idx
message_send_jobs_escalation_idx
message_send_jobs_status_created_idx
```

### 10.13 `public.message_automation_state`

Known schema:

```text
id text primary key
polling_enabled boolean not null default false
interval_minutes integer not null default 2
status text not null default 'idle'
last_checked_at timestamptz
updated_at timestamptz not null default now()
```

Main row:

```text
id = main
```

Statuses used:

```text
idle
fetching
new_message_received
matching_lead
choosing_template
template_selected
queued
sending
updating_pipeline
pipeline_updated
human_review
webhook_ignored
webhook_duplicate
error
```

### 10.14 `public.templates`

Known schema:

```text
id bigint
created_at timestamptz default now()
updated_at timestamptz default now()
template_name text not null
template_type text
channel text default 'sms'
stage text
intent text
content text not null
requires_human_approval boolean default false
is_active boolean default true
priority integer default 0
```

Historical status:

```text
0 rows
```

The live template source remains QuoSender until migration is completed.

### 10.15 `public.dashboard_showing_schedules`

Current Booking-tab schedule source.

Known columns:

```text
id bigint
apt_address text
showing_at timestamptz
schedule_status text default 'available'
max_slots integer default 100
created_at timestamptz
updated_at timestamptz
```

Indexes:

```text
dashboard_showing_schedules_apt_address_idx
dashboard_showing_schedules_showing_at_idx
```

### 10.16 `public.dashboard_showing_appointments`

Current dashboard appointment source.

Known columns:

```text
id bigint
schedule_id bigint
lead_id text
lead_name text
phone text
apt_address text
showing_at timestamptz
appointment_status text default 'booked'
confirmation_status text default 'pending_confirmation'
attendance_status text
created_at timestamptz
updated_at timestamptz
```

Relationship:

```text
schedule_id → dashboard_showing_schedules.id
```

Indexes:

```text
dashboard_showing_appointments_phone_idx
dashboard_showing_appointments_schedule_id_idx
dashboard_showing_appointments_showing_at_idx
```

### 10.17 Schedule-template tables

Known existing tables:

```text
public.dashboard_schedule_templates
public.dashboard_schedule_template_items
```

Historical counts observed on 2026-07-06:

```text
dashboard_schedule_templates: 2
dashboard_schedule_template_items: 13
```

`dashboard_schedule_template_items` includes `apt_address`.

### 10.18 Legacy booking tables

```text
public.showing_schedules
public.showing_appointments
```

These appeared stale compared with dashboard booking tables.

Known old relationships:

```text
showing_schedules.property_id → properties.id
showing_appointments.showing_schedule_id → showing_schedules.id
showing_appointments.lead_id → leads.id
showing_appointments.property_id → properties.id
showing_appointments.conversation_id → conversations.id
```

Do not use old booking RPCs for new dashboard automation without verifying their targets.

### 10.19 Other known tables/views

```text
public.dashboard_rows
```

Historical status:

```text
0 rows
```

Known backups/old snapshots:

```text
public.backup_conversations_before_id_fix_20260528
public.backup_messages_before_id_fix_20260528
public.backup_properties_before_id_fix_20260528
public.backup_leads_before_id_fix_20260528
public.backup_showing_appointments_before_id_fix_20260528
public.backup_ai_decisions_before_id_fix_20260528
public.backup_human_escalations_before_id_fix_20260528
public.backup_properties_created_at_may_2026_fix
public.backup_leads_created_at_may_2026_fix
```

Do not use backup tables in current application flows.

---

## 11. Supabase functions / RPCs

### `public.normalize_phone_text(text)`

Purpose:

```text
strip non-digits from phone
return null for blank
```

### `public.find_single_contacted_lead_for_auto_reply(text)`

Expected return:

```text
matched_count bigint
lead_id text
lead_name text
phone text
apt_address text
pipeline_status text
current_status text
conversation_stage text
last_outbound_sms text
last_outbound_at text
stop_automation text
needs_human_review text
```

Purpose:

```text
match eligible intro_sent/contacted lead by normalized phone
0 matches → Human Review
1 match → continue
2+ matches → Human Review
```

### `public.mark_lead_requirements_sent(text,text,text)`

Signature:

```text
p_lead_id text
p_inbound_sms text
p_outbound_sms text
```

Return:

```text
updated_lead_id text
updated_pipeline_status text
```

Purpose:

```text
update lead to requirements_sent
store inbound/outbound message state
```

Verified working example:

```text
lead 653
→ updated_pipeline_status = requirements_sent
```

### `public.update_dashboard_lead_booked(text,text)`

Purpose:

```text
set dashboard lead booked state after Booking-tab appointment creation
```

Expected updates:

```text
pipeline_stage = showing_scheduled
pipeline_status = booked
appointment_status = booked
confirmation_status = pending_confirmation
attendance_status = pending
showing_at = supplied value
```

### `public.set_apartment_price(text,numeric,date,text)` — added 2026-07-16

Purpose:

```text
create/lock current price row
→ read previous price
→ reject invalid/same price
→ insert dated history
→ update current price
```

Return:

```text
updated_apt_address
previous_price
current_price
effective_date
history_id
updated_at
```

### Other known existing/mentioned functions

```text
mark_intro_sent
prepare_catchall_ai_context
finalize_catchall_ai_reply
create_ai_human_escalation
book_showing_appointment
booking_update
```

Warning:

- `book_showing_appointment` and `booking_update` may target legacy booking tables.
- Inspect definitions before reuse.

---

## 12. Constraints and important database behavior

### Pipeline status check

`dashboard_leads` and `leads` allow:

```text
new_lead
contacted
requirements_sent
schedule_sent
booked
confirmed
showed
no_show
reschedule_needed
cancelled
nurture
lost
```

### Webhook dedupe

```text
messages.external_message_id UNIQUE
```

### Text timestamps

Several `dashboard_leads` timestamp fields are text. Use:

```sql
now()::text
```

where required.

### Price writes

Price tables are server-only:

```text
browser → Next.js /api/apartment-prices
→ supabaseServer service role
→ set_apartment_price RPC
```

---

## 13. Current Home apartment normalization strategy

The dashboard uses JavaScript helpers inside `app/page.tsx`.

Purpose:

- Group equivalent display labels.
- Aggregate leads across variants.
- Match stored price rows to canonical UI labels.
- Avoid changing Supabase master apartment data.

Examples normalized together:

```text
15 Webster Street #3
15 Webster St #3
15 Webster St Apt 3
```

Canonical display selection prefers shorter abbreviated forms.

Important:

- No Supabase normalization RPC.
- No database unique normalized index.
- No automatic address rewrite.
- Existing `dashboard_apartments` remains source of truth.

---

## 14. Current price analytics implementation

### API

```text
GET  /api/apartment-prices
POST /api/apartment-prices
```

GET returns all current prices and history.

POST validates:

```text
apartment address
positive price
YYYY-MM-DD effective date
```

Then calls `set_apartment_price`.

### UI behavior

Price Manager displays:

```text
Current: $X · since <date>
New price input
Effective date
Note
Save Price
```

Save is disabled for:

```text
blank price
invalid/non-positive price
missing effective date
same price as current
```

Error responses display Supabase `message`, `code`, `details`, and `hint` rather than `[object Object]`.

### Responsive behavior

- Save button spans full row.
- Manager grows to content height.
- Price manager and graph stack at narrower width.
- Two-column and one-column breakpoints are defined.
- No internal manager scroll is required.

---

## 15. Known diagnostic findings

### 15.1 Cloudflare caused missing new Human Review items

Evidence:

- Old Quick Tunnel had changed/stopped.
- New URL returned Quo test `200 OK`.
- A new real inbound message appeared after webhook URL update.

### 15.2 The tested requirements pipeline update worked

For lead 653:

```text
conversation_stage = requirements_sent
pipeline_status = requirements_sent
```

`ai_decisions` included successful `pipelineUpdate`.

### 15.3 The duplicate requirements message was manual

The second send was:

```text
decision = manual_template_sent
templateKey = 02_requirements_request_v1
```

not a second webhook automatic send.

### 15.4 Confirmation-inbox messages are ignored by requirements flow

They are logged in `ai_decisions` but can bypass Human Review.

---

## 16. Queue design rule

The preferred architecture is:

```text
webhook decision
→ insert pending message_send_jobs row
→ return quickly

worker
→ claim one job
→ call AnyClick
→ mark sent/failed
→ insert outbound message
→ update pipeline
```

The current intro-reply webhook has historically called AnyClick directly. The next schedule-invitation branch should prefer the queue to prevent concurrency problems.

---

## 17. Next automation feature

Target:

```text
lead has requirements_sent
→ lead replies clearly positive/qualified
→ safely match exact lead/property/conversation
→ find next future available dashboard_showing_schedules row
→ do not use same-day schedule for a new invitation
→ render 03_showing_invitation_v1
→ insert message_send_jobs pending row
→ send with local worker
→ update pipeline to schedule_sent
```

Fallback to Human Review for:

```text
ambiguous/negative reply
no exact lead match
multiple possible leads
missing apartment
no future schedule
full/cancelled schedule
already booked/confirmed/showed/lost
automation stopped
send/queue/database failure
```

---

## 18. Operational runbook

### Start services

Typical local services:

```text
QuoSender/template server  → port 3000
AnyClick sender            → port 3001
Mission Control            → port 3002
Cloudflare tunnel          → public URL to port 3002
```

### Start Mission Control

```bash
npm run dev
```

### Start Quick Tunnel

```bash
cloudflared tunnel --url http://localhost:3002
```

### Update Quo webhook

Use:

```text
https://<new-host>.trycloudflare.com/api/messages-automation/webhook
```

Select:

```text
message.received
```

### Test Mission Control route

```text
http://localhost:3002/api/messages-automation/webhook
```

GET should report that the route is live and expects POST.

### Test Quo API route

```text
http://localhost:3002/api/quo/conversations?limit=10
```

### Test apartment prices

```text
http://localhost:3002/api/apartment-prices
```

### Refresh PostgREST after adding RPC

```sql
notify pgrst, 'reload schema';
```

---

## 19. Historical Supabase row-count snapshot

Approximate values observed around 2026-07-06; these are not guaranteed current:

```text
ai_decisions: 932
dashboard_leads: 604
messages: 577
conversations: 316
properties: 314
leads: 302
human_escalations: 134
message_send_jobs: 40
dashboard_showing_appointments: 26
dashboard_showing_schedules: 25
showing_schedules: 24
showing_appointments: 13
dashboard_schedule_template_items: 13
dashboard_schedule_templates: 2
message_automation_state: 1
templates: 0
dashboard_rows: 0
```

---

## 20. Known issues and risks

1. **Temporary webhook hostname**
   - Quick Tunnel URL changes on restart.

2. **Confirmation inbox**
   - Inbound messages can be ignored instead of escalated.

3. **Human Review template safety**
   - Manual requirements template can be sent after requirements were already sent.

4. **Same phone, multiple apartments**
   - Phone-only context can select wrong apartment.
   - Prefer exact lead/property/conversation context.

5. **Legacy/current booking split**
   - Use dashboard booking tables, not old showing tables.

6. **Stale `pipeline_status` on older intro rows**
   - Use `current_status=contacted` and `conversation_stage=intro_sent` for the existing first auto-reply lookup.

7. **Polling checkpoint**
   - `last_checked_at` can hide older test messages.
   - Webhook processing should rely on `external_message_id`.

8. **Polling while webhook testing**
   - Can duplicate processing pathways.
   - Keep polling paused during controlled webhook tests unless dedupe is confirmed.

9. **Template source split**
   - `public.templates` may still be empty.
   - QuoSender remains live renderer.

10. **Address variants**
    - Normalization currently exists only in Home JavaScript.
    - Other modules may still use exact raw strings.

11. **CSS duplication**
    - Price-analytics CSS was appended in multiple iterations; clean duplicate overrides later.

12. **Current price is keyed by display address**
    - If the canonical UI label changes later, price rows may need migration.

---

## 21. Recommended next work order

1. Install a permanent public webhook endpoint.
2. Add confirmation-inbox Human Review handling.
3. Add Human Review template-stage guard.
4. Extract Apartment Analytics into its own component.
5. Clean duplicate CSS.
6. Build queued `requirements_sent → schedule_sent` automation.
7. Add exact conversation/property context matching.
8. Move templates into `public.templates` only after current renderer behavior is preserved.
9. Add appointment creation after the lead accepts the showing invitation.
10. Add confirmation and attendance automations.

---

## 22. Critical instructions for a new AI/developer

- Do not create another apartment master list.
- Use `dashboard_apartments` as the Home apartment source.
- Do not normalize or merge apartment addresses in Supabase for the current analytics feature.
- Use JavaScript canonicalization for display/aggregation.
- Do not use `properties` as the current apartment-price source; it contains repeated lead-linked rows.
- Use `apartment_prices` and `apartment_price_history` for Home price management.
- Use `dashboard_leads_clean` for dashboard lead reads.
- Use `dashboard_leads` for pipeline writes/RPCs.
- Use `dashboard_showing_schedules` and `dashboard_showing_appointments` for current Booking.
- Do not assume old `showing_*` RPCs target current tables.
- Dedupe webhook events by `external_message_id`.
- Do not decide conversation context by phone alone when multiple inquiries are possible.
- Use service-role server routes for protected writes.
- Keep Quo/OpenPhone API keys and Supabase service role server-side.
- Treat the Cloudflare Quick Tunnel hostname as temporary.
- Verify with database evidence before changing a working pipeline RPC.

---

## 23. Current resume point

Mission Control is operational locally on port 3002. New Quo inbound messages are reaching Human Review again after the Cloudflare webhook URL was updated. The intro-reply requirements automation is working and updates leads to `requirements_sent`; the observed duplicate requirements SMS was a manual Human Review send. The Home tab now includes date-range Lead Volume and Price History analytics using the existing `dashboard_apartments` list, JavaScript-only address normalization, two new Supabase price tables, a protected `set_apartment_price` RPC, and `/api/apartment-prices`.
