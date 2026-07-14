import { readFile } from "node:fs/promises";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  connection: vi.fn(async () => {
    mocks.order.push("connection");
  }),
  getWorkspace: vi.fn(async () => {
    mocks.order.push("workspace");
    return { ok: true, code: "OK", data: { eventId: "event-1" } };
  }),
  Stage: vi.fn(() => null),
}));

vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("../../src/server/giveaway-actions", () => ({
  getOrganizerGiveawayWorkspaceAction: mocks.getWorkspace,
}));
vi.mock("../../src/features/giveaways/giveaway-presentation-stage", () => ({
  GiveawayPresentationStage: mocks.Stage,
}));

import GiveawayPresentationPage from "../../src/app/organizer/events/[eventId]/giveaways/[giveawayId]/present/page";

const channel = "123e4567-e89b-42d3-a456-426614174000";

describe("authenticated giveaway presentation stage route", () => {
  beforeEach(() => {
    mocks.order.length = 0;
    mocks.connection.mockClear();
    mocks.getWorkspace.mockClear();
    mocks.Stage.mockClear();
    mocks.getWorkspace.mockImplementation(async () => {
      mocks.order.push("workspace");
      return { ok: true, code: "OK", data: { eventId: "event-1" } };
    });
  });

  test("awaits request props, authorizes the giveaway, and passes only route identity to the stage", async () => {
    const element = await GiveawayPresentationPage({
      params: Promise.resolve({ eventId: "event-1", giveawayId: "giveaway-1" }),
      searchParams: Promise.resolve({ channel }),
    });

    expect(mocks.order).toEqual(["connection", "workspace"]);
    expect(mocks.getWorkspace).toHaveBeenCalledWith("giveaway-1");
    expect(element.type).toBe(mocks.Stage);
    expect(element.props).toEqual({
      eventId: "event-1",
      giveawayId: "giveaway-1",
      channelId: channel,
    });
    expect(element.props).not.toHaveProperty("workspace");
    expect(element.props).not.toHaveProperty("presentation");
  });

  test("rejects missing, repeated, and malformed channels before authorization", async () => {
    for (const invalidChannel of [undefined, [channel, channel], "not-a-uuid"]) {
      const element = await GiveawayPresentationPage({
        params: Promise.resolve({ eventId: "event-secret", giveawayId: "giveaway-secret" }),
        searchParams: Promise.resolve({ channel: invalidChannel }),
      });
      const markup = renderToStaticMarkup(element);
      expect(markup).toContain("Live draw unavailable");
      expect(markup).not.toContain("event-secret");
      expect(markup).not.toContain("giveaway-secret");
      expect(markup).not.toContain(String(invalidChannel));
    }
    expect(mocks.getWorkspace).not.toHaveBeenCalled();
    expect(mocks.Stage).not.toHaveBeenCalled();
  });

  test("keeps authorization failure and event mismatch generic without mounting a channel", async () => {
    mocks.getWorkspace.mockResolvedValueOnce({ ok: false, code: "UNAUTHENTICATED" } as never);
    const unauthorized = await GiveawayPresentationPage({
      params: Promise.resolve({ eventId: "private-event", giveawayId: "private-giveaway" }),
      searchParams: Promise.resolve({ channel }),
    });
    const unauthorizedMarkup = renderToStaticMarkup(unauthorized);

    mocks.getWorkspace.mockResolvedValueOnce({
      ok: true,
      code: "OK",
      data: { eventId: "different-event" },
    });
    const mismatch = await GiveawayPresentationPage({
      params: Promise.resolve({ eventId: "private-event", giveawayId: "private-giveaway" }),
      searchParams: Promise.resolve({ channel }),
    });
    const mismatchMarkup = renderToStaticMarkup(mismatch);

    expect(unauthorizedMarkup).toBe(mismatchMarkup);
    expect(unauthorizedMarkup).toContain("Live draw unavailable");
    expect(unauthorizedMarkup).not.toMatch(/private|different|unauthenticated|123e4567/i);
    expect(mocks.Stage).not.toHaveBeenCalled();
  });

  test("uses the installed Next 16 request-time contract in a server page", async () => {
    const source = await readFile(
      new URL(
        "../../src/app/organizer/events/[eventId]/giveaways/[giveawayId]/present/page.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).not.toContain('"use client"');
    expect(source).toContain("await connection()");
    expect(source).toMatch(/await params/);
    expect(source).toMatch(/await searchParams/);
    expect(source.indexOf("await connection()")).toBeLessThan(
      source.lastIndexOf("getOrganizerGiveawayWorkspaceAction"),
    );
  });
});
