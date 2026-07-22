import type { NextRequest } from "next/server";

import { getTambikeBackend } from "@/server/backend";
import { hasExactGiveawayCronAuthorization } from "@/server/giveaway-route-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

export async function GET(request: NextRequest) {
  if (!hasExactGiveawayCronAuthorization(request.headers, process.env.CRON_SECRET)) {
    return Response.json({ error: "FORBIDDEN" }, { status: 403, headers: noStoreHeaders });
  }

  try {
    const backend = await getTambikeBackend();
    const result = await backend.drainMemberMediaCleanup(new Date());
    return Response.json(result, { headers: noStoreHeaders });
  } catch {
    return Response.json({ error: "CLEANUP_FAILED" }, { status: 500, headers: noStoreHeaders });
  }
}
