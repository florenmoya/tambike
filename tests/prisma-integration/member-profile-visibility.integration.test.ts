import { randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";

import { PrismaTambikeBackend } from "../../src/server/prisma-backend";
import { profileSlugBase } from "../../src/server/member-profiles/profile-domain";
import {
  closePrismaIntegrationClientPair,
  createPrismaIntegrationClientPair,
  createPrismaIntegrationClients,
} from "./clients";
import { createPrismaEventFixture } from "./fixtures";

const profileInput = {
  displayName: "Integration Profile Rider",
  area: "Antipolo",
  bio: "A disposable profile used only by guarded integration tests.",
  visibility: "PUBLIC" as const,
  defaultRosterIdentity: "VISIBLE" as const,
};

describe("Prisma member profile visibility", () => {
  test("matches visibility, sanitization, editor, motorcycle, and snapshot policy", async () => {
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createPrismaIntegrationClientPair(process.env, (databaseUrl) => {
      const backend = PrismaTambikeBackend.create(databaseUrl);
      return { backend, $disconnect: () => backend.disconnect() };
    });
    const suffix = randomUUID();

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, { suffix, riderCount: 2 });
      const [owner, outsider] = fixture.riders;
      if (!owner || !outsider) throw new Error("PROFILE_FIXTURE_RIDERS_MISSING");

      await expect(backendClients.primary.backend.getMemberProfileEditor(owner.sessionToken)).resolves.toMatchObject({
        slug: null,
        isPublished: false,
        visibility: "PRIVATE",
        defaultRosterIdentity: "ANONYMOUS",
      });
      await expect(backendClients.primary.backend.getMemberProfile(undefined, "integration-profile-rider")).rejects.toMatchObject({ code: "NOT_FOUND" });

      const saved = await backendClients.primary.backend.updateMemberProfile(owner.sessionToken, profileInput);
      expect(saved.slug).toBe("integration-profile-rider");
      const publicView = await backendClients.primary.backend.getMemberProfile(undefined, saved.slug!);
      expect(publicView).toMatchObject({ displayName: profileInput.displayName, visibility: "PUBLIC" });
      for (const forbidden of ["email", "verificationStatus", "userId", "objectKey", "storageKey", "passwordHash"]) {
        expect(JSON.stringify(publicView)).not.toContain(forbidden);
      }
      expect(JSON.stringify(publicView)).not.toMatch(/"id"\s*:/);

      await backendClients.primary.backend.updateMemberProfile(owner.sessionToken, {
        ...profileInput,
        visibility: "MEMBERS_ONLY",
      });
      await expect(backendClients.primary.backend.getMemberProfile(undefined, saved.slug!)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(backendClients.primary.backend.getMemberProfile(outsider.sessionToken, saved.slug!)).resolves.toMatchObject({ visibility: "MEMBERS_ONLY" });

      await backendClients.primary.backend.updateMemberProfile(owner.sessionToken, {
        ...profileInput,
        visibility: "PRIVATE",
      });
      await expect(backendClients.primary.backend.getMemberProfile(owner.sessionToken, saved.slug!)).resolves.toMatchObject({ visibility: "PRIVATE" });
      await expect(backendClients.primary.backend.getMemberProfile(fixture.adminSession, saved.slug!)).resolves.toMatchObject({ visibility: "PRIVATE" });
      await expect(backendClients.primary.backend.getMemberProfile(outsider.sessionToken, saved.slug!)).rejects.toMatchObject({ code: "NOT_FOUND" });

      await expect(backendClients.primary.backend.updateMemberProfile(owner.sessionToken, {
        ...profileInput,
        displayName: "Renamed Integration Rider",
      })).resolves.toMatchObject({ slug: saved.slug, displayName: "Renamed Integration Rider" });

      await expect(backendClients.primary.backend.upsertMotorcycle(owner.sessionToken, {
        make: "Honda",
        model: "CB650R",
        year: 2025,
        displacementCc: 649,
        nickname: "Ember",
      })).resolves.toMatchObject({ make: "Honda", model: "CB650R", photos: [] });
      await expect(rawClients.secondary.motorcycle.findUnique({ where: { userId: owner.userId } })).resolves.toMatchObject({ make: "Honda", model: "CB650R" });

      expect((await backendClients.primary.backend.getSnapshot()).users).toEqual([]);
      expect((await backendClients.primary.backend.getSnapshot(owner.sessionToken)).users).toEqual([]);
      expect((await backendClients.primary.backend.getSnapshot(fixture.organizerSession)).users).toEqual([]);
      expect((await backendClients.primary.backend.getSnapshot(owner.sessionToken)).currentUser?.email).toContain("integration-rider");
      expect((await backendClients.primary.backend.getSnapshot(fixture.adminSession)).users.some((user) => user.id === owner.userId)).toBe(true);

      await expect(backendClients.primary.backend.updateMemberProfile(owner.sessionToken, { ...profileInput, bio: "x".repeat(501) })).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(backendClients.primary.backend.upsertMotorcycle(owner.sessionToken, { make: "Honda", model: "CB650R", year: 1884 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });

  test("allocates deterministic collision suffixes under concurrent publication", async () => {
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createPrismaIntegrationClientPair(process.env, (databaseUrl) => {
      const backend = PrismaTambikeBackend.create(databaseUrl);
      return { backend, $disconnect: () => backend.disconnect() };
    });
    const suffix = randomUUID();

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, { suffix, riderCount: 2 });
      const [first, second] = fixture.riders;
      if (!first || !second) throw new Error("PROFILE_FIXTURE_RIDERS_MISSING");
      const displayName = `Collision ${suffix}`;
      const [firstSaved, secondSaved] = await Promise.all([
        backendClients.primary.backend.updateMemberProfile(first.sessionToken, { ...profileInput, displayName }),
        backendClients.secondary.backend.updateMemberProfile(second.sessionToken, { ...profileInput, displayName }),
      ]);

      const base = profileSlugBase(displayName);
      expect([firstSaved.slug, secondSaved.slug].sort()).toEqual([base, `${base}-2`].sort());
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });

  test("serializes concurrent first saves for the same owner and preserves one slug", async () => {
    const rawClients = createPrismaIntegrationClients();
    const backendClients = createPrismaIntegrationClientPair(process.env, (databaseUrl) => {
      const backend = PrismaTambikeBackend.create(databaseUrl);
      return { backend, $disconnect: () => backend.disconnect() };
    });
    const suffix = randomUUID();

    try {
      const fixture = await createPrismaEventFixture(rawClients.primary, { suffix, riderCount: 2 });
      const [sameNameOwner, differentNameOwner] = fixture.riders;
      if (!sameNameOwner || !differentNameOwner) throw new Error("PROFILE_FIXTURE_RIDERS_MISSING");

      const sameName = `Same Owner ${suffix}`;
      const sameNameBase = profileSlugBase(sameName);
      const sameNameResults = await Promise.all([
        backendClients.primary.backend.updateMemberProfile(sameNameOwner.sessionToken, {
          ...profileInput,
          displayName: sameName,
        }),
        backendClients.secondary.backend.updateMemberProfile(sameNameOwner.sessionToken, {
          ...profileInput,
          displayName: sameName,
        }),
      ]);
      expect(sameNameResults.map((result) => result.slug)).toEqual([sameNameBase, sameNameBase]);
      await expect(
        rawClients.primary.user.findUniqueOrThrow({
          where: { id: sameNameOwner.userId },
          select: { profileSlug: true },
        }),
      ).resolves.toEqual({ profileSlug: sameNameBase });

      const firstName = `First Owner Name ${suffix}`;
      const secondName = `Second Owner Name ${suffix}`;
      const allowedSlugs = [profileSlugBase(firstName), profileSlugBase(secondName)];
      const differentNameResults = await Promise.all([
        backendClients.primary.backend.updateMemberProfile(differentNameOwner.sessionToken, {
          ...profileInput,
          displayName: firstName,
        }),
        backendClients.secondary.backend.updateMemberProfile(differentNameOwner.sessionToken, {
          ...profileInput,
          displayName: secondName,
        }),
      ]);
      expect(new Set(differentNameResults.map((result) => result.slug)).size).toBe(1);
      expect(allowedSlugs).toContain(differentNameResults[0]?.slug);
      const persisted = await rawClients.primary.user.findUniqueOrThrow({
        where: { id: differentNameOwner.userId },
        select: { profileSlug: true },
      });
      expect(persisted.profileSlug).toBe(differentNameResults[0]?.slug);
    } finally {
      await closePrismaIntegrationClientPair(backendClients);
      await closePrismaIntegrationClientPair(rawClients);
    }
  });
});
