import { describe, expect, test } from "vitest";

import { demoEvents } from "@/features/tambike-demo/data";

const internalOrPromotionalPhrases = [
  /\bscan in\b/i,
  /\bsave .* leads?\b/i,
  /\brecord .* (?:report|participation)\b/i,
  /\bpriority perks?\b/i,
  /\bunlock\b/i,
  /\bexclusive\b/i,
  /\bdon['’]t miss\b/i,
];

describe("seeded event brief copy", () => {
  test("keeps every event plan concise and rider-facing", () => {
    expect(demoEvents).toHaveLength(24);

    for (const event of demoEvents) {
      const sentenceCount = event.whatHappens
        .split(/[.!?]+(?:\s|$)/)
        .filter(Boolean).length;

      expect(
        sentenceCount,
        `${event.id} should use one or two sentences`,
      ).toBeGreaterThanOrEqual(1);
      expect(
        sentenceCount,
        `${event.id} should use one or two sentences`,
      ).toBeLessThanOrEqual(2);
      expect(
        event.whatHappens.length,
        `${event.id} should stay compact`,
      ).toBeLessThanOrEqual(210);

      for (const phrase of internalOrPromotionalPhrases) {
        expect(event.whatHappens, `${event.id} contains ${phrase}`).not.toMatch(
          phrase,
        );
      }
    }
  });

  test("uses the approved Cafe Classico plan", () => {
    expect(
      demoEvents.find((event) => event.id === "tambike-cafe-classico")
        ?.whatHappens,
    ).toBe(
      "Park with the group, grab a drink, and meet riders over bikes and road stories. Come by on your own or with friends; there is no ride-out or fixed program.",
    );
  });
});
