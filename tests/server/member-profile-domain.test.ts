import { describe, expect, test } from "vitest";

import {
  MEMBER_PROFILE_LIMITS,
  canViewMemberProfile,
  parseMotorcycleInput,
  parseProfileInput,
  profileOwnerLockResource,
  profileSlugBase,
  profileSlugLockResource,
  resolveStableProfileSlug,
  toMemberProfileView,
} from "../../src/server/member-profiles/profile-domain";
import { createTambikeTestBackend } from "../../src/server/testing";
import { createTestActors } from "./support/tambike-fixtures";

const profileInput = {
  displayName: "  Mika Santos  ",
  area: "  Davao City  ",
  bio: "  Weekend rider and careful garage keeper.  ",
  visibility: "PUBLIC" as const,
  defaultRosterIdentity: "VISIBLE" as const,
};

describe("member profile policy and sanitization", () => {
  test("applies public, member, owner, and admin visibility exactly", () => {
    expect(canViewMemberProfile(null, "PUBLIC")).toBe(true);
    expect(canViewMemberProfile(null, "MEMBERS_ONLY")).toBe(false);
    expect(canViewMemberProfile({ role: "rider", ownsProfile: false }, "MEMBERS_ONLY")).toBe(true);
    expect(canViewMemberProfile({ role: "rider", ownsProfile: false }, "PRIVATE")).toBe(false);
    expect(canViewMemberProfile({ role: "rider", ownsProfile: true }, "PRIVATE")).toBe(true);
    expect(canViewMemberProfile({ role: "admin", ownsProfile: false }, "PRIVATE")).toBe(true);
  });

  test("creates normalized bounded slug bases with a safe fallback", () => {
    expect(profileSlugBase("  Míka Santos — Sample Rider  ")).toBe("mika-santos-sample-rider");
    expect(profileSlugBase("🏍️")).toBe("rider");
    expect(profileSlugBase("x".repeat(80))).toHaveLength(48);
  });

  test("uses separate namespaced owner and candidate-slug lock resources", () => {
    expect(profileOwnerLockResource("user-123")).toBe("tambike:member-profile-owner:user-123");
    expect(profileSlugLockResource("same-rider")).toBe("tambike:member-profile-slug:same-rider");
  });

  test("acquires the owner lock before re-reading or allocating a first-save slug", async () => {
    const calls: string[] = [];
    const slug = await resolveStableProfileSlug("New Rider", {
      acquireOwnerLock: async () => {
        calls.push("owner-lock");
      },
      readCurrentSlug: async () => {
        calls.push("read-current");
        return null;
      },
      acquireSlugLock: async (base) => {
        calls.push(`slug-lock:${base}`);
      },
      allocateSlug: async (base) => {
        calls.push(`allocate:${base}`);
        return base;
      },
    });

    expect(slug).toBe("new-rider");
    expect(calls).toEqual([
      "owner-lock",
      "read-current",
      "slug-lock:new-rider",
      "allocate:new-rider",
    ]);
  });

  test("returns the authoritative slug after owner locking without reallocating", async () => {
    const calls: string[] = [];
    const slug = await resolveStableProfileSlug("Changed Name", {
      acquireOwnerLock: async () => {
        calls.push("owner-lock");
      },
      readCurrentSlug: async () => {
        calls.push("read-current");
        return "original-slug";
      },
      acquireSlugLock: async () => {
        calls.push("unexpected-slug-lock");
      },
      allocateSlug: async () => {
        calls.push("unexpected-allocation");
        return "wrong";
      },
    });

    expect(slug).toBe("original-slug");
    expect(calls).toEqual(["owner-lock", "read-current"]);
  });

  test("normalizes valid profile input and rejects blank or over-limit fields", () => {
    expect(parseProfileInput(profileInput)).toEqual({
      displayName: "Mika Santos",
      area: "Davao City",
      bio: "Weekend rider and careful garage keeper.",
      visibility: "PUBLIC",
      defaultRosterIdentity: "VISIBLE",
    });
    expect(() => parseProfileInput({ ...profileInput, displayName: " " })).toThrow("INVALID_INPUT");
    expect(() => parseProfileInput({ ...profileInput, area: "x".repeat(MEMBER_PROFILE_LIMITS.area + 1) })).toThrow("INVALID_INPUT");
    expect(() => parseProfileInput({ ...profileInput, bio: "x".repeat(501) })).toThrow("INVALID_INPUT");
  });

  test("normalizes bounded motorcycle fields and rejects impossible values", () => {
    expect(
      parseMotorcycleInput({
        make: "  Honda  ",
        model: "  CB650R  ",
        year: 2025,
        displacementCc: 649,
        nickname: "  Ember  ",
        description: "  Kept for weekend rides.  ",
      }),
    ).toEqual({
      make: "Honda",
      model: "CB650R",
      year: 2025,
      displacementCc: 649,
      nickname: "Ember",
      description: "Kept for weekend rides.",
    });

    for (const input of [
      { make: "", model: "CB650R" },
      { make: "Honda", model: "" },
      { make: "x".repeat(MEMBER_PROFILE_LIMITS.make + 1), model: "CB650R" },
      { make: "Honda", model: "CB650R", year: 1884 },
      { make: "Honda", model: "CB650R", year: 2101 },
      { make: "Honda", model: "CB650R", displacementCc: 0 },
      { make: "Honda", model: "CB650R", displacementCc: 10_001 },
      { make: "Honda", model: "CB650R", nickname: "x".repeat(MEMBER_PROFILE_LIMITS.nickname + 1) },
      { make: "Honda", model: "CB650R", description: "x".repeat(MEMBER_PROFILE_LIMITS.motorcycleDescription + 1) },
    ]) {
      expect(() => parseMotorcycleInput(input)).toThrow("INVALID_INPUT");
    }
  });

  test("emits only public DTO fields and same-origin opaque media URLs", () => {
    const publicView = toMemberProfileView({
      userId: "secret-user-id",
      email: "mika@example.test",
      passwordHash: "secret-hash",
      verificationStatus: "APPROVED",
      slug: "mika-santos",
      displayName: "Mika Santos",
      area: "Davao City",
      role: "rider",
      bio: "Weekend rider.",
      visibility: "PUBLIC",
      joinedAt: "July 22, 2026",
      profilePhotoMediaId: "avatar_opaque_123",
      profilePhotoStorageKey: "media/users/secret/avatar.webp",
      motorcycle: {
        id: "secret-motorcycle-id",
        userId: "secret-user-id",
        make: "Honda",
        model: "CB650R",
        year: 2025,
        displacementCc: 649,
        nickname: "Ember",
        description: "Weekend bike.",
        photos: [
          {
            id: "secret-photo-id",
            mediaId: "bike_opaque_456",
            storageKey: "media/users/secret/motorcycle.webp",
            position: 0,
            width: 1600,
            height: 1067,
          },
        ],
      },
    });

    expect(publicView).toEqual({
      slug: "mika-santos",
      displayName: "Mika Santos",
      area: "Davao City",
      role: "rider",
      bio: "Weekend rider.",
      visibility: "PUBLIC",
      joinedAt: "July 22, 2026",
      profilePhotoUrl: "/media/avatar_opaque_123",
      motorcycle: {
        make: "Honda",
        model: "CB650R",
        year: 2025,
        displacementCc: 649,
        nickname: "Ember",
        description: "Weekend bike.",
        photos: [
          { url: "/media/bike_opaque_456", position: 0, width: 1600, height: 1067 },
        ],
      },
    });
    const serialized = JSON.stringify(publicView);
    for (const forbidden of ["email", "verificationStatus", "userId", "objectKey", "storageKey", "passwordHash"]) {
      expect(serialized).not.toContain(forbidden);
    }
    // Match the forbidden property itself; `width` is an allowed DTO field.
    expect(serialized).not.toMatch(/"id"\s*:/);
  });
});

describe("in-memory member profile behavior", () => {
  test("enforces visibility and returns non-enumerating not-found responses", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "profile-visibility");
    const published = await backend.updateMemberProfile(actors.rider.sessionToken, profileInput);

    await expect(backend.getMemberProfile(undefined, published.slug!)).resolves.toMatchObject({
      slug: "mika-santos",
      displayName: "Mika Santos",
    });

    const membersOnly = await backend.updateMemberProfile(actors.rider.sessionToken, {
      ...profileInput,
      visibility: "MEMBERS_ONLY",
    });
    await expect(backend.getMemberProfile(undefined, membersOnly.slug!)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(backend.getMemberProfile(actors.outsider.sessionToken, membersOnly.slug!)).resolves.toMatchObject({ visibility: "MEMBERS_ONLY" });

    const privateProfile = await backend.updateMemberProfile(actors.rider.sessionToken, {
      ...profileInput,
      visibility: "PRIVATE",
    });
    await expect(backend.getMemberProfile(actors.rider.sessionToken, privateProfile.slug!)).resolves.toMatchObject({ visibility: "PRIVATE" });
    await expect(backend.getMemberProfile(actors.admin.sessionToken, privateProfile.slug!)).resolves.toMatchObject({ visibility: "PRIVATE" });
    await expect(backend.getMemberProfile(actors.outsider.sessionToken, privateProfile.slug!)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(backend.getMemberProfile(undefined, "missing-profile")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("keeps unpublished profiles out of slug lookup while exposing the owner editor", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "profile-unpublished");

    await expect(backend.getMemberProfile(undefined, "fixture-rider")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(backend.getMemberProfileEditor(actors.rider.sessionToken)).resolves.toMatchObject({
      slug: null,
      isPublished: false,
      visibility: "PRIVATE",
      defaultRosterIdentity: "ANONYMOUS",
    });
  });

  test("allocates collision suffixes once and keeps slugs stable after name edits", async () => {
    const backend = await createTambikeTestBackend();
    const first = await backend.signUpRider({ displayName: "Same Rider", email: "same-1@example.test", password: "password123", area: "Manila" });
    const second = await backend.signUpRider({ displayName: "Same Rider", email: "same-2@example.test", password: "password123", area: "Manila" });
    const firstSaved = await backend.updateMemberProfile(first.sessionToken, { ...profileInput, displayName: "Same Rider" });
    const secondSaved = await backend.updateMemberProfile(second.sessionToken, { ...profileInput, displayName: "Same Rider" });

    expect(firstSaved.slug).toBe("same-rider");
    expect(secondSaved.slug).toBe("same-rider-2");
    await expect(backend.updateMemberProfile(first.sessionToken, { ...profileInput, displayName: "Renamed Rider" })).resolves.toMatchObject({ slug: "same-rider", displayName: "Renamed Rider" });
  });

  test("upserts one validated motorcycle and includes it in owner/public views", async () => {
    const backend = await createTambikeTestBackend();
    const actors = await createTestActors(backend, "profile-motorcycle");
    const profile = await backend.updateMemberProfile(actors.rider.sessionToken, profileInput);

    await expect(backend.upsertMotorcycle(actors.rider.sessionToken, {
      make: "Honda",
      model: "CB650R",
      year: 2025,
      displacementCc: 649,
      nickname: "Ember",
    })).resolves.toMatchObject({ make: "Honda", model: "CB650R", photos: [] });
    await expect(backend.getMemberProfile(undefined, profile.slug!)).resolves.toMatchObject({
      motorcycle: { make: "Honda", model: "CB650R", photos: [] },
    });
  });

  test("adds organizer hosted-event count without organizer or event identifiers", async () => {
    const backend = await createTambikeTestBackend();
    const organizer = await backend.loginWithPassword("organizer@bayanko.ph", "password123");
    const saved = await backend.updateMemberProfile(organizer.sessionToken, {
      ...profileInput,
      displayName: "Tambike Organizer",
    });
    const view = await backend.getMemberProfile(undefined, saved.slug!);

    expect(view.organizer?.hostedEventCount).toBe(24);
    expect(view).not.toHaveProperty("organizerProfileId");
    expect(JSON.stringify(view)).not.toContain("user-marco-organizer-profile");
  });
});
