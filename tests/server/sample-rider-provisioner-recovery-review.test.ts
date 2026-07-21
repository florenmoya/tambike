import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  collectSampleRiderCleanupKeys,
  createPrismaSampleRiderProvisioner,
  runSampleRiderRecoverySteps,
  SampleRiderRecoveryError,
  toSampleRiderCliErrorCode,
  validateDirectSampleRiderLockUrl,
  type SampleRiderLockClient,
} from "@/server/member-profiles/sample-rider";
import type { MemberMediaStore } from "@/server/member-media/store";
import { runSampleRiderCli } from "../../scripts/provision-sample-rider";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("direct sample rider lock connection", () => {
  test.each([
    "",
    "mysql://localhost/tambike",
    "postgresql://user:pass@pooler.example.test:5432/tambike",
    "postgresql://user:pass@localhost:6543/tambike",
    "postgresql://user:pass@localhost:5432/tambike?pgbouncer=true",
    "postgresql://user:pass@localhost:5432/tambike?pool_mode=transaction",
  ])("rejects a missing or transaction-pooled direct lock URL", (value) => {
    expect(() => validateDirectSampleRiderLockUrl(value)).toThrow(/DIRECT_LOCK_URL_REQUIRED/);
  });

  test("uses the explicit direct URL and acquires, operates, unlocks true, then ends", async () => {
    const events: string[] = [];
    const directUrl = "postgresql://user:pass@db.example.test:5432/tambike";
    const runtimeUrl = "postgresql://user:pass@pooler.example.test:6543/tambike?pgbouncer=true";
    const client: SampleRiderLockClient = {
      connect: vi.fn(async () => { events.push("connect"); }),
      query: vi.fn(async (sql) => {
        events.push(sql.includes("unlock") ? "unlock" : "lock");
        return sql.includes("unlock") ? { rows: [{ unlocked: true }] } : { rows: [{ locked: true }] };
      }),
      end: vi.fn(async () => { events.push("end"); }),
    };
    const store = inertStore();
    const createLockClient = vi.fn((connectionString: string) => {
      expect(connectionString).toBe(directUrl);
      expect(connectionString).not.toBe(runtimeUrl);
      return client;
    });
    const provisioner = createPrismaSampleRiderProvisioner(runtimeUrl, directUrl, {
      store,
      createLockClient,
    });

    try {
      const lock = await provisioner.dependencies.acquireProvisioningLock();
      events.push("operation");
      await lock.release();
      expect(events).toEqual(["connect", "lock", "operation", "unlock", "end"]);
      expect(createLockClient).toHaveBeenCalledTimes(1);
    } finally {
      await provisioner.close();
    }
  });

  test("serializes two production lock clients through the same advisory key", async () => {
    let owner: number | null = null;
    const waiters: Array<() => void> = [];
    const events: string[] = [];
    let nextId = 0;
    const createLockClient = (): SampleRiderLockClient => {
      const id = ++nextId;
      return {
        connect: async () => { events.push(`${id}:connect`); },
        query: async (sql) => {
          if (sql.includes("unlock")) {
            events.push(`${id}:unlock`);
            owner = null;
            waiters.shift()?.();
            return { rows: [{ unlocked: true }] };
          }
          if (owner !== null) await new Promise<void>((resolve) => waiters.push(resolve));
          owner = id;
          events.push(`${id}:lock`);
          return { rows: [{ locked: true }] };
        },
        end: async () => { events.push(`${id}:end`); },
      };
    };
    const directUrl = "postgresql://user:pass@db.example.test:5432/tambike";
    const first = createPrismaSampleRiderProvisioner("postgresql://runtime/db", directUrl, {
      store: inertStore(),
      createLockClient,
    });
    const second = createPrismaSampleRiderProvisioner("postgresql://runtime/db", directUrl, {
      store: inertStore(),
      createLockClient,
    });

    try {
      const firstLock = await first.dependencies.acquireProvisioningLock();
      const secondLockPromise = second.dependencies.acquireProvisioningLock();
      await Promise.resolve();
      expect(events).not.toContain("2:lock");
      await firstLock.release();
      const secondLock = await secondLockPromise;
      await secondLock.release();
      expect(events.indexOf("2:lock")).toBeGreaterThan(events.indexOf("1:unlock"));
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
});

describe("bounded sample rider recovery", () => {
  test("collects current, generated-final, and temporary keys exactly once without deleting originals", () => {
    expect(collectSampleRiderCleanupKeys(
      ["media/current.webp", "media/original.webp"],
      ["media/generated.webp", "media/current.webp"],
      ["tmp/upload", "media/generated.webp"],
      new Set(["media/original.webp"]),
    )).toEqual([
      "media/current.webp",
      "media/generated.webp",
      "tmp/upload",
    ]);
  });

  test("retries each step three times, continues exact cleanup attempts, and preserves every failure", async () => {
    const attempts = [0, 0, 0];
    const terminal = new Error("terminal-object-delete");

    await expect(runSampleRiderRecoverySteps([
      async () => { attempts[0] += 1; throw terminal; },
      async () => { attempts[1] += 1; },
      async () => {
        attempts[2] += 1;
        if (attempts[2] < 3) throw new Error(`temporary-${attempts[2]}`);
      },
    ])).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AggregateError);
      const recovery = error as AggregateError;
      expect(recovery.errors).toHaveLength(1);
      expect(recovery.errors[0]).toBeInstanceOf(AggregateError);
      expect((recovery.errors[0] as AggregateError).errors).toEqual([terminal, terminal, terminal]);
      return true;
    });

    expect(attempts).toEqual([3, 1, 3]);
  });

  test.each(["false", "throw", "end"] as const)(
    "treats unlock %s as recovery failure, retries boundedly, always ends, and scrubs the public code",
    async (mode) => {
      let unlockAttempts = 0;
      let endAttempts = 0;
      const client: SampleRiderLockClient = {
        connect: async () => undefined,
        query: async (sql) => {
          if (!sql.includes("unlock")) return { rows: [{ locked: true }] };
          unlockAttempts += 1;
          if (mode === "false") return { rows: [{ unlocked: false }] };
          if (mode === "throw") throw new Error("secret-direct-url-unlock");
          return { rows: [{ unlocked: true }] };
        },
        end: async () => {
          endAttempts += 1;
          if (mode === "end") throw new Error("secret-direct-url-end");
        },
      };
      const provisioner = createPrismaSampleRiderProvisioner(
        "postgresql://runtime/db",
        "postgresql://user:pass@db.example.test:5432/tambike",
        { store: inertStore(), createLockClient: () => client },
      );

      try {
        const lock = await provisioner.dependencies.acquireProvisioningLock();
        let caught: unknown;
        try {
          await lock.release();
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(AggregateError);
        expect(toSampleRiderCliErrorCode(caught)).toBe("PROVISION_COMPENSATION_FAILED");
        expect(toSampleRiderCliErrorCode(caught)).not.toContain("secret");
        expect(unlockAttempts).toBe(mode === "end" ? 1 : 3);
        expect(endAttempts).toBe(mode === "end" ? 3 : 1);
      } finally {
        await provisioner.close();
      }
    },
  );

  test("retains the primary operation error with restore and release failures", () => {
    const primary = new Error("primary-operation");
    const restore = new AggregateError([new Error("restore-object")], "restore");
    const release = new AggregateError([new Error("unlock")], "release");
    const error = new SampleRiderRecoveryError(primary, [restore, release]);

    expect(error.errors).toEqual([primary, restore, release]);
    expect(toSampleRiderCliErrorCode(error)).toBe("PROVISION_COMPENSATION_FAILED");
    expect(JSON.stringify({ code: toSampleRiderCliErrorCode(error) })).not.toContain("primary-operation");
  });
});

describe("direct URL CLI boundary", () => {
  test("requires explicit DIRECT_URL without printing it or constructing the provisioner", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tambike-direct-lock-url-"));
    tempDirectories.push(directory);
    const manifestPath = join(directory, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      eventId: "tambike-cafe-classico",
      avatar: "avatar.jpg",
      motorcyclePhotos: ["0.jpg", "1.jpg", "2.jpg", "3.jpg", "4.jpg"],
    }));
    const createProvisioner = vi.fn();

    await expect(runSampleRiderCli({
      argv: ["--confirm-production", "--manifest", manifestPath],
      environment: {
        TAMBIKE_SAMPLE_RIDER_PASSWORD: "runtime-secret",
        DATABASE_URL: "postgresql://runtime-secret@pooler.example/tambike",
      },
      createProvisioner,
    })).rejects.toThrow("DIRECT_LOCK_URL_REQUIRED");
    expect(createProvisioner).not.toHaveBeenCalled();
  });
});

function inertStore(): MemberMediaStore {
  return {
    createPresignedPost: vi.fn(),
    getObject: vi.fn(),
    putObject: vi.fn(),
    deleteObject: vi.fn(),
  };
}
