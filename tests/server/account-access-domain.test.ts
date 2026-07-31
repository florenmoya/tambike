import { describe, expect, test } from "vitest";
import { createTambikeTestBackend } from "../../src/server/testing";
import { createTestActors } from "./support/tambike-fixtures";

describe("account access domain", () => {
  test("lists safe account details in a stable order for admins only", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "account-list");

    await expect(
      backend.listAdminUserAccounts(actors.rider.sessionToken),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const accounts = await backend.listAdminUserAccounts(
      actors.admin.sessionToken,
    );
    expect(accounts.map((account) => account.displayName)).toEqual([
      "Fixture Outsider",
      "Fixture Rider",
      "Tambike Ops",
      "Tambike Organizer",
    ]);
    expect(
      accounts.find((account) => account.id === actors.rider.user.id),
    ).toMatchObject({
      verificationStatus: "UNVERIFIED",
      accountStatus: "ACTIVE",
      updatedAt: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      ),
    });
    expect(JSON.stringify(accounts)).not.toContain("passwordHash");
    expect(JSON.stringify(accounts)).not.toContain("suspendedByUserId");
  });

  test("suspends an account, revokes every session, and preserves verification", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "account-suspend");
    const secondSession = await backend.loginWithPassword(
      actors.rider.user.email,
      "password123",
    );
    const before = (
      await backend.listAdminUserAccounts(actors.admin.sessionToken)
    ).find((user) => user.id === actors.rider.user.id)!;

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
      backend.loginWithPassword(actors.rider.user.email, "wrong-password"),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(
      backend.loginWithPassword(actors.rider.user.email, "password123"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(backend.auditCount("ACCOUNT_SUSPENDED")).resolves.toBe(1);
  });

  test("restores access without changing verification", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "account-restore");
    const before = (
      await backend.listAdminUserAccounts(actors.admin.sessionToken)
    ).find((user) => user.id === actors.rider.user.id)!;
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
    await expect(
      backend.loginWithPassword(actors.rider.user.email, "password123"),
    ).resolves.toMatchObject({
      user: {
        verificationStatus: "UNVERIFIED",
        accountStatus: "ACTIVE",
      },
    });
    await expect(backend.auditCount("ACCOUNT_RESTORED")).resolves.toBe(1);
  });

  test("rejects self-suspension, last-admin suspension, stale writes, and non-admins", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "account-guards");
    const accounts = await backend.listAdminUserAccounts(
      actors.admin.sessionToken,
    );
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

  test("validates reasons and rejects invalid account transitions", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "account-validation");
    const rider = (
      await backend.listAdminUserAccounts(actors.admin.sessionToken)
    ).find((user) => user.id === actors.rider.user.id)!;

    await expect(
      backend.suspendUser(actors.admin.sessionToken, rider.id, {
        reason: "too short",
        expectedUpdatedAt: rider.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      backend.suspendUser(actors.admin.sessionToken, rider.id, {
        reason: "x".repeat(501),
        expectedUpdatedAt: rider.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      backend.suspendUser(actors.admin.sessionToken, "missing-user", {
        reason: "A valid reason for a missing account.",
        expectedUpdatedAt: rider.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      backend.restoreUser(actors.admin.sessionToken, rider.id, {
        reason: "The account is already active.",
        expectedUpdatedAt: rider.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const suspended = await backend.suspendUser(
      actors.admin.sessionToken,
      rider.id,
      {
        reason: "  Exactly ten  ",
        expectedUpdatedAt: rider.updatedAt,
      },
    );
    expect(suspended.suspendedReason).toBe("Exactly ten");
    await expect(
      backend.restoreUser(actors.admin.sessionToken, rider.id, {
        reason: "A stale restore reason.",
        expectedUpdatedAt: rider.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      backend.restoreUser(actors.outsider.sessionToken, rider.id, {
        reason: "A rider cannot restore an account.",
        expectedUpdatedAt: suspended.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
