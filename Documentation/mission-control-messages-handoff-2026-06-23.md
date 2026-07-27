# Mission Control Messages / Quo Inbox Handoff

**Date:** 2026-06-23  
**Project:** Mission Control Dashboard + Quo/OpenPhone Messages  
**Current focus:** Move message fetching/display into Mission Control and prepare the right-side templates, queue, and automation monitor panels.

---

## 1. Main Goal

Mission Control should become the control center for messaging.

Long-term flow:

```text
Zillow lead
→ n8n sends intro message
→ Supabase stores lead/message state
→ lead replies in Quo/OpenPhone
→ Mission Control fetches new inbound messages
→ Mission Control/Supabase decides what to do
→ if eligible, use template reply
→ send to message queue / auto-clicker sender
→ update Supabase lead pipeline
→ otherwise send to Human Review
```

The current immediate goal is **display only**:

```text
Mission Control Messages tab
→ fetch conversations directly from Quo/OpenPhone API
→ lazy-load conversation list
→ click conversation
→ lazy-load chat history
```

We are intentionally moving away from depending on the old QuoSender server for the inbox UI because the QuoSender server may be shut down later.

---

## 2. Current Running Apps

### Mission Control Dashboard

Current app:

```text
localhost:3002
```

Main project path shown in VS Code:

```text
mission-control-dashboard/
```

Important dashboard files:

```text
mission-control-dashboard/app/page.tsx
mission-control-dashboard/app/page.module.css
mission-control-dashboard/components/messages/MessagesTab.tsx
mission-control-dashboard/components/messages/MessagesTab.module.css
mission-control-dashboard/lib/supabase.ts
```

The dashboard sidebar currently has:

```text
Home
Leads
Human Review
Booking
Messages
```

`Messages` is already mounted from `app/page.tsx`:

```tsx
{activeView === "messages" && <MessagesTab />}
```

### Old QuoSender Server

Current app:

```text
localhost:3000
```

Old project path shown in VS Code:

```text
quosenderv2/packages/sender/server/
```

Important files inspected:

```text
packages/sender/server/src/index.ts
packages/sender/server/src/config.ts
packages/sender/server/src/routes/conversations.ts
packages/sender/server/src/routes/messages.ts
packages/sender/server/src/routes/admin.ts
packages/sender/server/src/routes/webhooks.ts
packages/sender/server/src/services/conversation.service.ts
packages/sender/server/src/services/message.service.ts
packages/sender/server/src/services/sender.client.ts
packages/sender/server/src/services/quo.client.ts
```

Old QuoSender already supports lazy loading locally through SQLite:

```text
GET /api/conversations?limit=20&cursor=...
GET /api/conversations/:id/messages?limit=30&cursor=...
```

But we decided not to depend on these routes long-term.

---

## 3. Important Decision Made

Originally, we considered using:

```text
Mission Control browser
→ QuoSender server API
→ Quo/OpenPhone
```

But then we decided the better long-term setup is:

```text
Mission Control browser
→ Mission Control Next.js API route
→ Quo/OpenPhone API
```

This avoids needing the QuoSender server for inbox display later.

Important security decision:

```text
The browser must NOT call Quo/OpenPhone directly with the API key.
The API key must stay server-side inside Next.js API routes.
```

---

## 4. Quo/OpenPhone API Client From Old Server

The working Quo client from the old server uses:

```ts
QUO_API_KEY
QUO_BASE_URL=https://api.openphone.com
```

Important old client behavior:

```ts
Authorization: QUO_API_KEY
Content-Type: application/json
```

Important methods copied/planned for Mission Control:

```ts
listQuoConversations({ limit, cursor })
listQuoMessages({ phoneNumberId, participants, limit, cursor })
```

Old Quo/OpenPhone endpoints:

```text
GET /v1/conversations?limit=20&pageToken=...
GET /v1/messages?phoneNumberId=...&participants=...&limit=30&pageToken=...
```

Primary inbox number ID currently used in QuoSender:

```text
PNAO2aXSml
```

This is the OpenPhone/Quo phone number ID for the primary inbox, noted in old code as `(201) 350-1990`.

---

## 5. Mission Control Environment Variables Needed

Add these to:

```text
mission-control-dashboard/.env.local
```

```env
QUO_API_KEY=your_real_key_here
QUO_BASE_URL=https://api.openphone.com
QUO_PRIMARY_INBOX_ID=PNAO2aXSml
```

Do **not** use `NEXT_PUBLIC_` for `QUO_API_KEY`.

Existing Supabase env vars remain:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

---

## 6. Mission Control API Route Structure

Important correction made during session:

The API files must be under:

```text
mission-control-dashboard/app/api/...
```

They must **not** be under:

```text
mission-control-dashboard/app/landlord/confirmed-today/...
```

Wrong path that caused 404:

```text
app/landlord/confirmed-today/quo/conversations/route.ts
```

Correct paths:

```text
mission-control-dashboard/lib/quo.ts
mission-control-dashboard/app/api/quo/conversations/route.ts
mission-control-dashboard/app/api/quo/conversations/[id]/messages/route.ts
```

Expected browser/dashboard endpoints:

```text
GET http://localhost:3002/api/quo/conversations?limit=20&cursor=...
GET http://localhost:3002/api/quo/conversations/:id/messages?phoneNumberId=...&participants=...&limit=30&cursor=...
```

If `/api/quo/conversations` returns 404, check that the route is in the correct `app/api` folder and restart the Next.js dev server.

Test route first if needed:

```ts
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Mission Control Quo conversations API route is working",
  });
}
```

Then restart:

```bash
Ctrl + C
npm run dev
```

Open directly:

```text
http://localhost:3002/api/quo/conversations
```

Expected result from test route:

```json
{
  "ok": true,
  "message": "Mission Control Quo conversations API route is working"
}
```

---

## 7. Planned `lib/quo.ts`

Create:

```text
mission-control-dashboard/lib/quo.ts
```

Purpose:

```text
Server-side Quo/OpenPhone API helper for Mission Control API routes.
```

Should include types:

```ts
export interface QuoConversation {
  id: string;
  contactId?: string;
  channel?: string;
  lastMessageSnippet?: string;
  lastActivityAt?: string;
  createdAt: string;
  updatedAt?: string;
  name?: string | null;
  participants?: string[];
  phoneNumberId?: string;
}

export interface QuoMessage {
  id: string;
  conversationId?: string;
  direction?: string;
  body?: string;
  text?: string;
  status?: string;
  fromNumber?: string;
  toNumber?: string;
  from?: string;
  to?: string;
  createdAt?: string;
  sentAt?: string;
  failedAt?: string;
  errorMessage?: string;
}

export interface QuoPaginated<T> {
  data: T[];
  hasNextPage?: boolean;
  nextCursor?: string;
  nextPageToken?: string | null;
  totalItems?: number;
}
```

Should expose:

```ts
listQuoConversations(params?: { limit?: number; cursor?: string })
listQuoMessages(params: {
  phoneNumberId: string;
  participants: string[];
  limit?: number;
  cursor?: string;
})
```

Important fetch settings:

```ts
headers: {
  Authorization: quoApiKey,
  "Content-Type": "application/json",
}
cache: "no-store"
```

---

## 8. Planned API Route: Conversations

Create:

```text
mission-control-dashboard/app/api/quo/conversations/route.ts
```

Purpose:

```text
Fetch a lazy-loaded page of Quo/OpenPhone conversations.
Filter to primary inbox if QUO_PRIMARY_INBOX_ID is set.
```

Endpoint:

```text
GET /api/quo/conversations?limit=20&cursor=...
```

Returns normalized pagination:

```json
{
  "data": [],
  "cursor": "next-page-token-or-null",
  "hasMore": true
}
```

Important behavior:

```ts
const primaryInboxId = process.env.QUO_PRIMARY_INBOX_ID || "";

const filteredData = primaryInboxId
  ? (page.data || []).filter(
      (conversation) => conversation.phoneNumberId === primaryInboxId
    )
  : page.data || [];
```

---

## 9. Planned API Route: Conversation Messages

Create:

```text
mission-control-dashboard/app/api/quo/conversations/[id]/messages/route.ts
```

Purpose:

```text
Fetch a lazy-loaded page of messages for the selected Quo/OpenPhone conversation.
```

Endpoint:

```text
GET /api/quo/conversations/:id/messages?phoneNumberId=...&participants=...&limit=30&cursor=...
```

Important note:

The old Quo client requires:

```text
phoneNumberId
participants
```

to fetch messages from `/v1/messages`.

The `:id` path param is mostly for dashboard routing/context. The message fetch itself depends on:

```text
phoneNumberId
participants
```

Returns normalized pagination:

```json
{
  "data": [],
  "cursor": "next-page-token-or-null",
  "hasMore": true
}
```

---

## 10. Current Messages UI Goal

Current `MessagesTab.tsx` should become a two-column workspace.

High-level layout:

```text
Messages Page
├── Header row
│   ├── title: Quo Inbox
│   └── stats / refresh button
│
└── Workspace grid
    ├── Left column: Inbox workspace
    │   ├── Conversation list
    │   └── Chat history
    │
    └── Right column: Messaging controls
        ├── Message Templates / Auto Reply Rule frame
        ├── Message Queue frame
        └── Automation Status / Polling Monitor mini box
```

Important: Do **not** create separate sidebar nav links for Templates or Queue yet.

Keep one sidebar item:

```text
Messages
```

Templates, Queue, and Automation Monitor should live inside the Messages page.

---

## 11. Left Column: Quo Inbox

Left column should contain the whole inbox experience.

Internal split:

```text
Left inbox column
├── Conversation list
└── Message preview / chat history
```

Lazy-load requirements:

### Conversation list

First load:

```text
GET /api/quo/conversations?limit=20
```

On scroll near bottom:

```text
GET /api/quo/conversations?limit=20&cursor=<nextCursor>
```

### Chat history

On conversation click:

```text
GET /api/quo/conversations/:id/messages?phoneNumberId=<phoneNumberId>&participants=<participant>&limit=30
```

On scroll near top of chat:

```text
GET /api/quo/conversations/:id/messages?phoneNumberId=<phoneNumberId>&participants=<participant>&limit=30&cursor=<nextCursor>
```

Display behavior:

```text
API returns newest-first.
UI should reverse the batch to show oldest-to-newest.
When older messages are fetched, prepend them while preserving scroll position.
```

---

## 12. Right Column: Message Templates / Auto Reply Rule Frame

This is the next major UI frame to build.

Purpose:

```text
Manage templates and define which template gets used for an inbound reply rule.
```

This frame should combine:

```text
Template Library
+
Auto Reply Rule Mapping
```

### Template Library

Should eventually read from Supabase:

```text
public.templates
```

Known columns from handoff:

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

Initial UI fields:

```text
Template name
Template type
Stage
Intent
Active/inactive
Content preview/editor
```

First important template:

```text
02_requirements_request_v1
```

For first version, editing can focus on:

```text
content
is_active
```

Everything else can be read-only until stable.

### Auto Reply Rule Mapping

First rule to display:

```text
Rule name:
Intro Reply → Requirements

Trigger:
Inbound message received after intro_sent

Eligibility:
- exactly one matching lead by phone
- current_status = contacted
- conversation_stage = intro_sent
- automation not stopped
- human review not required

Template:
02_requirements_request_v1

After send:
pipeline_status = requirements_sent
conversation_stage = requirements_sent

Fallback:
Human Review
```

Buttons planned:

```text
Edit Rule
Save Rule
Test Rule
Enable / Disable
```

For the first UI version, these can be placeholder buttons unless the database rule table exists.

---

## 13. Right Column: Message Queue Frame

Build after Templates/Rule frame.

Purpose:

```text
Show future auto-reply queue status before sending through the auto-clicker sender.
```

Initial placeholder stats:

```text
Pending: 0
Sending: 0
Sent: 0
Failed: 0
Human Review: 0
```

Future queue item fields:

```text
phone
lead/property if matched
template selected
status
created time
retry button
cancel button
```

Eventually this can connect to:

```text
Supabase queue table
or
outbound rows in public.messages
or
a sender/auto-clicker queue service
```

---

## 14. Right Column: Automation Status / Polling Monitor Mini Box

Build after or alongside the Queue frame.

Purpose:

```text
Show the automation lifecycle and polling countdown.
```

Needed text/statuses:

```text
Fetching new message in countdown: 2 mins editable
New message received
Checking possible template reply
Sending to queue for auto reply
Sent to Human Review
```

Suggested state labels:

```text
Idle
Countdown
Fetching Messages
New Message Received
Matching Lead
Checking Rule
Template Selected
Queued Auto Reply
Human Review
Error
```

Controls:

```text
Start polling
Pause polling
Run now
Edit interval
```

Editable polling interval:

```text
Default: 2 minutes
```

This box should not send messages yet. First version can show the planned statuses and manual controls.

---

## 15. Future Automation Flow

Later automation target:

```text
Polling monitor countdown reaches 0
→ fetch new messages from Quo/OpenPhone
→ identify new inbound messages
→ match phone to Supabase lead
→ check auto-reply rule
→ select template
→ queue auto-reply
→ sender/auto-clicker sends reply
→ update lead pipeline
→ mark processed
```

Specific first auto-reply rule:

```text
If any inbound reply comes from a phone number
AND exactly one matching dashboard lead exists for that phone
AND that lead has current_status = contacted
AND that lead has conversation_stage = intro_sent
AND automation is not stopped
AND human review is not already required
AND lead has not already moved to requirements_sent/booked/etc

THEN:
Use 02_requirements_request_v1
Queue/send auto reply
Update lead to requirements_sent

ELSE:
Send nothing
Send to Human Review
```

Important ambiguity rule:

```text
0 matching eligible leads → Human Review / no auto-send
1 matching eligible lead → Use requirements template
2+ matching eligible leads → Human Review / no auto-send
```

This avoids guessing when the same phone number has multiple apartment inquiries.

---

## 16. Supabase Tables Already Present

Do not create duplicate tables unless needed.

Known public tables/views from handoff:

```text
public.ai_decisions
public.conversations
public.dashboard_leads
public.dashboard_leads_clean
public.dashboard_rows
public.dashboard_schedule_template_items
public.dashboard_schedule_templates
public.dashboard_showing_appointments
public.dashboard_showing_schedules
public.human_escalations
public.leads
public.messages
public.properties
public.showing_appointments
public.showing_schedules
public.templates
public.dashboard_apartments
```

Key tables for messaging/automation:

```text
public.dashboard_leads
public.dashboard_leads_clean
public.messages
public.conversations
public.templates
public.human_escalations
public.ai_decisions
```

---

## 17. Existing Supabase `public.messages`

Important correction from session:

There is already a Supabase messages table.

Do **not** create another messages table.

Known columns from handoff:

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
```

Recent records already include outbound intro messages like:

```text
direction = outbound
intent = initial_outreach
template_key = initial_outreach
processed = true
```

For immediate display-only inbox, we are fetching directly from Quo/OpenPhone and not yet saving new messages to Supabase.

Later, once automation begins, new inbound messages should likely be inserted/upserted into existing `public.messages` so they can drive:

```text
auto-reply decisions
Human Review
lead pipeline updates
processed/unprocessed tracking
message history by lead
```

Future inbound insert shape:

```ts
{
  phone: contactPhoneNumber,
  channel: "quo",
  direction: "inbound",
  message_text: messageBody,
  external_message_id: quoMessageId,
  external_conversation_id: quoConversationId,
  processed: false
}
```

Deduplicate using `external_message_id` if a unique constraint exists or via a safe upsert/RPC.

---

## 18. Existing Supabase `public.templates`

The handoff says this table exists but was empty when checked.

Columns:

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

Templates to move from QuoSender/UI:

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

First required template:

```text
02_requirements_request_v1
```

Need to copy the exact full text from QuoSender and insert into `public.templates`.

Example insert:

```sql
insert into public.templates (
  template_name,
  template_type,
  channel,
  stage,
  intent,
  content,
  requires_human_approval,
  is_active,
  priority
)
values (
  '02_requirements_request_v1',
  'auto_reply',
  'sms',
  'requirements_sent',
  'requirements_request',
  'PASTE FULL REQUIREMENTS TEMPLATE HERE',
  false,
  true,
  10
);
```

Better future version should use duplicate protection with a unique constraint or safe upsert.

---

## 19. Supabase Lead State Issue

Current status problem from handoff:

Many rows have:

```text
current_status = contacted
conversation_stage = intro_sent
pipeline_status = new_lead
```

There were 460 rows with that combination.

Therefore, the first auto-reply rule should **not** rely on:

```text
pipeline_status = contacted
```

Instead, use current real state:

```text
current_status = contacted
conversation_stage = intro_sent
```

Later, n8n or `mark_intro_sent` should also set:

```text
pipeline_status = contacted
```

---

## 20. Supabase RPCs / Functions To Finish Later

### Existing helper created

```sql
create or replace function public.normalize_phone_text(p_phone text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
$$;
```

Possible improvement:

For US phone numbers, compare last 10 digits because data may have both:

```text
+17189542664
7189542664
```

### Lookup function issue

Existing function:

```text
public.find_single_contacted_lead_for_auto_reply(text)
```

The first version checked `pipeline_status = contacted`, which failed because real data still has `pipeline_status = new_lead`.

When replacing return shape, Postgres gave:

```text
ERROR: 42P13: cannot change return type of existing function
HINT: use DROP FUNCTION find_single_contacted_lead_for_auto_reply(text) first.
```

Next time run:

```sql
drop function if exists public.find_single_contacted_lead_for_auto_reply(text);
```

Then recreate the corrected version that uses:

```text
current_status = contacted
conversation_stage = intro_sent
```

### mark_lead_requirements_sent

Existing function:

```text
public.mark_lead_requirements_sent(p_lead_id text, p_inbound_sms text, p_outbound_sms text)
```

Needs to clearly update both old fields and new pipeline field:

```text
conversation_stage = requirements_sent
pipeline_status = requirements_sent
last_inbound_sms
last_inbound_at
last_outbound_sms
last_outbound_at
needs_human_review = false
```

Reminder: many `dashboard_leads` fields are text, so SQL should use:

```sql
now()::text
```

for text timestamp fields.

---

## 21. Dashboard `app/page.tsx` Current State

`app/page.tsx` already imports:

```ts
import BookingTab from "../components/booking/BookingTab";
import { supabase } from "../lib/supabase";
import styles from "./page.module.css";
import LeadsTab from "../components/leads/LeadsTab";
import MessagesTab from "../components/messages/MessagesTab";
```

Active view type:

```ts
type ActiveView = "home" | "leads" | "human" | "booking" | "messages";
```

Messages nav item exists:

```ts
{
  label: "Messages",
  view: "messages" as ActiveView,
  count: 0,
}
```

Messages render exists:

```tsx
{activeView === "messages" && <MessagesTab />}
```

Leads are read from:

```ts
.from("dashboard_leads_clean")
.select(
  "lead_id, created_at, created_at_ts, lead_name, phone, apt_address, current_status, conversation_stage, needs_human_review_bool, notes, last_outbound_sms, last_outbound_at, pipeline_status"
)
```

This is correct for now.

---

## 22. Immediate Next Session Order

### Step 1 — Fix Mission Control API route paths

Make sure these exist exactly:

```text
mission-control-dashboard/lib/quo.ts
mission-control-dashboard/app/api/quo/conversations/route.ts
mission-control-dashboard/app/api/quo/conversations/[id]/messages/route.ts
```

Do not place them under `app/landlord/...`.

### Step 2 — Add env vars

Add to `mission-control-dashboard/.env.local`:

```env
QUO_API_KEY=your_real_key_here
QUO_BASE_URL=https://api.openphone.com
QUO_PRIMARY_INBOX_ID=PNAO2aXSml
```

Restart dashboard.

### Step 3 — Test API route directly

Open:

```text
http://localhost:3002/api/quo/conversations
```

Expected:

```text
JSON response, not 404
```

If 404:

```text
wrong folder path or dev server not restarted
```

If 500:

```text
probably missing/invalid env var or Quo upstream error
```

### Step 4 — Finish inbox lazy-load display

Update `MessagesTab.tsx` so it calls:

```text
/api/quo/conversations?limit=20&cursor=...
/api/quo/conversations/:id/messages?phoneNumberId=...&participants=...&limit=30&cursor=...
```

Keep lazy loading:

```text
scroll left list down → fetch next conversations
click conversation → fetch messages
scroll chat up → fetch older messages
```

### Step 5 — Convert Messages page to two-column workspace

Target layout:

```text
Left: Quo Inbox
Right: Templates + Queue + Automation Monitor
```

Recommended CSS proportions:

```css
.messagesWorkspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 12px;
}

.inboxShell {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
}
```

On mobile:

```css
grid-template-columns: 1fr;
```

### Step 6 — Build Message Templates frame

First right-column card:

```text
Message Templates / Auto Reply Rule
```

Show first rule read-only/hardcoded:

```text
Intro Reply → Requirements
Template: 02_requirements_request_v1
Fallback: Human Review
```

Then connect to Supabase `public.templates`.

### Step 7 — Build Queue frame placeholder

Second right-column card:

```text
Message Queue
Pending 0 | Sending 0 | Sent 0 | Failed 0
```

No sending yet.

### Step 8 — Build Automation Monitor mini box

Third right-column card:

```text
Next fetch in: 02:00
Interval: 2 minutes editable
Statuses: Fetching, New Message Received, Checking Rule, Queueing Reply, Human Review
Buttons: Run now, Pause, Start polling
```

No automation yet; UI/status only.

### Step 9 — After UI is stable, return to Supabase automation

Finish:

```text
find_single_contacted_lead_for_auto_reply
02_requirements_request_v1 insert
mark_lead_requirements_sent
phone-only human escalation function
inbound message insert/upsert to public.messages
```

Then connect monitor/queue to real automation.

---

## 23. One-Sentence Current Summary

We added the Messages nav tab and began moving Quo/OpenPhone inbox fetching into Mission Control directly through Next.js API routes; next we need to fix the API route path under `app/api`, complete lazy-loaded conversations/messages, then restructure the Messages page into a two-column workspace with the inbox on the left and templates, queue, and automation monitor controls on the right.
