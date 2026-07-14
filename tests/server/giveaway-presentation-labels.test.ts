import { describe, expect, test } from "vitest";

import {
  deriveGiveawayPresentationLabelPreview,
  deriveGiveawayPresentationLabels,
  normalizeGiveawayDisplayName,
} from "../../src/server/giveaways/presentation-labels";

describe("giveaway live presentation labels", () => {
  test("strips controls, collapses whitespace, and derives a Unicode-aware first-name label", () => {
    expect(normalizeGiveawayDisplayName(" \u0000  Mar\u00eda\tde\n\ud835\udc9eanon \u0007 ")).toBe(
      "Mar\u00eda de \ud835\udc9eanon",
    );
    expect(
      deriveGiveawayPresentationLabelPreview({
        displayName: " \u0000  Mar\u00eda\tde\n\ud835\udc9eanon \u0007 ",
        opaquePublicReference: "ref-unicode",
        optedIn: true,
      }),
    ).toEqual({ presentationLabel: "Mar\u00eda \ud835\udc9e.", presentationLabelKind: "consented_name" });
  });

  test("keeps a safe single token, caps it at 40 characters, and masks unsafe names", () => {
    expect(
      deriveGiveawayPresentationLabelPreview({
        displayName: "Ren\u00e9e",
        opaquePublicReference: "ref-single",
        optedIn: true,
      }),
    ).toEqual({ presentationLabel: "Ren\u00e9e", presentationLabelKind: "consented_name" });

    const capped = deriveGiveawayPresentationLabelPreview({
      displayName: "A".repeat(45),
      opaquePublicReference: "ref-long",
      optedIn: true,
    });
    expect(Array.from(capped.presentationLabel)).toHaveLength(40);
    expect(capped.presentationLabelKind).toBe("consented_name");

    expect(
      deriveGiveawayPresentationLabelPreview({
        displayName: "\ud83d\udeb2",
        opaquePublicReference: "ref-unsafe",
        optedIn: true,
      }),
    ).toMatchObject({ presentationLabelKind: "masked", presentationLabel: expect.stringMatching(/^Rider [0-9A-F]{4}$/) });
    expect(
      deriveGiveawayPresentationLabelPreview({
        displayName: "...",
        opaquePublicReference: "ref-punctuation-only",
        optedIn: true,
      }),
    ).toMatchObject({ presentationLabelKind: "masked" });
  });

  test("extends colliding masked codes from four to six and then eight hex characters", () => {
    const fourCollision = deriveGiveawayPresentationLabels([
      { entryId: "four-a", displayName: "A", opaquePublicReference: "ref-131", optedIn: false },
      { entryId: "four-b", displayName: "B", opaquePublicReference: "ref-342", optedIn: false },
    ]);
    expect(fourCollision.map((entry) => entry.presentationLabel)).toEqual([
      "Rider 443630",
      "Rider 44365F",
    ]);

    const sixCollision = deriveGiveawayPresentationLabels([
      { entryId: "six-a", displayName: "A", opaquePublicReference: "ref-4342", optedIn: false },
      { entryId: "six-b", displayName: "B", opaquePublicReference: "ref-6453", optedIn: false },
    ]);
    expect(sixCollision.map((entry) => entry.presentationLabel)).toEqual([
      "Rider 044DD628",
      "Rider 044DD6A5",
    ]);
  });

  test("continues past an eight-character collision and keeps duplicate consented suffixes unique", () => {
    const references = ["entry_collision_probe_9305", "entry_collision_probe_25309"];
    const masked = deriveGiveawayPresentationLabels(
      references.map((opaquePublicReference, index) => ({
        entryId: `masked-${index}`,
        displayName: "…",
        opaquePublicReference,
        optedIn: false,
      })),
    );
    const consented = deriveGiveawayPresentationLabels(
      references.map((opaquePublicReference, index) => ({
        entryId: `consented-${index}`,
        displayName: index === 0 ? "Mina Rivera" : "mina Reyes",
        opaquePublicReference,
        optedIn: true,
      })),
    );

    expect(masked.map((entry) => entry.presentationLabel)).toEqual([
      "Rider EF4BEF06B6",
      "Rider EF4BEF06F9",
    ]);
    expect(consented.map((entry) => entry.presentationLabel)).toEqual([
      "Mina R. · EF4BEF06B6",
      "mina R. · EF4BEF06F9",
    ]);
    for (const entry of [...masked, ...consented]) {
      expect(Array.from(entry.presentationLabel).length).toBeLessThanOrEqual(40);
    }
  });

  test("fails closed when a masked collision cannot fit the 40-character label cap", () => {
    expect(() =>
      deriveGiveawayPresentationLabels([
        { entryId: "collision-a", displayName: "A", opaquePublicReference: "same-reference", optedIn: false },
        { entryId: "collision-b", displayName: "B", opaquePublicReference: "same-reference", optedIn: false },
      ]),
    ).toThrow("GIVEAWAY_PRESENTATION_LABEL_CODE_CAP_EXCEEDED");
  });

  test("suffixes every case-insensitive duplicate consented label with its resolved masked code", () => {
    const labels = deriveGiveawayPresentationLabels([
      { entryId: "entry-a", displayName: "Mina Rivera", opaquePublicReference: "duplicate-a", optedIn: true },
      { entryId: "entry-b", displayName: "mina Reyes", opaquePublicReference: "duplicate-b", optedIn: true },
      { entryId: "entry-c", displayName: "Unique Rider", opaquePublicReference: "unique", optedIn: true },
    ]);

    expect(labels[0]).toMatchObject({
      entryId: "entry-a",
      presentationLabelKind: "consented_name",
      presentationLabel: expect.stringMatching(/^Mina R\. \u00b7 [0-9A-F]{4,8}$/),
    });
    expect(labels[1]).toMatchObject({
      entryId: "entry-b",
      presentationLabelKind: "consented_name",
      presentationLabel: expect.stringMatching(/^mina R\. \u00b7 [0-9A-F]{4,8}$/),
    });
    expect(labels[2]).toMatchObject({
      presentationLabelKind: "consented_name",
      presentationLabel: "Unique R.",
    });
  });
});
