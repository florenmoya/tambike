import { describe, expect, test, vi } from "vitest";

import {
  createGiveawayPrizeMediaDeliveryHandler,
} from "../../src/app/api/giveaway-prize-media/[mediaId]/route";
import {
  createGiveawayPrizeMediaUploadHandler,
} from "../../src/app/api/giveaway-prize-media/uploads/route";
import { BackendError } from "../../src/server/backend";

function uploadRequest(body: unknown) {
  return new Request("http://localhost/api/giveaway-prize-media/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function uploadBackend() {
  return {
    createGiveawayPrizeImageUpload: vi.fn(async (
      _sessionToken: string,
      _giveawayId: string,
      _prizePoolId: string,
      mimeType: string,
    ) => ({
      key: "tmp/giveaway-prizes/organizer-a/upload-1",
      mimeType: mimeType as "image/jpeg" | "image/png" | "image/webp",
      expiresInSeconds: 300,
      url: "https://uploads.example.test",
      fields: {
        key: "tmp/giveaway-prizes/organizer-a/upload-1",
        "Content-Type": mimeType,
      },
    })),
  };
}

describe("giveaway prize media upload route", () => {
  test("returns 401 before parsing an unauthenticated request", async () => {
    const backend = uploadBackend();
    const handler = createGiveawayPrizeMediaUploadHandler({
      readSessionToken: vi.fn(async () => null),
      getBackend: vi.fn(async () => backend),
    });

    const response = await handler(uploadRequest({
      giveawayId: "giveaway-1",
      prizePoolId: "pool-1",
      mimeType: "image/png",
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHENTICATED" });
    expect(backend.createGiveawayPrizeImageUpload).not.toHaveBeenCalled();
  });

  test("maps invalid MIME to 400 and non-owner access to 403", async () => {
    const invalidBackend = uploadBackend();
    invalidBackend.createGiveawayPrizeImageUpload.mockRejectedValueOnce(
      new BackendError("INVALID_IMAGE"),
    );
    const invalidHandler = createGiveawayPrizeMediaUploadHandler({
      readSessionToken: vi.fn(async () => "session-a"),
      getBackend: vi.fn(async () => invalidBackend),
    });
    const invalid = await invalidHandler(uploadRequest({
      giveawayId: "giveaway-1",
      prizePoolId: "pool-1",
      mimeType: "image/gif",
    }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "INVALID_IMAGE" });

    const nonOwnerBackend = uploadBackend();
    nonOwnerBackend.createGiveawayPrizeImageUpload.mockRejectedValueOnce(
      new BackendError("FORBIDDEN"),
    );
    const nonOwnerHandler = createGiveawayPrizeMediaUploadHandler({
      readSessionToken: vi.fn(async () => "session-b"),
      getBackend: vi.fn(async () => nonOwnerBackend),
    });
    const nonOwner = await nonOwnerHandler(uploadRequest({
      giveawayId: "giveaway-1",
      prizePoolId: "pool-1",
      mimeType: "image/png",
    }));
    expect(nonOwner.status).toBe(403);
    expect(await nonOwner.json()).toEqual({ error: "FORBIDDEN" });
  });

  test("returns a valid owner upload without exposing any storage credentials beyond the presign", async () => {
    const backend = uploadBackend();
    const handler = createGiveawayPrizeMediaUploadHandler({
      readSessionToken: vi.fn(async () => "session-a"),
      getBackend: vi.fn(async () => backend),
    });

    const response = await handler(uploadRequest({
      giveawayId: "giveaway-1",
      prizePoolId: "pool-1",
      mimeType: "image/png",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      key: "tmp/giveaway-prizes/organizer-a/upload-1",
      mimeType: "image/png",
      expiresInSeconds: 300,
      url: "https://uploads.example.test",
      fields: {
        key: "tmp/giveaway-prizes/organizer-a/upload-1",
        "Content-Type": "image/png",
      },
    });
    expect(backend.createGiveawayPrizeImageUpload).toHaveBeenCalledWith(
      "session-a",
      "giveaway-1",
      "pool-1",
      "image/png",
    );
  });

  test("maps malformed input, missing pools, and storage failures without leaking details", async () => {
    const malformedHandler = createGiveawayPrizeMediaUploadHandler({
      readSessionToken: vi.fn(async () => "session-a"),
      getBackend: vi.fn(async () => uploadBackend()),
    });
    const malformed = await malformedHandler(new Request(
      "http://localhost/api/giveaway-prize-media/uploads",
      { method: "POST", body: "{" },
    ));
    expect(malformed.status).toBe(400);

    const missingBackend = uploadBackend();
    missingBackend.createGiveawayPrizeImageUpload.mockRejectedValueOnce(
      new BackendError("NOT_FOUND"),
    );
    const missingHandler = createGiveawayPrizeMediaUploadHandler({
      readSessionToken: vi.fn(async () => "session-a"),
      getBackend: vi.fn(async () => missingBackend),
    });
    const missing = await missingHandler(uploadRequest({
      giveawayId: "giveaway-1",
      prizePoolId: "missing-pool",
      mimeType: "image/png",
    }));
    expect(missing.status).toBe(404);

    const unavailableBackend = uploadBackend();
    unavailableBackend.createGiveawayPrizeImageUpload.mockRejectedValueOnce(
      new Error("sensitive storage failure"),
    );
    const unavailableHandler = createGiveawayPrizeMediaUploadHandler({
      readSessionToken: vi.fn(async () => "session-a"),
      getBackend: vi.fn(async () => unavailableBackend),
    });
    const unavailable = await unavailableHandler(uploadRequest({
      giveawayId: "giveaway-1",
      prizePoolId: "pool-1",
      mimeType: "image/png",
    }));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "UPLOAD_UNAVAILABLE" });
  });
});

describe("giveaway prize media delivery route", () => {
  test("public-caches event-page image bytes", async () => {
    const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
    const backend = {
      getGiveawayPrizeImageMedia: vi.fn(async () => ({
        body: bytes,
        mimeType: "image/webp" as const,
        contentLength: bytes.byteLength,
        visibility: "event_page" as const,
      })),
    };
    const handler = createGiveawayPrizeMediaDeliveryHandler({
      readSessionToken: vi.fn(async () => null),
      getBackend: vi.fn(async () => backend),
    });

    const response = await handler(
      new Request("http://localhost/api/giveaway-prize-media/media-1"),
      { params: Promise.resolve({ mediaId: "media-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(response.headers.get("Content-Length")).toBe(String(bytes.byteLength));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(backend.getGiveawayPrizeImageMedia).toHaveBeenCalledWith(
      undefined,
      "media-1",
    );
  });

  test.each(["registered_riders", "eligible_riders"] as const)(
    "returns %s media privately to an authorized rider",
    async (visibility) => {
      const backend = {
        getGiveawayPrizeImageMedia: vi.fn(async () => ({
          body: new Uint8Array([1, 2, 3]),
          mimeType: "image/webp" as const,
          visibility,
        })),
      };
      const handler = createGiveawayPrizeMediaDeliveryHandler({
        readSessionToken: vi.fn(async () => "rider-session"),
        getBackend: vi.fn(async () => backend),
      });

      const response = await handler(
        new Request("http://localhost/api/giveaway-prize-media/media-1"),
        { params: Promise.resolve({ mediaId: "media-1" }) },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(backend.getGiveawayPrizeImageMedia).toHaveBeenCalledWith(
        "rider-session",
        "media-1",
      );
    },
  );

  test("returns 404 with private no-store headers when a private image is denied", async () => {
    const backend = {
      getGiveawayPrizeImageMedia: vi.fn(async () => {
        throw new BackendError("NOT_FOUND");
      }),
    };
    const handler = createGiveawayPrizeMediaDeliveryHandler({
      readSessionToken: vi.fn(async () => null),
      getBackend: vi.fn(async () => backend),
    });

    const response = await handler(
      new Request("http://localhost/api/giveaway-prize-media/private-media"),
      { params: Promise.resolve({ mediaId: "private-media" }) },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("Not found");
  });

  test("maps a missing finalized storage object to a detail-free 503", async () => {
    const backend = {
      getGiveawayPrizeImageMedia: vi.fn(async () => {
        throw new BackendError(
          "MEDIA_UNAVAILABLE",
          "sensitive finalized object detail",
        );
      }),
    };
    const handler = createGiveawayPrizeMediaDeliveryHandler({
      readSessionToken: vi.fn(async () => "rider-session"),
      getBackend: vi.fn(async () => backend),
    });

    const response = await handler(
      new Request("http://localhost/api/giveaway-prize-media/media-1"),
      { params: Promise.resolve({ mediaId: "media-1" }) },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("Media unavailable");
  });

  test("maps an unexpected storage failure to a detail-free 503", async () => {
    const backend = {
      getGiveawayPrizeImageMedia: vi.fn(async () => {
        throw new Error("sensitive S3 outage");
      }),
    };
    const handler = createGiveawayPrizeMediaDeliveryHandler({
      readSessionToken: vi.fn(async () => "rider-session"),
      getBackend: vi.fn(async () => backend),
    });

    const response = await handler(
      new Request("http://localhost/api/giveaway-prize-media/media-1"),
      { params: Promise.resolve({ mediaId: "media-1" }) },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("Media unavailable");
  });
});
