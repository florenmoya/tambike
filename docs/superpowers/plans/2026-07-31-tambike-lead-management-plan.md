# Tambike Test-Ride Lead Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simulated test-ride form and fake admin upload area with real, privacy-scoped test-ride lead capture and management for guests, riders, event owners, and admins.

**Architecture:** Store active lead contact data in Postgres with consent, idempotency, deduplication, workflow status, and expiry metadata. Domain methods enforce event eligibility and owner/admin access, while focused Server Actions and Route Handlers expose submission, masked lists, audited reveal, status updates, and safe CSV exports. An idempotent scheduled operation anonymizes expired rows in place so aggregate counts remain without a separate analytics store.

**Tech Stack:** Next.js 16.2.11 App Router, Server Actions, and Route Handlers; React 19.2.4; TypeScript 5; Zod 4.4.3; Prisma 7.8.0; PostgreSQL; Node crypto; Vitest 4.1.9; Radix/shadcn UI.

## Global Constraints

- Complete the account-access and event-review plans first.
- Only publicly eligible `Test Ride` events accept lead submissions.
- Guests may submit; authenticated submissions link to the rider.
- Organizers may access only leads for events they own; admins may access all leads.
- List views mask phone numbers; full contact reveal and export are separately authorized and audited.
- Consent version and timestamp are stored with every active lead.
- The default retention period is exactly 90 days and is configurable without a schema change.
- Expiry anonymizes the existing row: clear user link, phone, fingerprint, name, consent metadata, and all rider-entered free text; retain event, workflow status, created time, and purge time.
- Repeated active submissions for one event and normalized phone update the same request.
- Do not store raw phone numbers, IP addresses, or idempotency keys in audit/rate-limit metadata.
- Protect CSV cells against spreadsheet formula injection.
- Remove the batch-upload/validation feature, navigation, fabricated rows, and `FileUpload06` active usage.
- Treat Server Actions and Route Handlers as untrusted entry points.
- Preserve dirty worktree changes; never create an AI/Codex branch or worktree.
- Never run lead mutations or retention cleanup against a remote/live database without separate explicit approval.
- Browser verification uses only the Codex browser surface; do not run Playwright.

---

## File Structure

### Create

- `src/features/leads/types.ts` — serializable submission, list, contact, status, and query contracts.
- `src/features/leads/validation.ts` — strict Zod schemas, phone normalization, masking, and consent constant.
- `src/features/leads/test-ride-lead-form.tsx` — real guest/rider form with pending and committed-result states.
- `src/features/leads/lead-management-table.tsx` — responsive masked list, filters, reveal dialog, and status actions.
- `src/features/leads/organizer-event-leads.tsx` — owner-scoped event lead panel.
- `src/server/leads/lead-actions.ts` — public submission and authenticated management Server Actions/loaders.
- `src/server/leads/rate-limit-key.ts` — HMAC request fingerprinting without raw IP retention.
- `src/server/csv.ts` — reusable formula-safe CSV encoding.
- `src/app/api/organizer/events/[eventId]/exports/leads/route.ts` — owner-scoped CSV export.
- `src/app/api/jobs/lead-retention/route.ts` — secret-authenticated expiry job.
- `tests/server/lead-validation.test.ts` — phone, consent, and input parsing.
- `tests/server/lead-domain.test.ts` — memory submission/access/dedupe/retention behavior.
- `tests/server/lead-actions.test.ts` — safe action result and rate-limit context tests.
- `tests/server/lead-routes.test.ts` — export/job HTTP contract tests.
- `tests/server/lead-ui.test.tsx` — form/list semantics and fake-surface removal.
- `tests/prisma-integration/lead-management.integration.test.ts` — real database ownership, concurrency, and purge coverage.
- `prisma/migrations/20260731170000_production_leads/migration.sql` — production lead lifecycle and rate-limit persistence.

### Modify

- `prisma/schema.prisma` — nullable purgeable lead PII, status, consent, expiry, idempotency, partial dedupe support, and rate-limit table.
- `src/server/backend.ts` — memory lead/rate-limit stores and methods.
- `src/server/prisma-backend.ts` — transactional lead operations.
- `src/features/shared/action-state.ts` — add the `RATE_LIMITED` action code.
- `src/server/action-result.ts` — add the generic rate-limit message.
- `src/features/tambike-demo/tambike-screen.tsx` — replace local `saved` form with the real lead form and unavailable state.
- `src/features/admin/admin-console.tsx` — replace validation section with real lead content and remove upload UI.
- `src/features/organizer/organizer-console.tsx` — accept owned lead content in the event workspace.
- `src/components/app-sidebar.tsx` — rename “Leads & validation” to “Test-ride leads” and use section `leads`.
- `src/app/admin/leads/page.tsx` — focused admin lead loader.
- `src/app/events/[eventId]/test-ride/page.tsx` — remove demo static params and add event-backed metadata.
- `src/app/organizer/events/[eventId]/page.tsx` — render owner lead panel for eligible events.
- `src/app/api/admin/exports/leads/route.ts` — query-aware, real, safe admin export.
- `src/app/api/jobs/member-media-cleanup/route.ts` — no behavior change; use as the pattern for cron authentication.
- `src/components/file-upload-06.tsx` — delete after confirming no remaining imports.
- `src/features/tambike-demo/types.ts` — remove validation/import-only types if present.
- `prisma/seed.ts` — no fabricated leads; canonical events may remain empty.
- `.env.example` — document `LEAD_RETENTION_DAYS=90`.
- `tests/server/account-role-location-route-contract.test.ts` — leads route remains, validation/import controls do not.
- `tests/server/prisma-seed-policy.test.ts` — seed creates no lead records.

## Interfaces

```ts
export const TEST_RIDE_CONSENT_VERSION = "test-ride-contact-v1";

export type LeadStatus = "NEW" | "CONTACTED" | "COMPLETED" | "CLOSED";

export type SubmitLeadInput = {
  name: string;
  phone: string;
  currentMotorcycle: string;
  interestedModel: string;
  preferredTime: string;
  consent: true;
  consentVersion: typeof TEST_RIDE_CONSENT_VERSION;
  idempotencyKey: string;
  website: string;
};

export type LeadListQuery = {
  eventId?: string;
  status?: LeadStatus;
  cursor?: string;
  limit?: number;
};

export type LeadListItem = {
  id: string;
  eventId: string;
  eventTitle: string;
  name: string;
  maskedPhone: string;
  interestedModel: string;
  preferredTime: string;
  status: LeadStatus;
  createdAt: string;
  retentionExpiresAt: string;
  exportedAt?: string;
  updatedAt: string;
};

export type LeadListPage = {
  items: LeadListItem[];
  nextCursor?: string;
  total: number;
};

export type LeadContactView = {
  id: string;
  name: string;
  phone: string;
  currentMotorcycle: string;
  interestedModel: string;
  preferredTime: string;
  consentVersion: string;
  consentAt: string;
};

export type UpdateLeadStatusInput = {
  status: LeadStatus;
  expectedUpdatedAt: string;
};

export type LeadSubmissionResult = {
  leadId: string;
  updatedExisting: boolean;
};
```

Both backends expose:

```ts
submitTestRideLead(
  sessionToken: string | undefined,
  eventId: string,
  input: SubmitLeadInput,
  context: { rateLimitKeyHash: string; now?: Date },
): Promise<LeadSubmissionResult>;
listLeads(
  sessionToken: string,
  query?: LeadListQuery,
): Promise<LeadListPage>;
revealLeadContact(
  sessionToken: string,
  leadId: string,
): Promise<LeadContactView>;
updateLeadStatus(
  sessionToken: string,
  leadId: string,
  input: UpdateLeadStatusInput,
): Promise<LeadListItem>;
exportLeadsCsv(
  sessionToken: string,
  query?: Pick<LeadListQuery, "eventId" | "status">,
): Promise<string>;
purgeExpiredLeads(input: { now: Date }): Promise<{ purged: number }>;
```

---

### Task 1: Define Lead Validation, Phone Normalization, and Safe CSV

**Files:**
- Create: `src/features/leads/types.ts`
- Create: `src/features/leads/validation.ts`
- Create: `src/server/csv.ts`
- Create: `src/server/leads/rate-limit-key.ts`
- Create: `tests/server/lead-validation.test.ts`

**Interfaces:**
- Produces: contracts above, `normalizePhilippinePhone()`, `maskPhone()`, `encodeCsv()`, and `deriveLeadRateLimitKey()`.
- Consumed by: all lead operations.

- [ ] **Step 1: Write failing validation tests**

Create:

```ts
import { describe, expect, test } from "vitest";
import {
  maskPhone,
  normalizePhilippinePhone,
  submitLeadSchema,
  TEST_RIDE_CONSENT_VERSION,
} from "../../src/features/leads/validation";
import { encodeCsv } from "../../src/server/csv";
import { deriveLeadRateLimitKey } from "../../src/server/leads/rate-limit-key";

describe("test-ride lead validation", () => {
  test.each([
    ["09171234567", "+639171234567"],
    ["+63 917 123 4567", "+639171234567"],
    ["639171234567", "+639171234567"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizePhilippinePhone(input)).toBe(expected);
  });

  test.each(["", "12345", "+63917123", "+12025550123"])(
    "rejects unsupported phone %s",
    (input) => {
      expect(() => normalizePhilippinePhone(input)).toThrow("INVALID_PHONE");
    },
  );

  test("requires explicit current consent and an opaque idempotency key", () => {
    expect(submitLeadSchema.safeParse({
      name: "Ana Rider",
      phone: "09171234567",
      currentMotorcycle: "Honda Click 160",
      interestedModel: "Ducati Scrambler",
      preferredTime: "Saturday morning",
      consent: true,
      consentVersion: TEST_RIDE_CONSENT_VERSION,
      idempotencyKey: "018f47f0-c2b5-7b70-9f87-8f83df31f33e",
      website: "",
    }).success).toBe(true);
  });

  test("masks contact numbers", () => {
    expect(maskPhone("+639171234567")).toBe("+63 ••• ••• 4567");
  });

  test("protects CSV consumers from formulas", () => {
    expect(encodeCsv([["name", "phone"], ["=cmd|' /C calc'!A0", "+639171234567"]]))
      .toContain("\"'=cmd|' /C calc'!A0\"");
  });

  test("derives a stable HMAC key without returning raw input", () => {
    const key = deriveLeadRateLimitKey({
      secret: "test-secret-that-is-long-enough",
      eventId: "event-1",
      clientAddress: "203.0.113.8",
    });
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("203.0.113.8");
  });
});
```

- [ ] **Step 2: Run the focused test**

```powershell
npx vitest run tests/server/lead-validation.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement strict lead schemas**

Use:

```ts
export const TEST_RIDE_CONSENT_VERSION = "test-ride-contact-v1" as const;

export function normalizePhilippinePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  const normalized =
    /^09\d{9}$/.test(digits)
      ? `+63${digits.slice(1)}`
      : /^639\d{9}$/.test(digits)
        ? `+${digits}`
        : null;
  if (!normalized) throw new Error("INVALID_PHONE");
  return normalized;
}

export function maskPhone(value: string) {
  return `+63 ••• ••• ${value.slice(-4)}`;
}

export const submitLeadSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().transform(normalizePhilippinePhone),
  currentMotorcycle: z.string().trim().min(2).max(120),
  interestedModel: z.string().trim().min(2).max(120),
  preferredTime: z.string().trim().min(2).max(120),
  consent: z.literal(true),
  consentVersion: z.literal(TEST_RIDE_CONSENT_VERSION),
  idempotencyKey: z.string().uuid(),
  website: z.string().max(200),
}).strict();
```

Add strict query and status schemas with `limit` clamped to 1–100 and ISO `expectedUpdatedAt`.

- [ ] **Step 4: Implement CSV protection**

Create:

```ts
function csvCell(value: unknown) {
  const text = String(value ?? "");
  const protectedText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}

export function encodeCsv(rows: unknown[][]) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
```

- [ ] **Step 5: Implement rate-limit key derivation**

Create:

```ts
import { createHmac } from "node:crypto";

export function deriveLeadRateLimitKey(input: {
  secret: string;
  eventId: string;
  clientAddress: string;
}) {
  if (input.secret.length < 16) throw new Error("LEAD_RATE_LIMIT_SECRET_INVALID");
  return createHmac("sha256", input.secret)
    .update(`lead:${input.eventId}:${input.clientAddress}`)
    .digest("hex");
}
```

- [ ] **Step 6: Run and commit**

```powershell
npx vitest run tests/server/lead-validation.test.ts
npx eslint src/features/leads/types.ts src/features/leads/validation.ts src/server/csv.ts src/server/leads/rate-limit-key.ts tests/server/lead-validation.test.ts
git add -- src/features/leads/types.ts src/features/leads/validation.ts src/server/csv.ts src/server/leads/rate-limit-key.ts tests/server/lead-validation.test.ts
git commit -m "feat: define secure lead contracts"
```

Expected: test/lint pass, then commit succeeds.

---

### Task 2: Add Production Lead and Rate-Limit Persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260731170000_production_leads/migration.sql`
- Modify: `tests/server/account-role-location-schema-contract.test.ts`
- Modify: `tests/server/prisma-seed-policy.test.ts`
- Modify: `prisma/seed.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: purgeable lead rows, workflow status, idempotency, partial active dedupe, and request buckets.

- [ ] **Step 1: Add failing schema and seed assertions**

Assert:

```ts
expect(schema).toContain("enum LeadStatus");
expect(schema).toContain("retentionExpiresAt");
expect(schema).toContain("purgedAt");
expect(schema).toContain("idempotencyKeyHash");
expect(schema).toContain("model LeadSubmissionRateLimit");
expect(seedSource).not.toMatch(/lead\.(create|createMany)/);
```

- [ ] **Step 2: Run contracts**

```powershell
npx vitest run tests/server/account-role-location-schema-contract.test.ts tests/server/prisma-seed-policy.test.ts
```

Expected: FAIL on missing fields/table.

- [ ] **Step 3: Update Prisma schema**

Use:

```prisma
enum LeadStatus {
  NEW
  CONTACTED
  COMPLETED
  CLOSED
}

model Lead {
  id                String     @id @default(cuid())
  eventId           String
  userId            String?
  name              String?    @db.VarChar(120)
  phone             String?    @db.VarChar(20)
  phoneFingerprint  String?    @db.Char(64)
  currentMotorcycle String?    @db.VarChar(120)
  interestedModel   String?    @db.VarChar(120)
  preferredTime     String?    @db.VarChar(120)
  consentVersion    String?    @db.VarChar(80)
  consentAt         DateTime?
  idempotencyKeyHash String?   @unique
  status            LeadStatus @default(NEW)
  retentionExpiresAt DateTime
  exportedAt        DateTime?
  purgedAt          DateTime?
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user  User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([eventId, status, createdAt])
  @@index([retentionExpiresAt, purgedAt])
}

model LeadSubmissionRateLimit {
  keyHash         String   @id @db.Char(64)
  windowStartedAt DateTime
  attempts        Int
  updatedAt       DateTime @updatedAt

  @@index([windowStartedAt])
}
```

- [ ] **Step 4: Write data-preserving migration**

Add the enum/table/columns, make legacy required text nullable, and backfill:

```sql
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'COMPLETED', 'CLOSED');

ALTER TABLE "Lead"
  ADD COLUMN "phoneFingerprint" CHAR(64),
  ADD COLUMN "consentVersion" VARCHAR(80),
  ADD COLUMN "idempotencyKeyHash" TEXT,
  ADD COLUMN "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
  ADD COLUMN "retentionExpiresAt" TIMESTAMP(3),
  ADD COLUMN "purgedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Lead"
SET
  "consentVersion" = 'legacy-consent-v0',
  "retentionExpiresAt" = "createdAt" + INTERVAL '90 days'
WHERE "retentionExpiresAt" IS NULL;

ALTER TABLE "Lead"
  ALTER COLUMN "name" DROP NOT NULL,
  ALTER COLUMN "phone" DROP NOT NULL,
  ALTER COLUMN "currentMotorcycle" DROP NOT NULL,
  ALTER COLUMN "interestedModel" DROP NOT NULL,
  ALTER COLUMN "preferredTime" DROP NOT NULL,
  ALTER COLUMN "consentAt" DROP NOT NULL,
  ALTER COLUMN "retentionExpiresAt" SET NOT NULL;

CREATE UNIQUE INDEX "Lead_idempotencyKeyHash_key"
  ON "Lead"("idempotencyKeyHash");
CREATE UNIQUE INDEX "Lead_active_event_phone_key"
  ON "Lead"("eventId", "phoneFingerprint")
  WHERE "purgedAt" IS NULL AND "phoneFingerprint" IS NOT NULL;
CREATE INDEX "Lead_eventId_status_createdAt_idx"
  ON "Lead"("eventId", "status", "createdAt");
CREATE INDEX "Lead_retentionExpiresAt_purgedAt_idx"
  ON "Lead"("retentionExpiresAt", "purgedAt");

CREATE TABLE "LeadSubmissionRateLimit" (
  "keyHash" CHAR(64) PRIMARY KEY,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "LeadSubmissionRateLimit_windowStartedAt_idx"
  ON "LeadSubmissionRateLimit"("windowStartedAt");
```

The migration intentionally does not compute phone fingerprints for legacy rows because doing so requires the runtime secret and would retain new pseudonymous identifiers without a fresh need.

- [ ] **Step 5: Document retention setting**

Add:

```dotenv
# Test-ride lead contact retention. Defaults to 90 when unset.
LEAD_RETENTION_DAYS="90"
```

- [ ] **Step 6: Generate, test, and commit**

```powershell
npm run db:generate
npx vitest run tests/server/account-role-location-schema-contract.test.ts tests/server/prisma-seed-policy.test.ts
git add -- prisma/schema.prisma prisma/migrations/20260731170000_production_leads/migration.sql tests/server/account-role-location-schema-contract.test.ts tests/server/prisma-seed-policy.test.ts prisma/seed.ts .env.example
git commit -m "feat: persist production lead lifecycle"
```

Expected: generation/tests pass and commit succeeds.

---

### Task 3: Implement Memory Lead Submission and Access Rules

**Files:**
- Modify: `src/server/backend.ts`
- Create: `tests/server/lead-domain.test.ts`

**Interfaces:**
- Produces: all lead backend methods for memory mode.
- Consumed by: Server Actions and Prisma parity.

- [ ] **Step 1: Write failing domain tests**

Cover:

```ts
test("captures a guest lead and deduplicates an active phone per event", async () => {
  const backend = await createTambikeTestBackend();
  const actors = await createTestActors(backend, "lead-dedupe");
  const event = await createPublishedTestEvent(backend, actors, {
    type: "Test Ride",
    title: "Disposable Test Ride",
  });
  const input = validLeadInput("09171234567");

  const first = await backend.submitTestRideLead(undefined, event.id, input, {
    rateLimitKeyHash: "a".repeat(64),
    now: new Date("2026-07-31T04:00:00.000Z"),
  });
  const second = await backend.submitTestRideLead(
    actors.rider.sessionToken,
    event.id,
    { ...input, preferredTime: "Sunday afternoon", idempotencyKey: randomUUID() },
    {
      rateLimitKeyHash: "b".repeat(64),
      now: new Date("2026-07-31T04:01:00.000Z"),
    },
  );

  expect(second).toEqual({ leadId: first.leadId, updatedExisting: true });
  const page = await backend.listLeads(actors.admin.sessionToken, {
    eventId: event.id,
  });
  expect(page.total).toBe(1);
  expect(page.items[0]).toMatchObject({
    maskedPhone: "+63 ••• ••• 4567",
    preferredTime: "Sunday afternoon",
  });
});
```

Add tests proving:

- non-test-ride and non-public events reject submissions
- valid idempotency replay returns the original result
- six submissions in one 15-minute request bucket reject with `RATE_LIMITED`
- organizer sees only owned event leads
- outsider organizer cannot list/reveal/export another event's lead
- list is masked and reveal creates `LEAD_CONTACT_REVEALED`
- status update is compare-and-swap protected
- CSV includes real rows and no seeded lead
- purge clears every identifying/free-text field and remains idempotent
- purged rows are absent from operational lists but still countable for reports

- [ ] **Step 2: Run the domain test**

```powershell
npx vitest run tests/server/lead-domain.test.ts
```

Expected: FAIL because lead stores/methods do not exist.

- [ ] **Step 3: Add memory stores and error codes**

Add:

```ts
type BackendLead = {
  id: string;
  eventId: string;
  userId?: string;
  name?: string;
  phone?: string;
  phoneFingerprint?: string;
  currentMotorcycle?: string;
  interestedModel?: string;
  preferredTime?: string;
  consentVersion?: string;
  consentAt?: string;
  idempotencyKeyHash?: string;
  status: LeadStatus;
  retentionExpiresAt: string;
  exportedAt?: string;
  purgedAt?: string;
  createdAt: string;
  updatedAt: string;
};

private readonly leads = new Map<string, BackendLead>();
private readonly leadRateLimits = new Map<
  string,
  { windowStartedAt: number; attempts: number }
>();
```

Add `RATE_LIMITED` and `CONFLICT` handling to `BackendError` if not already present. Add audit actions `LEAD_CREATED`, `LEAD_UPDATED`, `LEAD_CONTACT_REVEALED`, `LEAD_STATUS_UPDATED`, `LEAD_EXPORT_CREATED`, and `LEAD_CONTACT_PURGED`.

- [ ] **Step 4: Implement submission**

Parse with `submitLeadSchema`, require an eligible event, calculate:

```ts
const retentionDays = readLeadRetentionDays(process.env);
const retentionExpiresAt = new Date(
  now.getTime() + retentionDays * 24 * 60 * 60 * 1000,
);
const phoneFingerprint = createHmac("sha256", this.leadFingerprintSecret)
  .update(`${event.id}:${parsed.phone}`)
  .digest("hex");
const idempotencyKeyHash = createHash("sha256")
  .update(parsed.idempotencyKey)
  .digest("hex");
```

Rate limit: reset a bucket after 15 minutes; reject attempt 6 and later. If the idempotency hash already exists, return that row without another rate-limit increment. If an active event/fingerprint row exists, update its submitted fields, consent, optional user link, expiry, and `updatedAt`; otherwise create. Never put phone/name in audit metadata.

- [ ] **Step 5: Implement owner/admin management**

Use one authorization helper:

```ts
private requireLeadOperator(user: BackendUser, event: Event) {
  if (user.role === "admin") return;
  if (
    user.role === "organizer" &&
    user.organizerProfileId === event.organizerId
  ) return;
  throw new BackendError("FORBIDDEN");
}
```

Lists exclude `purgedAt` rows. Reveal returns full contact only after the same authorization check and audits only lead/event IDs. Status update uses `expectedUpdatedAt`. CSV uses `encodeCsv()` and marks exported rows after building the authorized dataset.

- [ ] **Step 6: Implement idempotent purge**

For every active lead with `retentionExpiresAt <= now`, set:

```ts
lead.userId = undefined;
lead.name = undefined;
lead.phone = undefined;
lead.phoneFingerprint = undefined;
lead.currentMotorcycle = undefined;
lead.interestedModel = undefined;
lead.preferredTime = undefined;
lead.consentVersion = undefined;
lead.consentAt = undefined;
lead.idempotencyKeyHash = undefined;
lead.purgedAt = now.toISOString();
lead.updatedAt = now.toISOString();
```

Audit only aggregate purge count or lead ID, never removed values.

- [ ] **Step 7: Run and commit**

```powershell
npx vitest run tests/server/lead-domain.test.ts
git add -- src/server/backend.ts tests/server/lead-domain.test.ts
git commit -m "feat: enforce lead privacy and ownership"
```

Expected: pass and commit succeeds.

---

### Task 4: Implement Transactional Prisma Lead Operations

**Files:**
- Modify: `src/server/prisma-backend.ts`
- Create: `tests/prisma-integration/lead-management.integration.test.ts`

**Interfaces:**
- Consumes: production lead schema and memory behavior.
- Produces: Prisma parity, including concurrency and partial dedupe.

- [ ] **Step 1: Write integration coverage**

Use two event fixtures owned by different organizers. Test:

- concurrent duplicate phone submissions result in one active lead
- idempotency replay returns the same lead
- organizer A cannot list/reveal/export organizer B's lead
- admin can access both
- reveal audit metadata contains no phone/name
- status compare-and-swap rejects stale timestamp
- export marks only authorized rows
- purge clears PII and the unique active fingerprint, allowing a later fresh request
- repeated purge reports zero on the second run

- [ ] **Step 2: Run against disposable integration DB**

```powershell
npm run test:prisma:prepare
npm run test:prisma -- tests/prisma-integration/lead-management.integration.test.ts
```

Expected: FAIL until Prisma methods exist. Never substitute a remote/live URL.

- [ ] **Step 3: Implement atomic rate limiting and idempotency**

Inside a transaction:

1. Check `idempotencyKeyHash` first.
2. Upsert/read the rate bucket with a row lock.
3. Reset if older than 15 minutes; otherwise increment and reject above five.
4. Upsert the active lead by the partial unique event/fingerprint index.
5. Audit create/update with non-sensitive metadata.

Catch PostgreSQL unique-conflict `P2002`, re-read the active lead, and perform the same authorized update so concurrent submissions converge.

- [ ] **Step 4: Implement scoped reads, reveal, status, and export**

Build Prisma `where` filters from the authenticated operator:

```ts
const ownershipWhere =
  user.role === "admin"
    ? {}
    : { event: { organizer: { userId: user.id } } };
```

For organizer queries with `eventId`, verify ownership before reading. Operational lists require `purgedAt: null`. Reveal and status update run in transactions with audit creation. Export uses `encodeCsv()` and updates `exportedAt` only for selected authorized rows.

- [ ] **Step 5: Implement bulk anonymization**

Select expired IDs in bounded batches of 500 and update each batch:

```ts
await tx.lead.updateMany({
  where: { id: { in: ids }, purgedAt: null },
  data: {
    userId: null,
    name: null,
    phone: null,
    phoneFingerprint: null,
    currentMotorcycle: null,
    interestedModel: null,
    preferredTime: null,
    consentVersion: null,
    consentAt: null,
    idempotencyKeyHash: null,
    purgedAt: now,
  },
});
```

Write one aggregate `LEAD_CONTACT_PURGED` audit entry containing `{ purgedCount }`.

- [ ] **Step 6: Run parity tests and commit**

```powershell
npx vitest run tests/server/lead-domain.test.ts
npm run test:prisma -- tests/prisma-integration/lead-management.integration.test.ts
git add -- src/server/prisma-backend.ts tests/prisma-integration/lead-management.integration.test.ts
git commit -m "feat: persist scoped lead management"
```

Expected: both suites pass and commit succeeds.

---

### Task 5: Add Lead Server Actions, Exports, and Retention Job

**Files:**
- Create: `src/server/leads/lead-actions.ts`
- Modify: `src/app/api/admin/exports/leads/route.ts`
- Create: `src/app/api/organizer/events/[eventId]/exports/leads/route.ts`
- Create: `src/app/api/jobs/lead-retention/route.ts`
- Create: `tests/server/lead-actions.test.ts`
- Create: `tests/server/lead-routes.test.ts`

**Interfaces:**
- Consumes: lead backend methods and shared `ActionState<T>`.
- Produces: public submission, management actions/loaders, CSV downloads, and scheduled purge.

- [ ] **Step 1: Write action and route tests**

Test dependency-injected actions for:

- current consent required
- filled `website` honeypot returns the same generic success without backend write
- headers produce an HMAC key and raw address never reaches backend
- `RATE_LIMITED` maps to “Too many requests. Wait a few minutes and try again.”
- successful submission returns a committed lead ID
- list loader returns null for unauthorized callers
- reveal and status actions return safe structured results

Test Route Handlers with injected backend/session dependencies for 401, 403, 200 content headers, query filtering, CSV safety, invalid cron secret, and successful purge counts.

- [ ] **Step 2: Run and verify failure**

```powershell
npx vitest run tests/server/lead-actions.test.ts tests/server/lead-routes.test.ts
```

Expected: FAIL because action/routes are missing.

- [ ] **Step 3: Implement public submission action**

Use `headers()` and optional `readSessionToken()`:

```ts
const headerList = await headers();
const clientAddress =
  headerList.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
  headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  headerList.get("x-real-ip")?.trim() ||
  "local";
```

Read and length-bound the `website` field before parsing the normal lead fields. Derive an HMAC key using `SESSION_SECRET`. Never pass `clientAddress` to the backend. A filled honeypot returns:

```ts
{
  status: "success",
  code: "SUCCESS",
  message: "Your test-ride request was received.",
  data: { leadId: "accepted", updatedExisting: false },
}
```

without a write.

On real success, revalidate the event test-ride page, `/admin/leads`, and the owned organizer event page.

- [ ] **Step 4: Implement management loaders/actions**

Export:

```ts
loadLeadManagementPage(query?: LeadListQuery): Promise<LeadListPage | null>;
revealLeadContactAction(
  previous: ActionState<LeadContactView>,
  formData: FormData,
): Promise<ActionState<LeadContactView>>;
updateLeadStatusAction(
  previous: ActionState<LeadListItem>,
  formData: FormData,
): Promise<ActionState<LeadListItem>>;
```

Extend shared `ActionCode` with `"RATE_LIMITED"` and add the default message
“Too many requests. Wait a few minutes and try again.” to `actionError()`.
Use strict schemas and entity-specific message overrides where needed. Never
return raw backend errors.

- [ ] **Step 5: Implement export routes**

Admin route reads optional `eventId` and `status` query values, validates them, calls `exportLeadsCsv()`, and returns:

```ts
return new Response(csv, {
  headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": 'attachment; filename="tambike-leads.csv"',
    "cache-control": "private, no-store",
  },
});
```

Organizer route awaits `RouteContext<"/api/organizer/events/[eventId]/exports/leads">`, passes the event ID, and relies on backend ownership enforcement.

- [ ] **Step 6: Implement retention job**

Follow the existing secret-authenticated job pattern. Accept POST only, compare `Authorization: Bearer ${CRON_SECRET}` with a timing-safe comparison, invoke `purgeExpiredLeads({ now: new Date() })`, and return:

```ts
Response.json({ ok: true, purged: result.purged });
```

Never include lead IDs or contact data.

- [ ] **Step 7: Run and commit**

```powershell
npx vitest run tests/server/lead-actions.test.ts tests/server/lead-routes.test.ts
npx eslint src/features/shared/action-state.ts src/server/action-result.ts src/server/leads/lead-actions.ts src/app/api/admin/exports/leads/route.ts src/app/api/organizer/events/[eventId]/exports/leads/route.ts src/app/api/jobs/lead-retention/route.ts
git add -- src/features/shared/action-state.ts src/server/action-result.ts src/server/leads/lead-actions.ts src/app/api/admin/exports/leads/route.ts src/app/api/organizer/events/[eventId]/exports/leads/route.ts src/app/api/jobs/lead-retention/route.ts tests/server/lead-actions.test.ts tests/server/lead-routes.test.ts
git commit -m "feat: expose protected lead operations"
```

Expected: tests/lint pass and commit succeeds.

---

### Task 6: Replace Simulated Lead and Upload UI

**Files:**
- Create: `src/features/leads/test-ride-lead-form.tsx`
- Create: `src/features/leads/lead-management-table.tsx`
- Create: `src/features/leads/organizer-event-leads.tsx`
- Modify: `src/features/tambike-demo/tambike-screen.tsx`
- Modify: `src/features/admin/admin-console.tsx`
- Modify: `src/features/organizer/organizer-console.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/app/admin/leads/page.tsx`
- Modify: `src/app/events/[eventId]/test-ride/page.tsx`
- Modify: `src/app/organizer/events/[eventId]/page.tsx`
- Delete: `src/components/file-upload-06.tsx`
- Modify: `tests/server/account-role-location-route-contract.test.ts`
- Create: `tests/server/lead-ui.test.tsx`

**Interfaces:**
- Consumes: lead actions/loaders and focused view models.
- Produces: real public submission and responsive operator management.

- [ ] **Step 1: Write UI/removal contracts**

Assert:

```ts
expect(formMarkup).toContain("Request a test ride");
expect(formMarkup).toContain(TEST_RIDE_CONSENT_VERSION);
expect(formMarkup).toContain('name="website"');
expect(formMarkup).toContain('aria-live="polite"');
expect(formMarkup).not.toContain("Save lead");

expect(managementMarkup).toContain("Test-ride leads");
expect(managementMarkup).toContain("Reveal contact");
expect(managementMarkup).toContain("Export CSV");
expect(managementMarkup).toContain("+63 ••• ••• 4567");

expect(adminSource).not.toContain("ValidationSection");
expect(adminSource).not.toContain("getValidationRows");
expect(sidebarSource).not.toContain("Leads & validation");
expect(sidebarSource).not.toContain('section: "validation"');
expect(fileUploadExists).toBe(false);
```

- [ ] **Step 2: Run UI tests and verify failure**

```powershell
npx vitest run tests/server/lead-ui.test.tsx tests/server/account-role-location-route-contract.test.ts
```

Expected: FAIL on missing real components and remaining fake UI.

- [ ] **Step 3: Build the public lead form**

`TestRideLeadForm` accepts `{ eventId: string; eventTitle: string }`, creates one UUID idempotency key per mounted form, and uses `useActionState(submitTestRideLeadAction, initialState)`.

Fields:

- full name
- mobile number with `inputMode="tel"` and `autoComplete="tel"`
- current motorcycle
- interested model
- preferred time
- consent checkbox with visible version-independent user copy
- visually hidden honeypot labelled outside the accessibility tree
- hidden consent version and idempotency key

On committed success, retain a “Send another request” reset control and show “Your test-ride request was received.” Do not claim that a team has followed up.

- [ ] **Step 4: Render an honest unavailable state**

In the event test-ride route, load/validate the event. If it is missing, not public, or not type `Test Ride`, render a semantic `<h1>Test rides are not available for this event</h1>` and link back to the event. Remove `generateStaticParams()` based on `demoEvents`.

Replace `TestRideLeadScreen` local `saved` state and form body with `TestRideLeadForm`.

- [ ] **Step 5: Build responsive operator management**

`LeadManagementTable` receives an initial `LeadListPage` and optional fixed `eventId`.

- desktop: columns for name, event, masked phone, model, preferred time, status, received, expiry, actions
- below 768px: stacked cards with no minimum width
- reveal opens a dialog and fetches contact only when activated
- status action includes hidden `expectedUpdatedAt`
- filters submit query parameters and are reflected in export URLs
- no contact value is placed in the page until reveal succeeds

`OrganizerEventLeads` wraps the same component with fixed owned event ID and the organizer export URL.

- [ ] **Step 6: Replace admin validation section**

Change `AdminSection` from `"validation"` to `"leads"`. Rename sidebar label to “Test-ride leads.” Remove:

- `ValidationRow`
- `validationRows`
- `ValidationSection`
- `validationColumns`
- `getValidationRows`
- `FileUpload06` imports/usages
- overview “Data validation” card
- validation/import copy

Add `leadContent?: React.ReactNode` to `AdminConsole` and render it for section `leads` after the existing admin guard.

`src/app/admin/leads/page.tsx` loads query params, calls `loadLeadManagementPage()`, and passes `LeadManagementTable` into the shell.

- [ ] **Step 7: Add organizer event leads**

The owned event page reuses the event submission loader result. For public/operational Test Ride events, also load owner-scoped leads and pass `leadContent` into `OrganizerConsole`. Other event types render no lead panel or link.

- [ ] **Step 8: Delete the fake component**

Run:

```powershell
rg -n "FileUpload06|file-upload-06" src tests
```

Expected before deletion: no remaining active imports after Steps 3–7. Delete `src/components/file-upload-06.tsx`.

- [ ] **Step 9: Run UI tests and lint**

```powershell
npx vitest run tests/server/lead-ui.test.tsx tests/server/lead-actions.test.ts tests/server/lead-domain.test.ts tests/server/account-role-location-route-contract.test.ts
npx eslint src/features/leads/test-ride-lead-form.tsx src/features/leads/lead-management-table.tsx src/features/leads/organizer-event-leads.tsx src/features/tambike-demo/tambike-screen.tsx src/features/admin/admin-console.tsx src/features/organizer/organizer-console.tsx src/components/app-sidebar.tsx src/app/admin/leads/page.tsx src/app/events/[eventId]/test-ride/page.tsx src/app/organizer/events/[eventId]/page.tsx
```

Expected: pass.

- [ ] **Step 10: Verify with Codex browser**

With disposable local data:

1. As guest, submit a valid lead for a published Test Ride event and reload the page.
2. Repeat the same phone with changed preferred time; verify one updated admin row.
3. Open the test-ride route for a normal event; verify the unavailable state and event link.
4. As event owner, list/reveal/update/export only that event's leads.
5. As another organizer, directly open the owner route/export; verify no data access.
6. As admin, filter, reveal, change status, and export.
7. At 320px and 390x844, verify `/admin/leads` and organizer lead cards have zero page-level horizontal overflow.
8. Confirm contact numbers are masked before reveal and browser console is clean.

Do not submit or reveal lead data when localhost is connected to a remote/live database.

- [ ] **Step 11: Commit UI removal/replacement**

```powershell
git add -- src/features/leads/test-ride-lead-form.tsx src/features/leads/lead-management-table.tsx src/features/leads/organizer-event-leads.tsx src/features/tambike-demo/tambike-screen.tsx src/features/admin/admin-console.tsx src/features/organizer/organizer-console.tsx src/components/app-sidebar.tsx src/app/admin/leads/page.tsx src/app/events/[eventId]/test-ride/page.tsx src/app/organizer/events/[eventId]/page.tsx tests/server/account-role-location-route-contract.test.ts tests/server/lead-ui.test.tsx
git rm -- src/components/file-upload-06.tsx
git commit -m "fix: replace simulated lead workflows"
```

---

### Task 7: Run the Lead Slice Gate

**Files:**
- Verify only; fix only lead-related defects discovered by these gates.

- [ ] **Step 1: Run focused server tests**

```powershell
npx vitest run tests/server/lead-validation.test.ts tests/server/lead-domain.test.ts tests/server/lead-actions.test.ts tests/server/lead-routes.test.ts tests/server/lead-ui.test.tsx tests/server/account-role-location-route-contract.test.ts
```

Expected: pass.

- [ ] **Step 2: Run Prisma integration**

```powershell
npm run test:prisma -- tests/prisma-integration/lead-management.integration.test.ts
```

Expected: pass against the approved disposable database.

- [ ] **Step 3: Confirm fake behavior is gone**

```powershell
rg -n "Seeded Tambike Lead|lead@example\\.com|ValidationSection|getValidationRows|FileUpload06|Leads & validation|setSaved\\(true\\)" src
```

Expected: no matches.

- [ ] **Step 4: Run static/build gates**

```powershell
npm run db:generate
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all exit 0.
