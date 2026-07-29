// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, createElement, type ComponentType } from "react";
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
const raffleCss = readFileSync(
  join(
    process.cwd(),
    "src/features/giveaways/public-giveaway-panel.module.css",
  ),
  "utf8",
);

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
  test("removes a failed prize image and tries again when media identity changes", async () => {
    const panelModule = (await import(
      "../../src/features/giveaways/public-giveaway-panel"
    )) as Record<string, unknown>;
    const prizeImage = panelModule.PublicPrizeImage;

    expect(prizeImage).toBeTypeOf("function");
    if (typeof prizeImage !== "function") return;

    const PrizeImage = prizeImage as ComponentType<{
      presentation: {
        disclosure: "revealed";
        title: string;
        image: { mediaId: string; url: string; width: number; height: number };
      };
    }>;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(
        createElement(PrizeImage, {
          presentation: {
            disclosure: "revealed",
            title: "Road helmet",
            image: {
              mediaId: "  media-1  ",
              url: "/api/giveaway-prize-media/media-1",
              width: 1200,
              height: 900,
            },
          },
        }),
      );
    });

    const failedImage = container.querySelector("img");
    expect(failedImage).not.toBeNull();
    expect(
      new URL(failedImage?.getAttribute("src") ?? "", window.location.href)
        .pathname,
    ).toBe(
      "/giveaway-prize-media/media-1",
    );
    act(() => {
      failedImage?.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.children).toHaveLength(0);

    act(() => {
      root.render(
        createElement(PrizeImage, {
          presentation: {
            disclosure: "revealed",
            title: "Riding jacket",
            image: {
              mediaId: "media-2",
              url: "/api/giveaway-prize-media/media-2",
              width: 1200,
              height: 900,
            },
          },
        }),
      );
    });

    expect(container.querySelector("img")?.alt).toBe("Riding jacket");
    expect(
      new URL(
        container.querySelector("img")?.getAttribute("src") ?? "",
        window.location.href,
      ).pathname,
    ).toBe(
      "/giveaway-prize-media/media-2",
    );
  });

  test.each([
    [
      "padded URL",
      {
        mediaId: "media-1",
        url: " /giveaway-prize-media/media-1 ",
        width: 1200,
        height: 900,
      },
    ],
    [
      "control-character URL",
      {
        mediaId: "media-1",
        url: "/giveaway-prize-media/media-1\n",
        width: 1200,
        height: 900,
      },
    ],
    [
      "remote URL",
      {
        mediaId: "media-1",
        url: "https://tracker.example/prize.webp",
        width: 1200,
        height: 900,
      },
    ],
    [
      "mismatched managed URL",
      {
        mediaId: "media-1",
        url: "/giveaway-prize-media/media-2",
        width: 1200,
        height: 900,
      },
    ],
    [
      "nonpositive dimensions",
      {
        mediaId: "media-1",
        url: "/giveaway-prize-media/media-1",
        width: 0,
        height: -1,
      },
    ],
    [
      "fractional dimensions",
      {
        mediaId: "media-1",
        url: "/giveaway-prize-media/media-1",
        width: 1200.5,
        height: 900,
      },
    ],
    [
      "unsafe dimensions",
      {
        mediaId: "media-1",
        url: "/giveaway-prize-media/media-1",
        width: Number.MAX_SAFE_INTEGER + 1,
        height: 900,
      },
    ],
    [
      "unreasonably large dimensions",
      {
        mediaId: "media-1",
        url: "/giveaway-prize-media/media-1",
        width: 32_769,
        height: 900,
      },
    ],
  ])("drops %s and leaves a clean text-only prize", async (_label, image) => {
    const panelModule = (await import(
      "../../src/features/giveaways/public-giveaway-panel"
    )) as Record<string, unknown>;
    const prizeImage = panelModule.PublicPrizeImage;

    expect(prizeImage).toBeTypeOf("function");
    if (typeof prizeImage !== "function") return;

    const PrizeImage = prizeImage as ComponentType<{
      presentation: {
        disclosure: "revealed";
        title: string;
        image: typeof image;
      };
    }>;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(
        createElement(PrizeImage, {
          presentation: {
            disclosure: "revealed",
            title: "Text-only prize",
            image,
          },
        }),
      );
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.children).toHaveLength(0);
  });

  test("keeps a restrained four-by-three image box at desktop and mobile widths", () => {
    const imageRule = raffleCss.match(/\.prizeImage\s*\{[^}]+\}/)?.[0] ?? "";
    const mobileCss = raffleCss.slice(raffleCss.indexOf("@media (max-width: 390px)"));

    expect(imageRule).toContain("aspect-ratio: 4 / 3");
    expect(imageRule).toContain("width: min(100%, 28rem)");
    expect(imageRule).not.toContain("max-height");
    expect(raffleCss).not.toContain("max-height");
    expect(mobileCss).toContain(".section");
    expect(mobileCss).toContain("padding: 0.8rem");
  });

  test("keeps duplicate result nodes stable when unrelated results are inserted or reordered", async () => {
    const panelModule = (await import(
      "../../src/features/giveaways/public-giveaway-panel"
    )) as Record<string, unknown>;
    const resultList = panelModule.PublicGiveawayResultList;

    expect(resultList).toBeTypeOf("function");
    if (typeof resultList !== "function") return;

    type Result = PublicEventGiveaway["results"][number];
    const ResultList = resultList as ComponentType<{
      results: Result[];
      presentationTitle: string;
    }>;
    const duplicate = { prizeTitle: "Tambike helmet", winnerAlias: "Rider M." };
    const firstResults = [
      duplicate,
      { prizeTitle: "Riding jacket", winnerAlias: "Rider J." },
      { ...duplicate },
    ];
    const reorderedResults = [
      { prizeTitle: "Riding boots", winnerAlias: "Rider B." },
      duplicate,
      { prizeTitle: "Riding jacket", winnerAlias: "Rider J." },
      { ...duplicate },
    ];
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(
        createElement(ResultList, {
          results: firstResults,
          presentationTitle: "Fallback prize",
        }),
      );
    });
    const before = [...container.querySelectorAll("p")]
      .filter((paragraph) => paragraph.textContent?.endsWith("Rider M."))
      .map((paragraph) => paragraph.parentElement);

    act(() => {
      root.render(
        createElement(ResultList, {
          results: reorderedResults,
          presentationTitle: "Fallback prize",
        }),
      );
    });
    const after = [...container.querySelectorAll("p")]
      .filter((paragraph) => paragraph.textContent?.endsWith("Rider M."))
      .map((paragraph) => paragraph.parentElement);

    expect(before).toHaveLength(2);
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

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

  test("fails closed when legacy public prize pools have no valid presentation", async () => {
    const internalPoolTitle = "Private sponsor inventory";
    const internalItemTitle = "Unannounced carbon helmet";
    const legacyPool = {
      id: "legacy-pool",
      title: internalPoolTitle,
      awardMode: "random_draw",
      inventoryKind: "finite",
      itemQuantity: 1,
      presenceVerificationRequired: false,
      items: [{ title: internalItemTitle }],
    } as unknown as PublicEventGiveaway["giveaway"]["prizePools"][number];
    const malformedPool = {
      ...legacyPool,
      id: "malformed-pool",
      presentation: { disclosure: "revealed", title: "   " },
    } as unknown as PublicEventGiveaway["giveaway"]["prizePools"][number];

    const open = campaign("Legacy open raffle", "open");
    open.giveaway.prizePools = [legacyPool];
    const completed = campaign("Legacy completed raffle", "completed");
    completed.giveaway.prizePools = [legacyPool];
    const scheduled = campaign("Legacy scheduled raffle", "scheduled");
    scheduled.giveaway.prizePools = [legacyPool];
    const paused = campaign("Malformed paused raffle", "paused");
    paused.giveaway.prizePools = [malformedPool];

    vi.mocked(listPublicGiveawaysForEventAction).mockResolvedValue({
      ok: true,
      code: "OK",
      data: [open, completed, scheduled, paused],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(createElement(PublicGiveawayPanel, { eventId: "event-1" }));
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Legacy open raffle");
    });

    const text = container.textContent ?? "";
    expect(text.match(/Prize details unavailable/g)).toHaveLength(3);
    expect(text).not.toContain(internalPoolTitle);
    expect(text).not.toContain(internalItemTitle);
  });

  test("shows every open raffle without implying that a winner exists", async () => {
    const firstOpen = campaign("Helmet raffle", "open");
    const secondOpen = campaign("Gear raffle", "open");

    vi.mocked(listPublicGiveawaysForEventAction).mockResolvedValue({
      ok: true,
      code: "OK",
      data: [firstOpen, secondOpen],
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(createElement(PublicGiveawayPanel, { eventId: "event-1" }));
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Event raffles");
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Open raffles");
    expect(text).toContain("Helmet raffle");
    expect(text).toContain("Gear raffle");
    expect(text).not.toContain("Recent winners");
    expect(text).not.toContain("Latest winner");
  });

  test("separates every open raffle from published winner results", async () => {
    const completed = campaign("Helmet raffle result", "completed");
    completed.giveaway.sponsorDisclosure = "Supported by Helmet Co.";
    completed.giveaway.mechanics = "One eligible rider was selected from valid entries.";
    completed.giveaway.terms = "The organizer will contact the winner.";
    completed.giveaway.drawAt = "2026-07-26T00:00:00.000Z";
    completed.giveaway.prizePools = [
      {
        id: "helmet-pool",
        awardMode: "random_draw",
        inventoryKind: "finite",
        itemQuantity: 1,
        presenceVerificationRequired: false,
        presentation: {
          disclosure: "revealed",
          title: "Tambike helmet",
          description: "A full-face helmet for everyday rides.",
          image: {
            mediaId: "helmet-image",
            url: "/giveaway-prize-media/helmet-image",
            width: 1200,
            height: 900,
          },
        },
      },
    ];
    completed.results = [
      { prizeTitle: "Tambike helmet", winnerAlias: "Raffle Sample Rider" },
    ];
    completed.drawVerifications = [
      {
        giveawayId: "Helmet raffle result",
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
    open.giveaway.mechanics = "Registered event riders may enter once.";
    open.giveaway.terms = "One winner receives the gear package.";
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
    secondOpen.giveaway.mechanics = "Eligible riders may enter once.";
    secondOpen.giveaway.terms = "One winner receives a surprise prize.";
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
    const secondCompleted = campaign("Boots raffle result", "completed");
    secondCompleted.giveaway.sponsorDisclosure = "   ";
    secondCompleted.giveaway.mechanics = "A valid entry was selected.";
    secondCompleted.giveaway.terms = "The organizer contacted the winner.";

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
      expect(container.textContent).toContain("Event raffles");
    });

    const text = container.textContent ?? "";
    expect(
      [...container.querySelectorAll("article h3")].map((heading) => heading.textContent),
    ).toEqual([
      "Open jacket raffle",
      "Open gloves raffle",
      "Helmet raffle result",
    ]);
    const articles = [...container.querySelectorAll("article")];
    expect(container.querySelector("header span")?.textContent).toBe("Raffles");
    expect(container.querySelector("header h2")?.textContent).toBe("Event raffles");
    expect(text).not.toContain("Prize route");
    expect(text).toContain("Open raffles");
    expect(text.match(/Recent winners/g)).toHaveLength(1);
    expect(text).toContain("Open now");
    expect(text).not.toContain("Latest winner");
    expect(text).not.toContain("Ongoing");
    expect(text).not.toContain("Completed");
    expect(text).not.toContain("Boots raffle result");
    expect(text).toContain("Win:");
    expect(text).toContain("Weekend Rider Gear Package");
    expect(text).toContain("Entries close:");
    expect(text).toContain("Draw date:");
    expect(text).toContain("Surprise prize");
    expect(text).not.toContain(hiddenInventoryTitle);
    expect(text).toContain("Winner:");
    expect(text).toContain("Raffle Sample Rider");
    expect(text).toContain("Prize won:");
    expect(text).toContain("Registered event riders may enter once.");
    expect(text).toContain("One winner receives the gear package.");
    expect(text).toContain("One eligible rider was selected from valid entries.");
    expect(text).toContain("The organizer will contact the winner.");
    expect(articles[1]?.querySelector("span")?.textContent).toBe("Open now");
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
    expect(articles[2]?.querySelector<HTMLImageElement>("img")?.alt).toBe(
      "Tambike helmet",
    );

    for (const removed of [
      "Featured prize",
      "Opt-in entry",
      "How it worked",
      "Verify the draw",
    ]) {
      expect(text).not.toContain(removed);
    }

    expect(articles[0]?.textContent).not.toContain("Raffle Sample Rider");
    expect(text).not.toContain("Raffle details");
    expect(text).not.toContain("View result");
    expect(
      [...container.querySelectorAll("details > summary")].map(
        (summary) => summary.textContent,
      ),
    ).toEqual(["Draw verification", "Published draw"]);
    expect(container.querySelectorAll("details")).toHaveLength(2);
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
