import { BackendError, getTambikeBackend } from "@/server/backend";
import { readSessionToken } from "@/server/session-cookie";

export async function POST(request: Request) {
  const sessionToken = await readSessionToken();
  if (!sessionToken) {
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  try {
    const input = await request.json() as { purpose?: unknown; mimeType?: unknown };
    if (
      (input.purpose !== "avatar" && input.purpose !== "motorcycle-photo") ||
      typeof input.mimeType !== "string"
    ) {
      return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
    }
    const backend = await getTambikeBackend();
    const upload = await backend.createMemberMediaUpload(sessionToken, input.mimeType);
    return Response.json({ ...upload, purpose: input.purpose });
  } catch (error) {
    if (error instanceof BackendError && error.code === "UNAUTHENTICATED") {
      return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (error instanceof BackendError && error.code === "INVALID_INPUT") {
      return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
    }
    if (error instanceof BackendError && error.code === "INVALID_IMAGE") {
      return Response.json({ error: "INVALID_IMAGE" }, { status: 400 });
    }
    return Response.json({ error: "UPLOAD_UNAVAILABLE" }, { status: 503 });
  }
}
