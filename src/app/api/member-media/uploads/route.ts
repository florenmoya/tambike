import { BackendError, getTambikeBackend } from "@/server/backend";
import { readSessionToken } from "@/server/session-cookie";

interface MemberMediaUploadRouteBackend {
  createMemberMediaUpload(sessionToken: string, mimeType: string): Promise<{
    key: string;
    mimeType: string;
    expiresInSeconds: number;
    url: string;
    fields: Record<string, string>;
  }>;
}

interface MemberMediaUploadHandlerDependencies {
  readSessionToken: () => Promise<string | null>;
  getBackend: () => Promise<MemberMediaUploadRouteBackend>;
}

function invalidInputResponse() {
  return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
}

export function createMemberMediaUploadHandler(
  dependencies: MemberMediaUploadHandlerDependencies,
) {
  return async function memberMediaUploadHandler(request: Request) {
    const sessionToken = await dependencies.readSessionToken();
    if (!sessionToken) {
      return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return invalidInputResponse();
    }
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input)
    ) {
      return invalidInputResponse();
    }
    const record = input as Record<string, unknown>;
    if (
      (record.purpose !== "avatar" && record.purpose !== "motorcycle-photo") ||
      typeof record.mimeType !== "string"
    ) {
      return invalidInputResponse();
    }

    try {
      const backend = await dependencies.getBackend();
      const upload = await backend.createMemberMediaUpload(sessionToken, record.mimeType);
      return Response.json({ ...upload, purpose: record.purpose });
    } catch (error) {
      if (error instanceof BackendError && error.code === "UNAUTHENTICATED") {
        return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
      }
      if (error instanceof BackendError && error.code === "INVALID_INPUT") {
        return invalidInputResponse();
      }
      if (error instanceof BackendError && error.code === "INVALID_IMAGE") {
        return Response.json({ error: "INVALID_IMAGE" }, { status: 400 });
      }
      return Response.json({ error: "UPLOAD_UNAVAILABLE" }, { status: 503 });
    }
  };
}

export const POST = createMemberMediaUploadHandler({
  readSessionToken,
  getBackend: getTambikeBackend,
});
