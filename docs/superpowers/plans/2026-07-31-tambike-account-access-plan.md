# Tambike Account Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the client-only account disable/restore controls with production-safe, persisted, audited account suspension that revokes sessions and preserves verification history.

**Architecture:** Add a distinct account-access state to the shared domain contract and Prisma schema, then implement identical memory and Prisma backend operations. Expose the operations through focused server loaders/actions and a client confirmation surface rendered inside the existing admin shell. This plan also makes the production backend fail closed when Postgres configuration is absent.

**Tech Stack:** Next.js 16.2.11 App Router and Server Actions, React 19.2.4, TypeScript 5, Zod 4.4.3, Prisma 7.8.0, PostgreSQL, Vitest 4.1.9, Radix/shadcn UI.

## Global Constraints

- Production requires valid Postgres configuration and must never silently fall back to the in-memory backend.
- The in-memory backend remains explicit for local and automated tests only.
- Verification state and account access state are separate.
- Suspension is reversible, audited, immediately session-revoking, and history-preserving.
- Reject self-suspension and suspension of the last active admin on the server.
- Expected Server Action failures are returned as structured values; unexpected failures still throw to an error boundary.
- Treat every Server Action as an untrusted public entry point: authenticate, authorize, validate, and return only UI-safe data.
- Use `revalidatePath()` with literal affected paths; do not invalidate the root layout.
- Preserve all existing dirty worktree changes and stage only files named by the current task.
- Never create an AI/Codex branch or worktree.
- Never run migration or mutation checks against a remote/live database without separate explicit approval.
- Browser verification uses only the Codex browser surface; do not run Playwright.

---

## File Structure

### Create

- `src/features/admin/account-access-types.ts` — serializable account-access contracts shared by server and UI.
- `src/features/shared/action-state.ts` — serializable expected-action result contract shared by all workflows.
- `src/server/action-result.ts` — safe `BackendError` to action-state mapping shared by Server Actions.
- `src/server/admin/account-actions.ts` — account page loader and suspend/restore Server Actions.
- `src/features/admin/admin-user-accounts.tsx` — responsive user list and reason-confirmation dialogs.
- `tests/server/account-access-domain.test.ts` — memory-backend transition, audit, and authorization tests.
- `tests/server/account-access-actions.test.ts` — Server Action result-mapping contract tests.
- `tests/server/account-access-ui.test.tsx` — static UI/semantics contract tests.
- `tests/prisma-integration/account-access.integration.test.ts` — real transaction/session/audit integration coverage.
- `prisma/migrations/20260731150000_account_access_state/migration.sql` — additive account state and safe legacy backfill.

### Modify

- `src/server/database-url.ts` — explicit runtime backend resolution and production fail-closed rule.
- `src/server/backend.ts` — memory model, authorization guard, account operations, audit actions, and runtime selection.
- `src/server/prisma-backend.ts` — transactional account operations and account-aware session checks.
- `src/server/session-cookie.ts` — shared required-session reader.
- `src/features/tambike-demo/types.ts` — separate `AccountStatus` from `VerificationStatus`.
- `src/features/tambike-demo/data.ts` — seed account access state.
- `src/features/admin/admin-console.tsx` — accept server-loaded account content and remove local user overrides.
- `src/app/admin/users/page.tsx` — load the focused admin account view model on the server.
- `prisma/schema.prisma` — account state, suspension provenance, indexes, and self-relations.
- `prisma/seed.ts` — seed all canonical accounts as active.
- `tests/server/backend-domain.test.ts` — replace legacy `verificationStatus: "SUSPENDED"` assumptions.
- `tests/server/database-url.test.ts` — production runtime resolution coverage.
- `vitest.config.ts` — opt the ordinary server-test suite into memory mode explicitly.
- `tests/prisma-integration/fixtures.ts` — explicit active account state in shared fixtures.
- `README.md` — document explicit local memory mode and production database requirement.
- `.env.example` — document `TAMBIKE_BACKEND=memory` as local/test-only.

## Interfaces

This plan produces these contracts for later plans:

```ts
export type AccountStatus = "ACTIVE" | "SUSPENDED";

export type AdminUserAccount = {
  id: string;
  displayName: string;
  email: string;
  role: "rider" | "organizer" | "admin";
  verificationStatus: "UNVERIFIED" | "PENDING" | "APPROVED" | "REJECTED";
  accountStatus: AccountStatus;
  area: string;
  organizerProfileId?: string;
  suspendedAt?: string;
  suspendedReason?: string;
  updatedAt: string;
};

export type AccountAccessMutationInput = {
  reason: string;
  expectedUpdatedAt: string;
};

export type ActionCode =
  | "SUCCESS"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "NOT_FOUND";

export type ActionState<T = undefined> =
  | { status: "idle"; message: "" }
  | { status: "success"; code: "SUCCESS"; message: string; data: T }
  | {
      status: "error";
      code: Exclude<ActionCode, "SUCCESS">;
      message: string;
      fieldErrors?: Record<string, string[]>;
    };
```

Both runtime backends must expose:

```ts
listAdminUserAccounts(sessionToken: string): Promise<AdminUserAccount[]>;
suspendUser(
  sessionToken: string,
  targetUserId: string,
  input: AccountAccessMutationInput,
): Promise<AdminUserAccount>;
restoreUser(
  sessionToken: string,
  targetUserId: string,
  input: AccountAccessMutationInput,
): Promise<AdminUserAccount>;
```

---

### Task 1: Make Runtime Backend Selection Fail Closed in Production

**Files:**
- Modify: `src/server/database-url.ts`
- Modify: `src/server/backend.ts`
- Modify: `tests/server/database-url.test.ts`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Produces: `resolveRuntimeBackend(env): { kind: "memory" } | { kind: "prisma"; databaseUrl: string }`
- Consumed by: `createRuntimeBackend()` in `src/server/backend.ts`

- [ ] **Step 1: Write failing runtime-resolution tests**

Add these cases to `tests/server/database-url.test.ts`:

```ts
import {
  getMigrationDatabaseUrl,
  getRuntimeDatabaseUrl,
  requireMigrationDatabaseUrl,
  resolveRuntimeBackend,
} from "../../src/server/database-url";

test("fails closed when production has no database URL", () => {
  expect(() => resolveRuntimeBackend({ NODE_ENV: "production" })).toThrow(
    "Tambike production requires DATABASE_URL or SUPABASE_DATABASE_URL",
  );
});

test("rejects forced memory mode in production", () => {
  expect(() =>
    resolveRuntimeBackend({
      NODE_ENV: "production",
      TAMBIKE_BACKEND: "memory",
      DATABASE_URL: "postgresql://runtime.example/tambike",
    }),
  ).toThrow("TAMBIKE_BACKEND=memory is not allowed in production");
});

test("allows explicit memory mode outside production", () => {
  expect(
    resolveRuntimeBackend({ NODE_ENV: "test", TAMBIKE_BACKEND: "memory" }),
  ).toEqual({ kind: "memory" });
});

test("rejects implicit memory fallback in development", () => {
  expect(() => resolveRuntimeBackend({ NODE_ENV: "development" })).toThrow(
    "Configure a database or explicitly set TAMBIKE_BACKEND=memory for local/test use",
  );
});

test("selects Prisma whenever a runtime URL exists", () => {
  expect(
    resolveRuntimeBackend({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://runtime.example/tambike",
    }),
  ).toEqual({
    kind: "prisma",
    databaseUrl: "postgresql://runtime.example/tambike",
  });
});
```

- [ ] **Step 2: Run the focused test and verify the new API is missing**

Run:

```powershell
npx vitest run tests/server/database-url.test.ts
```

Expected: FAIL because `resolveRuntimeBackend` is not exported.

- [ ] **Step 3: Implement explicit backend resolution**

Update `DatabaseEnv` and add this function in `src/server/database-url.ts`:

```ts
type DatabaseEnv = {
  NODE_ENV?: string | undefined;
  DATABASE_URL?: string | undefined;
  DIRECT_URL?: string | undefined;
  SUPABASE_DATABASE_URL?: string | undefined;
  SHADOW_DATABASE_URL?: string | undefined;
  TAMBIKE_BACKEND?: string | undefined;
  [key: string]: string | undefined;
};

export function resolveRuntimeBackend(env: DatabaseEnv = process.env):
  | { kind: "memory" }
  | { kind: "prisma"; databaseUrl: string } {
  const forcedMemory = readEnv(env.TAMBIKE_BACKEND)?.toLowerCase() === "memory";
  const production = readEnv(env.NODE_ENV)?.toLowerCase() === "production";

  if (forcedMemory) {
    if (production) {
      throw new Error("TAMBIKE_BACKEND=memory is not allowed in production");
    }
    return { kind: "memory" };
  }

  const databaseUrl =
    readEnv(env.DATABASE_URL) ?? readEnv(env.SUPABASE_DATABASE_URL);
  if (databaseUrl) {
    return { kind: "prisma", databaseUrl };
  }
  throw new Error(
    production
      ? "Tambike production requires DATABASE_URL or SUPABASE_DATABASE_URL"
      : "Configure a database or explicitly set TAMBIKE_BACKEND=memory for local/test use",
  );
}
```

Replace `createRuntimeBackend()` selection in `src/server/backend.ts`:

```ts
async function createRuntimeBackend(): Promise<RuntimeBackend> {
  const runtime = resolveRuntimeBackend();
  if (runtime.kind === "prisma") {
    const { PrismaTambikeBackend } = await import("./prisma-backend");
    return PrismaTambikeBackend.create(runtime.databaseUrl);
  }
  return TambikeBackend.create();
}
```

- [ ] **Step 4: Document the rule**

Replace the README fallback statement with:

```md
Local and automated tests may opt into the in-memory backend with
`TAMBIKE_BACKEND=memory`. No environment falls back to memory implicitly.
Production rejects memory mode and exits with a configuration error unless
`DATABASE_URL` or `SUPABASE_DATABASE_URL` is set.
```

Add to `.env.example`:

```dotenv
# Local/test-only escape hatch. Never set this in production.
TAMBIKE_BACKEND=""
```

- [ ] **Step 5: Make the server-test backend explicit**

Add to the existing `test` block in `vitest.config.ts`:

```ts
env: {
  TAMBIKE_BACKEND: "memory",
},
```

Do not add this to `vitest.prisma-integration.config.ts`; Prisma integration
must continue to use its disposable database.

- [ ] **Step 6: Run the test and lint the touched files**

Run:

```powershell
npx vitest run tests/server/database-url.test.ts
npx eslint src/server/database-url.ts src/server/backend.ts tests/server/database-url.test.ts vitest.config.ts
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit the runtime guard**

```powershell
git add -- src/server/database-url.ts src/server/backend.ts tests/server/database-url.test.ts vitest.config.ts README.md .env.example
git commit -m "fix: require persistent production backend"
```

---

### Task 2: Separate Verification from Account Access in the Schema

**Files:**
- Modify: `src/features/tambike-demo/types.ts`
- Modify: `src/features/tambike-demo/data.ts`
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seed.ts`
- Create: `prisma/migrations/20260731150000_account_access_state/migration.sql`
- Modify: `tests/server/account-role-location-schema-contract.test.ts`
- Modify: `tests/server/prisma-seed-policy.test.ts`
- Modify: `tests/prisma-integration/fixtures.ts`

**Interfaces:**
- Produces: `AccountStatus`, account suspension columns, and active canonical seeds.
- Consumed by: both backend implementations and all later role guards.

- [ ] **Step 1: Add failing type/schema contract assertions**

In `tests/server/account-role-location-schema-contract.test.ts`, assert:

```ts
expect(typesSource).toContain('export type AccountStatus = "ACTIVE" | "SUSPENDED"');
expect(typesSource).toContain("export type OrganizerVerificationStatus");
expect(typesSource).toMatch(
  /export type VerificationStatus =[\s\S]*?"REJECTED";/,
);
expect(schema.match(/enum VerificationStatus \{([\s\S]*?)\}/)?.[1])
  .not.toContain("SUSPENDED");
expect(schema.match(/enum OrganizerVerificationStatus \{([\s\S]*?)\}/)?.[1])
  .toContain("SUSPENDED");
expect(schema).toContain("enum AccountStatus");
expect(schema).toContain("accountStatus");
expect(schema).toContain("suspendedByUserId");
expect(schema).toContain('relation("UserSuspendedBy"');
```

In `tests/server/prisma-seed-policy.test.ts`, assert the canonical users set `accountStatus: "ACTIVE"` and no seed user uses `verificationStatus: "SUSPENDED"`.

- [ ] **Step 2: Run the schema contracts and verify failure**

Run:

```powershell
npx vitest run tests/server/account-role-location-schema-contract.test.ts tests/server/prisma-seed-policy.test.ts
```

Expected: FAIL on the missing account state and legacy suspended verification state.

- [ ] **Step 3: Update shared TypeScript contracts**

Change the top of `src/features/tambike-demo/types.ts` to:

```ts
export type VerificationStatus =
  | "UNVERIFIED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED";

export type OrganizerVerificationStatus =
  | VerificationStatus
  | "SUSPENDED";

export type AccountStatus = "ACTIVE" | "SUSPENDED";
```

Add to `UserProfile`:

```ts
accountStatus: AccountStatus;
```

Update every literal user in `src/features/tambike-demo/data.ts` and `prisma/seed.ts` with:

```ts
accountStatus: "ACTIVE",
```

- [ ] **Step 4: Update the Prisma model**

Use this schema shape:

```prisma
enum VerificationStatus {
  UNVERIFIED
  PENDING
  APPROVED
  REJECTED
}

enum AccountStatus {
  ACTIVE
  SUSPENDED
}

enum OrganizerVerificationStatus {
  UNVERIFIED
  PENDING
  APPROVED
  REJECTED
  SUSPENDED
}

model User {
  id                   String             @id @default(cuid())
  displayName          String
  email                String             @unique
  passwordHash         String
  role                 Role               @default(rider)
  verificationStatus   VerificationStatus @default(UNVERIFIED)
  accountStatus        AccountStatus      @default(ACTIVE)
  suspendedAt          DateTime?
  suspendedByUserId    String?
  suspensionReason     String?            @db.VarChar(500)
  area                 String
  updatedAt            DateTime           @updatedAt

  suspendedBy          User?              @relation("UserSuspendedBy", fields: [suspendedByUserId], references: [id], onDelete: SetNull)
  suspensionsPerformed User[]             @relation("UserSuspendedBy")

  @@index([role, accountStatus])
}
```

Keep all existing `User` fields and relations not shown above unchanged.
Change `OrganizerProfile.verificationStatus` to
`OrganizerVerificationStatus @default(PENDING)` so existing organizer
moderation remains independent from account access.

- [ ] **Step 5: Write the safe expand/backfill migration**

The migration must:

1. Create `AccountStatus`.
2. Add suspension columns with `accountStatus` defaulting to `ACTIVE`.
3. Backfill legacy `VerificationStatus.SUSPENDED` rows to `accountStatus=SUSPENDED`.
4. Map the old restore behavior to `verificationStatus=APPROVED` for those legacy rows.
5. Recreate user `VerificationStatus` without `SUSPENDED` and create a separate
   `OrganizerVerificationStatus` that preserves every organizer moderation
   value, including `SUSPENDED`.
6. Add the self-reference and active-admin index.

Use SQL with these key statements:

```sql
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

ALTER TABLE "User"
  ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspendedByUserId" TEXT,
  ADD COLUMN "suspensionReason" VARCHAR(500);

UPDATE "User"
SET
  "accountStatus" = 'SUSPENDED',
  "suspendedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP)
WHERE "verificationStatus"::text = 'SUSPENDED';

ALTER TYPE "VerificationStatus" RENAME TO "VerificationStatus_legacy";
CREATE TYPE "VerificationStatus" AS ENUM (
  'UNVERIFIED',
  'PENDING',
  'APPROVED',
  'REJECTED'
);
CREATE TYPE "OrganizerVerificationStatus" AS ENUM (
  'UNVERIFIED',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SUSPENDED'
);

ALTER TABLE "User" ALTER COLUMN "verificationStatus" DROP DEFAULT;
ALTER TABLE "OrganizerProfile" ALTER COLUMN "verificationStatus" DROP DEFAULT;

ALTER TABLE "User"
  ALTER COLUMN "verificationStatus" TYPE "VerificationStatus"
  USING (
    CASE
      WHEN "verificationStatus"::text = 'SUSPENDED' THEN 'APPROVED'
      ELSE "verificationStatus"::text
    END
  )::"VerificationStatus";

ALTER TABLE "OrganizerProfile"
  ALTER COLUMN "verificationStatus" TYPE "OrganizerVerificationStatus"
  USING ("verificationStatus"::text)::"OrganizerVerificationStatus";

ALTER TABLE "User" ALTER COLUMN "verificationStatus" SET DEFAULT 'UNVERIFIED';
ALTER TABLE "OrganizerProfile" ALTER COLUMN "verificationStatus" SET DEFAULT 'PENDING';
DROP TYPE "VerificationStatus_legacy";

ALTER TABLE "User"
  ADD CONSTRAINT "User_suspendedByUserId_fkey"
  FOREIGN KEY ("suspendedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_role_accountStatus_idx"
  ON "User"("role", "accountStatus");
```

- [ ] **Step 6: Generate Prisma and rerun schema tests**

Run:

```powershell
npm run db:generate
npx vitest run tests/server/account-role-location-schema-contract.test.ts tests/server/prisma-seed-policy.test.ts
```

Expected: Prisma generation and both test files pass.

- [ ] **Step 7: Commit the account state schema**

```powershell
git add -- src/features/tambike-demo/types.ts src/features/tambike-demo/data.ts prisma/schema.prisma prisma/seed.ts prisma/migrations/20260731150000_account_access_state/migration.sql tests/server/account-role-location-schema-contract.test.ts tests/server/prisma-seed-policy.test.ts tests/prisma-integration/fixtures.ts
git commit -m "feat: separate account access from verification"
```

---

### Task 3: Implement Memory-Backend Account Access Rules

**Files:**
- Create: `src/features/admin/account-access-types.ts`
- Modify: `src/server/backend.ts`
- Create: `tests/server/account-access-domain.test.ts`
- Modify: `tests/server/backend-domain.test.ts`

**Interfaces:**
- Produces: the three backend methods listed in this plan's Interfaces section.
- Consumed by: Server Actions in Task 5 and parity tests in Task 4.

- [ ] **Step 1: Write failing suspension domain tests**

Create `tests/server/account-access-domain.test.ts` with tests covering:

```ts
import { describe, expect, test } from "vitest";
import { createTambikeTestBackend } from "../../src/server/testing";
import { createTestActors } from "./support/tambike-fixtures";

describe("account access domain", () => {
  test("suspends an account, revokes every session, and preserves verification", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "account-suspend");
    const secondSession = await backend.loginWithPassword(
      actors.rider.user.email,
      "password123",
    );
    const before = (await backend.listAdminUserAccounts(
      actors.admin.sessionToken,
    )).find((user) => user.id === actors.rider.user.id)!;

    const suspended = await backend.suspendUser(
      actors.admin.sessionToken,
      actors.rider.user.id,
      {
        reason: "Repeated abuse confirmed by moderation review.",
        expectedUpdatedAt: before.updatedAt,
      },
    );

    expect(suspended).toMatchObject({
      verificationStatus: "UNVERIFIED",
      accountStatus: "SUSPENDED",
      suspendedReason: "Repeated abuse confirmed by moderation review.",
    });
    await expect(
      backend.getCurrentUser(actors.rider.sessionToken),
    ).resolves.toBeNull();
    await expect(
      backend.getCurrentUser(secondSession.sessionToken),
    ).resolves.toBeNull();
    await expect(
      backend.loginWithPassword(actors.rider.user.email, "password123"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(backend.auditCount("ACCOUNT_SUSPENDED")).resolves.toBe(1);
  });

  test("restores access without changing verification", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "account-restore");
    const before = (await backend.listAdminUserAccounts(
      actors.admin.sessionToken,
    )).find((user) => user.id === actors.rider.user.id)!;
    const suspended = await backend.suspendUser(
      actors.admin.sessionToken,
      actors.rider.user.id,
      {
        reason: "Temporary safety hold pending rider contact.",
        expectedUpdatedAt: before.updatedAt,
      },
    );

    const restored = await backend.restoreUser(
      actors.admin.sessionToken,
      actors.rider.user.id,
      {
        reason: "Safety hold reviewed and resolved.",
        expectedUpdatedAt: suspended.updatedAt,
      },
    );

    expect(restored).toMatchObject({
      verificationStatus: "UNVERIFIED",
      accountStatus: "ACTIVE",
      suspendedAt: undefined,
      suspendedReason: undefined,
    });
    await expect(backend.auditCount("ACCOUNT_RESTORED")).resolves.toBe(1);
  });

  test("rejects self-suspension, last-admin suspension, stale writes, and non-admins", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "account-guards");
    const accounts = await backend.listAdminUserAccounts(actors.admin.sessionToken);
    const admin = accounts.find((user) => user.id === actors.admin.user.id)!;
    const rider = accounts.find((user) => user.id === actors.rider.user.id)!;

    await expect(
      backend.suspendUser(actors.admin.sessionToken, admin.id, {
        reason: "Self suspension must never be allowed.",
        expectedUpdatedAt: admin.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      backend.suspendUser(actors.rider.sessionToken, rider.id, {
        reason: "Riders cannot suspend accounts.",
        expectedUpdatedAt: rider.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      backend.suspendUser(actors.admin.sessionToken, rider.id, {
        reason: "Stale browser tab must lose the race.",
        expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
```

- [ ] **Step 2: Run the new domain test**

Run:

```powershell
npx vitest run tests/server/account-access-domain.test.ts
```

Expected: FAIL because the contracts and methods do not exist.

- [ ] **Step 3: Create serializable account contracts**

Create `src/features/admin/account-access-types.ts` using the exact interfaces from this plan's Interfaces section. Keep this module free of `server-only` so Client Components may import the types.

- [ ] **Step 4: Add account state to the memory model**

Update `BackendUser`, fixture hydration, signup, clone, and session guards:

```ts
type BackendUser = UserProfile & {
  passwordHash: string;
  updatedAt: string;
  suspendedAt?: string;
  suspendedByUserId?: string;
  suspensionReason?: string;
};

function cloneUser(user: BackendUser): UserProfile {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    verificationStatus: user.verificationStatus,
    accountStatus: user.accountStatus,
    area: user.area,
    bikeModel: user.bikeModel,
    clubName: user.clubName,
    joinedAt: user.joinedAt,
    organizerProfileId: user.organizerProfileId,
  };
}
```

All seeded/created users receive `accountStatus: "ACTIVE"` and an ISO `updatedAt`.

Change every active-user check from `verificationStatus === "SUSPENDED"` to `accountStatus === "SUSPENDED"`. `loginWithPassword` must verify the password first and then throw `BackendError("FORBIDDEN")` for a suspended account so the response does not reveal account existence before credential validation.

- [ ] **Step 5: Implement memory account operations**

Implement the three public methods with these rules:

```ts
async listAdminUserAccounts(sessionToken: string): Promise<AdminUserAccount[]> {
  this.requireRole(sessionToken, "admin");
  return Array.from(this.users.values())
    .map((user) => this.toAdminUserAccount(user))
    .sort((left, right) =>
      left.displayName.localeCompare(right.displayName) ||
      left.id.localeCompare(right.id),
    );
}

async suspendUser(
  sessionToken: string,
  targetUserId: string,
  input: AccountAccessMutationInput,
): Promise<AdminUserAccount> {
  const actor = this.requireRole(sessionToken, "admin");
  const target = this.users.get(targetUserId);
  if (!target) throw new BackendError("NOT_FOUND");
  if (target.id === actor.id) throw new BackendError("FORBIDDEN");
  if (target.updatedAt !== input.expectedUpdatedAt) {
    throw new BackendError("CONFLICT");
  }
  const reason = this.requireAdminReason(input.reason);
  if (target.role === "admin") {
    const activeAdmins = Array.from(this.users.values()).filter(
      (user) => user.role === "admin" && user.accountStatus === "ACTIVE",
    ).length;
    if (activeAdmins <= 1) throw new BackendError("FORBIDDEN");
  }
  if (target.accountStatus === "SUSPENDED") {
    throw new BackendError("CONFLICT");
  }

  const now = new Date().toISOString();
  target.accountStatus = "SUSPENDED";
  target.suspendedAt = now;
  target.suspendedByUserId = actor.id;
  target.suspensionReason = reason;
  target.updatedAt = now;
  for (const [token, session] of this.sessions) {
    if (session.userId === target.id) this.sessions.delete(token);
  }
  this.audit("ACCOUNT_SUSPENDED", actor.id, target.id, {
    previousAccountStatus: "ACTIVE",
    nextAccountStatus: "SUSPENDED",
  });
  return this.toAdminUserAccount(target);
}
```

`restoreUser()` mirrors the stale check, requires `SUSPENDED`, sets `ACTIVE`, clears suspension fields, updates the timestamp, and audits `ACCOUNT_RESTORED`. `requireAdminReason()` accepts trimmed text from 10 through 500 characters.

Broaden memory audit metadata from boolean-only values to:

```ts
type AuditMetadataValue = string | number | boolean | null;
type AuditMetadata = Record<string, AuditMetadataValue>;
```

Add `ACCOUNT_SUSPENDED` and `ACCOUNT_RESTORED` to `AuditAction`, and add `CONFLICT` to `BackendError`.

- [ ] **Step 6: Replace the legacy suspended verification test**

In `tests/server/backend-domain.test.ts`, change the suspended fixture to:

```ts
verificationStatus: "APPROVED",
accountStatus: "SUSPENDED",
```

Expect login to reject with `{ code: "FORBIDDEN" }` and remove any assertion that a suspended account can create a valid session.

- [ ] **Step 7: Run memory-backend account tests**

Run:

```powershell
npx vitest run tests/server/account-access-domain.test.ts tests/server/backend-domain.test.ts
```

Expected: all tests pass.

- [ ] **Step 8: Commit the memory implementation**

```powershell
git add -- src/features/admin/account-access-types.ts src/server/backend.ts tests/server/account-access-domain.test.ts tests/server/backend-domain.test.ts
git commit -m "feat: enforce account suspension rules"
```

---

### Task 4: Implement Transactional Prisma Account Access

**Files:**
- Modify: `src/server/prisma-backend.ts`
- Create: `tests/prisma-integration/account-access.integration.test.ts`

**Interfaces:**
- Consumes: account contracts and schema from Tasks 2–3.
- Produces: Prisma parity for list/suspend/restore.

- [ ] **Step 1: Write the Prisma integration test**

Create `tests/prisma-integration/account-access.integration.test.ts`. Use `createPrismaEventFixture()` to create an admin, organizer, rider, and sessions. Cover:

```ts
test("persists suspension, revokes sessions, audits, and restores verification", async () => {
  const fixture = await createPrismaEventFixture(prisma, {
    suffix: `account-access-${randomUUID()}`,
  });
  const before = (await backend.listAdminUserAccounts(
    fixture.adminSession,
  )).find((user) => user.id === fixture.riders[0].userId)!;

  const suspended = await backend.suspendUser(
    fixture.adminSession,
    fixture.riders[0].userId,
    {
      reason: "Disposable integration suspension reason.",
      expectedUpdatedAt: before.updatedAt,
    },
  );

  expect(suspended).toMatchObject({
    verificationStatus: "UNVERIFIED",
    accountStatus: "SUSPENDED",
  });
  await expect(
    prisma.session.count({ where: { userId: fixture.riders[0].userId } }),
  ).resolves.toBe(0);
  await expect(
    prisma.auditLog.count({
      where: {
        action: "ACCOUNT_SUSPENDED",
        targetId: fixture.riders[0].userId,
      },
    }),
  ).resolves.toBe(1);

  const restored = await backend.restoreUser(
    fixture.adminSession,
    fixture.riders[0].userId,
    {
      reason: "Disposable integration restoration reason.",
      expectedUpdatedAt: suspended.updatedAt,
    },
  );
  expect(restored).toMatchObject({
    verificationStatus: "UNVERIFIED",
    accountStatus: "ACTIVE",
  });
});
```

Add separate tests for stale `updatedAt`, self-suspension, last-active-admin protection, and outsider access.

- [ ] **Step 2: Prepare the disposable integration database**

Run only against the configured disposable integration database:

```powershell
npm run test:prisma:prepare
npm run test:prisma -- tests/prisma-integration/account-access.integration.test.ts
```

Expected: FAIL because Prisma backend methods are missing. If the harness reports that the database URL is not approved as disposable, stop and configure the approved test database; do not substitute a live URL.

- [ ] **Step 3: Implement account-aware Prisma authentication**

Update Prisma user selects and `toUserProfile()` to include `accountStatus`.

Change `loginWithPassword()` so valid credentials for a suspended user throw `FORBIDDEN` before session creation.

Change `requireUser()` to:

```ts
if (!user) throw new BackendError("UNAUTHENTICATED");
if (user.accountStatus === "SUSPENDED") {
  throw new BackendError("FORBIDDEN");
}
return user;
```

- [ ] **Step 4: Implement transactional suspension**

Use one interactive transaction:

```ts
async suspendUser(
  sessionToken: string,
  targetUserId: string,
  input: AccountAccessMutationInput,
): Promise<AdminUserAccount> {
  const actor = await this.requireRole(sessionToken, "admin");
  const reason = this.requireAdminReason(input.reason);
  const expectedUpdatedAt = this.requireIsoTimestamp(input.expectedUpdatedAt);

  return this.prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: targetUserId },
      include: { organizerProfile: true },
    });
    if (!target) throw new BackendError("NOT_FOUND");
    if (target.id === actor.id) throw new BackendError("FORBIDDEN");
    if (
      target.updatedAt.getTime() !== expectedUpdatedAt.getTime() ||
      target.accountStatus !== "ACTIVE"
    ) {
      throw new BackendError("CONFLICT");
    }
    if (target.role === "admin") {
      const activeAdmins = await tx.user.count({
        where: { role: "admin", accountStatus: "ACTIVE" },
      });
      if (activeAdmins <= 1) throw new BackendError("FORBIDDEN");
    }

    const now = new Date();
    const changed = await tx.user.updateMany({
      where: {
        id: target.id,
        accountStatus: "ACTIVE",
        updatedAt: target.updatedAt,
      },
      data: {
        accountStatus: "SUSPENDED",
        suspendedAt: now,
        suspendedByUserId: actor.id,
        suspensionReason: reason,
      },
    });
    if (changed.count !== 1) throw new BackendError("CONFLICT");

    await tx.session.deleteMany({ where: { userId: target.id } });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        action: "ACCOUNT_SUSPENDED",
        targetType: "User",
        targetId: target.id,
        metadata: {
          previousAccountStatus: "ACTIVE",
          nextAccountStatus: "SUSPENDED",
        },
      },
    });
    const updated = await tx.user.findUniqueOrThrow({
      where: { id: target.id },
      include: { organizerProfile: true },
    });
    return this.toAdminUserAccount(updated);
  });
}
```

Implement `restoreUser()` with the inverse status transition, the same `updatedAt` compare-and-swap, cleared suspension fields, and `ACCOUNT_RESTORED` audit.

- [ ] **Step 5: Run memory and Prisma parity tests**

Run:

```powershell
npx vitest run tests/server/account-access-domain.test.ts
npm run test:prisma -- tests/prisma-integration/account-access.integration.test.ts
```

Expected: both suites pass.

- [ ] **Step 6: Commit Prisma account access**

```powershell
git add -- src/server/prisma-backend.ts tests/prisma-integration/account-access.integration.test.ts
git commit -m "feat: persist audited account suspension"
```

---

### Task 5: Add Structured Admin Account Server Actions

**Files:**
- Modify: `src/server/session-cookie.ts`
- Create: `src/features/shared/action-state.ts`
- Create: `src/server/action-result.ts`
- Create: `src/server/admin/account-actions.ts`
- Create: `tests/server/account-access-actions.test.ts`

**Interfaces:**
- Consumes: backend account methods.
- Produces: `loadAdminUserAccountsForPage`, `suspendUserAction`, and `restoreUserAction`.

- [ ] **Step 1: Write action-runtime tests**

Create tests that inject a fake backend and session reader rather than calling `cookies()`:

```ts
test("maps stale writes to a safe conflict result", async () => {
  const action = createAccountAccessActions({
    readRequiredSessionToken: async () => "admin-session",
    getBackend: async () => ({
      suspendUser: async () => {
        throw new BackendError("CONFLICT");
      },
    }),
    revalidate: () => undefined,
  });

  const form = new FormData();
  form.set("userId", "rider-1");
  form.set("reason", "A sufficiently clear moderation reason.");
  form.set("expectedUpdatedAt", "2026-07-31T01:00:00.000Z");

  await expect(action.suspendUserAction({ status: "idle", message: "" }, form))
    .resolves.toEqual({
      status: "error",
      code: "CONFLICT",
      message: "This account changed in another session. Reload and try again.",
    });
});
```

Also cover field errors, unauthenticated, forbidden, not found, success, and unexpected exception passthrough.

- [ ] **Step 2: Run the action tests and verify failure**

Run:

```powershell
npx vitest run tests/server/account-access-actions.test.ts
```

Expected: FAIL because the action factory and result contract do not exist.

- [ ] **Step 3: Export the required session reader**

Add to `src/server/session-cookie.ts`:

```ts
export async function readRequiredSessionToken() {
  const token = await readSessionToken();
  if (!token) {
    throw new BackendError("UNAUTHENTICATED");
  }
  return token;
}
```

Import `BackendError` from `./backend`. Replace the private duplicate in `src/server/actions.ts` with this shared export in the implementation task that first touches that file.

- [ ] **Step 4: Implement the action result mapper**

Create `src/features/shared/action-state.ts` with the `ActionCode` and
`ActionState<T>` interfaces from this plan's Interfaces section.

Create `src/server/action-result.ts`:

```ts
import { BackendError } from "@/server/backend";
import type { ActionState } from "@/features/shared/action-state";

const defaultMessages = {
  UNAUTHENTICATED: "Log in with an admin account and try again.",
  FORBIDDEN: "Your account cannot perform this action.",
  INVALID_INPUT: "Review the highlighted fields and try again.",
  CONFLICT: "This information changed in another session. Reload and try again.",
  NOT_FOUND: "The requested item is no longer available.",
} as const;

export function actionError(
  error: unknown,
  overrides: Partial<typeof defaultMessages> = {},
): ActionState<never> {
  if (error instanceof BackendError && error.code in defaultMessages) {
    const code = error.code as keyof typeof defaultMessages;
    return {
      status: "error",
      code,
      message: overrides[code] ?? defaultMessages[code],
    };
  }
  throw error;
}
```

Account actions pass account-specific `CONFLICT` and `NOT_FOUND` overrides. Later
event and lead plans use the same mapper with their own entity wording.

- [ ] **Step 5: Implement Zod-backed actions**

Use strict schemas:

```ts
const accountMutationSchema = z.object({
  userId: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(10).max(500),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();
```

Export a dependency-injected `createAccountAccessActions()` for tests and real bound exports:

```ts
export const {
  loadAdminUserAccountsForPage,
  suspendUserAction,
  restoreUserAction,
} = createAccountAccessActions({
  readRequiredSessionToken,
  getBackend: getTambikeBackend,
  revalidate: (path) => revalidatePath(path),
});
```

On success, revalidate `/admin`, `/admin/users`, and `/login`; return the updated `AdminUserAccount`. On validation failure, return `fieldErrors` from `error.flatten().fieldErrors`. Do not catch unexpected errors.

- [ ] **Step 6: Run action tests**

Run:

```powershell
npx vitest run tests/server/account-access-actions.test.ts
npx eslint src/server/session-cookie.ts src/features/shared/action-state.ts src/server/action-result.ts src/server/admin/account-actions.ts tests/server/account-access-actions.test.ts
```

Expected: tests and lint pass.

- [ ] **Step 7: Commit the action layer**

```powershell
git add -- src/server/session-cookie.ts src/features/shared/action-state.ts src/server/action-result.ts src/server/admin/account-actions.ts tests/server/account-access-actions.test.ts
git commit -m "feat: add safe admin account actions"
```

---

### Task 6: Replace Local Account Overrides with Persisted UI

**Files:**
- Create: `src/features/admin/admin-user-accounts.tsx`
- Modify: `src/features/admin/admin-console.tsx`
- Modify: `src/app/admin/users/page.tsx`
- Create: `tests/server/account-access-ui.test.tsx`

**Interfaces:**
- Consumes: focused account loader/actions and `AdminUserAccount`.
- Produces: reason-confirmed, reload-safe account controls.

- [ ] **Step 1: Write UI contract tests**

Render `AdminUserAccounts` with active and suspended rows and assert:

```ts
expect(markup).toContain("User accounts");
expect(markup).toContain("Suspend account");
expect(markup).toContain("Restore account");
expect(markup).toContain('aria-live="polite"');
expect(markup).not.toContain("RBAC");
expect(markup).not.toContain("onSetStatus");
```

Read `admin-console.tsx` as text and assert it no longer contains `userStatusOverrides`.

- [ ] **Step 2: Run the UI test and verify failure**

Run:

```powershell
npx vitest run tests/server/account-access-ui.test.tsx
```

Expected: FAIL because the component does not exist and local overrides remain.

- [ ] **Step 3: Build the focused account component**

`AdminUserAccounts` is a Client Component. It receives:

```ts
type AdminUserAccountsProps = {
  currentUserId: string;
  initialAccounts: AdminUserAccount[];
};
```

Implement:

- name/email, role, verification, access, area, and last-updated fields
- mobile cards below 640px and the existing `DataTable` above 640px
- “Suspend account” disabled for the current admin
- Radix dialog with account name, required reason textarea, Cancel, and destructive Confirm
- restore dialog with required resolution reason
- `useActionState()` for each selected action
- pending submit state and `aria-live="polite"` result
- replacement of the matching row with the server-returned row only after success

The submission form must include:

```tsx
<input type="hidden" name="userId" value={selected.id} />
<input
  type="hidden"
  name="expectedUpdatedAt"
  value={selected.updatedAt}
/>
<textarea
  id="account-action-reason"
  name="reason"
  required
  minLength={10}
  maxLength={500}
/>
```

- [ ] **Step 4: Wire the server page into the existing shell**

Update `src/app/admin/users/page.tsx`:

```tsx
import { AdminConsole } from "@/features/admin/admin-console";
import { AdminUserAccounts } from "@/features/admin/admin-user-accounts";
import { loadAdminUserAccountsForPage } from "@/server/admin/account-actions";

export const metadata = {
  title: "User accounts",
  description: "Manage Tambike rider, organizer, and admin account access.",
};

export default async function Page() {
  const model = await loadAdminUserAccountsForPage();
  return (
    <AdminConsole
      section="users"
      userContent={
        model
          ? (
              <AdminUserAccounts
                currentUserId={model.currentUserId}
                initialAccounts={model.accounts}
              />
            )
          : null
      }
    />
  );
}
```

Add `userContent?: React.ReactNode` to `AdminConsole`. For the users section, render it after the existing auth/role guards. Remove `userStatusOverrides`, `setUserStatus`, `getUserRows(...overrides)`, `getUserColumns(onSetStatus, ...)`, and the old local action handlers.

- [ ] **Step 5: Run account UI and domain tests**

Run:

```powershell
npx vitest run tests/server/account-access-ui.test.tsx tests/server/account-access-actions.test.ts tests/server/account-access-domain.test.ts
npx eslint src/features/admin/admin-user-accounts.tsx src/features/admin/admin-console.tsx src/app/admin/users/page.tsx
```

Expected: all tests and lint pass.

- [ ] **Step 6: Verify with the existing dev server and Codex browser**

First check whether the dev server is already listening and reuse it. In the Codex browser:

1. Log in as admin and open `/admin/users`.
2. Suspend a disposable rider with a 10+ character reason.
3. Reload `/admin/users`; verify the rider remains suspended.
4. In a separate signed-in rider session, navigate again; verify the old session is no longer accepted.
5. Restore the rider with a reason and reload; verify access is active and verification status is unchanged.
6. Try the current admin row; verify suspension is unavailable.
7. At 320px and 390x844, verify no page-level horizontal overflow and that dialogs fit the viewport.
8. Confirm the browser console has no warnings or errors.

Do not perform this mutation check if localhost is connected to a remote/live database. Use explicit memory mode or an approved disposable local database.

- [ ] **Step 7: Commit the account UI**

```powershell
git add -- src/features/admin/admin-user-accounts.tsx src/features/admin/admin-console.tsx src/app/admin/users/page.tsx tests/server/account-access-ui.test.tsx
git commit -m "fix: persist admin account controls"
```

---

### Task 7: Run the Account-Access Slice Gate

**Files:**
- Verify only; modify files only to fix failures within this slice.

**Interfaces:**
- Confirms all outputs promised by this plan.

- [ ] **Step 1: Run focused automated gates**

```powershell
npm run db:generate
npx vitest run tests/server/database-url.test.ts tests/server/account-access-domain.test.ts tests/server/account-access-actions.test.ts tests/server/account-access-ui.test.tsx tests/server/backend-domain.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run the disposable Prisma integration gate**

```powershell
npm run test:prisma -- tests/prisma-integration/account-access.integration.test.ts
```

Expected: pass against the approved disposable integration database.

- [ ] **Step 3: Run repository static gates**

```powershell
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 4: Inspect the final slice diff**

```powershell
git status --short
git diff --check
git log --oneline -7
```

Expected: no whitespace errors; existing unrelated dirty files remain untouched; account-access commits are visible as separate checkpoints.
