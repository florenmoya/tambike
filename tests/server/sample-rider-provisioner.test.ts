import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import bcrypt from "bcryptjs";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  SampleRiderProvisioningError,
  provisionSampleRider,
  type SampleRiderAsset,
  type SampleRiderDependencies,
  type SampleRiderManifest,
  type SampleRiderProvisioningVerification,
  type SampleRiderProvisioningResult,
} from "@/server/member-profiles/sample-rider";
import { runSampleRiderCli } from "../../scripts/provision-sample-rider";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function manifest(overrides: Partial<SampleRiderManifest> = {}): SampleRiderManifest {
  return {
    eventId: "tambike-cafe-classico",
    avatar: "avatar.jpg",
    motorcyclePhotos: ["bike-0.jpg", "bike-1.jpg", "bike-2.jpg", "bike-3.jpg", "bike-4.jpg"],
    ...overrides,
  };
}

function createStatefulDependencies() {
  const state = {
    user: null as null | {
      id: string;
      passwordHash: string;
      role: string;
      displayName: string;
      area: string;
      slug: string | null;
      visibility: string;
      defaultRosterIdentity: string;
      bio?: string;
    },
    motorcycle: null as null | {
      make: string;
      model: string;
      year?: number;
      displacementCc?: number;
      nickname?: string;
      description?: string;
    },
    avatar: null as null | string,
    photos: new Map<number, string>(),
    rsvp: null as null | { eventId: string; status: string; rosterIdentity: string },
    pass: null as null | { eventId: string; status: string },
  };

  const dependencies: SampleRiderDependencies = {
    acquireProvisioningLock: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
    assertTargetEvent: vi.fn(async (eventId) => {
      if (eventId !== "tambike-cafe-classico") throw new Error("EVENT_NOT_FOUND");
    }),
    loadAsset: vi.fn(async (path): Promise<SampleRiderAsset> => {
      if (path.startsWith("missing")) throw new Error("ENOENT");
      return {
        path,
        bytes: Buffer.from(`contents:${path}`),
        mimeType: "image/jpeg",
      };
    }),
    preflightAsset: vi.fn(async (asset, purpose) => ({
      ...asset,
      purpose,
      normalizedBytes: asset.bytes,
      width: purpose === "avatar" ? 512 : 1200,
      height: purpose === "avatar" ? 512 : 800,
      fingerprint: `fingerprint:${asset.path}`,
    })),
    captureSnapshot: vi.fn(async () => structuredClone(state)),
    restoreSnapshot: vi.fn(async (snapshot) => {
      const restored = snapshot as typeof state;
      Object.assign(state, structuredClone(restored));
    }),
    upsertAccount: vi.fn(async (input) => {
      const passwordHash =
        state.user && await bcrypt.compare(input.password, state.user.passwordHash)
          ? state.user.passwordHash
          : input.passwordHash;
      state.user ??= {
        id: "sample-user-existing-id",
        passwordHash,
        role: "rider",
        displayName: input.displayName,
        area: input.area,
        slug: null,
        visibility: "PRIVATE",
        defaultRosterIdentity: "ANONYMOUS",
      };
      state.user.passwordHash = passwordHash;
      state.user.role = input.role;
      state.user.displayName = input.displayName;
      state.user.area = input.area;
      return { userId: state.user.id, sessionToken: "sample-session" };
    }),
    updateProfile: vi.fn(async (_context, input) => {
      if (!state.user) throw new Error("ACCOUNT_REQUIRED");
      state.user.displayName = input.displayName;
      state.user.area = input.area;
      state.user.visibility = input.visibility;
      state.user.defaultRosterIdentity = input.defaultRosterIdentity;
      state.user.bio = input.bio;
      state.user.slug ??= "mika-santos-sample-rider";
    }),
    upsertMotorcycle: vi.fn(async (_context, input) => {
      state.motorcycle = { ...input };
    }),
    ensureAvatar: vi.fn(async (_context, asset) => {
      state.avatar = asset.fingerprint;
    }),
    ensureMotorcyclePhoto: vi.fn(async (_context, position, asset) => {
      state.photos.set(position, asset.fingerprint);
    }),
    registerForEvent: vi.fn(async (_context, eventId, input) => {
      state.rsvp = { eventId, status: input.status, rosterIdentity: input.rosterIdentity };
      state.pass = { eventId, status: "active" };
    }),
    ensureActivePass: vi.fn(async () => {
      if (state.pass) state.pass.status = "active";
    }),
    inspectResult: vi.fn(async (): Promise<SampleRiderProvisioningVerification> => ({
      slug: state.user?.slug ?? "",
      eventId: state.rsvp?.eventId ?? "",
      riders: state.user ? 1 : 0,
      motorcycles: state.motorcycle ? 1 : 0,
      avatars: state.avatar ? 1 : 0,
      motorcyclePhotos: state.photos.size,
      rsvps: state.rsvp ? 1 : 0,
      passes: state.pass ? 1 : 0,
      account: {
        displayName: state.user?.displayName ?? "",
        area: state.user?.area ?? "",
        role: state.user?.role ?? "",
        passwordMatches: true,
      },
      profile: {
        bio: state.user?.bio,
        visibility: state.user?.visibility ?? "",
        defaultRosterIdentity: state.user?.defaultRosterIdentity ?? "",
      },
      motorcycle: state.motorcycle,
      avatarFingerprint: state.avatar ?? "",
      motorcyclePhotoFingerprints: [...state.photos.entries()].map(([position, fingerprint]) => ({ position, fingerprint })),
      rsvp: state.rsvp ? { status: state.rsvp.status, rosterIdentity: state.rsvp.rosterIdentity } : null,
      pass: state.pass ? { status: state.pass.status } : null,
    })),
    finish: vi.fn(async () => undefined),
  };

  return { state, dependencies };
}

describe("sample rider provisioner safety", () => {
  test("requires explicit production confirmation before loading assets or writing", async () => {
    const { dependencies } = createStatefulDependencies();

    await expect(
      provisionSampleRider({ confirmedProduction: false, password: "safe runtime secret", manifest: manifest() }, dependencies),
    ).rejects.toMatchObject({ code: "PRODUCTION_CONFIRMATION_REQUIRED" });

    expect(dependencies.loadAsset).not.toHaveBeenCalled();
    expect(dependencies.upsertAccount).not.toHaveBeenCalled();
  });

  test.each([undefined, "", "   "])("rejects a missing or blank runtime password (%s)", async (password) => {
    const { dependencies } = createStatefulDependencies();

    await expect(
      provisionSampleRider({ confirmedProduction: true, password, manifest: manifest() }, dependencies),
    ).rejects.toMatchObject({ code: "PASSWORD_REQUIRED" });
    expect(dependencies.upsertAccount).not.toHaveBeenCalled();
  });

  test("rejects any event other than the exact Cafe Classico event", async () => {
    const { dependencies } = createStatefulDependencies();

    await expect(
      provisionSampleRider({
        confirmedProduction: true,
        password: "safe runtime secret",
        manifest: manifest({ eventId: "some-other-event" }),
      }, dependencies),
    ).rejects.toMatchObject({ code: "INVALID_EVENT" });
    expect(dependencies.assertTargetEvent).not.toHaveBeenCalled();
  });

  test.each([
    { motorcyclePhotos: [] },
    { motorcyclePhotos: ["one.jpg"] },
    { motorcyclePhotos: ["0.jpg", "1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg"] },
  ])(
    "requires exactly five motorcycle photos",
    async ({ motorcyclePhotos }) => {
      const { dependencies } = createStatefulDependencies();

      await expect(
        provisionSampleRider({
          confirmedProduction: true,
          password: "safe runtime secret",
          manifest: manifest({ motorcyclePhotos }),
        }, dependencies),
      ).rejects.toMatchObject({ code: "INVALID_ASSET_COUNT" });
      expect(dependencies.upsertAccount).not.toHaveBeenCalled();
    },
  );

  test("loads all six assets before making the first database write", async () => {
    const { dependencies } = createStatefulDependencies();

    await expect(
      provisionSampleRider({
        confirmedProduction: true,
        password: "safe runtime secret",
        manifest: manifest({ motorcyclePhotos: ["missing-bike.jpg", "1.jpg", "2.jpg", "3.jpg", "4.jpg"] }),
      }, dependencies),
    ).rejects.toMatchObject({ code: "ASSET_UNAVAILABLE" });

    expect(dependencies.upsertAccount).not.toHaveBeenCalled();
  });
});

describe("sample rider provisioner domain flow", () => {
  test("uses a bcrypt hash and the normal rider/public/visible domain inputs", async () => {
    const { state, dependencies } = createStatefulDependencies();
    const password = "runtime-only-password";

    await provisionSampleRider(
      { confirmedProduction: true, password, manifest: manifest() },
      dependencies,
    );

    expect(state.user).toMatchObject({
      role: "rider",
      displayName: "Mika Santos — Sample Rider",
      area: "Davao City",
      visibility: "PUBLIC",
      defaultRosterIdentity: "VISIBLE",
    });
    expect(state.user?.passwordHash).not.toBe(password);
    await expect(bcrypt.compare(password, state.user?.passwordHash ?? "")).resolves.toBe(true);
    expect(dependencies.registerForEvent).toHaveBeenCalledWith(
      expect.anything(),
      "tambike-cafe-classico",
      { status: "going", attendanceType: "direct", rosterIdentity: "VISIBLE" },
    );
  });

  test("is idempotent and preserves the account id and stable profile slug", async () => {
    const { state, dependencies } = createStatefulDependencies();
    const input = { confirmedProduction: true, password: "runtime-only-password", manifest: manifest() };

    const first = await provisionSampleRider(input, dependencies);
    const firstId = state.user?.id;
    const firstSlug = state.user?.slug;
    const firstPasswordHash = state.user?.passwordHash;
    const second = await provisionSampleRider(input, dependencies);

    expect(state.user?.id).toBe(firstId);
    expect(state.user?.slug).toBe(firstSlug);
    expect(state.user?.passwordHash).toBe(firstPasswordHash);
    expect(state.motorcycle).toMatchObject({ make: "Honda", model: "CB400 Super Four" });
    expect([...state.photos.keys()]).toEqual([0, 1, 2, 3, 4]);
    expect(state.rsvp).toEqual({ eventId: "tambike-cafe-classico", status: "going", rosterIdentity: "VISIBLE" });
    expect(state.pass).toEqual({ eventId: "tambike-cafe-classico", status: "active" });
    expect(first).toEqual(second);
    expect(second).toEqual({
      slug: "mika-santos-sample-rider",
      eventId: "tambike-cafe-classico",
      riders: 1,
      motorcycles: 1,
      avatars: 1,
      motorcyclePhotos: 5,
      rsvps: 1,
      passes: 1,
    });
    expect(dependencies.finish).toHaveBeenCalledTimes(2);
  });

  test("rejects a post-run state that is not exactly the requested cardinality", async () => {
    const { dependencies } = createStatefulDependencies();
    dependencies.inspectResult = vi.fn(async () => ({
      slug: "mika-santos-sample-rider",
      eventId: "tambike-cafe-classico",
      riders: 1,
      motorcycles: 1,
      avatars: 1,
      motorcyclePhotos: 4,
      rsvps: 1,
      passes: 1,
      account: { displayName: "Mika Santos — Sample Rider", area: "Davao City", role: "rider", passwordMatches: true },
      profile: {
        bio: "Weekend city rider, coffee-stop regular, and caretaker of a classic inline-four.",
        visibility: "PUBLIC",
        defaultRosterIdentity: "VISIBLE",
      },
      motorcycle: {
        make: "Honda",
        model: "CB400 Super Four",
        year: 1998,
        displacementCc: 399,
        nickname: "Sora",
        description: "A carefully maintained everyday classic built for relaxed city rides and tambike nights.",
      },
      avatarFingerprint: "fingerprint:avatar.jpg",
      motorcyclePhotoFingerprints: [0, 1, 2, 3, 4].map((position) => ({
        position,
        fingerprint: `fingerprint:bike-${position}.jpg`,
      })),
      rsvp: { status: "going", rosterIdentity: "VISIBLE" },
      pass: { status: "active" },
    }));

    await expect(
      provisionSampleRider({ confirmedProduction: true, password: "runtime-only-password", manifest: manifest() }, dependencies),
    ).rejects.toMatchObject({ code: "INVARIANT_FAILED" });
  });
});

describe("sample rider CLI contract", () => {
  test("never inherits production confirmation from npm config", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tambike-sample-rider-npm-args-"));
    tempDirectories.push(directory);
    const manifestPath = join(directory, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest()), "utf8");
    const createProvisioner = vi.fn();

    await expect(runSampleRiderCli({
      argv: [manifestPath],
      environment: {
        TAMBIKE_SAMPLE_RIDER_PASSWORD: "runtime-only-password",
        DATABASE_URL: "postgresql://example.invalid/runtime",
        npm_config_confirm_production: "true",
        npm_config_manifest: manifestPath,
      },
      createProvisioner,
    })).rejects.toMatchObject({ code: "PRODUCTION_CONFIRMATION_REQUIRED" });

    expect(createProvisioner).not.toHaveBeenCalled();
  });

  test("prints only stable summary fields and never secrets or infrastructure details", async () => {
    const output: string[] = [];
    const result: SampleRiderProvisioningResult = {
      slug: "mika-santos-sample-rider",
      eventId: "tambike-cafe-classico",
      riders: 1,
      motorcycles: 1,
      avatars: 1,
      motorcyclePhotos: 5,
      rsvps: 1,
      passes: 1,
    };
    const directory = await mkdtemp(join(tmpdir(), "tambike-sample-rider-"));
    tempDirectories.push(directory);
    const manifestPath = join(directory, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest()), "utf8");

    await runSampleRiderCli({
      argv: ["--confirm-production", "--manifest", manifestPath],
      environment: {
        TAMBIKE_SAMPLE_RIDER_PASSWORD: "do-not-print-me",
        DATABASE_URL: "postgresql://secret:secret@db.example/private",
      },
      write: (line) => output.push(line),
      createProvisioner: async () => ({
        dependencies: createStatefulDependencies().dependencies,
        close: async () => undefined,
      }),
    });

    const text = output.join("\n");
    expect(JSON.parse(text)).toEqual(result);
    for (const forbidden of ["do-not-print-me", "postgresql://", "passwordHash", "storageKey", "signed", "AWS_"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  test("keeps the sample email literal and all seed coupling out of the CLI and general seed", async () => {
    const [script, module, packageJson, guide] = await Promise.all([
      readFile(join(process.cwd(), "scripts", "provision-sample-rider.ts"), "utf8"),
      readFile(join(process.cwd(), "src", "server", "member-profiles", "sample-rider.ts"), "utf8"),
      readFile(join(process.cwd(), "package.json"), "utf8"),
      readFile(join(process.cwd(), "docs", "deployment", "sample-rider-provisioning.md"), "utf8"),
    ]);

    expect(script).not.toMatch(/prisma\/seed|seedPrisma|db:seed/);
    expect(module).not.toMatch(/prisma\/seed|seedPrisma|db:seed/);
    expect((script.match(/mika\.sample@/g) ?? [])).toHaveLength(0);
    expect((module.match(/mika\.sample@/g) ?? [])).toHaveLength(1);
    expect(packageJson).toContain('"provision:sample-rider"');
    expect(guide).toContain("npm run provision:sample-rider -- -- --confirm-production -- --manifest");
    expect(guide).toContain("npx tsx --conditions=react-server scripts/provision-sample-rider.ts --confirm-production --manifest");
    expect(guide).toContain("fails closed");
  });
});

test("provisioning failures use stable non-sensitive error codes", () => {
  const error = new SampleRiderProvisioningError("PASSWORD_REQUIRED");
  expect(error.message).toBe("PASSWORD_REQUIRED");
  expect(JSON.stringify(error)).not.toContain("password");
});
