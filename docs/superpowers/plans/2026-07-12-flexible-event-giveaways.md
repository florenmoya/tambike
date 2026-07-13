# Flexible Event Raffles and Giveaways Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully configurable, event-scoped raffle and giveaway system with secure eligibility, auditable selection, staff fulfilment, privacy-safe rider views, and admin compliance control.

**Architecture:** Keep the existing display-only `Perk` and `PerkRedemption` domain unchanged. Add a separate `EventGiveaway` aggregate with versioned eligibility rules, materialized entries, an immutable lock snapshot, prize-item inventory, draw and replacement history, award claims, and a tamper-evident audit ledger. Implement the same domain contract in the in-memory and Prisma backends; server actions and role-specific workspaces consume scoped DTOs rather than placing candidate data in the global demo snapshot.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7 with PostgreSQL and `@prisma/adapter-pg`, Vitest, Zod, Node `crypto`, qrcode.react, existing in-app Codex browser verification.

## Global Constraints

- This intentionally overrides the prior MVP non-goal for automated raffles in `tambike-platform-mvp-requirements-ui-wireflow.md`; every operational campaign requires organizer attestation and admin compliance approval.
- The platform records mechanics, terms, evidence, and operations. It does not certify permits, calculate prize tax, handle paid entries, or make a jurisdictional legal determination.
- Existing `Perk(type = "Raffle")` records remain display-only. Do not backfill them into operational campaigns.
- A confirmed check-in may create an entry only when the configured campaign rule allows it. It must never automatically fulfil a prize or redeem a limited perk.
- Pending self-review check-ins are ineligible until a staff scan confirms them.
- All event-owner, venue-owner, admin, rider, and suspended-account checks run server-side in both backend implementations.
- Candidate lists, raw identifiers, emails, phones, source evidence, unrevealed entropy, and audit payloads never enter public or rider DTOs.
- All random selection uses Node CSPRNG and a committed deterministic ranking algorithm; do not use `Math.random`.
- Freeze, draw, redraw, award verification, and fulfilment must be transactional and idempotent. Prisma operations lock the `EventGiveaway` row and use database constraints as the final concurrency guard.
- The giveaway audit history is append-only and retained. Events with giveaway history are cancelled/retained rather than silently deleted.
- Preserve current QR camera, QR-image upload, and manual-token fallback. Prize claiming uses a distinct scanner action and never calls the attendance mutation.
- Never run `npm run db:seed` or `prisma migrate reset --force` against a persistent or production database. Production migration uses `npx prisma migrate deploy`.
- Use the Codex in-app browser for browser checks. Do not use Playwright for browser verification.

---

## Product contract

### Campaign dimensions

Each `EventGiveaway` stores:

- Campaign label: `raffle` or `giveaway`.
- Entry mode: `automatic`, `opt_in`, `claim_code`, or `manual_only`.
- Eligibility sources: going RSVP with active pass, confirmed check-in, staff-confirmed check-in, prior perk redemption, manual entry, or an authenticated campaign-code claim.
- Entry limit: one or weighted entries per rider, with every increment represented by an entry-event ledger row.
- Prize-pool award modes: random draw, guaranteed, first come, or manual selection.
- Event timing: manual or scheduled entry opening, close, lock, draw, verification deadline, and claim deadline, stored as UTC instants with an IANA campaign time zone for display.
- Winner verification: none, staff presence verification, or staff QR/manual claim verification.
- Public visibility: event-page mechanics, registered-rider mechanics, eligible-rider mechanics, or hidden campaign.
- Compliance state: draft, pending review, approved, changes requested, rejected, suspended.

### Lifecycle

~~~text
draft -> pending_compliance_review -> approved -> scheduled -> open
open -> locked -> drawing -> claims_open -> completed

draft | pending_compliance_review | approved | scheduled | open -> cancelled
approved | scheduled | open | locked | claims_open -> suspended
~~~

Configuration edits after the first entry, lock, or draw do not mutate prior mechanics. They create a new mechanics version, clear the approval, and require a new admin approval before reopening.

### Draw protocol

1. Lock creates an immutable snapshot of canonical candidate entries and their weights.
2. Lock creates 32 CSPRNG bytes, persists only the SHA-256 commitment in normal fields/audit metadata, and encrypts the seed with `GIVEAWAY_DRAW_ENCRYPTION_KEY`.
3. Draw ranks every candidate unit with `HMAC-SHA-256(seed, giveawayId + snapshotEntryId + unit)`.
4. The backend allocates available prize items in the persisted rank order, honoring max-wins and pool-specific exclusion rules.
5. Results, rank digest, algorithm version, and audit events commit atomically.
6. Publication reveals the seed and a non-PII verification payload. A redraw preserves the original award and consumes the next valid rank, never rerolling or overwriting history.

## File Structure

| Path | Responsibility |
| --- | --- |
| `docs/superpowers/specs/2026-07-12-flexible-event-giveaways-design.md` | Approved product design, lifecycle, roles, privacy, and fairness contract. |
| `tambike-platform-mvp-requirements-ui-wireflow.md` | Records the intentional scope expansion and the mandatory campaign compliance gate. |
| `prisma/schema.prisma` | Event giveaway aggregate, enums, foreign keys, retention relationships, and indexes declared through Prisma. |
| `prisma/migrations/20260712060000_flexible_event_giveaways/migration.sql` | Additive PostgreSQL migration, partial indexes, audit immutability trigger, and retention constraints. |
| `prisma/seed.ts` | Synthetic campaign fixtures and child-first cleanup order. |
| `src/features/giveaways/types.ts` | Shared safe DTOs, input contracts, enums, and action result codes. |
| `src/features/giveaways/validation.ts` | Zod validation and lifecycle transition matrix. |
| `src/server/giveaways/eligibility.ts` | Server-only candidate evaluation, entry ledger calculation, and snapshot materialization helpers. |
| `src/server/giveaways/draw-engine.ts` | CSPRNG commitment, seed encryption, deterministic ranking, and verification payload construction. |
| `src/server/giveaways/audit.ts` | Canonical audit payload serialization and hash-chain calculation. |
| `src/server/backend.ts` | In-memory implementation of every giveaway operation for development and Vitest parity. |
| `src/server/prisma-backend.ts` | Prisma implementation with locks, transactions, idempotency, and scoped queries. |
| `src/server/actions.ts` | Cookie-session server actions and user-safe error mapping. |
| `src/app/api/jobs/giveaway-lifecycle/route.ts` | Secret-protected idempotent scheduled open/lock/draw-expiry processing. |
| `src/app/api/admin/exports/giveaways/[eventId]/route.ts` | Admin-only private CSV export with formula escaping and audit. |
| `src/features/giveaways/giveaway-workspace.tsx` | Organizer campaign builder, preview, state controls, draw review, and audit timeline. |
| `src/features/giveaways/giveaway-compliance-review.tsx` | Admin compliance review, suspension, reasoned void, and export controls. |
| `src/features/giveaways/giveaway-claim-panel.tsx` | Staff camera/upload/manual award verification and fulfilment panel. |
| `src/features/giveaways/rider-giveaway-status.tsx` | Rider-only entry, win, terms, and claim presentation. |
| `src/app/organizer/events/[eventId]/giveaways/page.tsx` | Organizer giveaway workspace route. |
| `src/app/venue/events/[eventId]/giveaways/page.tsx` | Venue/staff fulfilment route. |
| `src/app/admin/giveaways/page.tsx` | Admin campaign review list. |
| `src/app/admin/giveaways/[eventId]/page.tsx` | Admin event giveaway detail and audit route. |
| `src/app/giveaway-claims/[token]/page.tsx` | Login-required rider award claim QR route. |
| `tests/server/giveaway-domain.test.ts` | Memory-backend authorization, eligibility, lifecycle, and privacy tests. |
| `tests/server/giveaway-draw-engine.test.ts` | Pure deterministic ranking, commitment, and verification tests. |
| `tests/server/giveaway-prisma.integration.test.ts` | Disposable-Postgres two-client row-lock and uniqueness tests. |
| `tests/server/giveaway-export.test.ts` | Export authorization, data minimization, escaping, headers, and audit tests. |

---

### Task 1: Establish the product and compliance contract

**Files:**
- Modify: `tambike-platform-mvp-requirements-ui-wireflow.md:90-99, 171-179, 211-219, 240-248, 542-556, 659-668`
- Create: `docs/superpowers/specs/2026-07-12-flexible-event-giveaways-design.md`
- Test: `tests/server/giveaway-domain.test.ts`

**Interfaces:**
- Produces the required policy: every `EventGiveaway` starts in `draft`, requires organizer attestation, and requires `complianceStatus = approved` before operational states.
- Produces the user-visible restrictions used by the backend validation and UI.

- [ ] **Step 1: Write failing policy tests**

~~~ts
test("does not open a campaign before admin compliance approval", async () => {
  const { organizer, giveaway } = await createDraftGiveaway();

  await expect(
    backend.openGiveaway(organizer.sessionToken, giveaway.id),
  ).rejects.toThrow("GIVEAWAY_NOT_APPROVED");
});

test("does not transform a display-only raffle perk into a campaign", async () => {
  const event = await backend.getEvent("swabz-classic-bike-tambike");

  expect(event.perks.some((perk) => perk.type === "Raffle")).toBe(true);
  expect(await backend.listGiveawaysForEvent(event.id)).toEqual([]);
});
~~~

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npx vitest run tests/server/giveaway-domain.test.ts`  
Expected: FAIL because giveaway operations and DTOs do not exist.

- [ ] **Step 3: Update the requirements document and preserve the design specification**

Replace the automated-raffle non-goal with an operational-giveaway scope-expansion section that requires:

~~~md
Automated event giveaways are allowed only through the verified Event Giveaway workflow.
The organizer must provide mechanics, terms, prize inventory, claim deadline, sponsor disclosure,
and an attestation of responsibility. Admin approval is required before entry opening, draw,
or fulfilment. Tambike records and audits the process but does not validate permits, taxes,
or jurisdictional legality.
~~~

Keep `docs/superpowers/specs/2026-07-12-flexible-event-giveaways-design.md` as the canonical product contract. Do not alter existing display-only `Perk` behavior.

- [ ] **Step 4: Run the focused test after wiring the minimum compliance guard**

Run: `npx vitest run tests/server/giveaway-domain.test.ts -t "does not open"`  
Expected: PASS after Task 4 adds the backend transition guard.

- [ ] **Step 5: Commit the isolated documentation contract**

~~~powershell
git add tambike-platform-mvp-requirements-ui-wireflow.md docs/superpowers/specs/2026-07-12-flexible-event-giveaways-design.md
git commit -m "docs: define audited event giveaway policy"
~~~

### Task 2: Define safe giveaway contracts, validation, and deterministic draw primitives

**Files:**
- Create: `src/features/giveaways/types.ts`
- Create: `src/features/giveaways/validation.ts`
- Create: `src/server/giveaways/draw-engine.ts`
- Create: `src/server/giveaways/audit.ts`
- Test: `tests/server/giveaway-draw-engine.test.ts`

**Interfaces:**
- Consumes the product contract from Task 1.
- Produces validated creation/update inputs, safe public/rider/operator/admin DTOs, lifecycle errors, and a pure deterministic draw engine for both backends.

- [ ] **Step 1: Write failing draw-engine tests**

~~~ts
import { createSeedCommitment, rankSnapshotEntries } from "@/server/giveaways/draw-engine";

test("ranks the same frozen weighted entries identically for the same seed", () => {
  const seed = Buffer.alloc(32, 7);
  const entries = [
    { id: "entry-a", ordinal: 1, weight: 1 },
    { id: "entry-b", ordinal: 2, weight: 2 },
  ];

  expect(rankSnapshotEntries("giveaway-1", entries, seed)).toEqual(
    rankSnapshotEntries("giveaway-1", entries, seed),
  );
  expect(createSeedCommitment(seed)).toMatch(/^[a-f0-9]{64}$/);
});

test("never includes raw seed bytes in the public verification payload", () => {
  const payload = buildPublicDrawVerificationPayload({
    giveawayId: "giveaway-1",
    snapshotDigest: "snapshot",
    algorithmVersion: "hmac-sha256-v1",
    revealedSeed: Buffer.alloc(32, 9),
  });

  expect(JSON.stringify(payload)).not.toContain("090909");
});
~~~

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npx vitest run tests/server/giveaway-draw-engine.test.ts`  
Expected: FAIL because the draw modules do not exist.

- [ ] **Step 3: Create the shared contracts and lifecycle matrix**

Use the following exact public contract shape. Keep candidate and audit records out of public and rider DTOs.

~~~ts
export type GiveawayKind = "raffle" | "giveaway";
export type GiveawayState =
  | "draft" | "scheduled" | "open" | "locked" | "drawing"
  | "claims_open" | "completed" | "cancelled" | "suspended";
export type GiveawayComplianceStatus =
  | "draft" | "pending_review" | "approved" | "changes_requested" | "rejected";
export type GiveawayEntryMode = "automatic" | "opt_in" | "claim_code" | "manual_only";
export type GiveawayEligibilitySource =
  | "going_rsvp" | "active_pass" | "confirmed_check_in"
  | "staff_confirmed_check_in" | "perk_redemption" | "manual";
export type GiveawayAwardMode = "random_draw" | "guaranteed" | "first_come" | "manual_selection";

export interface GiveawayEligibilityRuleInput {
  source: GiveawayEligibilitySource;
  enabled: boolean;
  multiplier: number;
  startsAt?: string;
  endsAt?: string;
  perkId?: string;
}

export interface CreateGiveawayInput {
  title: string;
  kind: GiveawayKind;
  entryMode: GiveawayEntryMode;
  rules: GiveawayEligibilityRuleInput[];
  maxEntriesPerRider: number;
  maxWinsPerRider: number;
  entryOpensAt?: string;
  entryClosesAt?: string;
  drawAt?: string;
  claimDeadlineAt?: string;
  timeZone: string;
  mechanics: string;
  terms: string;
  sponsorDisclosure?: string;
  requiresPresenceVerification: boolean;
  publicVisibility: "event_page" | "registered_riders" | "eligible_riders" | "hidden";
  organizerAttestation: true;
}

export interface PublicGiveawaySummary {
  id: string;
  title: string;
  kind: GiveawayKind;
  state: GiveawayState;
  mechanics: string;
  termsVersion: number;
  prizes: Array<{ title: string; quantity: number; awardMode: GiveawayAwardMode }>;
}
~~~

Validate this with Zod. Reject zero/negative multipliers, no enabled rules, invalid IANA time zone, invalid date ordering, missing mechanics/terms/attestation, and unsupported award-mode combinations before backend work begins.

Implement `draw-engine.ts` with `randomBytes`, `createHash`, `createHmac`, and AES-256-GCM encryption/decryption using a base64 32-byte `GIVEAWAY_DRAW_ENCRYPTION_KEY`. Use a canonical JSON serializer in `audit.ts` so hash-chain input is stable across both backends.

- [ ] **Step 4: Run pure-module tests**

Run: `npx vitest run tests/server/giveaway-draw-engine.test.ts`  
Expected: PASS with deterministic rank, valid commitment, encrypted pre-draw seed, and safe verification payload coverage.

- [ ] **Step 5: Commit the isolated contracts**

~~~powershell
git add src/features/giveaways/types.ts src/features/giveaways/validation.ts src/server/giveaways/draw-engine.ts src/server/giveaways/audit.ts tests/server/giveaway-draw-engine.test.ts
git commit -m "feat: add giveaway contracts and draw engine"
~~~

### Task 3: Persist the immutable giveaway aggregate and seed safe fixtures

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260712060000_flexible_event_giveaways/migration.sql`
- Modify: `prisma/seed.ts:42-58,156-190`
- Modify: `src/server/backend.ts:216-258`
- Test: `tests/server/giveaway-domain.test.ts`

**Interfaces:**
- Consumes Task 2 input and DTO types.
- Produces PostgreSQL persistence for campaign configuration, immutable snapshots, prize inventory, awards, operators, claims, and audit history.

- [ ] **Step 1: Write schema-facing domain tests**

~~~ts
test("freezes exactly one snapshot row per giveaway entry", async () => {
  const { giveaway, organizer } = await createApprovedOpenGiveaway();
  await backend.lockGiveawayEntries(organizer.sessionToken, giveaway.id);

  const snapshot = await backend.getGiveawaySnapshot(organizer.sessionToken, giveaway.id);
  expect(new Set(snapshot.entries.map((entry) => entry.entryId)).size)
    .toBe(snapshot.entries.length);
});
~~~

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npx vitest run tests/server/giveaway-domain.test.ts -t "freezes exactly"`  
Expected: FAIL because no giveaway tables or lock operation exist.

- [ ] **Step 3: Add Prisma models and the additive migration**

Add these models and enums to `prisma/schema.prisma`:

~~~prisma
model EventGiveaway {
  id                String   @id @default(cuid())
  eventId           String
  title             String
  kind              GiveawayKind
  state             GiveawayState @default(draft)
  complianceStatus  GiveawayComplianceStatus @default(draft)
  entryMode         GiveawayEntryMode
  mechanics         String
  terms             String
  termsVersion      Int      @default(1)
  timeZone          String
  entryOpensAt      DateTime?
  entryClosesAt     DateTime?
  drawAt            DateTime?
  claimDeadlineAt   DateTime?
  maxEntriesPerRider Int    @default(1)
  maxWinsPerRider   Int      @default(1)
  lockedAt          DateTime?
  lockedByUserId    String?
  snapshotDigest    String?
  configDigest      String?
  seedCommitment    String?
  seedCiphertext    String?
  seedIv            String?
  seedAuthTag       String?
  seedRevealedAt    DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  event             Event @relation(fields: [eventId], references: [id], onDelete: Restrict)
  rules             GiveawayEligibilityRule[]
  entries           GiveawayEntry[]
  snapshots         GiveawaySnapshot[]
  prizes            GiveawayPrize[]
  draws             GiveawayDraw[]
  operators         GiveawayOperator[]
  audits            GiveawayAuditEvent[]

  @@index([eventId, state])
  @@index([complianceStatus, state])
}
~~~

Add `GiveawayEligibilityRule`, `GiveawayEntry`, `GiveawayEntryEvent`, `GiveawaySnapshot`, `GiveawaySnapshotEntry`, `GiveawayPrize`, `GiveawayPrizeItem`, `GiveawayDraw`, `GiveawayAward`, `GiveawayVerification`, `GiveawayFulfillment`, `GiveawayOperator`, and `GiveawayAuditEvent`. Use `Json` only for validated source facts and audit payloads; not for core state or foreign-key relationships.

The SQL migration must:

1. Create all enums and tables additively after `20260711030000_flexible_event_checkin`.
2. Add indexes for `EventGiveaway(eventId,state)`, `GiveawayEntry(giveawayId,userId)`, snapshot lookup, draw chronology, award status, and audit chronology.
3. Add `UNIQUE(giveawayId,userId)` for one rider aggregate entry, `UNIQUE(snapshotId,entryId)`, `UNIQUE(giveawayId,sequence)`, and `UNIQUE(giveawayId,idempotencyKey)`.
4. Add a partial unique index for one current award per prize item:

~~~sql
CREATE UNIQUE INDEX "GiveawayAward_currentPrizeItem_key"
ON "GiveawayAward" ("prizeItemId")
WHERE "isCurrent" = true;
~~~

5. Add check constraints for positive prize quantities, positive entry/win limits, and non-negative entry weight.
6. Create a trigger that rejects `UPDATE` and `DELETE` on `GiveawayAuditEvent`.
7. Use `ON DELETE RESTRICT` from `EventGiveaway` to `Event`, and from audit/draw/snapshot rows to their campaign, so history is retained.
8. Do not backfill or reinterpret existing `Perk` rows.

Update seed cleanup so giveaway children delete before passes, RSVPs, and events. Create only synthetic fixtures: confirmed eligible rider, pending review rider, cancelled-pass rider, ineligible rider, an approved open campaign, a locked completed campaign, and a redraw chain. Mirror the fixture shape in the in-memory `createSeed()`.

- [ ] **Step 4: Generate Prisma artifacts and run schema/domain tests**

Run: `npm run db:generate`  
Expected: Prisma Client generation succeeds.

Run: `npx vitest run tests/server/giveaway-domain.test.ts -t "freezes exactly"`  
Expected: PASS in the in-memory backend after Task 4 adds the operation.

- [ ] **Step 5: Commit schema and fixtures**

~~~powershell
git add prisma/schema.prisma prisma/migrations/20260712060000_flexible_event_giveaways/migration.sql prisma/seed.ts src/server/backend.ts tests/server/giveaway-domain.test.ts
git commit -m "feat: persist event giveaway lifecycle"
~~~

### Task 4: Implement authorization, eligibility, snapshot, and award operations in both backends

**Files:**
- Modify: `src/server/backend.ts:261-983`
- Modify: `src/server/prisma-backend.ts:186-1187`
- Modify: `src/server/backend.ts:65-94`
- Modify: `src/server/prisma-backend.ts:1117-1130`
- Modify: `src/server/testing.ts`
- Test: `tests/server/giveaway-domain.test.ts`

**Interfaces:**
- Consumes Task 2 types and Task 3 models.
- Produces identical in-memory and Prisma methods:

~~~ts
createGiveaway(sessionToken: string, eventId: string, input: CreateGiveawayInput): Promise<GiveawayWorkspace>;
submitGiveawayForReview(sessionToken: string, giveawayId: string): Promise<GiveawayWorkspace>;
decideGiveawayCompliance(sessionToken: string, giveawayId: string, input: { decision: "approved" | "changes_requested" | "rejected"; reason: string }): Promise<GiveawayWorkspace>;
openGiveaway(sessionToken: string, giveawayId: string): Promise<GiveawayWorkspace>;
enterGiveaway(sessionToken: string, giveawayId: string, input?: { campaignCode?: string }): Promise<RiderGiveawayState>;
grantManualGiveawayEntry(sessionToken: string, giveawayId: string, riderId: string, input: { entries: number; reason: string }): Promise<GiveawayEntryOperatorView>;
lockGiveawayEntries(sessionToken: string, giveawayId: string): Promise<GiveawaySnapshotOperatorView>;
runGiveawayDraw(sessionToken: string, giveawayId: string, input: { idempotencyKey: string }): Promise<GiveawayDrawOperatorView>;
redrawGiveawayAward(sessionToken: string, awardId: string, input: { reason: string; idempotencyKey: string }): Promise<GiveawayDrawOperatorView>;
verifyGiveawayAward(sessionToken: string, awardToken: string): Promise<GiveawayClaimOperatorView>;
fulfillGiveawayAward(sessionToken: string, awardId: string, input: { reference?: string; note?: string }): Promise<GiveawayClaimOperatorView>;
~~~

- [ ] **Step 1: Write failing authorization and eligibility tests**

~~~ts
test("creates an automatic entry only after a confirmed check-in", async () => {
  const { giveaway, rider, organizer, pass } = await createApprovedOpenGiveaway({
    rules: [{ source: "confirmed_check_in", enabled: true, multiplier: 1 }],
  });

  expect(await backend.getMyGiveawayState(rider.sessionToken, giveaway.id)).toMatchObject({
    entry: null,
  });

  await backend.selfCheckIn(rider.sessionToken, await issueLiveQr(organizer));
  expect(await backend.getMyGiveawayState(rider.sessionToken, giveaway.id)).toMatchObject({
    entry: { status: "eligible", entries: 1 },
  });
  expect(pass.status).toBe("checked_in");
});

test("does not create an entry for a pending review check-in until staff confirms", async () => {
  const { giveaway, rider, organizer, pass } = await createApprovedOpenReviewGiveaway();

  await backend.selfCheckIn(rider.sessionToken, await issueLiveQr(organizer));
  expect((await backend.getMyGiveawayState(rider.sessionToken, giveaway.id)).entry).toBeNull();

  await backend.scanPass(organizer.sessionToken, giveaway.eventId, pass.qrToken, "staff_camera");
  expect((await backend.getMyGiveawayState(rider.sessionToken, giveaway.id)).entry?.status).toBe("eligible");
});

test("rejects venue draw and cross-organizer configuration", async () => {
  const { giveaway, otherOrganizer, venue } = await createApprovedOpenGiveaway();

  await expect(backend.runGiveawayDraw(venue.sessionToken, giveaway.id, { idempotencyKey: "x" }))
    .rejects.toThrow("FORBIDDEN");
  await expect(backend.openGiveaway(otherOrganizer.sessionToken, giveaway.id))
    .rejects.toThrow("FORBIDDEN");
});
~~~

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npx vitest run tests/server/giveaway-domain.test.ts -t "automatic entry|pending review|cross-organizer"`  
Expected: FAIL because backend operations do not exist.

- [ ] **Step 3: Add shared authorization and lifecycle implementation**

Add `requireGiveawayConfigurator`, `requireGiveawayOperator`, and `requireGiveawayAdmin` helpers beside existing check-in authorization:

~~~ts
function requireGiveawayConfigurator(user: BackendUser, event: Event) {
  if (user.role === "admin") return;
  if (
    user.role === "organizer" &&
    user.verificationStatus === "APPROVED" &&
    event.organizerId === user.organizerProfileId
  ) return;
  throw new BackendError("FORBIDDEN", "FORBIDDEN");
}
~~~

In the Prisma backend, load the event organizer owner and venue owner with the giveaway row, lock the giveaway before every lifecycle mutation, and re-read state after the lock:

~~~ts
await tx.$queryRaw`SELECT "id" FROM "EventGiveaway" WHERE "id" = ${giveawayId} FOR UPDATE`;
const giveaway = await tx.eventGiveaway.findUniqueOrThrow({
  where: { id: giveawayId },
  include: giveawayWorkspaceInclude,
});
assertGiveawayTransition(giveaway.state, "lock");
~~~

Implement automatic check-in entry synchronization inside the same transaction that confirms a check-in. For event rules using dynamic pass/RSVP eligibility, calculate the source during entry/lock; do not fabricate a rider entry in a client component.

Persist every state change with:

~~~ts
await appendGiveawayAudit(tx, {
  giveawayId,
  actorUserId: actor.id,
  action: "GIVEAWAY_ENTRIES_LOCKED",
  payload: { snapshotDigest, configDigest, candidateCount },
});
await tx.auditLog.create({
  data: {
    actorUserId: actor.id,
    action: "GIVEAWAY_ENTRIES_LOCKED",
    targetType: "EventGiveaway",
    targetId: giveawayId,
    metadata: { candidateCount, snapshotDigest },
  },
});
~~~

Map `P2002` and conditional-update misses to explicit domain errors such as `GIVEAWAY_NOT_APPROVED`, `GIVEAWAY_NOT_OPEN`, `GIVEAWAY_LOCKED`, `ENTRY_EXISTS`, `NOT_ELIGIBLE`, `DRAW_IN_PROGRESS`, `DRAW_ALREADY_COMPLETED`, `PRIZE_SOLD_OUT`, `AWARD_NOT_CLAIMABLE`, and `CLAIM_EXPIRED`.

- [ ] **Step 4: Run domain tests**

Run: `npx vitest run tests/server/giveaway-domain.test.ts`  
Expected: PASS for lifecycle transitions, server-side ownership, confirmed-only eligibility, manual-entry audit, no duplicate entry, max-entry limits, and non-PII DTOs.

- [ ] **Step 5: Commit the backend parity work**

~~~powershell
git add src/server/backend.ts src/server/prisma-backend.ts src/server/testing.ts tests/server/giveaway-domain.test.ts
git commit -m "feat: add authorized giveaway eligibility lifecycle"
~~~

### Task 5: Implement locking, fair allocation, claim tokens, redraws, and immutable audit history

**Files:**
- Modify: `src/server/backend.ts`
- Modify: `src/server/prisma-backend.ts`
- Modify: `src/server/giveaways/draw-engine.ts`
- Modify: `src/server/giveaways/audit.ts`
- Test: `tests/server/giveaway-domain.test.ts`
- Test: `tests/server/giveaway-prisma.integration.test.ts`

**Interfaces:**
- Consumes locked snapshot and prize-item inventory from Tasks 3 and 4.
- Produces one idempotent initial draw or redraw sequence, a current award per prize item, one-time claim tokens, and retained superseded awards.

- [ ] **Step 1: Write failing draw, redraw, and claim tests**

~~~ts
test("returns the original draw for the same idempotency key", async () => {
  const { giveaway, organizer } = await createLockedApprovedGiveaway();

  const first = await backend.runGiveawayDraw(organizer.sessionToken, giveaway.id, {
    idempotencyKey: "draw-001",
  });
  const replay = await backend.runGiveawayDraw(organizer.sessionToken, giveaway.id, {
    idempotencyKey: "draw-001",
  });

  expect(replay.id).toBe(first.id);
  expect(replay.awards).toEqual(first.awards);
});

test("redraw keeps the declined winner and allocates the next ranked eligible entry", async () => {
  const { draw, organizer } = await createDrawWithThreeEligibleEntries();
  const original = draw.awards[0];

  const redraw = await backend.redrawGiveawayAward(organizer.sessionToken, original.id, {
    reason: "Winner declined onsite",
    idempotencyKey: "redraw-001",
  });

  expect(redraw.awards[0].previousAwardId).toBe(original.id);
  expect(await backend.getGiveawayAward(original.id)).toMatchObject({
    isCurrent: false,
    status: "declined",
  });
});

test("allows one staff fulfilment and rejects a replayed claim", async () => {
  const { awardToken, venue } = await createVerifiedAward();

  await backend.verifyGiveawayAward(venue.sessionToken, awardToken);
  await backend.fulfillGiveawayAward(venue.sessionToken, awardToken, { reference: "counter-3" });
  await expect(
    backend.fulfillGiveawayAward(venue.sessionToken, awardToken, { reference: "counter-3" }),
  ).rejects.toThrow("AWARD_NOT_CLAIMABLE");
});
~~~

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npx vitest run tests/server/giveaway-domain.test.ts -t "idempotency|redraw|replayed claim"`  
Expected: FAIL because no draw, award, or fulfilment implementation exists.

- [ ] **Step 3: Implement draw and claim semantics**

Within one transaction:

1. Lock `EventGiveaway`.
2. Verify approved/locked state, snapshot digest, config digest, draw idempotency key, and available prize items.
3. Decrypt the committed seed only in server memory.
4. Rank snapshot entry units using the Task 2 draw engine.
5. Select candidates in rank order, skipping disqualified entries and riders at the configured max-wins threshold.
6. Insert draw, awards, current prize-item reservations, encrypted/hashed claim tokens, and audit events.
7. Update campaign state to `claims_open` only after all writes succeed.

Use this allocation shape:

~~~ts
for (const prizeItem of availablePrizeItems) {
  const candidate = nextEligibleRankedCandidate({
    rankedCandidates,
    awardedUserIds,
    maxWinsPerRider: giveaway.maxWinsPerRider,
  });
  if (!candidate) break;

  await tx.giveawayAward.create({
    data: {
      giveawayId: giveaway.id,
      drawId: draw.id,
      prizeItemId: prizeItem.id,
      entryId: candidate.entryId,
      userId: candidate.userId,
      status: giveaway.requiresPresenceVerification ? "pending_verification" : "claimable",
      isCurrent: true,
      claimTokenHash: hashToken(randomBytes(24).toString("base64url")),
    },
  });
}
~~~

Generate one-time claim tokens with CSPRNG, store only their hash, and treat award verification and fulfilment as separate transitions. A QR opens a rider-authenticated claim page; it never fulfils the award by itself.

For redraw, lock the original award and campaign, set `isCurrent = false`, preserve the original status/reason/actor, create a new `GiveawayDraw(kind = redraw)`, and allocate the next never-selected candidate from the same frozen snapshot. Never modify the initial draw's candidate set or seed commitment.

- [ ] **Step 4: Add two-client Postgres concurrency coverage**

Create a disposable-test-database harness that instantiates two Prisma backends against a dedicated database URL. Run simultaneous `Promise.allSettled` calls for freeze, initial draw, redraw, and fulfillment. Assert exactly one terminal draw, one current award per prize item, no partial snapshot, and one fulfilment record.

Run: `GIVEAWAY_TEST_DATABASE_URL=<disposable-url> npx vitest run tests/server/giveaway-prisma.integration.test.ts`  
Expected: PASS. Do not point this command at `DIRECT_URL`, a shared Supabase database, or production.

- [ ] **Step 5: Commit the auditable allocation behavior**

~~~powershell
git add src/server/backend.ts src/server/prisma-backend.ts src/server/giveaways/draw-engine.ts src/server/giveaways/audit.ts tests/server/giveaway-domain.test.ts tests/server/giveaway-prisma.integration.test.ts
git commit -m "feat: add auditable giveaway draws and claims"
~~~

### Task 6: Add server actions, scheduled lifecycle processing, notifications, and safe export

**Files:**
- Modify: `src/server/actions.ts`
- Modify: `src/features/tambike-demo/demo-provider.tsx`
- Create: `src/app/api/jobs/giveaway-lifecycle/route.ts`
- Create: `src/app/api/admin/exports/giveaways/[eventId]/route.ts`
- Modify: `src/server/backend.ts`
- Modify: `src/server/prisma-backend.ts`
- Test: `tests/server/giveaway-export.test.ts`

**Interfaces:**
- Consumes backend methods from Tasks 4 and 5.
- Produces cookie-authenticated actions, a CRON_SECRET-protected lifecycle endpoint, user notifications, and admin-only export.

- [ ] **Step 1: Write failing action/export tests**

~~~ts
test("returns no email or source metadata in a rider giveaway action response", async () => {
  const result = await getMyGiveawayStateAction("giveaway-1");

  expect(JSON.stringify(result)).not.toMatch(/@|sourceSnapshot|claimTokenHash|seedCiphertext/);
});

test("rejects a rider from downloading the giveaway export", async () => {
  const response = await GET(exportRequestAs("mina.rider@example.com"), {
    params: Promise.resolve({ eventId: "tambike-cafe-classico" }),
  });

  expect(response.status).toBe(403);
});

test("escapes formula-prefixed cells and sets private cache headers", async () => {
  const response = await GET(exportRequestAs("admin@bayanko.ph"), {
    params: Promise.resolve({ eventId: "tambike-cafe-classico" }),
  });

  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.text()).toContain("'=HYPERLINK");
});
~~~

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npx vitest run tests/server/giveaway-export.test.ts`  
Expected: FAIL because no giveaway actions or export route exist.

- [ ] **Step 3: Implement actions and lifecycle route**

Add actions that read the session only on the server and return scoped data:

~~~ts
export async function createGiveawayAction(eventId: string, input: CreateGiveawayInput) {
  const backend = await getTambikeBackend();
  const token = await readRequiredSessionToken();
  return backend.createGiveaway(token, eventId, input);
}

export async function getMyGiveawayStateAction(giveawayId: string) {
  const backend = await getTambikeBackend();
  const token = await readRequiredSessionToken();
  return backend.getMyGiveawayState(token, giveawayId);
}
~~~

Do not put candidate arrays, winner worklists, or full giveaway state into `DemoState`. The provider may retain only event-level campaign summaries and the current rider's compact entitlement count; organizer/admin/venue views fetch their scoped workspace through dedicated actions.

Mirror the existing CRON_SECRET validation in `src/app/api/jobs/event-reminders/route.ts`. The lifecycle job must call an idempotent backend method with `now`:

~~~ts
const result = await backend.advanceGiveawayLifecycles({
  now: new Date(),
  actor: { kind: "system", reason: "scheduled lifecycle" },
});
return Response.json(result, {
  headers: { "Cache-Control": "no-store" },
});
~~~

It may open scheduled approved campaigns, lock campaigns at their entry close, run an explicitly scheduled approved draw, and expire overdue unclaimed awards. It must not re-open, re-draw, or alter a locked snapshot on retries.

Create the admin export route using a dedicated `exportGiveawayCsv` backend method. Authorize admin only, escape cells that start with `=`, `+`, `-`, or `@`, include only explicitly approved operational columns, add `Cache-Control: private, no-store`, and append `GIVEAWAY_EXPORT_CREATED` to both audit systems.

- [ ] **Step 4: Run server action and export tests**

Run: `npx vitest run tests/server/giveaway-export.test.ts`  
Expected: PASS for unauthorized, forbidden, privacy, CSV escaping, headers, and export-audit cases.

- [ ] **Step 5: Commit action, job, and export work**

~~~powershell
git add src/server/actions.ts src/features/tambike-demo/demo-provider.tsx src/app/api/jobs/giveaway-lifecycle/route.ts src/app/api/admin/exports/giveaways/[eventId]/route.ts src/server/backend.ts src/server/prisma-backend.ts tests/server/giveaway-export.test.ts
git commit -m "feat: add giveaway actions lifecycle and export"
~~~

### Task 7: Build organizer and admin campaign workspaces

**Files:**
- Create: `src/features/giveaways/giveaway-workspace.tsx`
- Create: `src/features/giveaways/giveaway-compliance-review.tsx`
- Modify: `src/features/organizer/organizer-console.tsx`
- Modify: `src/features/admin/admin-console.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Create: `src/app/organizer/events/[eventId]/giveaways/page.tsx`
- Create: `src/app/admin/giveaways/page.tsx`
- Create: `src/app/admin/giveaways/[eventId]/page.tsx`
- Test: `tests/server/giveaway-domain.test.ts`

**Interfaces:**
- Consumes scoped `GiveawayWorkspace`, `AdminGiveawayReview`, and action results from Task 6.
- Produces organizer configuration/draw controls and admin review/override controls without exposing sensitive candidate data to riders or venue staff.

- [ ] **Step 1: Write server-visible UI contract tests**

~~~ts
test("does not expose draw controls in a pending compliance workspace", async () => {
  const workspace = await backend.getGiveawayWorkspace(organizer.sessionToken, pendingGiveaway.id);

  expect(workspace.permissions.canDraw).toBe(false);
  expect(workspace.complianceStatus).toBe("pending_review");
});

test("returns only aggregate campaign metrics to organizer reports until a winner is verified", async () => {
  const report = await backend.getOrganizerGiveawayReport(organizer.sessionToken, eventId);

  expect(report.metrics).toMatchObject({ eligible: expect.any(Number), fulfilled: expect.any(Number) });
  expect(JSON.stringify(report)).not.toContain("email");
});
~~~

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/server/giveaway-domain.test.ts -t "draw controls|aggregate campaign"`  
Expected: FAIL because workspace/report DTOs do not exist.

- [ ] **Step 3: Implement organizer and admin surfaces**

Add a `giveaways` section to the organizer console route resolver and sidebar. The organizer workspace must render these sections in order:

1. Mechanics and terms with immutable version summary.
2. Eligibility rule builder and live aggregate preview.
3. Prize pools and inventory items.
4. Compliance status, attestation, and submit-for-review action.
5. Entry window/open/pause/lock controls.
6. Locked snapshot digest/candidate count and draw commitment.
7. Draw review, result publication, redraw history, and fulfilment queue.
8. Append-only audit timeline.

All destructive or exceptional actions require a typed reason and explicit confirmation. A draw screen must animate only the persisted result; the UI never produces random selection.

Add an admin sidebar item and workspace with:

~~~ts
type AdminGiveawayDecision =
  | { decision: "approved"; reason: string }
  | { decision: "changes_requested"; reason: string }
  | { decision: "rejected"; reason: string }
  | { decision: "suspended"; reason: string }
  | { decision: "void_draw"; reason: string };
~~~

Admin can view the full audit and compliance evidence, approve or block mechanics, suspend an active campaign, void with a permanent reason, and initiate a reasoned redraw. Admin export remains separate from the review screen.

- [ ] **Step 4: Run focused domain tests and static checks**

Run: `npx vitest run tests/server/giveaway-domain.test.ts`  
Expected: PASS for permission DTOs and reporting privacy.

Run: `npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 5: Commit organizer/admin UI**

~~~powershell
git add src/features/giveaways/giveaway-workspace.tsx src/features/giveaways/giveaway-compliance-review.tsx src/features/organizer/organizer-console.tsx src/features/admin/admin-console.tsx src/components/app-sidebar.tsx src/app/organizer/events/[eventId]/giveaways/page.tsx src/app/admin/giveaways/page.tsx src/app/admin/giveaways/[eventId]/page.tsx
git commit -m "feat: add organizer and admin giveaway workspaces"
~~~

### Task 8: Build rider entry status and staff prize-claim surfaces

**Files:**
- Create: `src/features/giveaways/rider-giveaway-status.tsx`
- Create: `src/features/giveaways/giveaway-claim-panel.tsx`
- Create: `src/features/giveaways/giveaway-claim-qr.tsx`
- Modify: `src/features/tambike-demo/tambike-screen.tsx`
- Modify: `src/features/check-in/rider-self-check-in-screen.tsx`
- Modify: `src/features/organizer/organizer-console.tsx`
- Modify: `src/features/venue/venue-console.tsx`
- Create: `src/app/venue/events/[eventId]/giveaways/page.tsx`
- Create: `src/app/giveaway-claims/[token]/page.tsx`
- Reuse: `src/features/check-in/qr-image-decoder.ts`
- Test: `tests/server/giveaway-domain.test.ts`

**Interfaces:**
- Consumes safe rider state and staff claim actions from Task 6.
- Produces a rider-facing entry/win/claim UX and a separate staff fulfilment tool.

- [ ] **Step 1: Write failing rider and claim-flow tests**

~~~ts
test("rider can see only their own entry reference and claim state", async () => {
  const mine = await backend.getMyGiveawayState(rider.sessionToken, giveaway.id);
  const someoneElses = await backend.getMyGiveawayState(otherRider.sessionToken, giveaway.id);

  expect(mine.entry?.reference).toMatch(/^G-/);
  expect(JSON.stringify(mine)).not.toContain(otherRider.email);
  expect(someoneElses.awards).not.toContainEqual(expect.objectContaining({ userId: rider.id }));
});

test("venue staff can verify and fulfil but cannot alter mechanics or draw", async () => {
  await expect(backend.updateGiveaway(venue.sessionToken, giveaway.id, update)).rejects.toThrow("FORBIDDEN");
  await expect(backend.runGiveawayDraw(venue.sessionToken, giveaway.id, { idempotencyKey: "x" }))
    .rejects.toThrow("FORBIDDEN");
});
~~~

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npx vitest run tests/server/giveaway-domain.test.ts -t "own entry|venue staff"`  
Expected: FAIL because rider/staff giveaway views do not exist.

- [ ] **Step 3: Implement separated rider and staff UX**

On the event page, render public mechanics only when campaign visibility permits. On the rider's pass and confirmed self-check-in screen, render:

- entry state and opaque entry reference;
- terms version accepted;
- claimed/selected/verification/fulfilment state;
- winner alias consent setting;
- a claim QR only for the authenticated selected rider.

The claim route must require login, compare the award token hash server-side, and render a one-time QR without a fulfil button.

Create `GiveawayClaimPanel` for organizer/venue staff. Reuse only capture primitives from the attendance scanner:

~~~ts
const decoded = await decodeQrImageData(file);
const claim = await verifyGiveawayAwardAction(decoded.token);
await fulfillGiveawayAwardAction(claim.awardId, {
  reference: handoffReference,
  note: handoffNote,
});
~~~

The claim panel supports camera, QR-image upload, and manual code. It records scan source and staff actor on fulfilment. It must not call `scanPassAction`, alter attendance, grant entry, or reveal unrelated entrants.

- [ ] **Step 4: Run server tests and type checks**

Run: `npx vitest run tests/server/giveaway-domain.test.ts`  
Expected: PASS for rider isolation, claim replay denial, operator boundary, and no automatic perk redemption.

Run: `npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 5: Commit rider and staff surfaces**

~~~powershell
git add src/features/giveaways/rider-giveaway-status.tsx src/features/giveaways/giveaway-claim-panel.tsx src/features/giveaways/giveaway-claim-qr.tsx src/features/tambike-demo/tambike-screen.tsx src/features/check-in/rider-self-check-in-screen.tsx src/features/organizer/organizer-console.tsx src/features/venue/venue-console.tsx src/app/venue/events/[eventId]/giveaways/page.tsx src/app/giveaway-claims/[token]/page.tsx
git commit -m "feat: add rider giveaway status and staff claims"
~~~

### Task 9: Add scoped reporting, notifications, retention, and deployment-safe verification

**Files:**
- Modify: `src/server/backend.ts`
- Modify: `src/server/prisma-backend.ts`
- Modify: `src/features/organizer/organizer-console.tsx`
- Modify: `src/features/venue/venue-console.tsx`
- Modify: `src/features/admin/admin-console.tsx`
- Modify: `src/app/api/admin/exports/giveaways/[eventId]/route.ts`
- Test: `tests/server/giveaway-domain.test.ts`
- Test: `tests/server/giveaway-export.test.ts`
- Test: `tests/server/giveaway-prisma.integration.test.ts`

**Interfaces:**
- Consumes campaigns, awards, audit records, and claim events from Tasks 3 through 8.
- Produces aggregate reports, private notifications, retention-safe campaign closure, and production-safe verification.

- [ ] **Step 1: Write failing reporting and notification tests**

~~~ts
test("notifies a winner without publishing their personal data", async () => {
  await backend.publishGiveawayResults(organizer.sessionToken, draw.id);
  const notifications = await backend.getNotifications(rider.sessionToken);

  expect(notifications).toContainEqual(expect.objectContaining({
    title: expect.stringMatching(/winner|giveaway/i),
  }));
  expect(JSON.stringify(notifications)).not.toContain("claimTokenHash");
});

test("keeps cancelled campaign audit and draw history retrievable", async () => {
  await backend.cancelGiveaway(admin.sessionToken, giveaway.id, { reason: "Venue closure" });

  expect(await backend.getGiveawayAudit(admin.sessionToken, giveaway.id)).not.toHaveLength(0);
  await expect(backend.deleteEvent(admin.sessionToken, giveaway.eventId)).rejects.toThrow("GIVEAWAY_HISTORY_RETAINED");
});
~~~

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npx vitest run tests/server/giveaway-domain.test.ts -t "notifies a winner|audit and draw"`  
Expected: FAIL because notifications/reporting/retention operations do not exist.

- [ ] **Step 3: Implement reporting and notifications**

Create in-app `Notification` records for entry confirmation, award selection, claim deadline reminder, verification request, fulfilment, disqualification, and redraw. Use only rider-safe copy and URLs.

Add aggregate report fields:

~~~ts
interface GiveawayReportMetrics {
  campaigns: number;
  eligibleRiders: number;
  entriesIssued: number;
  lockedSnapshots: number;
  prizesAvailable: number;
  prizesAllocated: number;
  awardsVerified: number;
  awardsFulfilled: number;
  claimsExpired: number;
  redraws: number;
}
~~~

Organizer and venue reports show aggregates plus their permitted fulfilment work. Admin reports show compliance state, audit integrity, and export actions. Public winner views use only consented aliases. Campaign cancellation and event lifecycle controls retain the audit, snapshot, draw, award, verification, and fulfilment history.

- [ ] **Step 4: Run the complete technical verification**

Run: `npm run test:server`  
Expected: all server suites pass.

Run: `GIVEAWAY_TEST_DATABASE_URL=<disposable-url> npx vitest run tests/server/giveaway-prisma.integration.test.ts`  
Expected: two-client transaction, lock, partial unique index, and rollback tests pass.

Run: `npm run lint`  
Expected: ESLint exits 0.

Run: `npx tsc --noEmit`  
Expected: TypeScript exits 0.

Run: `npm run build`  
Expected: Next.js production build exits 0.

Run: `git diff --check`  
Expected: no whitespace errors.

Run: `npx prisma migrate status`  
Expected: database schema is up to date after deployment.

- [ ] **Step 5: Run Codex browser smoke flows**

Use the in-app Codex browser, with a disposable/migrated test environment:

1. Organizer creates a campaign, submits mechanics, and cannot open it before admin approval.
2. Admin approves the campaign and sees the compliance/audit trail.
3. Rider registers, completes a confirmed check-in, sees only their own entry reference, and cannot see candidate data.
4. Organizer locks the snapshot and runs one draw; retry with the same idempotency key shows the same result.
5. Venue staff opens the fulfilment queue, verifies the winning rider's one-time QR from camera, QR image upload, and manual-code paths, then cannot fulfil it again.
6. Admin export downloads only from the authorized route; browser-visible response never exposes another rider's email or claim secret.
7. A declined/expired winner produces an auditable redraw without erasing the initial award.

- [ ] **Step 6: Deploy and migration safety**

Author the migration against a disposable local database:

~~~powershell
npx prisma migrate dev --create-only --name flexible_event_giveaways
npx prisma validate
~~~

Review generated SQL, especially `ON DELETE RESTRICT`, partial unique indexes, audit trigger, and index names. Apply to the configured deployment database only with:

~~~powershell
npx prisma migrate deploy
npx prisma migrate status
~~~

Do not seed or reset the deployment database. Confirm the application loads after migration before enabling any campaign.

- [ ] **Step 7: Commit reporting and verification**

~~~powershell
git add src/server/backend.ts src/server/prisma-backend.ts src/features/organizer/organizer-console.tsx src/features/venue/venue-console.tsx src/features/admin/admin-console.tsx src/app/api/admin/exports/giveaways/[eventId]/route.ts tests/server/giveaway-domain.test.ts tests/server/giveaway-export.test.ts tests/server/giveaway-prisma.integration.test.ts
git commit -m "feat: report and audit event giveaways"
~~~

## Plan Self-Review

- **Scope coverage:** The plan covers raffle and giveaway mechanics, all requested eligibility pools, organizer/admin/staff/rider operations, deterministic audit, claims, redraws, privacy, reporting, exports, scheduling, migration, and browser verification.
- **Legacy compatibility:** Existing perks remain independent and no historical raffle perk becomes a live campaign.
- **Concurrency:** Parent giveaway locks, idempotency constraints, current-prize partial uniqueness, and two-client Postgres tests protect snapshot/draw/claim races.
- **Security:** Server-side authorization, encrypted pre-draw seeds, token hashes, admin-only raw exports, scoped DTOs, manual fulfilment, and immutable audit records are explicit.
- **Operational gate:** Automated campaigns cannot bypass the documented compliance/attestation workflow.
- **Ambiguity resolved:** The default fairness model is commit/reveal CSPRNG with published verification after results; the plan does not claim independently public randomness.

