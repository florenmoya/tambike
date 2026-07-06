import type { NextRequest } from "next/server";

function hasValidCronSecret(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) {
    return false;
  }

  const authorization = request.headers.get("authorization");
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  const queryToken = request.nextUrl.searchParams.get("secret");

  return bearerToken === configuredSecret || queryToken === configuredSecret;
}

export async function GET(request: NextRequest) {
  if (!hasValidCronSecret(request)) {
    return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  return Response.json({
    created: 0,
    skipped: 0,
    mode: "in_app_notifications_only",
  });
}
