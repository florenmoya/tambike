import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(async () => undefined),
  getContext: vi.fn(),
}));

vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("../../src/server/giveaway-actions", () => ({
  getRiderGiveawayClaimContextAction: mocks.getContext,
}));
vi.mock("../../src/features/giveaways/giveaway-claim-screen", () => ({
  GiveawayClaimScreen: () => null,
}));

import ClaimPage from "../../src/app/giveaway-claims/[awardId]/page";

describe("giveaway claim route", () => {
  test("awaits the award id and passes only the safe action envelope into the rider screen", async () => {
    mocks.getContext.mockResolvedValue({
      ok: true,
      code: "OK",
      data: {
        awardId: "award-1",
        giveawayId: "giveaway-1",
        giveawayTitle: "Sunday ride draw",
        giveawayState: "claims_open",
        award: {
          prizePoolTitle: "Helmet",
          status: "claimable",
          fulfilmentMode: "onsite",
        },
        deliveryDetailsSubmitted: false,
        claimCredentialIssued: false,
      },
    });

    const element = await ClaimPage({ params: Promise.resolve({ awardId: "award-1" }) });

    expect(mocks.connection).toHaveBeenCalledOnce();
    expect(mocks.getContext).toHaveBeenCalledWith("award-1");
    expect(element.props).toMatchObject({
      awardId: "award-1",
      initialContext: {
        awardId: "award-1",
        giveawayId: "giveaway-1",
        claimCredentialIssued: false,
      },
      initialError: null,
    });
  });

  test("keeps an unauthenticated response generic and out of route data", async () => {
    mocks.getContext.mockResolvedValue({ ok: false, code: "UNAUTHENTICATED" });

    const element = await ClaimPage({ params: Promise.resolve({ awardId: "award-2" }) });

    expect(element.props).toEqual({
      awardId: "award-2",
      initialContext: null,
      initialError: "UNAUTHENTICATED",
    });
  });
});
