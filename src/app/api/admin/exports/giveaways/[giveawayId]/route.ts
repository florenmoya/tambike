import type { NextRequest } from "next/server";

import { BackendError, getTambikeBackend } from "@/server/backend";
import {
  createGiveawayCsvExportErrorResponse,
  createGiveawayCsvExportResponse,
} from "@/server/giveaway-route-runtime";
import { sessionCookieName } from "@/server/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ giveawayId: string }>;
};

function errorResponse(error: unknown) {
  if (error instanceof BackendError) {
    switch (error.code) {
      case "UNAUTHENTICATED":
        return createGiveawayCsvExportErrorResponse("UNAUTHENTICATED", 401);
      case "FORBIDDEN":
        return createGiveawayCsvExportErrorResponse("FORBIDDEN", 403);
      case "NOT_FOUND":
        return createGiveawayCsvExportErrorResponse("NOT_FOUND", 404);
      case "INVALID_INPUT":
        return createGiveawayCsvExportErrorResponse("INVALID_INPUT", 400);
      default:
        return createGiveawayCsvExportErrorResponse("EXPORT_FAILED", 400);
    }
  }

  return createGiveawayCsvExportErrorResponse("EXPORT_FAILED", 500);
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const sessionToken = request.cookies.get(sessionCookieName)?.value;
  if (!sessionToken) {
    return createGiveawayCsvExportErrorResponse("UNAUTHENTICATED", 401);
  }

  const { giveawayId } = await params;
  try {
    const backend = await getTambikeBackend();
    const csv = await backend.exportGiveawayCsv(sessionToken, giveawayId);
    return createGiveawayCsvExportResponse(csv, giveawayId);
  } catch (error) {
    return errorResponse(error);
  }
}
