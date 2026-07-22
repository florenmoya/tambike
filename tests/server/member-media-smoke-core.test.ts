import sharp from "sharp";
import { describe, expect, test, vi } from "vitest";

import {
  createSmokeNamespaceStore,
  runMemberMediaS3Smoke,
  type SmokePersistence,
} from "../../scripts/smoke-member-media-s3";
import type {
  MemberMediaStore,
  PutMemberMediaObjectInput,
  StoredMemberMediaObject,
} from "../../src/server/member-media/store";

const fixedNow = new Date("2026-07-22T05:00:00.000Z");
const validEnvironment = {
  AWS_REGION: "ap-southeast-1",
  MEMBER_MEDIA_SMOKE_BUCKET_NAME: "tambike-member-media-smoke",
  MEMBER_MEDIA_SMOKE_ROLE_ARN: "arn:aws:iam::123456789012:role/tambike-member-media-test",
  MEMBER_MEDIA_SMOKE_PREFIX: "smoke/member-media",
  MEMBER_MEDIA_SMOKE_CONFIRM: "I_UNDERSTAND_THIS_USES_A_TEST_BUCKET",
  VERCEL_OIDC_TOKEN: "short-lived-test-token",
};

function uuids() {
  const values = ["run-id", "user-id", "upload-id", "media-id"];
  return () => values.shift() ?? "extra-id";
}

function memoryPersistence(options: { saveError?: Error } = {}): SmokePersistence {
  let record: { mediaId: string; storageKey: string } | undefined;
  return {
    async saveFinalized(_userId, next) {
      if (options.saveError) throw options.saveError;
      record = { mediaId: next.mediaId, storageKey: next.storageKey };
      return { mediaId: next.mediaId, replacedStorageKeys: [] };
    },
    async remove(_userId, mediaId) {
      if (!record || record.mediaId !== mediaId) throw new Error("record not found");
      return { storageKey: record.storageKey };
    },
    async reorder() {},
    async authorizeRead(_userId, mediaId) {
      if (!record || record.mediaId !== mediaId) throw new Error("record not found");
      return { storageKey: record.storageKey, mimeType: "image/webp" };
    },
  };
}

function fakeS3(options: {
  postTimeoutAfterWrite?: boolean;
  putTimeoutAfterWrite?: boolean;
  readFinalizedError?: Error;
  deleteError?: (key: string) => Error | undefined;
} = {}) {
  const objects = new Map<string, StoredMemberMediaObject>();
  const presignInputs: Array<{ key: string; mimeType: string }> = [];
  const putKeys: string[] = [];
  const putBodies = new Map<string, Uint8Array>();
  const getKeys: string[] = [];
  const deleteKeys: string[] = [];
  const store: MemberMediaStore = {
    async createPresignedPost(input) {
      presignInputs.push({ key: input.key, mimeType: input.mimeType });
      return {
        url: "https://s3.test/upload",
        fields: { key: input.key, "Content-Type": input.mimeType, policy: "signed" },
      };
    },
    async getObject(key) {
      getKeys.push(key);
      if (key.includes("/media/") && options.readFinalizedError) {
        throw options.readFinalizedError;
      }
      const value = objects.get(key);
      if (!value) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      return value;
    },
    async putObject(input: PutMemberMediaObjectInput) {
      putKeys.push(input.key);
      putBodies.set(input.key, input.body);
      objects.set(input.key, {
        body: input.body,
        contentType: input.mimeType,
        contentLength: input.body.byteLength,
        lastModified: fixedNow,
      });
      if (options.putTimeoutAfterWrite) throw new Error("put timed out after accepted write");
    },
    async deleteObject(key) {
      deleteKeys.push(key);
      const error = options.deleteError?.(key);
      if (error) throw error;
      objects.delete(key);
    },
  };
  const post = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const form = init?.body as FormData;
    const key = String(form.get("key"));
    const file = form.get("file");
    if (!(file instanceof Blob)) throw new Error("file missing");
    objects.set(key, {
      body: new Uint8Array(await file.arrayBuffer()),
      contentType: String(form.get("Content-Type")),
      contentLength: file.size,
      lastModified: fixedNow,
    });
    if (options.postTimeoutAfterWrite) throw new Error("POST timed out after accepted write");
    return new Response(null, { status: 204 });
  });
  return { store, post, objects, presignInputs, putKeys, putBodies, getKeys, deleteKeys };
}

function dependencies(
  s3: ReturnType<typeof fakeS3>,
  persistence: SmokePersistence = memoryPersistence(),
) {
  return {
    store: s3.store,
    fetch: s3.post as typeof fetch,
    anonymousFetch: (async () => new Response(null, { status: 403 })) as typeof fetch,
    createUuid: uuids(),
    now: () => fixedNow,
    persistence,
  };
}

describe("member media real S3 smoke core", () => {
  test("maps every operation into one unique namespace and returns only exact run keys", async () => {
    const s3 = fakeS3();
    const result = await runMemberMediaS3Smoke(validEnvironment, dependencies(s3));
    const prefix = "smoke/member-media/20260722050000-run-id/";
    const tempKey = `${prefix}tmp/users/smoke-user-id/upload-id`;
    const mediaKey = `${prefix}media/users/smoke-user-id/avatar/media-id.webp`;

    expect(result.runPrefix).toBe(prefix);
    expect(s3.presignInputs).toEqual([{ key: tempKey, mimeType: "image/jpeg" }]);
    expect(s3.post).toHaveBeenCalledOnce();
    const posted = s3.post.mock.calls[0]?.[1]?.body as FormData;
    expect(posted.get("key")).toBe(tempKey);
    expect(posted.get("Content-Type")).toBe("image/jpeg");
    expect(s3.putKeys).toEqual([mediaKey]);
    expect(s3.getKeys).toEqual([tempKey, mediaKey]);
    expect(new Set(result.uploadedKeys)).toEqual(new Set([tempKey, mediaKey]));
    expect(new Set(result.deletedKeys)).toEqual(new Set([tempKey, mediaKey]));
    expect(new Set(s3.deleteKeys)).toEqual(new Set([tempKey, mediaKey]));
    expect([...s3.objects]).toEqual([]);
    expect(result.media).toEqual({ mediaId: "media-id", width: 512, height: 512 });
  });

  test("proves the actual finalized raw object rejects an anonymous fetch before cleanup", async () => {
    const s3 = fakeS3();
    const anonymousFetch = vi.fn(async () => new Response(null, { status: 403 }));

    const result = await runMemberMediaS3Smoke(validEnvironment, {
      ...dependencies(s3),
      anonymousFetch: anonymousFetch as typeof fetch,
    });

    const mediaKey = "smoke/member-media/20260722050000-run-id/media/users/smoke-user-id/avatar/media-id.webp";
    expect(result.rawObjectKey).toBe(mediaKey);
    expect(result.rawObjectUrl).toBe(
      `https://tambike-member-media-smoke.s3.ap-southeast-1.amazonaws.com/${mediaKey}`,
    );
    expect(anonymousFetch).toHaveBeenCalledWith(result.rawObjectUrl, { method: "GET" });
    expect(new Set(s3.deleteKeys)).toEqual(new Set([
      "smoke/member-media/20260722050000-run-id/tmp/users/smoke-user-id/upload-id",
      mediaKey,
    ]));
  });

  test.each([200, 404, 500])("fails and still cleans exact keys when anonymous raw fetch returns %i", async (status) => {
    const s3 = fakeS3();
    const anonymousFetch = vi.fn(async () => new Response(null, { status }));

    await expect(runMemberMediaS3Smoke(validEnvironment, {
      ...dependencies(s3),
      anonymousFetch: anonymousFetch as typeof fetch,
    })).rejects.toThrow(`anonymous raw S3 object fetch returned ${status}`);

    expect(new Set(s3.deleteKeys)).toEqual(new Set([
      "smoke/member-media/20260722050000-run-id/tmp/users/smoke-user-id/upload-id",
      "smoke/member-media/20260722050000-run-id/media/users/smoke-user-id/avatar/media-id.webp",
    ]));
  });

  test("registers a final key before a put that times out after S3 accepted it", async () => {
    const s3 = fakeS3({ putTimeoutAfterWrite: true });
    await expect(
      runMemberMediaS3Smoke(validEnvironment, dependencies(s3)),
    ).rejects.toThrow("put timed out after accepted write");

    const prefix = "smoke/member-media/20260722050000-run-id/";
    expect(new Set(s3.deleteKeys)).toEqual(new Set([
      `${prefix}tmp/users/smoke-user-id/upload-id`,
      `${prefix}media/users/smoke-user-id/avatar/media-id.webp`,
    ]));
    expect([...s3.objects]).toEqual([]);
  });

  test("registers the temp key before a presigned POST that times out after acceptance", async () => {
    const s3 = fakeS3({ postTimeoutAfterWrite: true });
    await expect(
      runMemberMediaS3Smoke(validEnvironment, dependencies(s3)),
    ).rejects.toThrow("POST timed out after accepted write");

    expect(s3.deleteKeys).toEqual([
      "smoke/member-media/20260722050000-run-id/tmp/users/smoke-user-id/upload-id",
    ]);
    expect([...s3.objects]).toEqual([]);
  });

  test("attempts every exact cleanup key even when each deletion fails", async () => {
    const s3 = fakeS3({ deleteError: (key) => new Error(`cannot delete ${key}`) });
    const error = await runMemberMediaS3Smoke(validEnvironment, dependencies(s3)).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).message).toMatch(/cleanup failed/i);
    expect((error as AggregateError).errors).toHaveLength(3);

    const prefix = "smoke/member-media/20260722050000-run-id/";
    expect(s3.deleteKeys).toContain(`${prefix}tmp/users/smoke-user-id/upload-id`);
    expect(s3.deleteKeys).toContain(`${prefix}media/users/smoke-user-id/avatar/media-id.webp`);
  });

  test("cleans exact temp and final keys when persistence finalization fails", async () => {
    const s3 = fakeS3();
    await expect(runMemberMediaS3Smoke(
      validEnvironment,
      dependencies(s3, memoryPersistence({ saveError: new Error("finalize persistence failed") })),
    )).rejects.toThrow("finalize persistence failed");

    const prefix = "smoke/member-media/20260722050000-run-id/";
    expect(new Set(s3.deleteKeys)).toEqual(new Set([
      `${prefix}tmp/users/smoke-user-id/upload-id`,
      `${prefix}media/users/smoke-user-id/avatar/media-id.webp`,
    ]));
    expect([...s3.objects]).toEqual([]);
  });

  test("cleans the finalized key when the authorized read fails", async () => {
    const s3 = fakeS3({ readFinalizedError: new Error("authorized read failed") });
    await expect(
      runMemberMediaS3Smoke(validEnvironment, dependencies(s3)),
    ).rejects.toThrow("authorized read failed");

    const prefix = "smoke/member-media/20260722050000-run-id/";
    expect(new Set(s3.deleteKeys)).toEqual(new Set([
      `${prefix}tmp/users/smoke-user-id/upload-id`,
      `${prefix}media/users/smoke-user-id/avatar/media-id.webp`,
    ]));
    expect([...s3.objects]).toEqual([]);
  });

  test("namespace adapter rejects broad or escaping logical keys before mutation", async () => {
    const s3 = fakeS3();
    const owned = new Set<string>();
    const deleted = new Set<string>();
    const adapter = createSmokeNamespaceStore(
      s3.store,
      "smoke/member-media/run-id/",
      owned,
      deleted,
    );

    await expect(adapter.putObject({
      key: "../media/escape.webp",
      body: new Uint8Array([1]),
      mimeType: "image/webp",
    })).rejects.toThrow("SMOKE_REFUSED");
    await expect(adapter.deleteObject("media/")).rejects.toThrow("SMOKE_REFUSED");
    expect(s3.putKeys).toEqual([]);
    expect(s3.deleteKeys).toEqual([]);
    expect(owned.size).toBe(0);
  });

  test("success executes the actual normalization and metadata inspection path", async () => {
    const s3 = fakeS3();
    const result = await runMemberMediaS3Smoke(validEnvironment, dependencies(s3));
    expect(result.media.width).toBe(512);
    expect(result.media.height).toBe(512);
    const putKey = s3.putKeys[0]!;
    const putBody = s3.putBodies.get(putKey);
    if (!putBody) throw new Error("normalized put body missing");
    const metadata = await sharp(putBody).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 512, height: 512 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
  });
});
