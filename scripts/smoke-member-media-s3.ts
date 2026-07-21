import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import sharp from "sharp";

import { createS3MemberMediaStore } from "../src/server/member-media/s3-store";
import {
  createMemberMediaLifecycleService,
  type AuthorizedMemberMediaDescriptor,
  type FinalizedMemberMediaRecord,
  type MemberMediaPersistence,
} from "../src/server/member-media/service";
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
  MEMBER_MEDIA_SMOKE_RUN_ID?: string;
  MEMBER_MEDIA_SMOKE_CONFIRM?: string;
  VERCEL_OIDC_TOKEN?: string;
}

export interface SmokeConfiguration {
  region: "ap-southeast-1";
  bucketName: string;
  roleArn: string;
  basePrefix: string;
  runId?: string;
}

export interface SmokePersistence extends MemberMediaPersistence {
  authorizeRead(
    userId: string,
    mediaId: string,
  ): Promise<AuthorizedMemberMediaDescriptor>;
}

export interface SmokeRunDependencies {
  store?: MemberMediaStore;
  fetch?: typeof fetch;
  createUuid?: () => string;
  now?: () => Date;
  persistence?: SmokePersistence;
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
  const runId = env.MEMBER_MEDIA_SMOKE_RUN_ID?.trim() || undefined;
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
  if (runId && !/^[0-9]{14}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
    throw new Error("SMOKE_REFUSED: MEMBER_MEDIA_SMOKE_RUN_ID must be a timestamp plus UUID");
  }

  return { region, bucketName, roleArn, basePrefix, ...(runId ? { runId } : {}) };
}

function requireRunPrefix(runPrefix: string) {
  if (
    !runPrefix.startsWith("smoke/") ||
    !runPrefix.endsWith("/") ||
    runPrefix.includes("..") ||
    runPrefix.includes("//")
  ) {
    throw new Error("SMOKE_REFUSED: invalid unique smoke run namespace");
  }
}

function physicalRunKey(runPrefix: string, logicalKey: string) {
  requireRunPrefix(runPrefix);
  if (
    !/^(tmp|media)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(logicalKey) ||
    logicalKey.includes("..") ||
    logicalKey.includes("//") ||
    logicalKey.endsWith("/")
  ) {
    throw new Error("SMOKE_REFUSED: logical key is not an exact tmp/ or media/ object");
  }
  const key = `${runPrefix}${logicalKey}`;
  if (key === runPrefix || !key.startsWith(runPrefix)) {
    throw new Error("SMOKE_REFUSED: object key escaped the unique smoke namespace");
  }
  return key;
}

function requireOwnedRunKey(runPrefix: string, key: string, ownedKeys: Set<string>) {
  requireRunPrefix(runPrefix);
  const logicalKey = key.startsWith(runPrefix) ? key.slice(runPrefix.length) : "";
  const reconstructed = logicalKey ? physicalRunKey(runPrefix, logicalKey) : "";
  if (key === runPrefix || reconstructed !== key || !ownedKeys.has(key)) {
    throw new Error("SMOKE_REFUSED: operation targeted a non-run-owned object key");
  }
}

export function createSmokeNamespaceStore(
  store: MemberMediaStore,
  runPrefix: string,
  ownedKeys: Set<string>,
  deletedKeys: Set<string>,
): MemberMediaStore {
  requireRunPrefix(runPrefix);
  return {
    async createPresignedPost(input) {
      const key = physicalRunKey(runPrefix, input.key);
      ownedKeys.add(key);
      return store.createPresignedPost({ ...input, key });
    },
    getObject(key) {
      const physical = physicalRunKey(runPrefix, key);
      requireOwnedRunKey(runPrefix, physical, ownedKeys);
      return store.getObject(physical);
    },
    async putObject(input: PutMemberMediaObjectInput) {
      const key = physicalRunKey(runPrefix, input.key);
      ownedKeys.add(key);
      await store.putObject({ ...input, key });
    },
    async deleteObject(key) {
      const physical = physicalRunKey(runPrefix, key);
      requireOwnedRunKey(runPrefix, physical, ownedKeys);
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
  fetcher: typeof fetch,
) {
  const form = new FormData();
  for (const [name, value] of Object.entries(presigned.fields)) form.set(name, value);
  const imageBuffer = new ArrayBuffer(image.byteLength);
  new Uint8Array(imageBuffer).set(image);
  form.set("file", new Blob([imageBuffer], { type: "image/jpeg" }), "tambike-smoke.jpg");
  const response = await fetcher(presigned.url, { method: "POST", body: form });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`S3 presigned POST failed (${response.status}): ${body}`);
  }
}

function createSmokePersistence(): SmokePersistence {
  let ownerId: string | undefined;
  let finalized: { mediaId: string; storageKey: string } | undefined;
  const requireRecord = (userId: string, mediaId: string) => {
    if (!finalized || ownerId !== userId || finalized.mediaId !== mediaId) {
      throw new Error("smoke media record not found");
    }
    return finalized;
  };
  return {
    async saveFinalized(userId: string, record: FinalizedMemberMediaRecord) {
      ownerId = userId;
      finalized = { mediaId: record.mediaId, storageKey: record.storageKey };
      return { mediaId: record.mediaId, replacedStorageKeys: [] };
    },
    async remove(userId: string, mediaId: string) {
      return { storageKey: requireRecord(userId, mediaId).storageKey };
    },
    async reorder() {},
    async authorizeRead(userId: string, mediaId: string) {
      return {
        storageKey: requireRecord(userId, mediaId).storageKey,
        mimeType: "image/webp",
      };
    },
  };
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
    MEMBER_MEDIA_SMOKE_RUN_ID: process.env.MEMBER_MEDIA_SMOKE_RUN_ID,
    MEMBER_MEDIA_SMOKE_CONFIRM: process.env.MEMBER_MEDIA_SMOKE_CONFIRM,
    VERCEL_OIDC_TOKEN: process.env.VERCEL_OIDC_TOKEN,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function runMemberMediaS3Smoke(
  env: SmokeEnvironment = runtimeSmokeEnvironment(),
  dependencies: SmokeRunDependencies = {},
) {
  const config = validateSmokeConfiguration(env);
  const now = dependencies.now ?? (() => new Date());
  const createUuid = dependencies.createUuid ?? randomUUID;
  const fetcher = dependencies.fetch ?? fetch;
  const runId = config.runId ?? `${now().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${createUuid()}`;
  const runPrefix = `${config.basePrefix}/${runId}/`;
  const ownedKeys = new Set<string>();
  const deletedKeys = new Set<string>();
  const rawStore = dependencies.store ?? createS3MemberMediaStore(config);
  const store = createSmokeNamespaceStore(rawStore, runPrefix, ownedKeys, deletedKeys);
  const userId = `smoke-${createUuid()}`;
  const persistence = dependencies.persistence ?? createSmokePersistence();
  const lifecycle = createMemberMediaLifecycleService({ store, now, createUuid });
  let primaryError: unknown;
  let result:
    | { mediaId: string; width: number; height: number }
    | undefined;

  try {
    const image = await generatedJpeg();
    const presigned = await lifecycle.createUpload(userId, "image/jpeg");
    await submitPresignedPost(presigned, image, fetcher);
    const finalized = await lifecycle.finalize(
      userId,
      { purpose: "avatar", tempKey: presigned.key, claimedMimeType: "image/jpeg" },
      persistence,
    );
    const descriptor = await persistence.authorizeRead(userId, finalized.mediaId);
    const authorized = await lifecycle.read(descriptor);
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

    await lifecycle.delete(userId, finalized.mediaId, persistence);
    result = {
      mediaId: finalized.mediaId,
      width: metadata.width,
      height: metadata.height,
    };
  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors: Error[] = [];
  for (const key of ownedKeys) {
    if (!deletedKeys.has(key)) {
      try {
        requireOwnedRunKey(runPrefix, key, ownedKeys);
        await rawStore.deleteObject(key);
        deletedKeys.add(key);
      } catch (error) {
        cleanupErrors.push(
          new Error(`cleanup failed for exact key ${key}: ${errorMessage(error)}`, { cause: error }),
        );
      }
    }
  }

  if (cleanupErrors.length > 0) {
    const errors = primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors;
    throw new AggregateError(
      errors,
      `member media smoke cleanup failed for ${cleanupErrors.length} exact run-owned key(s)${
        primaryError ? `; primary failure: ${errorMessage(primaryError)}` : ""
      }`,
    );
  }
  if (primaryError) throw primaryError;
  if (!result) throw new Error("member media smoke finished without a result");

  return {
    runPrefix,
    uploadedKeys: [...ownedKeys],
    deletedKeys: [...deletedKeys],
    media: result,
  };
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
