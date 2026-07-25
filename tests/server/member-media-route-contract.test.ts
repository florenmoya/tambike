import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test, vi } from "vitest";
import {
  createMemberMediaUploadHandler,
} from "../../src/app/api/member-media/uploads/route";
import {
  createMemberMediaDeliveryHandler,
} from "../../src/app/media/[mediaId]/route";
import { createTambikeTestBackend } from "../../src/server/testing";
import type { MemberMediaStore, StoredMemberMediaObject } from "../../src/server/member-media/store";
import { createTestActors } from "./support/tambike-fixtures";

describe("member media App Router boundaries", () => {
  test("authenticates upload signing and never declares Edge/static execution", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/api/member-media/uploads/route.ts"),
      "utf8",
    );
    expect(source).toContain("readSessionToken");
    expect(source).toContain("createMemberMediaUpload");
    expect(source).toContain('error.code === "INVALID_IMAGE"');
    expect(source).not.toMatch(/runtime\s*=\s*["']edge["']/);
    expect(source).not.toMatch(/force-static|revalidate\s*=/);
  });

  test("awaits media params, streams WebP privately, and collapses failures to 404", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/media/[mediaId]/route.ts"),
      "utf8",
    );
    expect(source).toMatch(/await\s+(?:context\.)?params/);
    expect(source).toContain("readSessionToken");
    expect(source).toContain("private, no-store");
    expect(source).toContain("image/webp");
    expect(source).toMatch(/status:\s*404/);
    expect(source.replaceAll("\n", " ")).not.toMatch(/Response\.json\([^)]*(?:storageKey|media\/users\/)/);
    expect(source).not.toMatch(/runtime\s*=\s*["']edge["']/);
    expect(source).not.toMatch(/force-static|revalidate\s*=/);
  });

  test("invokes upload auth and returns a safe signed response shape", async () => {
    const handler = createMemberMediaUploadHandler({
      readSessionToken: async () => "session-1",
      getBackend: async () => ({
        createMemberMediaUpload: async () => ({
          key: "tmp/users/user-1/nonce-1",
          mimeType: "image/jpeg" as const,
          expiresInSeconds: 300,
          url: "https://uploads.example.test",
          fields: { key: "tmp/users/user-1/nonce-1", "Content-Type": "image/jpeg" },
        }),
      }),
    });
    const response = await handler(new Request("https://tambike.test/api/member-media/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: "avatar", mimeType: "image/jpeg" }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      key: "tmp/users/user-1/nonce-1",
      mimeType: "image/jpeg",
      expiresInSeconds: 300,
      url: "https://uploads.example.test",
      fields: { key: "tmp/users/user-1/nonce-1", "Content-Type": "image/jpeg" },
      purpose: "avatar",
    });
  });

  test("returns safe 400 for malformed JSON, null, arrays, and scalar upload bodies", async () => {
    const handler = createMemberMediaUploadHandler({
      readSessionToken: async () => "session-1",
      getBackend: async () => ({
        createMemberMediaUpload: async () => { throw new Error("must not be called"); },
      }),
    });
    for (const body of ["{", "null", "[]", '"avatar"', "42"]) {
      const response = await handler(new Request("https://tambike.test/api/member-media/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }));
      expect(response.status, body).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "INVALID_INPUT" });
    }
  });

  test("keeps unauthenticated uploads at 401 and operational failures at 503", async () => {
    const unauthenticated = createMemberMediaUploadHandler({
      readSessionToken: async () => null,
      getBackend: async () => { throw new Error("must not load backend"); },
    });
    await expect(unauthenticated(new Request("https://tambike.test/api/member-media/uploads", {
      method: "POST",
    })).then(async (response) => ({ status: response.status, body: await response.json() })))
      .resolves.toEqual({ status: 401, body: { error: "UNAUTHENTICATED" } });

    const unavailable = createMemberMediaUploadHandler({
      readSessionToken: async () => "session-1",
      getBackend: async () => { throw new Error("MEMBER_MEDIA_CONFIG"); },
    });
    await expect(unavailable(new Request("https://tambike.test/api/member-media/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: "avatar", mimeType: "image/jpeg" }),
    })).then(async (response) => ({ status: response.status, body: await response.json() })))
      .resolves.toEqual({ status: 503, body: { error: "UPLOAD_UNAVAILABLE" } });
  });

  test("streams authorized bytes with private no-store and hides delivery failures", async () => {
    let received: unknown;
    const handler = createMemberMediaDeliveryHandler({
      readSessionToken: async () => "session-1",
      getBackend: async () => ({
        getMemberMedia: async (...args: unknown[]) => {
          received = args;
          return { body: Buffer.from("webp"), mimeType: "image/webp" as const, contentLength: 4 };
        },
      }),
    });
    const response = await handler(new Request("https://tambike.test/media/media-1"), {
      params: Promise.resolve({ mediaId: "media-1" }),
    });
    expect(received).toEqual(["session-1", "media-1"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("webp");

    const hidden = createMemberMediaDeliveryHandler({
      readSessionToken: async () => "admin-session",
      getBackend: async () => ({ getMemberMedia: async () => { throw new Error("NOT_FOUND"); } }),
    });
    const missing = await hidden(new Request("https://tambike.test/media/unpublished"), {
      params: Promise.resolve({ mediaId: "unpublished" }),
    });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await missing.text()).not.toContain("NOT_FOUND");
  });

  test("redirects authorized media to a private temporary CDN URL without reading S3 bytes", async () => {
    const getMemberMedia = vi.fn(async () => {
      throw new Error("S3 bytes must not be read for a CDN redirect");
    });
    const handler = createMemberMediaDeliveryHandler({
      readSessionToken: async () => "session-1",
      getCdnUrlFactory: () => (storageKey) =>
        `https://d111111abcdef8.cloudfront.net/${storageKey}?signed=true`,
      getBackend: async () => ({
        authorizeMemberMedia: async () => ({
          storageKey: "media/users/user-1/avatar/media-1.webp",
          mimeType: "image/webp" as const,
        }),
        getMemberMedia,
      }),
    });

    const response = await handler(new Request("https://tambike.test/media/media-1"), {
      params: Promise.resolve({ mediaId: "media-1" }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toBe(
      "https://d111111abcdef8.cloudfront.net/media/users/user-1/avatar/media-1.webp?signed=true",
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Content-Type")).toBeNull();
    expect(getMemberMedia).not.toHaveBeenCalled();
  });

  test("hides CDN authorization and signing failures behind the same private 404", async () => {
    const authorizationFailure = createMemberMediaDeliveryHandler({
      readSessionToken: async () => null,
      getCdnUrlFactory: () => () => {
        throw new Error("must not sign unauthorized media");
      },
      getBackend: async () => ({
        authorizeMemberMedia: async () => {
          throw new Error("NOT_FOUND");
        },
        getMemberMedia: async () => {
          throw new Error("must not stream");
        },
      }),
    });
    const signingFailure = createMemberMediaDeliveryHandler({
      readSessionToken: async () => "session-1",
      getCdnUrlFactory: () => () => {
        throw new Error("SIGNING_FAILED");
      },
      getBackend: async () => ({
        authorizeMemberMedia: async () => ({
          storageKey: "media/users/user-1/avatar/media-1.webp",
          mimeType: "image/webp" as const,
        }),
        getMemberMedia: async () => {
          throw new Error("must not stream");
        },
      }),
    });

    for (const handler of [authorizationFailure, signingFailure]) {
      const response = await handler(new Request("https://tambike.test/media/media-1"), {
        params: Promise.resolve({ mediaId: "media-1" }),
      });
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.text()).toBe("Not found");
    }
  });

  test("returns route-level 404 when an admin requests unpublished owner media", async () => {
    const objects = new Map<string, StoredMemberMediaObject>();
    const store: MemberMediaStore = {
      createPresignedPost: async () => ({ url: "https://uploads.example.test", fields: {} }),
      getObject: async (key) => {
        const object = objects.get(key);
        if (!object) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
        return object;
      },
      putObject: async (input) => { objects.set(input.key, { body: input.body, contentType: input.mimeType }); },
      deleteObject: async (key) => { objects.delete(key); },
    };
    const backend = await createTambikeTestBackend({
      memberMedia: {
        store,
        createUuid: () => "route-media-1",
        normalize: async () => ({
          bytes: Buffer.from("webp"), mimeType: "image/webp", width: 512, height: 512,
        }),
      },
    });
    const actors = await createTestActors(backend, "member-media-route");
    const tempKey = `tmp/users/${actors.rider.user.id}/route-avatar`;
    objects.set(tempKey, {
      body: Buffer.from("jpeg"), contentType: "image/jpeg", lastModified: new Date(),
    });
    const avatar = await backend.finalizeMemberMedia(actors.rider.sessionToken, {
      purpose: "avatar", tempKey, claimedMimeType: "image/jpeg",
    });
    const handler = createMemberMediaDeliveryHandler({
      readSessionToken: async () => actors.admin.sessionToken,
      getBackend: async () => backend,
    });
    const response = await handler(new Request(`https://tambike.test${avatar.url}`), {
      params: Promise.resolve({ mediaId: avatar.mediaId }),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
