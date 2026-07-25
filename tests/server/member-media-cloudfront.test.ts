import { describe, expect, test, vi } from "vitest";

import {
  createMemberMediaCloudFrontUrl,
  loadMemberMediaCloudFrontConfig,
} from "../../src/server/member-media/cloudfront";

const privateKey = [
  "-----BEGIN PRIVATE KEY-----",
  "test-private-key",
  "-----END PRIVATE KEY-----",
].join("\n");

const completeEnvironment = {
  MEMBER_MEDIA_CLOUDFRONT_DOMAIN: "d111111abcdef8.cloudfront.net",
  MEMBER_MEDIA_CLOUDFRONT_PUBLIC_KEY_ID: "K1234567890",
  MEMBER_MEDIA_CLOUDFRONT_PRIVATE_KEY_BASE64: Buffer.from(privateKey).toString("base64"),
  MEMBER_MEDIA_CLOUDFRONT_URL_TTL_SECONDS: "300",
};

describe("member media CloudFront configuration", () => {
  test("keeps direct delivery when every CloudFront variable is absent", () => {
    expect(loadMemberMediaCloudFrontConfig({})).toBeNull();
  });

  test("rejects partial configuration instead of silently weakening delivery", () => {
    for (const missing of [
      "MEMBER_MEDIA_CLOUDFRONT_DOMAIN",
      "MEMBER_MEDIA_CLOUDFRONT_PUBLIC_KEY_ID",
      "MEMBER_MEDIA_CLOUDFRONT_PRIVATE_KEY_BASE64",
    ] as const) {
      const environment = { ...completeEnvironment };
      delete environment[missing];

      expect(
        () => loadMemberMediaCloudFrontConfig(environment),
        missing,
      ).toThrow("MEMBER_MEDIA_CLOUDFRONT_CONFIG");
    }
  });

  test("rejects malformed domains, keys, private material, and TTLs", () => {
    const invalidEnvironments = [
      { ...completeEnvironment, MEMBER_MEDIA_CLOUDFRONT_DOMAIN: "https://d111111abcdef8.cloudfront.net" },
      { ...completeEnvironment, MEMBER_MEDIA_CLOUDFRONT_DOMAIN: "d111111abcdef8.cloudfront.net/media" },
      { ...completeEnvironment, MEMBER_MEDIA_CLOUDFRONT_DOMAIN: "cdn.example.test" },
      { ...completeEnvironment, MEMBER_MEDIA_CLOUDFRONT_PUBLIC_KEY_ID: "key with spaces" },
      { ...completeEnvironment, MEMBER_MEDIA_CLOUDFRONT_PRIVATE_KEY_BASE64: "not-base64" },
      {
        ...completeEnvironment,
        MEMBER_MEDIA_CLOUDFRONT_PRIVATE_KEY_BASE64: Buffer.from("not a PEM").toString("base64"),
      },
      { ...completeEnvironment, MEMBER_MEDIA_CLOUDFRONT_URL_TTL_SECONDS: "59" },
      { ...completeEnvironment, MEMBER_MEDIA_CLOUDFRONT_URL_TTL_SECONDS: "901" },
      { ...completeEnvironment, MEMBER_MEDIA_CLOUDFRONT_URL_TTL_SECONDS: "300.5" },
    ];

    for (const environment of invalidEnvironments) {
      expect(() => loadMemberMediaCloudFrontConfig(environment)).toThrow(
        "MEMBER_MEDIA_CLOUDFRONT_CONFIG",
      );
    }
  });

  test("defaults the signed URL lifetime to five minutes", () => {
    const environment = { ...completeEnvironment };
    delete environment.MEMBER_MEDIA_CLOUDFRONT_URL_TTL_SECONDS;

    expect(loadMemberMediaCloudFrontConfig(environment)).toEqual({
      domain: "d111111abcdef8.cloudfront.net",
      publicKeyId: "K1234567890",
      privateKey,
      ttlSeconds: 300,
    });
  });

  test("accepts the trailing newline emitted by OpenSSL PEM files", () => {
    const opensslPrivateKey = `${privateKey}\n`;

    expect(loadMemberMediaCloudFrontConfig({
      ...completeEnvironment,
      MEMBER_MEDIA_CLOUDFRONT_PRIVATE_KEY_BASE64:
        Buffer.from(opensslPrivateKey).toString("base64"),
    })).toMatchObject({
      privateKey: opensslPrivateKey,
    });
  });

  test("signs an encoded HTTPS object path with a bounded expiration", () => {
    const sign = vi.fn((input: {
      url: string;
      keyPairId: string;
      privateKey: string | Buffer;
      dateLessThan: string | number | Date;
      algorithm?: "SHA1" | "SHA256";
    }) => `${input.url}?signed=true`);
    const config = loadMemberMediaCloudFrontConfig(completeEnvironment);

    const url = createMemberMediaCloudFrontUrl(
      "media/users/user 1/avatar/photo.webp",
      config!,
      {
        now: () => new Date("2026-07-25T00:00:00.000Z"),
        sign,
      },
    );

    expect(url).toBe(
      "https://d111111abcdef8.cloudfront.net/media/users/user%201/avatar/photo.webp?signed=true",
    );
    expect(sign).toHaveBeenCalledWith({
      url: "https://d111111abcdef8.cloudfront.net/media/users/user%201/avatar/photo.webp",
      keyPairId: "K1234567890",
      privateKey,
      dateLessThan: "2026-07-25T00:05:00.000Z",
      algorithm: "SHA256",
    });
  });

  test("rejects unsafe storage paths before signing", () => {
    const config = loadMemberMediaCloudFrontConfig(completeEnvironment)!;
    for (const storageKey of [
      "",
      "/media/users/user-1/avatar/photo.webp",
      "media/users/../photo.webp",
      "tmp/users/user-1/photo.webp",
      "media/users/user-1/avatar/photo.jpg",
    ]) {
      expect(() => createMemberMediaCloudFrontUrl(storageKey, config)).toThrow(
        "MEMBER_MEDIA_CLOUDFRONT_PATH",
      );
    }
  });
});
