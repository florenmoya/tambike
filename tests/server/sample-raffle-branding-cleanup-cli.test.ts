import { describe, expect, it, vi } from "vitest";

import {
  runSampleRaffleBrandingCleanupCli,
  type SampleRaffleBrandingCleanupCliOptions,
} from "../../scripts/clean-sample-raffle-branding";
import type {
  SampleRaffleBrandingSnapshot,
  SampleRaffleBrandingStore,
} from "../../src/server/maintenance/sample-raffle-branding-cleanup";

const snapshot: SampleRaffleBrandingSnapshot = {
  winner: {
    id: "winner-id",
    email: "raffle.winner.sample@tambike.ph",
    displayName: "Raffle Winner",
  },
  completed: {
    id: "completed-id",
    eventId: "tambike-cafe-classico",
    creatorUserId: "organizer-id",
    title: "Cafe Classico Helmet Raffle",
    status: "completed",
    complianceStatus: "approved",
    award: {
      id: "award-id",
      winnerUserId: "winner-id",
      publicWinnerAlias: "Cafe Classico Rider",
      winnerAliasOptedInAt: new Date("2026-07-20T00:00:00.000Z"),
      winnerAliasRevokedAt: null,
    },
    prizePool: {
      id: "completed-pool-id",
      publicTitle: "Cafe Classico Helmet",
      publicDescription: "A full-face helmet for safer everyday rides.",
      prizeItem: { id: "item-id", title: "Cafe Classico Helmet" },
      publicImage: {
        id: "image-id",
        mediaId: "sample-raffle-helmet-photo-v1",
        storageKey:
          "media/giveaway-prizes/completed-pool-id/sample-raffle-helmet-photo-v1.webp",
      },
    },
    latestMechanics: {
      id: "mechanics-id",
      version: 1,
      mechanics: "One eligible rider was selected from valid entries.",
      terms:
        "The winner receives one Cafe Classico Helmet. The organizer will contact the winner with claiming instructions.",
      sponsorDisclosure: null,
    },
  },
};

function setup(
  overrides: Partial<SampleRaffleBrandingCleanupCliOptions> = {},
) {
  const calls: string[] = [];
  const store: SampleRaffleBrandingStore = {
    inspect: vi.fn().mockResolvedValue(structuredClone(snapshot)),
    apply: vi.fn(async () => {
      calls.push("apply");
    }),
    close: vi.fn(async () => {
      calls.push("close");
    }),
  };
  const mediaStore = {
    putObject: vi.fn(async () => {
      calls.push("put-new");
    }),
    deleteObject: vi.fn(async (key: string) => {
      calls.push(key.includes("hjc-c10-fop") ? "delete-new" : "delete-old");
    }),
  };
  const fetchPhoto = vi.fn().mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/webp" },
    }),
  );
  const normalizePhoto = vi.fn().mockResolvedValue({
    bytes: new Uint8Array([4, 5, 6]),
    mimeType: "image/webp",
    width: 1200,
    height: 800,
  });
  const output: string[] = [];
  const options: SampleRaffleBrandingCleanupCliOptions = {
    argv: [],
    environment: {
      DATABASE_URL: "postgresql://user:secret@db.example.com/tambike",
      AWS_REGION: "ap-southeast-1",
      AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/tambike",
      S3_BUCKET_NAME: "private-bucket",
    },
    write: (line) => output.push(line),
    createStore: vi.fn().mockResolvedValue(store),
    createMediaStore: vi.fn().mockReturnValue(mediaStore),
    fetchPhoto,
    normalizePhoto,
    ...overrides,
  };
  return {
    calls,
    store,
    mediaStore,
    fetchPhoto,
    normalizePhoto,
    output,
    options,
  };
}

describe("sample raffle branding cleanup CLI", () => {
  it("defaults to a read-only preview without loading or touching media", async () => {
    const context = setup({
      argv: ["--yes"],
      createMediaStore: vi.fn(() => {
        throw new Error("media should not be loaded");
      }),
    });

    const receipt = await runSampleRaffleBrandingCleanupCli(context.options);

    expect(receipt.mode).toBe("preview");
    expect(receipt.target).toEqual({
      host: "db.example.com",
      database: "tambike",
    });
    expect(receipt.imageUpdate?.to.mediaId).toBe(
      "sample-raffle-hjc-c10-fop-photo-v1",
    );
    expect(context.store.apply).not.toHaveBeenCalled();
    expect(context.fetchPhoto).not.toHaveBeenCalled();
    expect(context.store.close).toHaveBeenCalledOnce();
    expect(context.output.join("\n")).not.toContain("secret");
    expect(context.output.join("\n")).not.toContain("private-bucket");
  });

  it("applies only with --apply and removes the old object after commit", async () => {
    const context = setup({ argv: ["--apply"] });

    const receipt = await runSampleRaffleBrandingCleanupCli(context.options);

    expect(receipt.mode).toBe("apply");
    expect(context.fetchPhoto).toHaveBeenCalledWith(
      "https://hjchelmets.us/cdn/shop/files/mc23___c10_fop_1.webp?v=1769468143&width=1600",
    );
    expect(context.normalizePhoto).toHaveBeenCalledWith({
      body: expect.any(Buffer),
      claimedMimeType: "image/webp",
      purpose: "motorcycle-photo",
    });
    expect(context.mediaStore.putObject).toHaveBeenCalledWith({
      key: "media/giveaway-prizes/completed-pool-id/sample-raffle-hjc-c10-fop-photo-v1.webp",
      body: new Uint8Array([4, 5, 6]),
      mimeType: "image/webp",
    });
    expect(context.store.apply).toHaveBeenCalledWith(
      expect.objectContaining({ conflicts: [] }),
      { mimeType: "image/webp", width: 1200, height: 800 },
    );
    expect(context.calls).toEqual([
      "put-new",
      "apply",
      "delete-old",
      "close",
    ]);
  });

  it("removes the newly uploaded object when the transaction fails", async () => {
    const context = setup({ argv: ["--apply"] });
    vi.mocked(context.store.apply).mockImplementationOnce(async () => {
      context.calls.push("apply");
      throw new Error("transaction failed");
    });

    await expect(
      runSampleRaffleBrandingCleanupCli(context.options),
    ).rejects.toThrow("transaction failed");

    expect(context.calls).toEqual([
      "put-new",
      "apply",
      "delete-new",
      "close",
    ]);
  });

  it("rejects invalid image responses before S3 or database writes", async () => {
    const context = setup({
      argv: ["--apply"],
      fetchPhoto: vi.fn().mockResolvedValue(
        new Response("not an image", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ),
    });

    await expect(
      runSampleRaffleBrandingCleanupCli(context.options),
    ).rejects.toThrow("SAMPLE_RAFFLE_BRANDING_PHOTO_INVALID");
    expect(context.mediaStore.putObject).not.toHaveBeenCalled();
    expect(context.store.apply).not.toHaveBeenCalled();
    expect(context.store.close).toHaveBeenCalledOnce();
  });
});
