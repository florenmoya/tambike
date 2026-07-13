/**
 * Cron authentication deliberately uses one exact Bearer value. There is no
 * query-string fallback so a secret cannot be copied into logs, links, or
 * referrers by accident.
 */
export function hasExactGiveawayCronAuthorization(
  headers: Headers,
  configuredSecret: string | undefined,
): boolean {
  if (!configuredSecret) return false;

  const actual = Buffer.from(headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${configuredSecret}`);
  if (actual.length !== expected.length) return false;

  return timingSafeEqual(actual, expected);
}

export function safeGiveawayExportFilename(giveawayId: string): string {
  const normalized = giveawayId.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
  return normalized || "export";
}

export function createGiveawayCsvExportResponse(csv: string, giveawayId: string): Response {
  const filename = safeGiveawayExportFilename(giveawayId);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="giveaway-${filename}.csv"`,
      ...privateNoStoreHeaders,
    },
  });
}

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

/** Export failures are sanitized but still must never be cached by shared clients. */
export function createGiveawayCsvExportErrorResponse(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: privateNoStoreHeaders });
}
import { timingSafeEqual } from "node:crypto";
