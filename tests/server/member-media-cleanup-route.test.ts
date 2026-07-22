import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { resetTambikeBackendForTests } from "../../src/server/backend";

const root = resolve(import.meta.dirname, "../..");
const routePath = resolve(root, "src/app/api/jobs/member-media-cleanup/route.ts");
const routeSource = existsSync(routePath) ? readFileSync(routePath, "utf8") : "";
const vercelPath = resolve(root, "vercel.json");
const vercelConfiguration = existsSync(vercelPath)
  ? JSON.parse(readFileSync(vercelPath, "utf8")) as {
      $schema?: string;
      crons?: Array<{ path: string; schedule: string }>;
    }
  : {};

async function loadRoute() {
  const modulePath = `../../src/app/api/jobs/${"member-media-cleanup"}/route`;
  return import(modulePath) as Promise<{ GET(request: Request): Promise<Response> }>;
}

const previousCronSecret = process.env.CRON_SECRET;

afterEach(() => {
  if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousCronSecret;
});

describe("member media cleanup cron route", () => {
  test("uses a dynamic no-store Node GET handler and the exact shared Bearer helper", () => {
    expect(routeSource).toContain('runtime = "nodejs"');
    expect(routeSource).toContain('dynamic = "force-dynamic"');
    expect(routeSource).toContain('"Cache-Control": "no-store"');
    expect(routeSource).toContain("hasExactGiveawayCronAuthorization");
    expect(routeSource).toContain("drainMemberMediaCleanup");
    expect(routeSource).not.toContain("searchParams");
    expect(routeSource).not.toContain("startsWith");
    expect(routeSource).not.toContain("error.message");
  });

  test("fails closed for absent, wrong, and query secrets but succeeds for the exact Bearer value", async () => {
    await resetTambikeBackendForTests();
    process.env.CRON_SECRET = "exact-cron-secret";
    const { GET } = await loadRoute();

    for (const request of [
      new Request("http://localhost/api/jobs/member-media-cleanup"),
      new Request("http://localhost/api/jobs/member-media-cleanup", {
        headers: { authorization: "Bearer wrong" },
      }),
      new Request("http://localhost/api/jobs/member-media-cleanup?secret=exact-cron-secret"),
    ]) {
      const response = await GET(request);
      expect(response.status).toBe(403);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }

    const response = await GET(new Request("http://localhost/api/jobs/member-media-cleanup", {
      headers: { authorization: "Bearer exact-cron-secret" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      batches: 0,
      claimed: 0,
      deleted: 0,
      failed: 0,
    });
  });

  test("configures one exact once-daily production cron", () => {
    expect(vercelConfiguration.$schema).toBe("https://openapi.vercel.sh/vercel.json");
    expect(vercelConfiguration.crons).toEqual([{
      path: "/api/jobs/member-media-cleanup",
      schedule: "0 3 * * *",
    }]);
  });
});
