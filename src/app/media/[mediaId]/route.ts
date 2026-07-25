import type { MemberMediaBody } from "@/server/member-media/store";
import {
  createMemberMediaCloudFrontUrl,
  loadMemberMediaCloudFrontConfig,
} from "@/server/member-media/cloudfront";
import type { AuthorizedMemberMediaDescriptor } from "@/server/member-media/service";
import { getTambikeBackend } from "@/server/backend";
import { readSessionToken } from "@/server/session-cookie";

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const privateImageHeaders = {
  ...privateNoStoreHeaders,
  "Content-Type": "image/webp",
};

interface MemberMediaDeliveryRouteBackend {
  authorizeMemberMedia?(
    sessionToken: string | undefined,
    mediaId: string,
  ): Promise<AuthorizedMemberMediaDescriptor>;
  getMemberMedia(sessionToken: string | undefined, mediaId: string): Promise<{
    body: MemberMediaBody;
    mimeType: "image/webp";
    contentLength?: number;
  }>;
}

interface MemberMediaDeliveryHandlerDependencies {
  readSessionToken: () => Promise<string | null>;
  getBackend: () => Promise<MemberMediaDeliveryRouteBackend>;
  getCdnUrlFactory?: () => ((storageKey: string) => string) | null;
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
      const createCdnUrl = dependencies.getCdnUrlFactory?.() ?? null;
      if (createCdnUrl) {
        if (!backend.authorizeMemberMedia) {
          throw new Error("MEMBER_MEDIA_CLOUDFRONT_CONFIG");
        }
        const descriptor = await backend.authorizeMemberMedia(
          sessionToken ?? undefined,
          mediaId,
        );
        const headers = new Headers(privateNoStoreHeaders);
        headers.set("Location", createCdnUrl(descriptor.storageKey));
        return new Response(null, { status: 307, headers });
      }

      const media = await backend.getMemberMedia(sessionToken ?? undefined, mediaId);
      const headers = new Headers(privateImageHeaders);
      if (media.contentLength !== undefined) {
        headers.set("Content-Length", String(media.contentLength));
      }
      return new Response(responseBody(media.body), { status: 200, headers });
    } catch {
      return new Response("Not found", { status: 404, headers: privateImageHeaders });
    }
  };
}

export const GET = createMemberMediaDeliveryHandler({
  readSessionToken,
  getBackend: getTambikeBackend,
  getCdnUrlFactory: () => {
    const config = loadMemberMediaCloudFrontConfig();
    return config
      ? (storageKey) => createMemberMediaCloudFrontUrl(storageKey, config)
      : null;
  },
});
