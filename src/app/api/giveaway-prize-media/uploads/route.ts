import { BackendError, getTambikeBackend } from "@/server/backend";
import type { PresignedUpload } from "@/server/giveaway-prize-media/service";
import { readSessionToken } from "@/server/session-cookie";

interface GiveawayPrizeMediaUploadRouteBackend {
  createGiveawayPrizeImageUpload(
    sessionToken: string,
    giveawayId: string,
    prizePoolId: string,
    mimeType: string,
  ): Promise<PresignedUpload>;
}

interface GiveawayPrizeMediaUploadHandlerDependencies {
  readSessionToken: () => Promise<string | null>;
  getBackend: () => Promise<GiveawayPrizeMediaUploadRouteBackend>;
}

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status });
}

export function createGiveawayPrizeMediaUploadHandler(
  dependencies: GiveawayPrizeMediaUploadHandlerDependencies,
) {
  return async function giveawayPrizeMediaUploadHandler(request: Request) {
    const sessionToken = await dependencies.readSessionToken();
    if (!sessionToken) {
      return errorResponse("UNAUTHENTICATED", 401);
    }

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return errorResponse("INVALID_INPUT", 400);
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return errorResponse("INVALID_INPUT", 400);
    }
    const record = input as Record<string, unknown>;
    if (
      typeof record.giveawayId !== "string" ||
      !record.giveawayId.trim() ||
      typeof record.prizePoolId !== "string" ||
      !record.prizePoolId.trim() ||
      typeof record.mimeType !== "string"
    ) {
      return errorResponse("INVALID_INPUT", 400);
    }
    if (!allowedMimeTypes.has(record.mimeType)) {
      return errorResponse("INVALID_IMAGE", 400);
    }

    try {
      const backend = await dependencies.getBackend();
      const upload = await backend.createGiveawayPrizeImageUpload(
        sessionToken,
        record.giveawayId,
        record.prizePoolId,
        record.mimeType,
      );
      return Response.json(upload);
    } catch (error) {
      if (error instanceof BackendError) {
        if (error.code === "UNAUTHENTICATED") {
          return errorResponse("UNAUTHENTICATED", 401);
        }
        if (error.code === "FORBIDDEN") {
          return errorResponse("FORBIDDEN", 403);
        }
        if (error.code === "NOT_FOUND") {
          return errorResponse("NOT_FOUND", 404);
        }
        if (error.code === "INVALID_INPUT" || error.code === "INVALID_IMAGE") {
          return errorResponse(error.code, 400);
        }
      }
      return errorResponse("UPLOAD_UNAVAILABLE", 503);
    }
  };
}

export const POST = createGiveawayPrizeMediaUploadHandler({
  readSessionToken,
  getBackend: getTambikeBackend,
});
