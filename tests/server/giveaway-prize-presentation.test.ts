import { describe, expect, test } from "vitest";

import { toPublicPrizePresentation } from "../../src/features/giveaways/public-prize-presentation";

describe("public giveaway prize presentation", () => {
  test("serializes revealed copy without operational inventory", () => {
    expect(
      toPublicPrizePresentation({
        disclosure: "revealed",
        publicTitle: "Weekend Rider Gear Package",
        publicDescription: "Helmet, gloves, and Tambike gear.",
      }),
    ).toEqual({
      disclosure: "revealed",
      title: "Weekend Rider Gear Package",
      description: "Helmet, gloves, and Tambike gear.",
    });
  });

  test("redacts every hidden public field for a surprise prize", () => {
    const serialized = JSON.stringify(
      toPublicPrizePresentation({
        disclosure: "surprise",
        publicTitle: "Private Ducati Helmet",
        publicDescription: "Private sponsor inventory",
        publicImage: {
          mediaId: "private-image",
          url: "/giveaway-prize-media/private-image",
          width: 1200,
          height: 900,
        },
      }),
    );

    expect(serialized).toBe(
      JSON.stringify({ disclosure: "surprise", title: "Surprise prize" }),
    );
    expect(serialized).not.toContain("Ducati");
    expect(serialized).not.toContain("private-image");
  });
});
