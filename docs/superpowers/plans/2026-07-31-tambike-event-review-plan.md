# Tambike Event Review Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the complete persisted event-review lifecycle: publish, request changes, reject, organizer resubmission, published-event disablement, and restore-to-review.

**Architecture:** Store one append-only approval row per event submission version and use the event row as the current state. Memory and Prisma backends enforce the same transition matrix and optimistic concurrency contract. Focused server loaders/actions feed reason-confirmation controls in the admin review page and a reusable organizer editor in the owned event workspace.

**Tech Stack:** Next.js 16.2.11 App Router and Server Actions, React 19.2.4, TypeScript 5, Zod 4.4.3, Prisma 7.8.0, PostgreSQL, Vitest 4.1.9, Radix/shadcn UI.

## Global Constraints

- Complete the account-access plan first; this plan consumes `ActionState<T>`, `actionError()`, and account-aware role guards.
- Use the approved transitions exactly:
  - `PENDING_ADMIN_REVIEW -> PUBLISHED | NEEDS_CHANGES | REJECTED`
  - `NEEDS_CHANGES -> PENDING_ADMIN_REVIEW`
  - `PUBLISHED -> DISABLED`
  - `DISABLED -> PENDING_ADMIN_REVIEW`
- Request changes, rejection, disablement, restoration, and resubmission require meaningful reasons where specified below.
- Rejection is final for one submission; the organizer may copy its values into a new event form.
- Restore never republishes directly.
- `DISABLED` is distinct from organizer-controlled `CANCELLED`.
- Every transition is authorized, compare-and-swap protected, timestamped, and audited.
- Expected action failures are structured return values; unexpected failures throw.
- Dynamic route `params` and `searchParams` are Promises in Next.js 16.2.11 and must be awaited.
- Remove demo-data `generateStaticParams()` from database-driven operator detail routes.
- Preserve existing dirty worktree changes; never create an AI/Codex branch or worktree.
- Never mutate a remote/live database without separate explicit approval.
- Browser verification uses only the Codex browser surface; do not run Playwright.

---

## File Structure

### Create

- `src/features/admin/event-review-types.ts` — serializable review, history, and mutation contracts.
- `src/features/admin/event-review-controls.tsx` — admin reason dialogs and transition feedback.
- `src/features/organizer/event-editor-fields.tsx` — reusable controlled event fields for create/copy/resubmit.
- `src/features/organizer/event-submission-panel.tsx` — needs-changes editor, history, and rejected-copy action.
- `src/server/admin/event-review-actions.ts` — admin review loader/actions.
- `src/server/organizer/event-submission-actions.ts` — owned event loader/resubmit/copy-source actions.
- `tests/server/event-review-domain.test.ts` — memory transition matrix and audit coverage.
- `tests/server/event-review-actions.test.ts` — validation/error/revalidation contracts.
- `tests/server/event-review-ui.test.tsx` — admin and organizer semantic UI contracts.
- `tests/prisma-integration/event-review.integration.test.ts` — transactional approval-history integration coverage.
- `prisma/migrations/20260731160000_event_review_lifecycle/migration.sql` — disabled state and versioned approval history.

### Modify

- `src/features/tambike-demo/types.ts` — add `DISABLED` and expose only required concurrency fields in operator view models.
- `src/server/backend.ts` — memory approval history and lifecycle methods.
- `src/server/prisma-backend.ts` — transactional lifecycle methods.
- `src/server/actions.ts` — make legacy `approvePublishAction` use the new persisted operation; remove duplicate session helper.
- `src/features/tambike-demo/demo-provider.tsx` — retain only compatibility operations still used outside focused operator pages.
- `src/features/admin/admin-console.tsx` — remove local event overrides and accept server-loaded review content.
- `src/features/organizer/organizer-console.tsx` — reuse event fields and accept server-loaded submission content.
- `src/app/admin/events/review/[reviewId]/page.tsx` — database-backed review loader and dynamic metadata.
- `src/app/organizer/events/[eventId]/page.tsx` — owned event loader and submission panel.
- `src/app/organizer/events/create/page.tsx` — optional rejected-event copy source.
- `prisma/schema.prisma` — event disabled metadata and versioned approval relation.
- `tests/server/backend-domain.test.ts` — update approval assertions for history.
- `tests/server/account-role-location-route-contract.test.ts` — ensure no demo static params remain on operator details.
- `tests/prisma-integration/fixtures.ts` — current submission version and approval fixture.

## Interfaces

```ts
export type EventReviewDecision =
  | "PUBLISH"
  | "REQUEST_CHANGES"
  | "REJECT";

export type EventReviewHistoryItem = {
  id: string;
  submissionVersion: number;
  decision:
    | "pending"
    | "published"
    | "needs_changes"
    | "rejected";
  reviewerName?: string;
  reason?: string;
  submittedAt: string;
  decidedAt?: string;
};

export type AdminEventReviewView = {
  event: Event;
  organizerName: string;
  submissionVersion: number;
  expectedUpdatedAt: string;
  history: EventReviewHistoryItem[];
};

export type OrganizerEventSubmissionView = {
  event: Event;
  submissionVersion: number;
  expectedUpdatedAt: string;
  latestDecision?: EventReviewHistoryItem;
  history: EventReviewHistoryItem[];
};

export type ReviewEventInput = {
  decision: EventReviewDecision;
  reason?: string;
  expectedUpdatedAt: string;
};

export type EventStatusMutationInput = {
  reason: string;
  expectedUpdatedAt: string;
};

export type ResubmitEventInput = {
  event: CreateEventInput;
  reason: string;
  expectedUpdatedAt: string;
};
```

Both backends expose:

```ts
getAdminEventReview(
  sessionToken: string,
  eventId: string,
): Promise<AdminEventReviewView>;
reviewEvent(
  sessionToken: string,
  eventId: string,
  input: ReviewEventInput,
): Promise<AdminEventReviewView>;
disableEvent(
  sessionToken: string,
  eventId: string,
  input: EventStatusMutationInput,
): Promise<AdminEventReviewView>;
restoreEventToReview(
  sessionToken: string,
  eventId: string,
  input: EventStatusMutationInput,
): Promise<AdminEventReviewView>;
getOrganizerEventSubmission(
  sessionToken: string,
  eventId: string,
): Promise<OrganizerEventSubmissionView>;
resubmitEvent(
  sessionToken: string,
  eventId: string,
  input: ResubmitEventInput,
): Promise<OrganizerEventSubmissionView>;
getRejectedEventCopySource(
  sessionToken: string,
  eventId: string,
): Promise<CreateEventInput>;
```

---

### Task 1: Add Versioned Review Persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260731160000_event_review_lifecycle/migration.sql`
- Modify: `src/features/tambike-demo/types.ts`
- Modify: `tests/server/account-role-location-schema-contract.test.ts`

**Interfaces:**
- Produces: `DISABLED`, `Event.submissionVersion`, disable provenance, and unique approval versions.
- Consumed by: all lifecycle methods.

- [ ] **Step 1: Add failing schema assertions**

Add:

```ts
expect(typesSource).toMatch(/EventStatus[\s\S]*"DISABLED"/);
expect(schema).toContain("DISABLED");
expect(schema).toContain("submissionVersion");
expect(schema).toContain("disabledByUserId");
expect(schema).toContain("@@unique([eventId, submissionVersion])");
expect(schema).toContain('relation("EventDisabledBy"');
expect(schema).toContain('relation("EventReviewer"');
```

- [ ] **Step 2: Run the contract and verify failure**

```powershell
npx vitest run tests/server/account-role-location-schema-contract.test.ts
```

Expected: FAIL on the missing lifecycle fields.

- [ ] **Step 3: Update shared event status**

Add `"DISABLED"` to `EventStatus` in `src/features/tambike-demo/types.ts`. Do not remove `"CANCELLED"`.

- [ ] **Step 4: Update Prisma models**

Add to `Event`:

```prisma
submissionVersion Int       @default(1)
disabledAt       DateTime?
disabledByUserId String?
disableReason    String?    @db.VarChar(500)

disabledBy       User?      @relation("EventDisabledBy", fields: [disabledByUserId], references: [id], onDelete: SetNull)
```

Add to `User`:

```prisma
eventsDisabled User[]          @relation("EventDisabledBy")
eventReviews   EventApproval[] @relation("EventReviewer")
```

Replace `EventApproval` with:

```prisma
model EventApproval {
  id                String           @id @default(cuid())
  eventId           String
  submissionVersion Int
  reviewerId        String?
  decision          ApprovalDecision @default(pending)
  conditions        String?
  notes             String?          @db.VarChar(1000)
  submittedAt       DateTime         @default(now())
  decidedAt         DateTime?
  createdAt         DateTime         @default(now())

  event    Event @relation(fields: [eventId], references: [id], onDelete: Cascade)
  reviewer User? @relation("EventReviewer", fields: [reviewerId], references: [id], onDelete: SetNull)

  @@unique([eventId, submissionVersion])
  @@index([decision, submittedAt])
}
```

- [ ] **Step 5: Write the migration**

Use:

```sql
ALTER TYPE "EventStatus" ADD VALUE IF NOT EXISTS 'DISABLED';

ALTER TABLE "Event"
  ADD COLUMN "submissionVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "disabledAt" TIMESTAMP(3),
  ADD COLUMN "disabledByUserId" TEXT,
  ADD COLUMN "disableReason" VARCHAR(500);

ALTER TABLE "EventApproval"
  ADD COLUMN "submissionVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "eventId"
      ORDER BY COALESCE("decidedAt", "createdAt"), "id"
    ) AS version
  FROM "EventApproval"
)
UPDATE "EventApproval" approval
SET "submissionVersion" = ranked.version
FROM ranked
WHERE approval."id" = ranked."id";

UPDATE "Event" event
SET "submissionVersion" = history.latest
FROM (
  SELECT "eventId", MAX("submissionVersion") AS latest
  FROM "EventApproval"
  GROUP BY "eventId"
) history
WHERE event."id" = history."eventId";

CREATE UNIQUE INDEX "EventApproval_eventId_submissionVersion_key"
  ON "EventApproval"("eventId", "submissionVersion");
CREATE INDEX "EventApproval_decision_submittedAt_idx"
  ON "EventApproval"("decision", "submittedAt");

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_disabledByUserId_fkey"
  FOREIGN KEY ("disabledByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventApproval"
  ADD CONSTRAINT "EventApproval_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

Before adding the reviewer foreign key, remove any existing unnamed/duplicate reviewer foreign key if the generated baseline already created one. Confirm with the disposable migration database rather than editing a live database.

- [ ] **Step 6: Generate Prisma and rerun schema contracts**

```powershell
npm run db:generate
npx vitest run tests/server/account-role-location-schema-contract.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit persistence**

```powershell
git add -- prisma/schema.prisma prisma/migrations/20260731160000_event_review_lifecycle/migration.sql src/features/tambike-demo/types.ts tests/server/account-role-location-schema-contract.test.ts
git commit -m "feat: persist versioned event reviews"
```

---

### Task 2: Implement the Memory Lifecycle and Transition Matrix

**Files:**
- Create: `src/features/admin/event-review-types.ts`
- Modify: `src/server/backend.ts`
- Create: `tests/server/event-review-domain.test.ts`
- Modify: `tests/server/backend-domain.test.ts`

**Interfaces:**
- Produces: all lifecycle methods from this plan's Interfaces section for the memory backend.
- Consumed by: action tests and parity integration tests.

- [ ] **Step 1: Write the transition matrix tests**

Create `tests/server/event-review-domain.test.ts` with these core cases:

```ts
test.each([
  ["PUBLISH", "PUBLISHED", "ADMIN_PUBLISHED"],
  ["REQUEST_CHANGES", "NEEDS_CHANGES", "EVENT_CHANGES_REQUESTED"],
  ["REJECT", "REJECTED", "EVENT_REJECTED"],
] as const)(
  "%s persists the expected decision and audit",
  async (decision, status, auditAction) => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, `review-${decision}`);
    const event = await backend.createEventDraft(
      actors.organizer.sessionToken,
      validDraftInput,
    );
    const view = await backend.getAdminEventReview(
      actors.admin.sessionToken,
      event.id,
    );

    const result = await backend.reviewEvent(
      actors.admin.sessionToken,
      event.id,
      {
        decision,
        reason:
          decision === "PUBLISH"
            ? undefined
            : "A clear event review reason for the organizer.",
        expectedUpdatedAt: view.expectedUpdatedAt,
      },
    );

    expect(result.event.status).toBe(status);
    expect(result.history.at(-1)).toMatchObject({
      submissionVersion: 1,
      decision:
        decision === "PUBLISH"
          ? "published"
          : decision === "REQUEST_CHANGES"
            ? "needs_changes"
            : "rejected",
    });
    await expect(backend.auditCount(auditAction)).resolves.toBe(1);
  },
);
```

Add tests proving:

- non-admin review is forbidden
- reason is required for changes/reject
- stale `expectedUpdatedAt` returns `CONFLICT`
- a second decision on the same version returns `CONFLICT`
- organizer can edit/resubmit only `NEEDS_CHANGES`
- resubmission increments the version and creates a new pending history item
- published disable blocks new RSVP
- restore creates a new pending version and never republishes
- `CANCELLED` is not treated as `DISABLED`
- rejected event copy source is owner-only and returns editable values without IDs/status

- [ ] **Step 2: Run the domain test and verify failure**

```powershell
npx vitest run tests/server/event-review-domain.test.ts
```

Expected: FAIL because the review contracts and methods do not exist.

- [ ] **Step 3: Add serializable review contracts**

Create `src/features/admin/event-review-types.ts` using the exact interfaces from this plan. Import `CreateEventInput` and `Event` as types only.

- [ ] **Step 4: Add memory approval records**

Add:

```ts
type BackendEventApproval = EventReviewHistoryItem & {
  eventId: string;
  reviewerId?: string;
};

private readonly eventApprovals = new Map<string, BackendEventApproval[]>();
private readonly eventUpdatedAt = new Map<string, string>();
private readonly eventSubmissionVersions = new Map<string, number>();
```

When `createEventDraft()` creates a `PENDING_ADMIN_REVIEW` event:

```ts
const submittedAt = new Date().toISOString();
this.eventUpdatedAt.set(event.id, submittedAt);
this.eventSubmissionVersions.set(event.id, 1);
this.eventApprovals.set(event.id, [{
  id: `event-approval-${randomUUID()}`,
  eventId: event.id,
  submissionVersion: 1,
  decision: "pending",
  submittedAt,
}]);
```

- [ ] **Step 5: Implement review, disable, restore, and resubmit**

Use one transition helper:

```ts
private requireEventStatus(event: Event, allowed: EventStatus[]) {
  if (!allowed.includes(event.status)) {
    throw new BackendError("CONFLICT");
  }
}

private requireExpectedEventUpdate(eventId: string, expected: string) {
  if (this.eventUpdatedAt.get(eventId) !== expected) {
    throw new BackendError("CONFLICT");
  }
}
```

`reviewEvent()` must:

- require admin
- require `PENDING_ADMIN_REVIEW`
- compare `expectedUpdatedAt`
- require a 10–1000 character reason for changes/reject
- update the current pending history item rather than replacing it
- set status to `PUBLISHED`, `NEEDS_CHANGES`, or `REJECTED`
- set reviewer name, reason, and `decidedAt`
- update the event timestamp
- create the corresponding audit
- create an organizer notification for changes/reject

`resubmitEvent()` must:

- require the owning approved organizer
- require `NEEDS_CHANGES`
- parse the full event input with existing location/schedule validation
- require a 10–500 character organizer resubmission note
- update editable fields and set `PENDING_ADMIN_REVIEW`
- increment `submissionVersion`
- append a pending history item
- audit `EVENT_RESUBMITTED`

`disableEvent()` requires admin and `PUBLISHED`; it stores reason/provenance in the memory event metadata, changes status to `DISABLED`, and audits `EVENT_DISABLED`.

`restoreEventToReview()` requires admin and `DISABLED`; it clears disable metadata, changes to `PENDING_ADMIN_REVIEW`, increments the submission version, appends pending history, and audits `EVENT_RESTORED_TO_REVIEW`.

Add all new actions to `AuditAction` and make `approvePublish()` call `reviewEvent()` with `PUBLISH` for compatibility.

- [ ] **Step 6: Ensure public operations reject disabled events**

Update event discovery/registration predicates so:

```ts
const publicStatuses: EventStatus[] = ["PUBLISHED", "ONGOING", "COMPLETED"];
```

`DISABLED` must be absent from public listings and `registerForEvent()` must reject it with `CONFLICT` or the existing closed-registration code. Existing RSVPs, passes, check-ins, and reports remain readable to authorized operators.

- [ ] **Step 7: Run memory lifecycle tests**

```powershell
npx vitest run tests/server/event-review-domain.test.ts tests/server/backend-domain.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit the memory lifecycle**

```powershell
git add -- src/features/admin/event-review-types.ts src/server/backend.ts tests/server/event-review-domain.test.ts tests/server/backend-domain.test.ts
git commit -m "feat: enforce event review lifecycle"
```

---

### Task 3: Implement Transactional Prisma Event Review

**Files:**
- Modify: `src/server/prisma-backend.ts`
- Modify: `tests/prisma-integration/fixtures.ts`
- Create: `tests/prisma-integration/event-review.integration.test.ts`

**Interfaces:**
- Consumes: lifecycle schema and contracts.
- Produces: Prisma parity under concurrent writes.

- [ ] **Step 1: Extend the shared Prisma fixture**

For the fixture's published event, set `submissionVersion: 1` and create an approval row:

```ts
await tx.eventApproval.create({
  data: {
    id: `integration-event-approval-${suffix}`,
    eventId,
    submissionVersion: 1,
    reviewerId: adminId,
    decision: "published",
    submittedAt: new Date(),
    decidedAt: new Date(),
  },
});
```

- [ ] **Step 2: Write integration tests**

Create tests that:

1. Create a pending event using the backend.
2. Request changes and assert the approval row, reason, audit, and event status commit together.
3. Resubmit as owner and assert version 2 pending.
4. Race two review calls with the same `expectedUpdatedAt`; assert exactly one succeeds.
5. Publish, disable, and restore; assert restore ends pending version 2/3 rather than published.
6. Attempt every operation as outsider and assert no row changes.

Use raw Prisma reads after each backend call.

- [ ] **Step 3: Run against the disposable database**

```powershell
npm run test:prisma:prepare
npm run test:prisma -- tests/prisma-integration/event-review.integration.test.ts
```

Expected: FAIL because the Prisma lifecycle is not implemented. Stop if the database is not the approved disposable integration database.

- [ ] **Step 4: Implement transactional review**

Inside one `prisma.$transaction()`:

```ts
const changed = await tx.event.updateMany({
  where: {
    id: eventId,
    status: "PENDING_ADMIN_REVIEW",
    updatedAt: expectedUpdatedAt,
  },
  data: { status: nextStatus },
});
if (changed.count !== 1) throw new BackendError("CONFLICT");

const approval = await tx.eventApproval.updateMany({
  where: {
    eventId,
    submissionVersion: event.submissionVersion,
    decision: "pending",
  },
  data: {
    reviewerId: admin.id,
    decision: dbDecision,
    notes: reason ?? null,
    decidedAt: now,
  },
});
if (approval.count !== 1) throw new BackendError("CONFLICT");
```

Create the audit and organizer notification in the same transaction. Re-read and return the focused view.

- [ ] **Step 5: Implement transactional resubmit/disable/restore**

Use `updateMany` predicates for expected status and timestamp. Resubmit and restore increment `submissionVersion` and create a new pending `EventApproval` inside the same transaction. Disable stores `disabledAt`, `disabledByUserId`, and `disableReason`; restore clears them.

Make `approvePublish()` delegate to `reviewEvent()` after loading the current expected timestamp so existing callers remain valid.

- [ ] **Step 6: Run memory and Prisma parity tests**

```powershell
npx vitest run tests/server/event-review-domain.test.ts
npm run test:prisma -- tests/prisma-integration/event-review.integration.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit Prisma lifecycle**

```powershell
git add -- src/server/prisma-backend.ts tests/prisma-integration/fixtures.ts tests/prisma-integration/event-review.integration.test.ts
git commit -m "feat: transact event review decisions"
```

---

### Task 4: Add Focused Review and Resubmission Actions

**Files:**
- Create: `src/server/admin/event-review-actions.ts`
- Create: `src/server/organizer/event-submission-actions.ts`
- Modify: `src/server/actions.ts`
- Create: `tests/server/event-review-actions.test.ts`

**Interfaces:**
- Consumes: `ActionState<T>`, `actionError()`, required session reader, and backend lifecycle methods.
- Produces: page loaders and Server Actions for admin and organizer UIs.

- [ ] **Step 1: Write validation and error-mapping tests**

Test these exact rules:

```ts
expect(reviewSchema.safeParse({
  eventId: "event-1",
  decision: "REQUEST_CHANGES",
  reason: "",
  expectedUpdatedAt: "2026-07-31T03:00:00.000Z",
}).success).toBe(false);

expect(reviewSchema.safeParse({
  eventId: "event-1",
  decision: "PUBLISH",
  expectedUpdatedAt: "2026-07-31T03:00:00.000Z",
}).success).toBe(true);
```

Also test safe `CONFLICT`, `FORBIDDEN`, and success results; verify affected path strings.

- [ ] **Step 2: Run the test and verify failure**

```powershell
npx vitest run tests/server/event-review-actions.test.ts
```

Expected: FAIL because the action modules do not exist.

- [ ] **Step 3: Implement admin actions**

Export:

```ts
loadAdminEventReviewForPage(eventId: string):
  Promise<AdminEventReviewView | null>;
reviewEventAction(
  previous: ActionState<AdminEventReviewView>,
  formData: FormData,
): Promise<ActionState<AdminEventReviewView>>;
disableEventAction(...): Promise<ActionState<AdminEventReviewView>>;
restoreEventAction(...): Promise<ActionState<AdminEventReviewView>>;
```

Use strict Zod schemas. On success revalidate:

```ts
revalidatePath(`/admin/events/review/${eventId}`);
revalidatePath("/admin/events/review");
revalidatePath(`/events/${eventId}`);
revalidatePath(`/organizer/events/${eventId}`);
```

Pass event-specific overrides to `actionError()`: a conflict says the event
changed in another session, and a missing record says the event is no longer
available. Keep the shared authentication/input messages unchanged.

- [ ] **Step 4: Implement organizer actions**

Export:

```ts
loadOrganizerEventSubmissionForPage(eventId: string):
  Promise<OrganizerEventSubmissionView | null>;
loadRejectedEventCopySource(eventId: string):
  Promise<CreateEventInput | null>;
resubmitEventAction(
  previous: ActionState<OrganizerEventSubmissionView>,
  formData: FormData,
): Promise<ActionState<OrganizerEventSubmissionView>>;
```

Parse the full event form with the same location/schedule parser used by creation. On success revalidate the organizer event, admin queue, and public event path.

- [ ] **Step 5: Update legacy publish action**

Change `approvePublishAction()` to use the new persisted backend method and return only the updated event/review result needed by any remaining caller. Remove the private `readRequiredSessionToken()` from `src/server/actions.ts` and import the shared helper.

- [ ] **Step 6: Run actions and lint**

```powershell
npx vitest run tests/server/event-review-actions.test.ts
npx eslint src/server/admin/event-review-actions.ts src/server/organizer/event-submission-actions.ts src/server/actions.ts tests/server/event-review-actions.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit actions**

```powershell
git add -- src/server/admin/event-review-actions.ts src/server/organizer/event-submission-actions.ts src/server/actions.ts tests/server/event-review-actions.test.ts
git commit -m "feat: expose event review actions"
```

---

### Task 5: Replace Local Event Overrides with Review Controls

**Files:**
- Create: `src/features/admin/event-review-controls.tsx`
- Create: `src/features/organizer/event-editor-fields.tsx`
- Create: `src/features/organizer/event-submission-panel.tsx`
- Modify: `src/features/admin/admin-console.tsx`
- Modify: `src/features/organizer/organizer-console.tsx`
- Modify: `src/features/tambike-demo/demo-provider.tsx`
- Modify: `src/app/admin/events/review/[reviewId]/page.tsx`
- Modify: `src/app/organizer/events/[eventId]/page.tsx`
- Modify: `src/app/organizer/events/create/page.tsx`
- Modify: `tests/server/account-role-location-route-contract.test.ts`
- Create: `tests/server/event-review-ui.test.tsx`

**Interfaces:**
- Consumes: focused loaders/actions and event review view models.
- Produces: persistent admin decisions and organizer resubmission UI.

- [ ] **Step 1: Write UI and route contracts**

Assert:

```ts
expect(adminMarkup).toContain("Approve and publish");
expect(adminMarkup).toContain("Request changes");
expect(adminMarkup).toContain("Reject submission");
expect(adminMarkup).toContain("Disable event");
expect(adminMarkup).toContain('name="reason"');
expect(adminMarkup).toContain('aria-live="polite"');

expect(organizerMarkup).toContain("Changes requested");
expect(organizerMarkup).toContain("Update and resubmit");
expect(organizerMarkup).toContain("Review history");

expect(adminConsoleSource).not.toContain("eventStatusOverrides");
expect(adminRouteSource).not.toContain("generateStaticParams");
expect(organizerRouteSource).not.toContain("demoEvents");
```

- [ ] **Step 2: Run UI contracts and verify failure**

```powershell
npx vitest run tests/server/event-review-ui.test.tsx tests/server/account-role-location-route-contract.test.ts
```

Expected: FAIL on missing components and local overrides.

- [ ] **Step 3: Extract reusable event fields**

Move the existing create form fields from `CreateEventSection` into:

```ts
type EventEditorFieldsProps = {
  idPrefix: string;
  defaults?: Partial<CreateEventInput>;
  disabled?: boolean;
};
```

Every `id` is prefixed, while field `name` values remain the `CreateEventInput` keys. The create page uses no defaults unless a validated rejected-event copy source is present. The resubmit panel uses the owned event values.

- [ ] **Step 4: Build admin transition dialogs**

`EventReviewControls` accepts:

```ts
type EventReviewControlsProps = {
  initialView: AdminEventReviewView;
};
```

Render only actions legal for the current status:

- pending: approve, request changes, reject
- published: disable
- disabled: restore to review
- needs changes/rejected: decision summary and back link

Request changes, reject, disable, and restore use separate dialog labels and required reason fields. Approve uses a confirmation dialog without a reason. Every form sends `eventId` and `expectedUpdatedAt`, disables while pending, and replaces local view data only from a successful server result.

- [ ] **Step 5: Build organizer resubmission/copy UI**

For `NEEDS_CHANGES`, render the latest admin reason, reusable fields, a required 10–500 character “What changed?” note, and “Update and resubmit.”

For `REJECTED`, show the final reason and a link:

```tsx
<Link href={`/organizer/events/create?copy=${view.event.id}`}>
  Create a new event from these details
</Link>
```

For pending/published/disabled states, show history without editable controls.

- [ ] **Step 6: Wire server-loaded routes**

Use awaited params:

```tsx
export async function generateMetadata(
  props: PageProps<"/admin/events/review/[reviewId]">,
) {
  const { reviewId } = await props.params;
  const view = await loadAdminEventReviewForPage(reviewId);
  return {
    title: view ? `Review ${view.event.title}` : "Event review",
    description: "Review a Tambike event submission.",
  };
}
```

The page loads the same focused view and passes `eventReviewContent` into `AdminConsole`. Remove `generateStaticParams()`.

The organizer event page loads `OrganizerEventSubmissionView` and passes `submissionContent` into `OrganizerConsole`.

The create page awaits `searchParams`, validates a single `copy` string, loads the owner-only copy source, and supplies it as event-form defaults.

- [ ] **Step 7: Remove local event status behavior**

Delete `eventStatusOverrides`, `setEventStatus`, and every `onSetStatus` path from `admin-console.tsx`. Remove `adminDecision` compatibility UI when no longer needed. Remove `approvePublish` from `DemoProvider` after all call sites use the focused actions.

- [ ] **Step 8: Run UI/domain tests and lint**

```powershell
npx vitest run tests/server/event-review-ui.test.tsx tests/server/event-review-actions.test.ts tests/server/event-review-domain.test.ts tests/server/account-role-location-route-contract.test.ts
npx eslint src/features/admin/event-review-controls.tsx src/features/organizer/event-editor-fields.tsx src/features/organizer/event-submission-panel.tsx src/features/admin/admin-console.tsx src/features/organizer/organizer-console.tsx src/app/admin/events/review/[reviewId]/page.tsx src/app/organizer/events/[eventId]/page.tsx src/app/organizer/events/create/page.tsx
```

Expected: pass.

- [ ] **Step 9: Verify lifecycle with Codex browser**

Using disposable local data:

1. Organizer creates a valid event.
2. Admin requests changes with a reason; reload and verify it persists.
3. Organizer edits and resubmits; reload both organizer and admin views.
4. Admin publishes; verify public discovery appears.
5. Admin disables with a reason; verify the public event disappears and new RSVP is blocked.
6. Admin restores; verify it returns to the queue and stays non-public until approved again.
7. Reject a separate disposable submission; verify it cannot be resubmitted but its values can prefill the new-event form.
8. Repeat an admin decision from a stale tab and verify a conflict message.
9. Check 320px, 390x844, tablet, and desktop layouts and browser console output.

Do not perform mutations if localhost points at a remote/live database.

- [ ] **Step 10: Commit the lifecycle UI**

```powershell
git add -- src/features/admin/event-review-controls.tsx src/features/organizer/event-editor-fields.tsx src/features/organizer/event-submission-panel.tsx src/features/admin/admin-console.tsx src/features/organizer/organizer-console.tsx src/features/tambike-demo/demo-provider.tsx src/app/admin/events/review/[reviewId]/page.tsx src/app/organizer/events/[eventId]/page.tsx src/app/organizer/events/create/page.tsx tests/server/account-role-location-route-contract.test.ts tests/server/event-review-ui.test.tsx
git commit -m "fix: persist event review controls"
```

---

### Task 6: Run the Event-Review Slice Gate

**Files:**
- Verify only; change only event-review files when a gate exposes a defect.

- [ ] **Step 1: Run focused tests**

```powershell
npx vitest run tests/server/event-review-domain.test.ts tests/server/event-review-actions.test.ts tests/server/event-review-ui.test.tsx tests/server/backend-domain.test.ts tests/server/account-role-location-route-contract.test.ts
```

Expected: pass.

- [ ] **Step 2: Run Prisma integration**

```powershell
npm run test:prisma -- tests/prisma-integration/event-review.integration.test.ts
```

Expected: pass on the approved disposable database.

- [ ] **Step 3: Run static and build gates**

```powershell
npm run db:generate
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all exit 0.

- [ ] **Step 4: Confirm no local-only event controls remain**

```powershell
rg -n "eventStatusOverrides|setEventStatus|onSetStatus\\(event" src
```

Expected: no matches.
