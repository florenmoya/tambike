import { describe, expect, test, vi } from "vitest";

import { createSampleRafflePresentationRefreshHandler } from "@/app/api/jobs/sample-raffle-presentation/route";

function request(
  authorization?: string,
  confirmation = "cafe-classico-public-v1",
) {
  return new Request(
    "https://tambike.example/api/jobs/sample-raffle-presentation",
    {
      method: "POST",
      headers: {
        ...(authorization ? { authorization } : {}),
        "x-tambike-sample-raffle-refresh": confirmation,
      },
    },
  );
}

describe("sample raffle presentation refresh route", () => {
  test("rejects missing cron authorization without touching raffle data", async () => {
    const refresh = vi.fn();
    const handler = createSampleRafflePresentationRefreshHandler({
      cronSecret: "exact-secret",
      refresh,
    });

    const response = await handler(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "FORBIDDEN" });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("requires the exact one-purpose confirmation header", async () => {
    const refresh = vi.fn();
    const handler = createSampleRafflePresentationRefreshHandler({
      cronSecret: "exact-secret",
      refresh,
    });

    const response = await handler(
      request("Bearer exact-secret", "wrong-target"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "CONFIRMATION_REQUIRED" });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("returns only the safe refresh receipt after exact authorization", async () => {
    const refresh = vi.fn(async () => ({
      eventId: "tambike-cafe-classico",
      completed: {
        giveawayId: "completed-id",
        title: "Cafe Classico Helmet Raffle",
        state: "completed" as const,
        winnerCount: 1 as const,
        winnerAlias: "Cafe Classico Rider",
      },
      ongoing: {
        giveawayId: "ongoing-id",
        title: "Weekend Rider Gear Raffle",
        state: "open" as const,
        winnerCount: 0 as const,
      },
      changed: true,
    }));
    const handler = createSampleRafflePresentationRefreshHandler({
      cronSecret: "exact-secret",
      refresh,
    });

    const response = await handler(request("Bearer exact-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      eventId: "tambike-cafe-classico",
      completed: { winnerAlias: "Cafe Classico Rider" },
      ongoing: { state: "open" },
      changed: true,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("keeps unexpected failures generic", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const handler = createSampleRafflePresentationRefreshHandler({
      cronSecret: "exact-secret",
      refresh: async () => {
        throw new Error("provider detail");
      },
    });

    const response = await handler(request("Bearer exact-secret"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "REFRESH_FAILED" });
    expect(consoleError).toHaveBeenCalledWith(
      "Sample raffle presentation refresh failed",
      { code: "Error" },
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "provider detail",
    );
    consoleError.mockRestore();
  });
});
