import { describe, expect, test, vi } from "vitest";

import {
  runPublicSeedLabelCleanupCli,
  type PublicSeedLabelCleanupStore,
} from "../../scripts/clean-public-seed-labels";

function cleanupStore(): PublicSeedLabelCleanupStore {
  return {
    inspect: vi.fn(async () => ({
      users: [
        {
          id: "mika",
          email: "mika.sample@tambike.ph",
          displayName: "Mika Santos — Sample Rider",
        },
      ],
      awards: [],
    })),
    apply: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe("public seed label cleanup CLI", () => {
  test("defaults to a read-only preview and prints no database credentials", async () => {
    const store = cleanupStore();
    const lines: string[] = [];
    const receipt = await runPublicSeedLabelCleanupCli({
      argv: [],
      environment: {
        DATABASE_URL:
          "postgresql://secret-user:secret-password@db.example.test:5432/tambike_db",
      },
      createStore: () => store,
      write: (line) => lines.push(line),
    });

    expect(receipt).toEqual({
      mode: "preview",
      target: { host: "db.example.test", database: "tambike_db" },
      userUpdates: [
        {
          id: "mika",
          email: "mika.sample@tambike.ph",
          from: "Mika Santos — Sample Rider",
          to: "Mika Santos",
        },
      ],
      awardUpdates: [],
    });
    expect(store.apply).not.toHaveBeenCalled();
    expect(store.close).toHaveBeenCalledOnce();
    expect(lines.join("\n")).not.toMatch(/secret-user|secret-password/);
  });

  test("applies exactly the previewed plan only with the explicit flag", async () => {
    const store = cleanupStore();

    const receipt = await runPublicSeedLabelCleanupCli({
      argv: ["--apply"],
      environment: {
        DATABASE_URL: "postgresql://localhost:5432/tambike_db",
      },
      createStore: () => store,
      write: () => undefined,
    });

    expect(receipt.mode).toBe("apply");
    expect(store.apply).toHaveBeenCalledOnce();
    expect(store.apply).toHaveBeenCalledWith({
      userUpdates: receipt.userUpdates,
      awardUpdates: receipt.awardUpdates,
    });
    expect(store.close).toHaveBeenCalledOnce();
  });

  test("closes the store when inspection fails", async () => {
    const store = cleanupStore();
    vi.mocked(store.inspect).mockRejectedValueOnce(new Error("inspect failed"));

    await expect(
      runPublicSeedLabelCleanupCli({
        environment: {
          DATABASE_URL: "postgresql://localhost:5432/tambike_db",
        },
        createStore: () => store,
        write: () => undefined,
      }),
    ).rejects.toThrow("inspect failed");

    expect(store.close).toHaveBeenCalledOnce();
  });
});
