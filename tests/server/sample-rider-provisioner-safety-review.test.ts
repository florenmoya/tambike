import sharp from "sharp";
import { describe, expect, test, vi } from "vitest";

import {
  provisionSampleRider,
  prepareSampleRiderAsset,
  type SampleRiderDependencies,
  type SampleRiderManifest,
  type SampleRiderPreparedAsset,
  type SampleRiderProvisioningVerification,
} from "@/server/member-profiles/sample-rider";

type FailurePoint = "account" | "profile" | "avatar" | "photo-2" | "rsvp" | "pass" | "inspect";

type FakeState = {
  account: null | { id: string; displayName: string; role: string; slug: string | null };
  profile: null | { visibility: string; defaultRosterIdentity: string; bio?: string };
  motorcycle: null | { make: string; model: string; year?: number; displacementCc?: number; nickname?: string; description?: string };
  avatar: null | { fingerprint: string; objectKey: string };
  photos: Array<{ position: number; fingerprint: string; objectKey: string }>;
  rsvp: null | { status: string; rosterIdentity: string };
  pass: null | { status: string };
};

const baseManifest = (suffix = "a"): SampleRiderManifest => ({
  eventId: "tambike-cafe-classico",
  avatar: `avatar-${suffix}.jpg`,
  motorcyclePhotos: Array.from({ length: 5 }, (_, index) => `bike-${suffix}-${index}.jpg`),
});

function cloneState(state: FakeState): FakeState {
  return structuredClone(state);
}

function createSafetyHarness(options: {
  failurePoint?: FailurePoint;
  malformedPath?: string;
  oversizedPath?: string;
  lock?: SampleRiderDependencies["acquireProvisioningLock"];
  stage?: (name: string) => void | Promise<void>;
} = {}) {
  let state: FakeState = {
    account: { id: "existing-sample", displayName: "Original", role: "rider", slug: "stable-sample" },
    profile: { visibility: "MEMBERS_ONLY", defaultRosterIdentity: "ANONYMOUS", bio: "Original bio" },
    motorcycle: { make: "Original", model: "Original" },
    avatar: { fingerprint: "old-avatar", objectKey: "old/avatar.webp" },
    photos: [{ position: 0, fingerprint: "old-photo", objectKey: "old/photo.webp" }],
    rsvp: { status: "interested", rosterIdentity: "ANONYMOUS" },
    pass: null,
  };
  let objects = new Map([
    ["old/avatar.webp", "old-avatar-bytes"],
    ["old/photo.webp", "old-photo-bytes"],
  ]);
  const originalState = cloneState(state);
  const originalObjects = new Map(objects);
  const calls: string[] = [];
  const failAfter = (point: FailurePoint) => {
    if (options.failurePoint === point) throw new Error(`FAIL_${point}`);
  };
  const mark = async (name: string) => {
    calls.push(name);
    await options.stage?.(name);
  };

  const verification = (): SampleRiderProvisioningVerification => ({
    slug: state.account?.slug ?? "",
    eventId: "tambike-cafe-classico",
    riders: state.account ? 1 : 0,
    motorcycles: state.motorcycle ? 1 : 0,
    avatars: state.avatar ? 1 : 0,
    motorcyclePhotos: state.photos.length,
    rsvps: state.rsvp ? 1 : 0,
    passes: state.pass ? 1 : 0,
    account: {
      displayName: state.account?.displayName ?? "",
      area: "Davao City",
      role: state.account?.role ?? "",
      passwordMatches: true,
    },
    profile: {
      bio: state.profile?.bio,
      visibility: state.profile?.visibility ?? "",
      defaultRosterIdentity: state.profile?.defaultRosterIdentity ?? "",
    },
    motorcycle: state.motorcycle,
    avatarFingerprint: state.avatar?.fingerprint ?? "",
    motorcyclePhotoFingerprints: state.photos.map(({ position, fingerprint }) => ({ position, fingerprint })),
    rsvp: state.rsvp,
    pass: state.pass,
  });

  const dependencies: SampleRiderDependencies = {
    acquireProvisioningLock: options.lock ?? (vi.fn(async () => ({
      release: vi.fn(async () => { calls.push("release"); }),
    })) as SampleRiderDependencies["acquireProvisioningLock"]),
    assertTargetEvent: vi.fn(async () => { await mark("event"); }),
    loadAsset: vi.fn(async (path) => ({ path, bytes: Buffer.from(path), mimeType: "image/jpeg" as const })),
    preflightAsset: vi.fn(async (asset, purpose): Promise<SampleRiderPreparedAsset> => {
      await mark(`preflight:${asset.path}`);
      if (asset.path === options.malformedPath) throw new Error("INVALID_IMAGE");
      if (asset.path === options.oversizedPath) throw new Error("IMAGE_TOO_LARGE");
      return {
        ...asset,
        purpose,
        normalizedBytes: Buffer.from(`normalized:${asset.path}`),
        width: purpose === "avatar" ? 512 : 1200,
        height: purpose === "avatar" ? 512 : 800,
        fingerprint: `fingerprint:${asset.path}`,
      };
    }),
    captureSnapshot: vi.fn(async () => {
      calls.push("snapshot");
      return { state: cloneState(state), objects: new Map(objects) };
    }),
    restoreSnapshot: vi.fn(async (snapshot) => {
      calls.push("restore");
      const captured = snapshot as { state: FakeState; objects: Map<string, string> };
      state = cloneState(captured.state);
      objects = new Map(captured.objects);
    }),
    upsertAccount: vi.fn(async (input) => {
      await mark("account");
      state.account = { id: state.account?.id ?? "new-sample", displayName: input.displayName, role: input.role, slug: state.account?.slug ?? "stable-sample" };
      failAfter("account");
      return { userId: state.account.id, sessionToken: "sample-session" };
    }),
    updateProfile: vi.fn(async (_context, input) => {
      await mark("profile");
      state.profile = { visibility: input.visibility, defaultRosterIdentity: input.defaultRosterIdentity, bio: input.bio };
      failAfter("profile");
    }),
    upsertMotorcycle: vi.fn(async (_context, input) => {
      await mark("motorcycle");
      state.motorcycle = { ...input };
    }),
    ensureAvatar: vi.fn(async (_context, asset) => {
      await mark("avatar");
      const objectKey = `new/${asset.fingerprint}.webp`;
      objects.set(objectKey, Buffer.from(asset.normalizedBytes).toString());
      state.avatar = { fingerprint: asset.fingerprint, objectKey };
      failAfter("avatar");
    }),
    ensureMotorcyclePhoto: vi.fn(async (_context, position, asset) => {
      await mark(`photo-${position}`);
      const objectKey = `new/${asset.fingerprint}.webp`;
      objects.set(objectKey, Buffer.from(asset.normalizedBytes).toString());
      state.photos = state.photos.filter((photo) => photo.position !== position);
      state.photos.push({ position, fingerprint: asset.fingerprint, objectKey });
      state.photos.sort((left, right) => left.position - right.position);
      if (position === 2) failAfter("photo-2");
    }),
    registerForEvent: vi.fn(async () => {
      await mark("rsvp");
      state.rsvp = { status: "going", rosterIdentity: "VISIBLE" };
      failAfter("rsvp");
    }),
    ensureActivePass: vi.fn(async () => {
      await mark("pass");
      state.pass = { status: "active" };
      failAfter("pass");
    }),
    inspectResult: vi.fn(async () => {
      await mark("inspect");
      failAfter("inspect");
      return verification();
    }),
    finish: vi.fn(async () => { calls.push("finish"); }),
  };

  return {
    dependencies,
    calls,
    originalState,
    originalObjects,
    getState: () => cloneState(state),
    getObjects: () => new Map(objects),
  };
}

describe("reviewed sample rider safety", () => {
  test("the production preflight decodes and normalizes valid media and rejects malformed or oversized bytes", async () => {
    const valid = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#64748b" },
    }).jpeg().toBuffer();

    await expect(prepareSampleRiderAsset({
      path: "valid.jpg",
      bytes: valid,
      mimeType: "image/jpeg",
    }, "avatar")).resolves.toMatchObject({
      width: 512,
      height: 512,
      purpose: "avatar",
      fingerprint: expect.any(String),
    });
    await expect(prepareSampleRiderAsset({
      path: "malformed.jpg",
      bytes: Buffer.from("not an image"),
      mimeType: "image/jpeg",
    }, "motorcycle-photo")).rejects.toThrow();
    await expect(prepareSampleRiderAsset({
      path: "oversized.jpg",
      bytes: new Uint8Array(8 * 1024 * 1024 + 1),
      mimeType: "image/jpeg",
    }, "motorcycle-photo")).rejects.toThrow(/8 MiB/);
  });

  test.each(["malformed", "oversized"] as const)(
    "preflights a %s final photo before the first mutation",
    async (kind) => {
      const badPath = "bike-a-4.jpg";
      const harness = createSafetyHarness(kind === "malformed" ? { malformedPath: badPath } : { oversizedPath: badPath });

      await expect(provisionSampleRider({
        confirmedProduction: true,
        password: "runtime-only-password",
        manifest: baseManifest(),
      }, harness.dependencies)).rejects.toMatchObject({ code: "ASSET_UNAVAILABLE" });

      expect(harness.dependencies.upsertAccount).not.toHaveBeenCalled();
      expect(harness.calls).not.toContain("snapshot");
      expect(harness.getState()).toEqual(harness.originalState);
      expect([...harness.getObjects()]).toEqual([...harness.originalObjects]);
    },
  );

  test.each<FailurePoint>(["account", "profile", "avatar", "photo-2", "rsvp", "pass", "inspect"])(
    "restores exact prior database and media state after a %s failure",
    async (failurePoint) => {
      const harness = createSafetyHarness({ failurePoint });

      await expect(provisionSampleRider({
        confirmedProduction: true,
        password: "runtime-only-password",
        manifest: baseManifest(),
      }, harness.dependencies)).rejects.toThrow(`FAIL_${failurePoint}`);

      expect(harness.getState()).toEqual(harness.originalState);
      expect([...harness.getObjects()]).toEqual([...harness.originalObjects]);
      expect(harness.calls).toContain("restore");
      expect(harness.calls.at(-1)).toBe("release");
    },
  );

  test("holds one lock across the complete operation so different manifests cannot interleave", async () => {
    let locked = false;
    const waiters: Array<() => void> = [];
    const timeline: string[] = [];
    const acquireProvisioningLock: SampleRiderDependencies["acquireProvisioningLock"] = async () => {
      if (locked) await new Promise<void>((resolve) => waiters.push(resolve));
      locked = true;
      const run = timeline.filter((event) => event.endsWith(":locked")).length + 1;
      timeline.push(`${run}:locked`);
      return {
        release: async () => {
          timeline.push(`${run}:released`);
          locked = false;
          waiters.shift()?.();
        },
      };
    };
    let activeRun = 0;
    const harness = createSafetyHarness({
      lock: acquireProvisioningLock,
      stage: (name) => { timeline.push(`${activeRun}:${name}`); },
    });
    const originalAcquire = harness.dependencies.acquireProvisioningLock;
    harness.dependencies.acquireProvisioningLock = async () => {
      const lock = await originalAcquire();
      activeRun += 1;
      return lock;
    };

    await Promise.all([
      provisionSampleRider({ confirmedProduction: true, password: "password-one", manifest: baseManifest("one") }, harness.dependencies),
      provisionSampleRider({ confirmedProduction: true, password: "password-two", manifest: baseManifest("two") }, harness.dependencies),
    ]);

    const firstRelease = timeline.indexOf("1:released");
    const secondLock = timeline.indexOf("2:locked");
    expect(firstRelease).toBeGreaterThan(-1);
    expect(secondLock).toBeGreaterThan(firstRelease);
    expect(timeline.slice(0, firstRelease)).not.toContainEqual(expect.stringMatching(/^2:/));
  });

  test("rejects exact-count output when a final media fingerprint is wrong and compensates", async () => {
    const harness = createSafetyHarness();
    const originalInspect = harness.dependencies.inspectResult;
    harness.dependencies.inspectResult = vi.fn(async (...args) => {
      const result = await originalInspect(args[0], args[1], args[2]);
      result.motorcyclePhotoFingerprints[3] = { position: 3, fingerprint: "wrong" };
      return result;
    });

    await expect(provisionSampleRider({
      confirmedProduction: true,
      password: "runtime-only-password",
      manifest: baseManifest(),
    }, harness.dependencies)).rejects.toMatchObject({ code: "INVARIANT_FAILED" });

    expect(harness.getState()).toEqual(harness.originalState);
    expect([...harness.getObjects()]).toEqual([...harness.originalObjects]);
  });
});
