import { createHash, randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { describe, expect, test } from "vitest";

import { PrismaTambikeBackend } from "../../src/server/prisma-backend";
import {
  closePrismaIntegrationClientPair,
  createPrismaIntegrationClientPair,
  createPrismaIntegrationClients,
} from "./clients";
import { createPrismaEventFixture } from "./fixtures";

type PrismaEventFixture = Awaited<
  ReturnType<typeof createPrismaEventFixture>
>;

const retainedAdminStateSelect = {
  id: true,
  accountStatus: true,
  suspendedAt: true,
  suspendedByUserId: true,
  suspensionReason: true,
  updatedAt: true,
  sessions: {
    select: {
      id: true,
      tokenHash: true,
      userId: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { id: "asc" as const },
  },
} satisfies Prisma.UserSelect;

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function createBackendClients(
  applicationNames = [
    "tambike-account-access-primary",
    "tambike-account-access-secondary",
  ],
) {
  let clientIndex = 0;
  return createPrismaIntegrationClientPair(process.env, (databaseUrl) => {
    const namedDatabaseUrl = new URL(databaseUrl);
    namedDatabaseUrl.searchParams.set(
      "application_name",
      applicationNames[clientIndex++]!,
    );
    const backend = PrismaTambikeBackend.create(namedDatabaseUrl.toString());
    return { backend, $disconnect: () => backend.disconnect() };
  });
}

async function waitForApplicationLock(
  prisma: PrismaClient,
  applicationName: string,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [result] = await prisma.$queryRaw<Array<{ blocked: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS "blocked"
        FROM pg_stat_activity
        WHERE application_name = ${applicationName}
          AND wait_event_type = 'Lock'
      `,
    );
    if (Number(result?.blocked ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const activity = await prisma.$queryRaw<
    Array<{
      applicationName: string;
      query: string;
      state: string;
      waitEvent: string | null;
      waitEventType: string | null;
    }>
  >(
    Prisma.sql`
      SELECT
        application_name AS "applicationName",
        LEFT(query, 160) AS "query",
        state,
        wait_event AS "waitEvent",
        wait_event_type AS "waitEventType"
      FROM pg_stat_activity
      WHERE application_name = ${applicationName}
    `,
  );
  throw new Error(
    `Timed out waiting for ${applicationName} to block: ${JSON.stringify(activity)}`,
  );
}

async function cleanupPrismaEventFixture(
  prisma: PrismaClient,
  fixture: PrismaEventFixture,
) {
  const userIds = [
    fixture.adminId,
    fixture.organizerId,
    ...fixture.riders.map((rider) => rider.userId),
  ];
  await prisma.$transaction(async (tx) => {
    await tx.auditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: userIds } },
          { targetId: { in: userIds } },
        ],
      },
    });
    await tx.event.deleteMany({ where: { id: fixture.eventId } });
    await tx.session.deleteMany({ where: { userId: { in: userIds } } });
    await tx.organizerProfile.deleteMany({
      where: { id: fixture.organizerProfileId },
    });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
}

async function readRetainedAdminState(
  prisma: PrismaClient,
  userIds?: string[],
) {
  return prisma.user.findMany({
    where: {
      role: "admin",
      ...(userIds ? { id: { in: userIds } } : { accountStatus: "ACTIVE" }),
    },
    select: retainedAdminStateSelect,
    orderBy: { id: "asc" },
  });
}

async function restoreRetainedAdminState(
  prisma: PrismaClient,
  retainedAdmins: Awaited<ReturnType<typeof readRetainedAdminState>>,
) {
  const userIds = retainedAdmins.map((admin) => admin.id);
  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { userId: { in: userIds } } });
    for (const admin of retainedAdmins) {
      await tx.user.update({
        where: { id: admin.id },
        data: {
          accountStatus: admin.accountStatus,
          suspendedAt: admin.suspendedAt,
          suspendedByUserId: admin.suspendedByUserId,
          suspensionReason: admin.suspensionReason,
          updatedAt: admin.updatedAt,
        },
      });
    }
    const sessions = retainedAdmins.flatMap((admin) => admin.sessions);
    if (sessions.length > 0) {
      await tx.session.createMany({ data: sessions });
    }
  });
}

describe("Prisma account access", () => {
  test("persists suspension, revokes sessions, audits safely, and restores verification", async () => {
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createBackendClients();
    const suffix = `account-access-${randomUUID()}`;

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, {
        suffix,
      });
      await rawClients.primary.user.update({
        where: { id: fixture.riders[0].userId },
        data: { passwordHash: await bcrypt.hash("password123", 4) },
      });
      const secondSession = await backendClients.primary.backend.loginWithPassword(
        `integration-rider-1-${suffix}@example.test`,
        "password123",
      );
      const accounts = await backendClients.primary.backend.listAdminUserAccounts(
        fixture.adminSession,
      );
      const before = accounts.find(
        (user) => user.id === fixture.riders[0].userId,
      )!;

      expect(accounts.map((account) => account.displayName)).toEqual(
        [...accounts]
          .sort(
            (left, right) =>
              left.displayName.localeCompare(right.displayName) ||
              left.id.localeCompare(right.id),
          )
          .map((account) => account.displayName),
      );
      expect(JSON.stringify(accounts)).not.toContain("passwordHash");
      expect(JSON.stringify(accounts)).not.toContain("suspendedByUserId");

      const suspensionReason = "Disposable integration suspension reason.";
      const suspended = await backendClients.primary.backend.suspendUser(
        fixture.adminSession,
        fixture.riders[0].userId,
        {
          reason: `  ${suspensionReason}  `,
          expectedUpdatedAt: before.updatedAt,
        },
      );

      expect(suspended).toMatchObject({
        verificationStatus: "UNVERIFIED",
        accountStatus: "SUSPENDED",
        suspendedReason: suspensionReason,
      });
      expect(Date.parse(suspended.updatedAt)).toBeGreaterThan(
        Date.parse(before.updatedAt),
      );
      await expect(
        rawClients.secondary.session.count({
          where: { userId: fixture.riders[0].userId },
        }),
      ).resolves.toBe(0);
      await expect(
        backendClients.secondary.backend.getCurrentUser(
          secondSession.sessionToken,
        ),
      ).resolves.toBeNull();
      await expect(
        backendClients.secondary.backend.loginWithPassword(
          `integration-rider-1-${suffix}@example.test`,
          "wrong-password",
        ),
      ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      await expect(
        backendClients.secondary.backend.loginWithPassword(
          `integration-rider-1-${suffix}@example.test`,
          "password123",
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const retainedSession = `retained-suspended-session-${suffix}`;
      await rawClients.primary.session.create({
        data: {
          tokenHash: hashSessionToken(retainedSession),
          userId: fixture.riders[0].userId,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await expect(
        backendClients.primary.backend.getCurrentUser(retainedSession),
      ).resolves.toBeNull();
      await expect(
        backendClients.primary.backend.getSnapshot(retainedSession),
      ).resolves.toMatchObject({
        currentUser: null,
        passes: [],
        passCreated: false,
      });
      await rawClients.primary.session.deleteMany({
        where: { userId: fixture.riders[0].userId },
      });

      const suspensionAudit = await rawClients.secondary.auditLog.findFirstOrThrow(
        {
          where: {
            action: "ACCOUNT_SUSPENDED",
            targetId: fixture.riders[0].userId,
          },
        },
      );
      expect(suspensionAudit).toMatchObject({
        actorUserId: fixture.adminId,
        targetType: "User",
        metadata: {
          previousAccountStatus: "ACTIVE",
          nextAccountStatus: "SUSPENDED",
          reason: suspensionReason,
        },
      });
      expect(JSON.stringify(suspensionAudit.metadata)).not.toContain(
        fixture.riders[0].sessionToken,
      );
      expect(JSON.stringify(suspensionAudit.metadata)).not.toContain(
        "password123",
      );

      const restorationReason = "Disposable integration restoration reason.";
      const restored = await backendClients.primary.backend.restoreUser(
        fixture.adminSession,
        fixture.riders[0].userId,
        {
          reason: `  ${restorationReason}  `,
          expectedUpdatedAt: suspended.updatedAt,
        },
      );
      expect(restored).toMatchObject({
        verificationStatus: "UNVERIFIED",
        accountStatus: "ACTIVE",
        suspendedAt: undefined,
        suspendedReason: undefined,
      });
      expect(Date.parse(restored.updatedAt)).toBeGreaterThan(
        Date.parse(suspended.updatedAt),
      );
      await expect(
        rawClients.secondary.auditLog.findFirstOrThrow({
          where: {
            action: "ACCOUNT_RESTORED",
            targetId: fixture.riders[0].userId,
          },
        }),
      ).resolves.toMatchObject({
        metadata: {
          previousAccountStatus: "SUSPENDED",
          nextAccountStatus: "ACTIVE",
          reason: restorationReason,
        },
      });
      await expect(
        rawClients.secondary.user.findUniqueOrThrow({
          where: { id: fixture.riders[0].userId },
          select: {
            accountStatus: true,
            suspendedAt: true,
            suspendedByUserId: true,
            suspensionReason: true,
          },
        }),
      ).resolves.toEqual({
        accountStatus: "ACTIVE",
        suspendedAt: null,
        suspendedByUserId: null,
        suspensionReason: null,
      });
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });

  test.each([
    {
      writer: "basic profile",
      update: async (
        backend: PrismaTambikeBackend,
        sessionToken: string,
      ) =>
        backend.updateProfile(sessionToken, {
          displayName: "Monotonic Basic Profile",
          area: "Pasig City",
          bikeModel: "Yamaha NMAX",
        }),
    },
    {
      writer: "member profile",
      update: async (
        backend: PrismaTambikeBackend,
        sessionToken: string,
      ) =>
        backend.updateMemberProfile(sessionToken, {
          displayName: "Monotonic Member Profile",
          area: "Mandaluyong City",
          bio: "A disposable profile concurrency regression.",
          visibility: "PUBLIC",
          defaultRosterIdentity: "VISIBLE",
        }),
    },
  ])(
    "$writer edits advance updatedAt by one millisecond and stale the prior account token",
    async ({ update }) => {
      const rawClients = createPrismaIntegrationClients();
      const backendClients = createBackendClients();
      const suffix = `account-profile-token-${randomUUID()}`;
      let fixture: PrismaEventFixture | undefined;

      try {
        fixture = await createPrismaEventFixture(rawClients.primary, { suffix });
        const riderId = fixture.riders[0].userId;
        const previousUpdatedAt = new Date("2099-08-03T00:00:00.000Z");
        await rawClients.primary.user.update({
          where: { id: riderId },
          data: { updatedAt: previousUpdatedAt },
        });

        await update(
          backendClients.primary.backend,
          fixture.riders[0].sessionToken,
        );

        const updated = await rawClients.secondary.user.findUniqueOrThrow({
          where: { id: riderId },
          select: { updatedAt: true },
        });
        expect(updated.updatedAt.toISOString()).toBe(
          "2099-08-03T00:00:00.001Z",
        );
        await expect(
          backendClients.secondary.backend.suspendUser(
            fixture.adminSession,
            riderId,
            {
              reason: "The pre-profile-edit token must be rejected.",
              expectedUpdatedAt: previousUpdatedAt.toISOString(),
            },
          ),
        ).rejects.toMatchObject({ code: "CONFLICT" });
      } finally {
        if (fixture) {
          await cleanupPrismaEventFixture(rawClients.primary, fixture);
        }
        await closePrismaIntegrationClientPair(backendClients);
        await closePrismaIntegrationClientPair(rawClients);
      }
    },
  );

  test("serializes login and suspension on the user row in either race order", async () => {
    for (const order of ["login-first", "suspension-first"] as const) {
      const suffix = `account-login-race-${order}-${randomUUID()}`;
      const applicationKey = randomUUID().slice(0, 8);
      const loginApplication = `tbk-aa-${applicationKey}-login`;
      const suspensionApplication = `tbk-aa-${applicationKey}-suspension`;
      const rawClients = createPrismaIntegrationClients();
      const backendClients = createBackendClients([
        loginApplication,
        suspensionApplication,
      ]);
      let fixture: PrismaEventFixture | undefined;

      try {
        fixture = await createPrismaEventFixture(rawClients.primary, {
          suffix,
        });
        const riderId = fixture.riders[0].userId;
        const riderEmail = `integration-rider-1-${suffix}@example.test`;
        await rawClients.primary.user.update({
          where: { id: riderId },
          data: { passwordHash: await bcrypt.hash("password123", 4) },
        });
        const before = (
          await backendClients.primary.backend.listAdminUserAccounts(
            fixture.adminSession,
          )
        ).find((account) => account.id === riderId)!;

        type LoginOutcome =
          | {
              status: "fulfilled";
              value: Awaited<
                ReturnType<
                  typeof backendClients.primary.backend.loginWithPassword
                >
              >;
            }
          | { status: "rejected"; reason: unknown };
        type SuspensionOutcome =
          | {
              status: "fulfilled";
              value: Awaited<
                ReturnType<typeof backendClients.primary.backend.suspendUser>
              >;
            }
          | { status: "rejected"; reason: unknown };

        let loginOutcomePromise: Promise<LoginOutcome> | undefined;
        let suspensionOutcomePromise: Promise<SuspensionOutcome> | undefined;
        const startLogin = () => {
          loginOutcomePromise = backendClients.primary.backend
            .loginWithPassword(riderEmail, "password123")
            .then(
              (value) => ({ status: "fulfilled" as const, value }),
              (reason: unknown) => ({
                status: "rejected" as const,
                reason,
              }),
            );
        };
        const startSuspension = () => {
          suspensionOutcomePromise = backendClients.secondary.backend
            .suspendUser(fixture!.adminSession, riderId, {
              reason: `Deterministic ${order} account race suspension.`,
              expectedUpdatedAt: before.updatedAt,
            })
            .then(
              (value) => ({ status: "fulfilled" as const, value }),
              (reason: unknown) => ({
                status: "rejected" as const,
                reason,
              }),
            );
        };

        await rawClients.primary.$transaction(async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${riderId} FOR UPDATE`,
          );
          if (order === "login-first") {
            startLogin();
            await waitForApplicationLock(
              rawClients.secondary,
              loginApplication,
            );
            startSuspension();
            await waitForApplicationLock(
              rawClients.secondary,
              suspensionApplication,
            );
          } else {
            startSuspension();
            await waitForApplicationLock(
              rawClients.secondary,
              suspensionApplication,
            );
            startLogin();
            await waitForApplicationLock(
              rawClients.secondary,
              loginApplication,
            );
          }
        });

        const [loginOutcome, suspensionOutcome] = await Promise.all([
          loginOutcomePromise!,
          suspensionOutcomePromise!,
        ]);
        expect(suspensionOutcome.status).toBe("fulfilled");
        if (suspensionOutcome.status !== "fulfilled") {
          throw suspensionOutcome.reason;
        }
        await expect(
          rawClients.secondary.session.count({ where: { userId: riderId } }),
        ).resolves.toBe(0);

        if (order === "login-first") {
          expect(loginOutcome.status).toBe("fulfilled");
        } else {
          expect(loginOutcome).toMatchObject({
            status: "rejected",
            reason: { code: "FORBIDDEN" },
          });
        }

        await backendClients.secondary.backend.restoreUser(
          fixture.adminSession,
          riderId,
          {
            reason: `Restore after deterministic ${order} race.`,
            expectedUpdatedAt: suspensionOutcome.value.updatedAt,
          },
        );
        if (loginOutcome.status === "fulfilled") {
          await expect(
            backendClients.primary.backend.getCurrentUser(
              loginOutcome.value.sessionToken,
            ),
          ).resolves.toBeNull();
          await expect(
            rawClients.secondary.session.findUnique({
              where: {
                tokenHash: hashSessionToken(loginOutcome.value.sessionToken),
              },
            }),
          ).resolves.toBeNull();
        }
        await expect(
          rawClients.secondary.session.count({ where: { userId: riderId } }),
        ).resolves.toBe(0);
      } finally {
        try {
          if (fixture) {
            await cleanupPrismaEventFixture(rawClients.primary, fixture);
          }
        } finally {
          await closePrismaIntegrationClientPair(backendClients);
          await closePrismaIntegrationClientPair(rawClients);
        }
      }
    }
  });

  test("rejects a stale updatedAt account transition", async () => {
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createBackendClients();

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, {
        suffix: `account-stale-${randomUUID()}`,
      });

      await expect(
        backendClients.primary.backend.suspendUser(
          fixture.adminSession,
          fixture.riders[0].userId,
          {
            reason: "A stale admin view must lose the update race.",
            expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
          },
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        rawClients.secondary.user.findUniqueOrThrow({
          where: { id: fixture.riders[0].userId },
          select: { accountStatus: true },
        }),
      ).resolves.toEqual({ accountStatus: "ACTIVE" });
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });

  test("rejects self-suspension", async () => {
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createBackendClients();

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, {
        suffix: `account-self-${randomUUID()}`,
      });
      const admin = (
        await backendClients.primary.backend.listAdminUserAccounts(
          fixture.adminSession,
        )
      ).find((account) => account.id === fixture.adminId)!;

      await expect(
        backendClients.primary.backend.suspendUser(
          fixture.adminSession,
          fixture.adminId,
          {
            reason: "An administrator cannot suspend their own account.",
            expectedUpdatedAt: admin.updatedAt,
          },
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });

  test("serializes mutual suspension so one active admin remains", async () => {
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createBackendClients();
    const retainedAdmins = await readRetainedAdminState(rawClients.primary);
    const retainedAdminIds = retainedAdmins.map((admin) => admin.id);
    let fixture: PrismaEventFixture | undefined;

    try {
      await rawClients.primary.user.updateMany({
        where: {
          id: { in: retainedAdminIds },
          role: "admin",
          accountStatus: "ACTIVE",
        },
        data: { accountStatus: "SUSPENDED" },
      });
      fixture = await createPrismaEventFixture(rawClients.primary, {
        suffix: `account-last-admin-${randomUUID()}`,
      });
      const fixtureAdminId = fixture.adminId;
      const fixtureRiderId = fixture.riders[0].userId;
      await rawClients.primary.user.update({
        where: { id: fixtureRiderId },
        data: { role: "admin" },
      });
      const accounts = await backendClients.primary.backend.listAdminUserAccounts(
        fixture.adminSession,
      );
      const firstAdmin = accounts.find(
        (account) => account.id === fixtureAdminId,
      )!;
      const secondAdmin = accounts.find(
        (account) => account.id === fixtureRiderId,
      )!;

      const results = await Promise.allSettled([
        backendClients.primary.backend.suspendUser(
          fixture.adminSession,
          secondAdmin.id,
          {
            reason: "Mutual admin race from the first administrator.",
            expectedUpdatedAt: secondAdmin.updatedAt,
          },
        ),
        backendClients.secondary.backend.suspendUser(
          fixture.riders[0].sessionToken,
          firstAdmin.id,
          {
            reason: "Mutual admin race from the second administrator.",
            expectedUpdatedAt: firstAdmin.updatedAt,
          },
        ),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
        1,
      );
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(
        1,
      );
      expect(
        await rawClients.primary.user.count({
          where: { role: "admin", accountStatus: "ACTIVE" },
        }),
      ).toBe(1);
      await expect(
        rawClients.secondary.auditLog.count({
          where: {
            action: "ACCOUNT_SUSPENDED",
            targetId: { in: [firstAdmin.id, secondAdmin.id] },
          },
        }),
      ).resolves.toBe(1);
    } finally {
      try {
        try {
          await restoreRetainedAdminState(rawClients.primary, retainedAdmins);
          await expect(
            readRetainedAdminState(rawClients.secondary, retainedAdminIds),
          ).resolves.toEqual(retainedAdmins);
        } finally {
          if (fixture) {
            const fixtureUserIds = [
              fixture.adminId,
              fixture.organizerId,
              ...fixture.riders.map((rider) => rider.userId),
            ];
            await cleanupPrismaEventFixture(rawClients.primary, fixture);
            await expect(
              rawClients.secondary.user.count({
                where: { id: { in: fixtureUserIds } },
              }),
            ).resolves.toBe(0);
            await expect(
              rawClients.secondary.auditLog.count({
                where: {
                  OR: [
                    { actorUserId: { in: fixtureUserIds } },
                    { targetId: { in: fixtureUserIds } },
                  ],
                },
              }),
            ).resolves.toBe(0);
          }
        }
      } finally {
        await closePrismaIntegrationClientPair(backendClients);
        await closePrismaIntegrationClientPair(rawClients);
      }
    }
  });

  test("rejects account access reads and writes from non-admins", async () => {
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createBackendClients();

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, {
        suffix: `account-outsider-${randomUUID()}`,
      });
      const riderId = fixture.riders[0].userId;

      await expect(
        backendClients.primary.backend.listAdminUserAccounts(
          fixture.riders[0].sessionToken,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        backendClients.primary.backend.suspendUser(
          fixture.riders[0].sessionToken,
          riderId,
          {
            reason: "A rider cannot suspend any user account.",
            expectedUpdatedAt: new Date().toISOString(),
          },
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        backendClients.primary.backend.restoreUser(
          fixture.organizerSession,
          riderId,
          {
            reason: "An organizer cannot restore any user account.",
            expectedUpdatedAt: new Date().toISOString(),
          },
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });
});
