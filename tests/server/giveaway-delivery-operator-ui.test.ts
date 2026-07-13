import { readFile } from "node:fs/promises";

import { describe, expect, test, vi } from "vitest";

vi.mock("../../src/server/giveaway-actions", () => ({
  fulfillGiveawayAwardAction: vi.fn(),
  readGiveawayDeliveryDetailsAction: vi.fn(),
  resolveGiveawayClaimAction: vi.fn(),
  verifyGiveawayClaimAction: vi.fn(),
}));

const scannerSourceUrl = new URL(
  "../../src/features/giveaways/giveaway-claim-scanner-panel.tsx",
  import.meta.url,
);

describe("giveaway delivery claim operator UI", () => {
  test("gates only delivery fulfilment on a details view for the same active award", async () => {
    const scannerModule = (await import("../../src/features/giveaways/giveaway-claim-scanner-panel")) as Record<
      string,
      unknown
    >;
    const canFulfill = scannerModule.canFulfillGiveawayClaim;

    expect(canFulfill).toBeTypeOf("function");
    if (typeof canFulfill !== "function") {
      return;
    }

    const predicate = canFulfill as (
      claim: { awardId: string; status: string; fulfilmentMode: string } | null,
      deliveryDetails: { awardId: string } | null,
    ) => boolean;
    const deliveryClaim = { awardId: "award-1", status: "verified", fulfilmentMode: "delivery" };

    expect(predicate(deliveryClaim, null)).toBe(false);
    expect(predicate(deliveryClaim, { awardId: "award-2" })).toBe(false);
    expect(predicate(deliveryClaim, { awardId: "award-1" })).toBe(true);
    expect(predicate({ awardId: "award-3", status: "verified", fulfilmentMode: "onsite" }, null)).toBe(true);
  });

  test("keeps consented delivery details transient and requires an explicit view before fulfilment", async () => {
    const source = await readFile(scannerSourceUrl, "utf8");

    expect(source).toContain("readGiveawayDeliveryDetailsAction");
    expect(source).toContain("const [deliveryDetails, setDeliveryDetails]");
    expect(source).toContain('claim.fulfilmentMode === "delivery"');
    expect(source).toContain("View consented delivery details");
    expect(source).toContain("Hide details");
    expect(source).toContain("Clear claim");
    expect(source).toContain("Delivery details must be viewed before fulfilment.");
    expect(source).toContain("setDeliveryDetails(null)");
    expect(source).not.toMatch(/localStorage|sessionStorage|URLSearchParams|router\.(push|replace).*delivery/i);
  });
});
