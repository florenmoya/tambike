import { BackendError, getTambikeBackend } from "@/server/backend";
import type {
  GiveawayPrizeMediaDelivery,
} from "@/server/giveaway-prize-media/service";
import type { MemberMediaBody } from "@/server/member-media/store";
import { readSessionToken } from "@/server/session-cookie";

interface GiveawayPrizeMediaDeliveryRouteBackend {
  getGiveawayPrizeImageMedia(
    sessionToken: string | undefined,
    mediaId: string,
  ): Promise<GiveawayPrizeMediaDelivery>;
}

interface GiveawayPrizeMediaDeliveryHandlerDependencies {
  readSessionToken: () => Promise<string | null>;
  getBackend: () => Promise<GiveawayPrizeMediaDeliveryRouteBackend>;
}

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Content-Type": "image/webp",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const publicHeaders = {
  ...privateHeaders,
  "Cache-Control":
    "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
};

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

export function createGiveawayPrizeMediaDeliveryHandler(
  dependencies: GiveawayPrizeMediaDeliveryHandlerDependencies,
) {
  return async function giveawayPrizeMediaDeliveryHandler(
    _request: Request,
    context: { params: Promise<{ mediaId: string }> },
  ) {
    const { mediaId } = await context.params;
    const sessionToken = await dependencies.readSessionToken();
    if (!mediaId) {
      return new Response("Not found", { status: 404, headers: privateHeaders });
    }

    try {
      const backend = await dependencies.getBackend();
      const media = await backend.getGiveawayPrizeImageMedia(
        sessionToken ?? undefined,
        mediaId,
      );
      const headers = new Headers(
        media.visibility === "event_page" ? publicHeaders : privateHeaders,
      );
      if (media.contentLength !== undefined) {
        headers.set("Content-Length", String(media.contentLength));
      }
      return new Response(responseBody(media.body), {
        status: 200,
        headers,
      });
    } catch (error) {
      if (error instanceof BackendError) {
        return new Response("Not found", {
          status: 404,
          headers: privateHeaders,
        });
      }
      return new Response("Media unavailable", {
        status: 503,
        headers: privateHeaders,
      });
    }
  };
}

export const GET = createGiveawayPrizeMediaDeliveryHandler({
  readSessionToken,
  getBackend: getTambikeBackend,
});
