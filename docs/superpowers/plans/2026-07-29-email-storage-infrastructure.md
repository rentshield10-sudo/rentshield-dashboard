# Email + Storage Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two reusable helpers — `lib/email.ts` (Resend) and `lib/storage.ts`
(Supabase Storage) — verified against the live services, with no
signing-specific logic yet.

**Architecture:** Both are thin wrappers around existing SDKs
(`@supabase/supabase-js` already includes Storage support; `resend` is a
new dependency). Both throw on failure rather than swallowing errors,
matching `lib/rentvine.ts`'s existing convention in this project.

**Tech Stack:** `resend` (new dependency), `@supabase/supabase-js`
(existing), Supabase Storage (private bucket, service-role access only).

## Global Constraints

- `RESEND_API_KEY` is a new required env var (add to `.env.local`, and
  later to Vercel's env vars alongside the others already documented).
- Domain verification (DNS records for `rentshieldpropertymanagement.com`)
  is explicitly deferred — Resend's sandbox mode (sending only to the
  account owner's own verified email) is what gets used/tested in this
  phase.
- No automated test suite exists in this project — verification is via
  direct scripts against the real Resend and Supabase services, matching
  every other feature built this session.

---

### Task 1: Install `resend` and create `lib/email.ts`

**Files:**
- Modify: `package.json` (add `resend` dependency)
- Create: `lib/email.ts`

**Interfaces:**
- Produces: `sendEmail({ to, subject, html }: { to: string; subject:
  string; html: string }): Promise<{ id: string }>` — throws on failure.

- [ ] **Step 1: Install the dependency**

```bash
npm install resend
```

- [ ] **Step 2: Write `lib/email.ts`**

```ts
import { Resend } from "resend";

const FROM_ADDRESS = "onboarding@resend.dev"; // sandbox sender until the
// custom domain is verified — swap to e.g. noreply@rentshieldpropertymanagement.com
// once DNS verification (deferred) is done.

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Missing env var: RESEND_API_KEY");
  }

  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject,
    html,
  });

  if (result.error) {
    throw new Error(`Resend send failed: ${result.error.message}`);
  }
  if (!result.data) {
    throw new Error("Resend send returned no data.");
  }

  return { id: result.data.id };
}
```

- [ ] **Step 3: Add `RESEND_API_KEY` to `.env.local`**

Get the key from Resend's dashboard (API Keys section) — no domain
verification needed to generate a sandbox-capable key.

```
RESEND_API_KEY=re_...
```

- [ ] **Step 4: Verify with a real send**

Write a one-off script (not committed) that imports and calls `sendEmail`
with `to` set to the Resend account's own verified email address (sandbox
mode requirement), then run it with `node` and confirm the email actually
arrives.

- [ ] **Step 5: Verify types/lint**

```bash
npx tsc --noEmit
npm run lint
```

Expect no new errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/email.ts
git commit -m "Add Resend email wrapper"
```

---

### Task 2: Create the Supabase Storage bucket and `lib/storage.ts`

**Files:**
- Create: `lib/storage.ts`

**Interfaces:**
- Consumes: `supabaseServer` (existing, from `lib/supabase-server.ts`).
- Produces:
  - `uploadFile(path: string, data: Buffer, contentType: string):
    Promise<void>` — throws on failure.
  - `getSignedDownloadUrl(path: string, expiresInSeconds: number):
    Promise<string>` — throws on failure.

- [ ] **Step 1: Create the bucket**

In the Supabase dashboard → Storage → New bucket:
- Name: `lease-documents`
- **Public: off** (private — this is the entire point; matches every
  other table in this project being locked to service-role-only access)

No SQL migration file for this — bucket creation isn't a table DDL
statement, it's a Storage-API-level object. This is a manual dashboard
step, same as every SQL migration in this project has been.

- [ ] **Step 2: Write `lib/storage.ts`**

```ts
import { supabaseServer } from "@/lib/supabase-server";

const BUCKET = "lease-documents";

export async function uploadFile(
  path: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await supabaseServer.storage
    .from(BUCKET)
    .upload(path, data, { contentType, upsert: false });

  if (error) {
    throw new Error(`Supabase Storage upload failed for ${path}: ${error.message}`);
  }
}

export async function getSignedDownloadUrl(
  path: string,
  expiresInSeconds: number,
): Promise<string> {
  const { data, error } = await supabaseServer.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data) {
    throw new Error(
      `Supabase Storage signed URL failed for ${path}: ${error?.message || "no data returned"}`,
    );
  }

  return data.signedUrl;
}
```

- [ ] **Step 3: Verify with a real upload + signed URL**

Write a one-off script (not committed) that uploads a small test buffer to
e.g. `originals/test.txt`, then calls `getSignedDownloadUrl` and fetches
that URL directly, confirming the content round-trips correctly. Also
confirm the bucket path is **not** reachable via a plain (non-signed)
public URL — this is the property the whole design depends on.

- [ ] **Step 4: Verify types/lint**

```bash
npx tsc --noEmit
npm run lint
```

Expect no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/storage.ts
git commit -m "Add Supabase Storage wrapper for private PDF storage"
```
