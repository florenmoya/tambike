import { describe, expect, test } from "vitest";

type GiveawayRouteRuntime = {
  hasExactGiveawayCronAuthorization(headers: Headers, configuredSecret: string | undefined): boolean;
  createGiveawayCsvExportResponse(csv: string, giveawayId: string): Response;
  createGiveawayCsvExportErrorResponse(error: string, status: number): Response;
};

async function loadGiveawayRouteRuntime() {
  // Keep this red-first test compilable until the route helpers are added.
  const modulePath = `../../src/server/${"giveaway-route-runtime"}`;
  return (await import(modulePath)) as GiveawayRouteRuntime;
}

describe("giveaway route runtime", () => {
  test("accepts only an exact Bearer cron secret and fails closed when absent", async () => {
    const { hasExactGiveawayCronAuthorization } = await loadGiveawayRouteRuntime();
    const secret = "cron-secret";

    expect(
      hasExactGiveawayCronAuthorization(new Headers({ authorization: `Bearer ${secret}` }), secret),
    ).toBe(true);
    // `Headers` normalizes optional HTTP whitespace, so use a distinct value
    // to prove this is an exact complete-value comparison rather than a prefix.
    expect(
      hasExactGiveawayCronAuthorization(new Headers({ authorization: `Bearer ${secret}-extra` }), secret),
    ).toBe(false);
    expect(
      hasExactGiveawayCronAuthorization(new Headers({ authorization: `Basic ${secret}` }), secret),
    ).toBe(false);
    expect(hasExactGiveawayCronAuthorization(new Headers(), secret)).toBe(false);
    expect(
      hasExactGiveawayCronAuthorization(new Headers({ authorization: `Bearer ${secret}` }), undefined),
    ).toBe(false);
  });

  test("creates a private, no-store CSV download with a safe filename", async () => {
    const { createGiveawayCsvExportResponse } = await loadGiveawayRouteRuntime();
    const maliciousId = "summer raffle\r\nSet-Cookie: leaked=1";
    const response = createGiveawayCsvExportResponse("title\nHelmet", maliciousId);
    const disposition = response.headers.get("Content-Disposition");

    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(disposition).toBe('attachment; filename="giveaway-summer_raffle__Set-Cookie__leaked_1.csv"');
    expect(disposition).not.toContain("\r");
    expect(disposition).not.toContain("\n");
    await expect(response.text()).resolves.toBe("title\nHelmet");
  });

  test("protects sanitized export errors with the same private response headers", async () => {
    const { createGiveawayCsvExportErrorResponse } = await loadGiveawayRouteRuntime();
    const response = createGiveawayCsvExportErrorResponse("EXPORT_FAILED", 500);

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({ error: "EXPORT_FAILED" });
  });
});
