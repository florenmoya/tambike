import { describe, expect, test, vi } from "vitest";

import {
  runEventBriefCopyCleanupCli,
  type EventBriefCopyCleanupStore,
} from "../../scripts/clean-event-brief-copy";
import { LEGACY_EVENT_BRIEF_COPY_BY_ID } from "@/server/maintenance/event-brief-copy-cleanup";

function cleanupStore(): EventBriefCopyCleanupStore {
  return {
    inspect: vi.fn(async () => ({
      events: [
        {
          id: "tambike-cafe-classico",
          whatHappens:
            LEGACY_EVENT_BRIEF_COPY_BY_ID["tambike-cafe-classico"],
        },
      ],
    })),
    apply: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe("event brief copy cleanup CLI", () => {
  test("defaults to a read-only preview without printing credentials", async () => {
    const store = cleanupStore();
    const lines: string[] = [];
    const receipt = await runEventBriefCopyCleanupCli({
      argv: [],
      environment: {
        DATABASE_URL:
          "postgresql://secret-user:secret-password@db.example.test:5432/tambike_db",
      },
      createStore: () => store,
      write: (line) => lines.push(line),
    });

    expect(receipt.mode).toBe("preview");
    expect(receipt.target).toEqual({
      host: "db.example.test",
      database: "tambike_db",
    });
    expect(receipt.eventUpdates).toHaveLength(1);
    expect(store.apply).not.toHaveBeenCalled();
    expect(store.close).toHaveBeenCalledOnce();
    expect(lines.join("\n")).not.toMatch(/secret-user|secret-password/);
  });

  test("writes only with the explicit apply flag", async () => {
    const store = cleanupStore();

    const receipt = await runEventBriefCopyCleanupCli({
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
      eventUpdates: receipt.eventUpdates,
    });
    expect(store.close).toHaveBeenCalledOnce();
  });

  test("always closes the store", async () => {
    const store = cleanupStore();
    vi.mocked(store.inspect).mockRejectedValueOnce(new Error("inspect failed"));

    await expect(
      runEventBriefCopyCleanupCli({
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
