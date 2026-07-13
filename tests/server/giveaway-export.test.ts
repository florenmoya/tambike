import { describe, expect, test } from "vitest";

import { buildGiveawayCsv, escapeGiveawayCsvCell } from "../../src/server/giveaways/export";

describe("giveaway CSV export safety", () => {
  test("escapes spreadsheet formulas after leading whitespace and raw tab or carriage-return prefixes", () => {
    expect(escapeGiveawayCsvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(escapeGiveawayCsvCell("  +SUM(A1:A2)")).toBe("'  +SUM(A1:A2)");
    expect(escapeGiveawayCsvCell("\tplain text")).toBe("'\tplain text");
    expect(escapeGiveawayCsvCell("\rplain text")).toBe("'\rplain text");
    expect(escapeGiveawayCsvCell("safe value")).toBe("safe value");
  });

  test("quotes commas and quotes without leaking omitted secret fields", () => {
    const csv = buildGiveawayCsv(
      ["giveaway_title", "winner_email", "status"],
      [
        {
          giveaway_title: 'Helmet, "limited"',
          winner_email: "rider@example.test",
          status: "claimable",
          claimTokenHash: "must-not-be-exported",
          encryptedPayload: "must-not-be-exported",
        },
      ],
    );

    expect(csv).toBe(
      'giveaway_title,winner_email,status\n"Helmet, ""limited""",rider@example.test,claimable',
    );
    expect(csv).not.toContain("must-not-be-exported");
  });
});
