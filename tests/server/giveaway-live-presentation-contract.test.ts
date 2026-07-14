import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { rankFrozenWeightedEntries } from "../../src/server/giveaways/draw-engine";

async function readSource(path: string) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("live-raffle presentation contracts", () => {
  test("implements the preference and frozen-label flow in both backends without private audit metadata", async () => {
    const [memory, prisma] = await Promise.all([
      readSource("src/server/backend.ts"),
      readSource("src/server/prisma-backend.ts"),
    ]);

    for (const source of [memory, prisma]) {
      expect(source).toContain("async setGiveawayLivePresentationPreference(");
      expect(source).toContain("GIVEAWAY_LIVE_PRESENTATION_OPTED_IN");
      expect(source).toContain("GIVEAWAY_LIVE_PRESENTATION_REVOKED");
      expect(source).toContain("presentationLabel");
      expect(source).toContain("presentationLabelKind");

      const methodStart = source.indexOf("async setGiveawayLivePresentationPreference(");
      const methodEnd = source.indexOf("\n  async ", methodStart + 10);
      const method = source.slice(methodStart, methodEnd);
      const auditStart = method.indexOf("GIVEAWAY_LIVE_PRESENTATION_");
      const auditTail = method.slice(auditStart);
      expect(auditTail).not.toMatch(/displayName|opaquePublicReference/);
    }
  });

  test("keeps label fields outside rank-source and snapshot digests", async () => {
    const [memory, prisma] = await Promise.all([
      readSource("src/server/backend.ts"),
      readSource("src/server/prisma-backend.ts"),
    ]);

    const memoryRankStart = memory.indexOf("rankSourceDigest: createHash");
    const memoryRankSource = memory.slice(
      memoryRankStart,
      memory.indexOf("presentationLabel:", memoryRankStart),
    );
    const prismaRankStart = prisma.indexOf("rankSourceDigest: this.calculateGiveawayRankSourceDigest");
    const prismaRankSource = prisma.slice(
      prismaRankStart,
      prisma.indexOf("presentationLabel:", prismaRankStart),
    );
    for (const source of [memoryRankSource, prismaRankSource]) {
      expect(source).not.toMatch(/presentationLabel|livePresentation/);
    }

    const memorySnapshotDigest = memory.slice(
      memory.indexOf("const snapshotDigest = createHash", memoryRankStart),
      memory.indexOf("const snapshot: GiveawaySnapshotRecord", memoryRankStart),
    );
    const prismaSnapshotDigest = prisma.slice(
      prisma.indexOf("private calculateGiveawaySnapshotDigest("),
      prisma.indexOf("private calculateGiveawayDrawInputDigest("),
    );
    const prismaDrawResultDigest = prisma.slice(
      prisma.indexOf("private calculateGiveawayDrawResultDigest("),
      prisma.indexOf("private ", prisma.indexOf("private calculateGiveawayDrawResultDigest(") + 10),
    );
    for (const source of [memorySnapshotDigest, prismaSnapshotDigest, prismaDrawResultDigest]) {
      expect(source).not.toMatch(/presentationLabel|livePresentation/);
    }
  });

  test("presentation-only fields cannot change deterministic ranking or the selected entry", () => {
    const seed = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
    const entries = [
      { id: "entry-a", weight: 2 },
      { id: "entry-b", weight: 1 },
    ];
    const entriesWithPresentation = entries.map((entry, index) => ({
      ...entry,
      presentationLabel: index === 0 ? "Mina R." : "Rider ABCD",
      presentationLabelKind: index === 0 ? "consented_name" : "masked",
    }));
    const ranked = rankFrozenWeightedEntries({
      giveawayId: "giveaway-label-proof",
      seed,
      entries,
    });
    const rankedWithPresentation = rankFrozenWeightedEntries({
      giveawayId: "giveaway-label-proof",
      seed,
      entries: entriesWithPresentation,
    });

    expect(rankedWithPresentation).toEqual(ranked);
    expect(rankedWithPresentation[0]?.entryId).toBe(ranked[0]?.entryId);
  });
});
