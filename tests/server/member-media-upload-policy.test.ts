import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, test, vi } from "vitest";

import {
  ALLOWED_MEMBER_IMAGE_MIME_TYPES,
  MAX_MEMBER_UPLOAD_BYTES,
  MEMBER_UPLOAD_EXPIRES_SECONDS,
} from "../../src/server/member-media/types";
import { loadMemberMediaConfig } from "../../src/server/member-media/config";
import { createMemberUploadPolicy } from "../../src/server/member-media/upload-policy";
import { createS3MemberMediaStore } from "../../src/server/member-media/s3-store";
import type {
  CreatePresignedPostInput,
  MemberMediaStore,
} from "../../src/server/member-media/store";

function capturePresignStore() {
  const createPresignedPost = vi.fn(
    async (input: CreatePresignedPostInput) => ({
      url: "https://uploads.example.test",
      fields: {
        key: input.key,
        "Content-Type": input.mimeType,
      },
    }),
  );

  const store: MemberMediaStore = {
    createPresignedPost,
    getObject: vi.fn(),
    putObject: vi.fn(),
    deleteObject: vi.fn(),
  };

  return { createPresignedPost, store };
}

describe("member image upload policy", () => {
  test("pins exact user temp key, MIME, five-minute expiry, and 1..8 MiB range", async () => {
    const { createPresignedPost, store } = capturePresignStore();

    const result = await createMemberUploadPolicy(store, {
      userId: "user-rider_123",
      nonce: "550e8400-e29b-41d4-a716-446655440000",
      mimeType: "image/jpeg",
    });

    expect(createPresignedPost).toHaveBeenCalledWith({
      key: "tmp/users/user-rider_123/550e8400-e29b-41d4-a716-446655440000",
      mimeType: "image/jpeg",
      expiresInSeconds: 300,
      minimumBytes: 1,
      maximumBytes: 8_388_608,
    });
    expect(result).toEqual({
      key: "tmp/users/user-rider_123/550e8400-e29b-41d4-a716-446655440000",
      mimeType: "image/jpeg",
      expiresInSeconds: 300,
      url: "https://uploads.example.test",
      fields: {
        key: "tmp/users/user-rider_123/550e8400-e29b-41d4-a716-446655440000",
        "Content-Type": "image/jpeg",
      },
    });
  });

  test("allows only exact JPEG, PNG, and WebP MIME values", async () => {
    const { store } = capturePresignStore();

    expect(ALLOWED_MEMBER_IMAGE_MIME_TYPES).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);

    for (const mimeType of ALLOWED_MEMBER_IMAGE_MIME_TYPES) {
      await expect(
        createMemberUploadPolicy(store, {
          userId: "user-1",
          nonce: `nonce-${mimeType.split("/")[1]}`,
          mimeType,
        }),
      ).resolves.toMatchObject({ mimeType });
    }

    for (const mimeType of [
      "image/gif",
      "image/svg+xml",
      "image/avif",
      "Image/JPEG",
      "image/jpeg; charset=utf-8",
      "",
    ]) {
      await expect(
        createMemberUploadPolicy(store, {
          userId: "user-1",
          nonce: "nonce-1",
          mimeType,
        }),
      ).rejects.toThrow("INVALID_IMAGE");
    }
  });

  test("rejects path separators and blank key components", async () => {
    const { store } = capturePresignStore();

    for (const input of [
      { userId: "", nonce: "nonce" },
      { userId: "../other-user", nonce: "nonce" },
      { userId: "user", nonce: "../escape" },
      { userId: "user/other", nonce: "nonce" },
      { userId: "user", nonce: "nested/nonce" },
    ]) {
      await expect(
        createMemberUploadPolicy(store, { ...input, mimeType: "image/png" }),
      ).rejects.toThrow("INVALID_IMAGE");
    }
  });

  test("exports the contract constants used by signing and bounded reads", () => {
    expect(MEMBER_UPLOAD_EXPIRES_SECONDS).toBe(300);
    expect(MAX_MEMBER_UPLOAD_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe("member media environment", () => {
  test("requires region, role ARN, and bucket name", () => {
    for (const env of [
      { AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/tambike", S3_BUCKET_NAME: "media" },
      { AWS_REGION: "ap-southeast-1", S3_BUCKET_NAME: "media" },
      { AWS_REGION: "ap-southeast-1", AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/tambike" },
    ]) {
      expect(() => loadMemberMediaConfig(env)).toThrow("MEMBER_MEDIA_CONFIG");
    }
  });

  test("trims values and pins production to ap-southeast-1", () => {
    expect(
      loadMemberMediaConfig({
        AWS_REGION: " ap-southeast-1 ",
        AWS_ROLE_ARN: " arn:aws:iam::123456789012:role/tambike ",
        S3_BUCKET_NAME: " tambike-member-media ",
        VERCEL_ENV: "production",
      }),
    ).toEqual({
      region: "ap-southeast-1",
      roleArn: "arn:aws:iam::123456789012:role/tambike",
      bucketName: "tambike-member-media",
    });

    expect(() =>
      loadMemberMediaConfig({
        AWS_REGION: "us-east-1",
        AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/tambike",
        S3_BUCKET_NAME: "tambike-member-media",
        VERCEL_ENV: "production",
      }),
    ).toThrow("ap-southeast-1");
  });
});

describe("S3 member media store", () => {
  test("maps the abstract upload contract to exact S3 POST fields and conditions", async () => {
    const client = { send: vi.fn() };
    const presign = vi.fn(async () => ({
      url: "https://bucket.s3.ap-southeast-1.amazonaws.com",
      fields: { key: "tmp/users/user-1/nonce-1" },
    }));
    const store = createS3MemberMediaStore(
      {
        region: "ap-southeast-1",
        roleArn: "arn:aws:iam::123456789012:role/tambike",
        bucketName: "tambike-member-media",
      },
      { client, presign },
    );

    await store.createPresignedPost({
      key: "tmp/users/user-1/nonce-1",
      mimeType: "image/webp",
      expiresInSeconds: 300,
      minimumBytes: 1,
      maximumBytes: 8_388_608,
    });

    expect(presign).toHaveBeenCalledWith(client, {
      Bucket: "tambike-member-media",
      Key: "tmp/users/user-1/nonce-1",
      Fields: { "Content-Type": "image/webp" },
      Conditions: [
        ["eq", "$key", "tmp/users/user-1/nonce-1"],
        ["eq", "$Content-Type", "image/webp"],
        ["content-length-range", 1, 8_388_608],
      ],
      Expires: 300,
    });
  });

  test("gets, puts, and deletes only the requested private object", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetObjectCommand) {
        return {
          Body: Buffer.from("stored-image"),
          ContentType: "image/webp",
          ContentLength: 12,
        };
      }
      return {};
    });
    const store = createS3MemberMediaStore(
      {
        region: "ap-southeast-1",
        roleArn: "arn:aws:iam::123456789012:role/tambike",
        bucketName: "tambike-member-media",
      },
      { client: { send } },
    );

    await expect(store.getObject("media/users/user-1/avatar.webp")).resolves.toEqual({
      body: Buffer.from("stored-image"),
      contentType: "image/webp",
      contentLength: 12,
    });
    await store.putObject({
      key: "media/users/user-1/avatar.webp",
      body: Buffer.from("normalized-webp"),
      mimeType: "image/webp",
    });
    await store.deleteObject("tmp/users/user-1/nonce-1");

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
    expect((send.mock.calls[0][0] as GetObjectCommand).input).toEqual({
      Bucket: "tambike-member-media",
      Key: "media/users/user-1/avatar.webp",
    });
    expect(send.mock.calls[1][0]).toBeInstanceOf(PutObjectCommand);
    expect((send.mock.calls[1][0] as PutObjectCommand).input).toEqual({
      Bucket: "tambike-member-media",
      Key: "media/users/user-1/avatar.webp",
      Body: Buffer.from("normalized-webp"),
      ContentType: "image/webp",
      CacheControl: "private, no-store",
      ServerSideEncryption: "AES256",
    });
    expect(send.mock.calls[2][0]).toBeInstanceOf(DeleteObjectCommand);
    expect((send.mock.calls[2][0] as DeleteObjectCommand).input).toEqual({
      Bucket: "tambike-member-media",
      Key: "tmp/users/user-1/nonce-1",
    });
  });
});
