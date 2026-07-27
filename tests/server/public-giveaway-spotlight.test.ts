// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { GiveawayState, PublicEventGiveaway } from "../../src/features/giveaways/types";
import { PublicGiveawayPanel } from "../../src/features/giveaways/public-giveaway-panel";
import { groupPublicGiveawaysForSpotlight } from "../../src/features/giveaways/public-giveaway-spotlight-state";
import { listPublicGiveawaysForEventAction } from "../../src/server/giveaway-actions";

vi.mock("../../src/server/giveaway-actions", () => ({
  listPublicGiveawaysForEventAction: vi.fn(),
}));

const roots: Root[] = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.replaceChildren();
  vi.clearAllMocks();
});

function campaign(id: string, state: GiveawayState): PublicEventGiveaway {
  return {
    giveaway: {
      id,
      eventId: "event-1",
      title: id,
      kind: "raffle",
      state,
      complianceStatus: "approved",
      entryMode: "opt_in",
      mechanics: "Mechanics",
      terms: "Terms",
      timeZone: "Asia/Manila",
      publicVisibility: "event_page",
      prizePools: [],
    },
    results: [],
    drawVerifications: [],
  };
}

describe("public giveaway spotlight", () => {
  test("leads with the first open raffle and preserves state-group order", () => {
    const groups = groupPublicGiveawaysForSpotlight([
      campaign("completed-1", "completed"),
      campaign("paused-1", "paused"),
      campaign("open-1", "open"),
      campaign("completed-2", "completed"),
      campaign("open-2", "open"),
      campaign("locked-1", "locked"),
    ]);

    expect(groups.primaryOpen?.giveaway.id).toBe("open-1");
    expect(groups.completed.map(({ giveaway }) => giveaway.id)).toEqual([
      "completed-1",
      "completed-2",
    ]);
    expect(groups.additional.map(({ giveaway }) => giveaway.id)).toEqual([
      "open-2",
      "paused-1",
      "locked-1",
    ]);
  });

  test("returns no spotlight when no open campaign exists", () => {
    const groups = groupPublicGiveawaysForSpotlight([
      campaign("completed-1", "completed"),
      campaign("scheduled-1", "scheduled"),
    ]);

    expect(groups.primaryOpen).toBeUndefined();
    expect(groups.completed.map(({ giveaway }) => giveaway.id)).toEqual(["completed-1"]);
    expect(groups.additional.map(({ giveaway }) => giveaway.id)).toEqual(["scheduled-1"]);
  });

  test("renders every open raffle before completed results and keeps proof secondary", async () => {
    const completed = campaign("Completed helmet raffle", "completed");
    completed.giveaway.prizePools = [
      {
        id: "helmet-pool",
        title: "Helmet prize",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        inventoryKind: "finite",
        itemQuantity: 1,
        presenceVerificationRequired: false,
        items: [{ id: "helmet", title: "Tambike helmet" }],
      },
    ];
    completed.results = [{ prizePoolTitle: "Helmet prize", winnerAlias: "Rider M." }];
    completed.drawVerifications = [
      {
        giveawayId: "Completed helmet raffle",
        commitment: "commitment-value",
        snapshotDigest: "snapshot-digest",
        snapshotCount: 12,
        algorithmVersion: "v1",
        drawDigest: "draw-digest",
        seed: "revealed-seed",
      },
    ];

    const open = campaign("Open jacket raffle", "open");
    open.giveaway.prizePools = [
      {
        id: "jacket-pool",
        title: "Jacket prize",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        inventoryKind: "finite",
        itemQuantity: 1,
        presenceVerificationRequired: false,
        items: [{ id: "jacket", title: "Tambike riding jacket" }],
      },
    ];
    open.giveaway.entryOpensAt = "2026-07-27T00:00:00.000Z";
    open.giveaway.entryClosesAt = "2026-07-30T00:00:00.000Z";

    const secondOpen = campaign("Open gloves raffle", "open");
    const secondCompleted = campaign("Completed boots raffle", "completed");

    vi.mocked(listPublicGiveawaysForEventAction).mockResolvedValue({
      ok: true,
      code: "OK",
      data: [completed, open, secondCompleted, secondOpen],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(createElement(PublicGiveawayPanel, { eventId: "event-1" }));
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("See what is open and who won recently.");
    });

    const text = container.textContent ?? "";
    expect(
      [...container.querySelectorAll("article h3")].map((heading) => heading.textContent),
    ).toEqual([
      "Open jacket raffle",
      "Open gloves raffle",
      "Completed helmet raffle",
      "Completed boots raffle",
    ]);
    expect(container.querySelector("header span")?.textContent).toBe("Raffles & prizes");
    expect(text).not.toContain("Prize route");
    expect(text).toContain("Open now");
    expect(text).toContain("Tambike riding jacket");
    expect(text).toContain("Recent winner");
    expect(text).toContain("Rider M.");
    expect(text).toContain("Winner chose to share this alias.");
    expect(text).toContain("Verify the draw");
    expect(
      container.querySelector<HTMLAnchorElement>('a[href="/login?next=%2Fevents%2Fevent-1"]')
        ?.textContent,
    ).toContain("Log in to enter");

    const articles = [...container.querySelectorAll("article")];
    expect(articles[0]?.textContent).not.toContain("Verify the draw");
    expect(articles[0]?.textContent).not.toContain("Rider M.");
    expect(articles[2]?.querySelector("details summary")?.textContent).toBe("How it worked");
  });
});
