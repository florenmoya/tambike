import { describe, expect, test } from "vitest";

import {
  giveawayEntryModeLabel,
  giveawayStateLabel,
  isGiveawayClaimActionable,
  riderGiveawayStatusLabel,
  safeGiveawayNotificationHref,
} from "../../src/features/giveaways/giveaway-surface-state";

describe("giveaway surface state", () => {
  test("uses factual labels for campaign and rider states", () => {
    expect(giveawayStateLabel("open")).toBe("Entries open");
    expect(giveawayStateLabel("claims_open")).toBe("Winners announced");
    expect(giveawayEntryModeLabel("claim_code")).toBe("Code entry");
    expect(riderGiveawayStatusLabel("pending_verification")).toBe("Awaiting verification");
    expect(riderGiveawayStatusLabel("fulfilled")).toBe("Fulfilled");
  });

  test("only presents a claim action while a credential can be used", () => {
    expect(isGiveawayClaimActionable("pending_verification")).toBe(true);
    expect(isGiveawayClaimActionable("claimable")).toBe(true);
    expect(isGiveawayClaimActionable("verified")).toBe(false);
    expect(isGiveawayClaimActionable("fulfilled")).toBe(false);
  });

  test("keeps notification navigation on a local, non-protocol-relative path", () => {
    expect(safeGiveawayNotificationHref("/giveaway-claims/award-123")).toBe(
      "/giveaway-claims/award-123",
    );
    expect(safeGiveawayNotificationHref("https://example.test/claim")).toBeUndefined();
    expect(safeGiveawayNotificationHref("//example.test/claim")).toBeUndefined();
    expect(safeGiveawayNotificationHref("/\\example.test/claim")).toBeUndefined();
    expect(safeGiveawayNotificationHref("javascript:alert(1)")).toBeUndefined();
  });
});
