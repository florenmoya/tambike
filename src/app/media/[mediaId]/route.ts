import type { MemberMediaBody } from "@/server/member-media/store";
import { getTambikeBackend } from "@/server/backend";
import { readSessionToken } from "@/server/session-cookie";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Content-Type": "image/webp",
  "X-Content-Type-Options": "nosniff",
};

interface MemberMediaDeliveryRouteBackend {
  getMemberMedia(sessionToken: string | undefined, mediaId: string): Promise<{
    body: MemberMediaBody;
    mimeType: "image/webp";
    contentLength?: number;
  }>;
}

interface MemberMediaDeliveryHandlerDependencies {
  readSessionToken: () => Promise<string | null>;
  getBackend: () => Promise<MemberMediaDeliveryRouteBackend>;
}

function responseBody(body: MemberMediaBody): BodyInit {
  if (body instanceof Uint8Array) {
    return new Uint8Array(body);
  }
  const iterator = body[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

export function createMemberMediaDeliveryHandler(
  dependencies: MemberMediaDeliveryHandlerDependencies,
) {
  return async function memberMediaDeliveryHandler(
    _request: Request,
    context: { params: Promise<{ mediaId: string }> },
  ) {
    const { mediaId } = await context.params;
    const sessionToken = await dependencies.readSessionToken();
    try {
      const backend = await dependencies.getBackend();
      const media = await backend.getMemberMedia(sessionToken ?? undefined, mediaId);
      const headers = new Headers(privateHeaders);
      if (media.contentLength !== undefined) {
        headers.set("Content-Length", String(media.contentLength));
      }
      return new Response(responseBody(media.body), { status: 200, headers });
    } catch {
      return new Response("Not found", { status: 404, headers: privateHeaders });
    }
  };
}

export const GET = createMemberMediaDeliveryHandler({
  readSessionToken,
  getBackend: getTambikeBackend,
});
