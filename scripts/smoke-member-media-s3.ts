import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import sharp from "sharp";

import { createS3MemberMediaStore } from "../src/server/member-media/s3-store";
import { createMemberMediaLifecycleService } from "../src/server/member-media/service";
import type {
  MemberMediaStore,
  PutMemberMediaObjectInput,
} from "../src/server/member-media/store";

const CONFIRMATION = "I_UNDERSTAND_THIS_USES_A_TEST_BUCKET";
const TEST_NAME = /(?:^|[-_.])(test|smoke|nonprod)(?:[-_.]|$)/i;

interface SmokeEnvironment {
  AWS_REGION?: string;
  MEMBER_MEDIA_SMOKE_BUCKET_NAME?: string;
  MEMBER_MEDIA_SMOKE_ROLE_ARN?: string;
  MEMBER_MEDIA_SMOKE_PREFIX?: string;
  MEMBER_MEDIA_SMOKE_CONFIRM?: string;
  VERCEL_OIDC_TOKEN?: string;
}

export interface SmokeConfiguration {
  region: "ap-southeast-1";
  bucketName: string;
  roleArn: string;
  basePrefix: string;
}

function required(env: SmokeEnvironment, name: keyof SmokeEnvironment) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`SMOKE_REFUSED: ${name} is required`);
  return value;
}

export function validateSmokeConfiguration(env: SmokeEnvironment): SmokeConfiguration {
  const region = required(env, "AWS_REGION");
  const bucketName = required(env, "MEMBER_MEDIA_SMOKE_BUCKET_NAME");
  const roleArn = required(env, "MEMBER_MEDIA_SMOKE_ROLE_ARN");
  const rawPrefix = required(env, "MEMBER_MEDIA_SMOKE_PREFIX");
  const confirmation = required(env, "MEMBER_MEDIA_SMOKE_CONFIRM");
  required(env, "VERCEL_OIDC_TOKEN");

  if (region !== "ap-southeast-1") {
    throw new Error("SMOKE_REFUSED: AWS_REGION must be ap-southeast-1");
  }
  if (confirmation !== CONFIRMATION) {
    throw new Error("SMOKE_REFUSED: explicit test-bucket confirmation is required");
  }
  if (!TEST_NAME.test(bucketName) || !TEST_NAME.test(roleArn.split("/").at(-1) ?? "")) {
    throw new Error("SMOKE_REFUSED: bucket and role names must identify test, smoke, or nonprod resources");
  }

  const basePrefix = rawPrefix.replace(/^\/+|\/+$/g, "");
  const lowerPrefix = basePrefix.toLowerCase();
  if (
    !lowerPrefix.startsWith("smoke/") ||
    lowerPrefix === "smoke/" ||
    lowerPrefix.startsWith("tmp/") ||
    lowerPrefix.startsWith("media/") ||
    /(^|\/)(prod|production|sample|mika)(\/|$)/.test(lowerPrefix) ||
    !/^[a-z0-9][a-z0-9._/-]*$/i.test(basePrefix) ||
    basePrefix.includes("..") ||
    basePrefix.includes("//")
  ) {
    throw new Error("SMOKE_REFUSED: prefix must be a safe non-production path beginning with smoke/");
  }

  return { region, bucketName, roleArn, basePrefix };
}

function prefixingStore(
  store: MemberMediaStore,
  runPrefix: string,
  ownedKeys: Set<string>,
  deletedKeys: Set<string>,
): MemberMediaStore {
  const physicalKey = (logicalKey: string) => `${runPrefix}${logicalKey}`;
  return {
    async createPresignedPost(input) {
      const key = physicalKey(input.key);
      const result = await store.createPresignedPost({ ...input, key });
      ownedKeys.add(key);
      return result;
    },
    getObject(key) {
      return store.getObject(physicalKey(key));
    },
    async putObject(input: PutMemberMediaObjectInput) {
      const key = physicalKey(input.key);
      await store.putObject({ ...input, key });
      ownedKeys.add(key);
    },
    async deleteObject(key) {
      const physical = physicalKey(key);
      await store.deleteObject(physical);
      deletedKeys.add(physical);
    },
  };
}

async function generatedJpeg() {
  return sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 255, g: 190, b: 69 },
    },
  })
    .withMetadata({ exif: { IFD0: { Artist: "Tambike S3 smoke" } } })
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function submitPresignedPost(
  presigned: { url: string; fields: Record<string, string> },
  image: Uint8Array,
) {
  const form = new FormData();
  for (const [name, value] of Object.entries(presigned.fields)) form.set(name, value);
  const imageBuffer = new ArrayBuffer(image.byteLength);
  new Uint8Array(imageBuffer).set(image);
  form.set("file", new Blob([imageBuffer], { type: "image/jpeg" }), "tambike-smoke.jpg");
  const response = await fetch(presigned.url, { method: "POST", body: form });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`S3 presigned POST failed (${response.status}): ${body}`);
  }
}

async function bodyBytes(body: Uint8Array | AsyncIterable<Uint8Array>) {
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function runtimeSmokeEnvironment(): SmokeEnvironment {
  return {
    AWS_REGION: process.env.AWS_REGION,
    MEMBER_MEDIA_SMOKE_BUCKET_NAME: process.env.MEMBER_MEDIA_SMOKE_BUCKET_NAME,
    MEMBER_MEDIA_SMOKE_ROLE_ARN: process.env.MEMBER_MEDIA_SMOKE_ROLE_ARN,
    MEMBER_MEDIA_SMOKE_PREFIX: process.env.MEMBER_MEDIA_SMOKE_PREFIX,
    MEMBER_MEDIA_SMOKE_CONFIRM: process.env.MEMBER_MEDIA_SMOKE_CONFIRM,
    VERCEL_OIDC_TOKEN: process.env.VERCEL_OIDC_TOKEN,
  };
}

export async function runMemberMediaS3Smoke(env: SmokeEnvironment = runtimeSmokeEnvironment()) {
  const config = validateSmokeConfiguration(env);
  const runId = `${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID()}`;
  const runPrefix = `${config.basePrefix}/${runId}/`;
  const ownedKeys = new Set<string>();
  const deletedKeys = new Set<string>();
  const rawStore = createS3MemberMediaStore(config);
  const store = prefixingStore(rawStore, runPrefix, ownedKeys, deletedKeys);
  const userId = `smoke-${randomUUID()}`;
  let finalized:
    | { mediaId: string; storageKey: string }
    | undefined;
  const lifecycle = createMemberMediaLifecycleService({ store });

  const persistence = {
    async saveFinalized(_userId: string, record: { mediaId: string; storageKey: string }) {
      finalized = { mediaId: record.mediaId, storageKey: record.storageKey };
      return { mediaId: record.mediaId, replacedStorageKeys: [] };
    },
    async remove(_userId: string, mediaId: string) {
      if (!finalized || finalized.mediaId !== mediaId) throw new Error("smoke media record not found");
      return { storageKey: finalized.storageKey };
    },
    async reorder() {},
  };

  try {
    const image = await generatedJpeg();
    const presigned = await lifecycle.createUpload(userId, "image/jpeg");
    await submitPresignedPost(presigned, image);
    const result = await lifecycle.finalize(
      userId,
      { purpose: "avatar", tempKey: presigned.key, claimedMimeType: "image/jpeg" },
      persistence,
    );
    if (!finalized) throw new Error("finalization did not return a persisted smoke key");

    const authorized = await lifecycle.read({
      storageKey: finalized.storageKey,
      mimeType: "image/webp",
    });
    const bytes = await bodyBytes(authorized.body);
    const metadata = await sharp(bytes).metadata();
    if (
      authorized.mimeType !== "image/webp" ||
      metadata.format !== "webp" ||
      metadata.width !== 512 ||
      metadata.height !== 512 ||
      metadata.exif ||
      metadata.icc ||
      metadata.iptc ||
      metadata.xmp
    ) {
      throw new Error("normalized object is not a metadata-free 512x512 WebP avatar");
    }

    await lifecycle.delete(userId, result.mediaId, persistence);
    return {
      runPrefix,
      uploadedKeys: [...ownedKeys],
      deletedKeys: [...deletedKeys],
      media: { mediaId: result.mediaId, width: metadata.width, height: metadata.height },
    };
  } finally {
    for (const key of ownedKeys) {
      if (!deletedKeys.has(key)) {
        await rawStore.deleteObject(key);
        deletedKeys.add(key);
      }
    }
    if ([...deletedKeys].some((key) => !key.startsWith(runPrefix))) {
      throw new Error("SMOKE_REFUSED: cleanup escaped the unique run prefix");
    }
  }
}

async function main() {
  const result = await runMemberMediaS3Smoke();
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
