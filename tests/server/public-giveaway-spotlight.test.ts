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
  vi.restoreAllMocks();
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

  test("keeps the public prize visible before a scheduled raffle opens", async () => {
    const scheduled = campaign("Scheduled helmet raffle", "scheduled");
    scheduled.giveaway.prizePools = [
      {
        id: "scheduled-pool",
        awardMode: "random_draw",
        inventoryKind: "finite",
        itemQuantity: 1,
        presenceVerificationRequired: false,
        presentation: { disclosure: "revealed", title: "Early-bird helmet" },
      },
    ];
    vi.mocked(listPublicGiveawaysForEventAction).mockResolvedValue({
      ok: true,
      code: "OK",
      data: [scheduled],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(createElement(PublicGiveawayPanel, { eventId: "event-1" }));
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Scheduled helmet raffle");
    });

    expect(container.textContent).toContain("Win:");
    expect(container.textContent).toContain("Early-bird helmet");
    expect(container.textContent).not.toContain("Log in to enter");
  });

  test("renders every open raffle before completed results in plain raffle language", async () => {
    const completed = campaign("Completed helmet raffle", "completed");
    completed.giveaway.sponsorDisclosure = "Supported by Helmet Co.";
    completed.giveaway.prizePools = [
      {
        id: "helmet-pool",
        awardMode: "random_draw",
        inventoryKind: "finite",
        itemQuantity: 1,
        presenceVerificationRequired: false,
        presentation: { disclosure: "revealed", title: "Tambike helmet" },
      },
    ];
    completed.results = [
      { prizeTitle: "Tambike helmet", winnerAlias: "Raffle Sample Rider" },
    ];
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
    open.giveaway.sponsorDisclosure = "Presented by Jacket Co.";
    open.giveaway.prizePools = [
      {
        id: "jacket-pool",
        awardMode: "random_draw",
        inventoryKind: "finite",
        itemQuantity: 1,
        presenceVerificationRequired: false,
        presentation: {
          disclosure: "revealed",
          title: "Weekend Rider Gear Package",
          description: "A road-ready jacket and riding essentials.",
          image: {
            mediaId: "jacket-image",
            url: "/api/giveaway-prize-media/jacket-image",
            width: 1200,
            height: 900,
          },
        },
      },
    ];
    open.giveaway.entryOpensAt = "2026-07-27T00:00:00.000Z";
    open.giveaway.entryClosesAt = "2026-07-30T00:00:00.000Z";
    open.giveaway.drawAt = "2026-08-01T00:00:00.000Z";

    const secondOpen = campaign("Open gloves raffle", "open");
    secondOpen.giveaway.sponsorDisclosure = "Backed by Gloves Co.";
    secondOpen.giveaway.prizePools = [
      {
        id: "surprise-pool",
        awardMode: "random_draw",
        inventoryKind: "finite",
        itemQuantity: 1,
        presenceVerificationRequired: false,
        presentation: { disclosure: "surprise", title: "Surprise prize" },
      },
    ];
    const hiddenInventoryTitle = "Private carbon racing gloves";
    const secondCompleted = campaign("Completed boots raffle", "completed");
    secondCompleted.giveaway.sponsorDisclosure = "   ";

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
      expect(container.textContent).toContain(
        "Join the current raffle or see the latest result.",
      );
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
    const articles = [...container.querySelectorAll("article")];
    expect(container.querySelector("header span")?.textContent).toBe("Raffles");
    expect(text).not.toContain("Prize route");
    expect(text).toContain("Ongoing");
    expect(text).toContain("Win:");
    expect(text).toContain("Weekend Rider Gear Package");
    expect(text).toContain("Entries close:");
    expect(text).toContain("Draw date:");
    expect(text).toContain("Surprise prize");
    expect(text).not.toContain(hiddenInventoryTitle);
    expect(text).toContain("Completed");
    expect(text).toContain("Winner:");
    expect(text).toContain("Raffle Sample Rider");
    expect(text).toContain("Prize won:");
    expect(articles[1]?.querySelector("span")?.textContent).toBe("Ongoing");
    expect(text).toContain("Presented by Jacket Co.");
    expect(text).toContain("Supported by Helmet Co.");
    expect(text).toContain("Backed by Gloves Co.");
    expect(
      container.querySelector<HTMLAnchorElement>('a[href="/login?next=%2Fevents%2Fevent-1"]')
        ?.textContent,
    ).toContain("Log in to enter");
    expect(text).not.toContain("Log in with your rider account to enter while this raffle is open.");

    const prizeImage = articles[0]?.querySelector<HTMLImageElement>("img");
    expect(prizeImage?.alt).toBe("Weekend Rider Gear Package");
    expect(prizeImage?.getAttribute("width")).toBe("1200");
    expect(prizeImage?.getAttribute("height")).toBe("900");

    for (const removed of [
      "Featured prize",
      "Opt-in entry",
      "Recent winner",
      "How it worked",
      "Verify the draw",
    ]) {
      expect(text).not.toContain(removed);
    }

    expect(articles[0]?.textContent).not.toContain("Raffle Sample Rider");
    expect(articles[0]?.querySelector("details summary")?.textContent).toBe(
      "Raffle details",
    );
    expect(articles[2]?.querySelector("details summary")?.textContent).toBe("View result");
    expect(articles[2]?.textContent).toContain("Draw details");
    expect(articles[3]?.querySelectorAll("details p")).toHaveLength(2);
  });

  test("keeps the raffle loading state compact", () => {
    vi.mocked(listPublicGiveawaysForEventAction).mockReturnValue(
      new Promise(() => undefined),
    );

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(createElement(PublicGiveawayPanel, { eventId: "event-1" }));
    });

    const section = container.querySelector("section");
    const status = container.querySelector('[role="status"]');

    expect(section?.getAttribute("aria-busy")).toBe("true");
    expect(status?.textContent).toContain("Loading raffles…");
    expect(status?.querySelectorAll(':scope > [aria-hidden="true"]')).toHaveLength(1);
  });

  test("renders repeated public aliases without duplicate React keys", async () => {
    const completed = campaign("Completed duplicate-alias raffle", "completed");
    completed.results = [
      { prizeTitle: "Tambike helmet", winnerAlias: "Rider M." },
      { prizeTitle: "Tambike helmet", winnerAlias: "Rider M." },
    ];
    vi.mocked(listPublicGiveawaysForEventAction).mockResolvedValue({
      ok: true,
      code: "OK",
      data: [completed],
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(createElement(PublicGiveawayPanel, { eventId: "event-1" }));
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Completed duplicate-alias raffle");
    });

    expect(
      [...container.querySelectorAll("p")].filter(
        (paragraph) => paragraph.textContent?.endsWith("Rider M."),
      ),
    ).toHaveLength(2);
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain(
      "Encountered two children with the same key",
    );
  });
});
