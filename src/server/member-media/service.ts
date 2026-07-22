import { randomUUID } from "node:crypto";

import { normalizeMemberImage, type NormalizeMemberImageInput } from "./image-normalizer";
import { loadMemberMediaConfig } from "./config";
import { createS3MemberMediaStore } from "./s3-store";
import type { MemberMediaBody, MemberMediaStore } from "./store";
import { createMemberUploadPolicy } from "./upload-policy";
import {
  MEMBER_UPLOAD_EXPIRES_SECONDS,
  type MemberImageMimeType,
  type MemberImagePurpose,
  type NormalizedMemberImage,
} from "./types";

export type MemberMediaLifecycleErrorCode =
  | "INVALID_INPUT"
  | "INVALID_IMAGE"
  | "UPLOAD_NOT_FOUND"
  | "UPLOAD_EXPIRED"
  | "UPLOAD_OWNERSHIP_MISMATCH"
  | "MEDIA_UNAVAILABLE";

export class MemberMediaLifecycleError extends Error {
  constructor(public readonly code: MemberMediaLifecycleErrorCode, message: string = code) {
    super(message);
    this.name = "MemberMediaLifecycleError";
  }
}

export interface FinalizeMemberMediaInput {
  purpose: MemberImagePurpose;
  tempKey: string;
  claimedMimeType: MemberImageMimeType;
  motorcyclePhotoPosition?: number;
}

export interface FinalizedMemberMediaRecord {
  purpose: MemberImagePurpose;
  mediaId: string;
  storageKey: string;
  mimeType: "image/webp";
  width: number;
  height: number;
  finalizedAt: Date;
  motorcyclePhotoPosition?: number;
}

export interface MemberMediaPersistence {
  registerCleanup(userId: string, storageKey: string, cleanupAfter: Date): Promise<void>;
  activateCleanup(storageKey: string, cleanupAfter: Date): Promise<void>;
  saveFinalized(
    userId: string,
    record: FinalizedMemberMediaRecord,
    tempKey: string,
    cleanupAfter: Date,
  ): Promise<{ mediaId: string }>;
  remove(userId: string, mediaId: string, cleanupAfter: Date): Promise<void>;
  reorder(userId: string, mediaIds: string[]): Promise<void>;
  claimCleanup(input: {
    limit: number;
    now: Date;
    claimExpiresAt: Date;
  }): Promise<Array<{
    id: string;
    storageKey: string;
    claimToken: string;
    attemptCount: number;
  }>>;
  completeCleanup(id: string, claimToken: string): Promise<void>;
  failCleanup(
    id: string,
    claimToken: string,
    attemptedAt: Date,
    retryAt: Date,
  ): Promise<void>;
}

export interface MemberMediaCleanupResult {
  batches: number;
  claimed: number;
  deleted: number;
  failed: number;
}

export interface AuthorizedMemberMediaDescriptor {
  storageKey: string;
  mimeType: "image/webp";
}

export interface MemberMediaDelivery {
  body: MemberMediaBody;
  mimeType: "image/webp";
  contentLength?: number;
}

export interface MemberMediaLifecycleDependencies {
  now?: () => Date;
  createUuid?: () => string;
  normalize?: (input: NormalizeMemberImageInput) => Promise<NormalizedMemberImage>;
}

export type MemberMediaLifecycleOptions = MemberMediaLifecycleDependencies & {
  store?: MemberMediaStore;
};

export function createMemberMediaLifecycleService(
  options: MemberMediaLifecycleOptions = {},
) {
  const { store, ...dependencies } = options;
  let runtimeStore: MemberMediaStore | undefined;
  const resolveStore = () => {
    runtimeStore ??= createS3MemberMediaStore(loadMemberMediaConfig());
    return runtimeStore;
  };
  const lazyStore: MemberMediaStore = {
    createPresignedPost: (input) => resolveStore().createPresignedPost(input),
    getObject: (key) => resolveStore().getObject(key),
    putObject: (input) => resolveStore().putObject(input),
    deleteObject: (key) => resolveStore().deleteObject(key),
  };
  return new MemberMediaLifecycleService(
    store ?? lazyStore,
    dependencies,
  );
}

function isNoSuchKey(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; Code?: string; code?: string };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.Code === "NoSuchKey" ||
    candidate.code === "NoSuchKey"
  );
}

async function deleteIdempotently(store: MemberMediaStore, key: string) {
  try {
    await store.deleteObject(key);
  } catch (error) {
    if (!isNoSuchKey(error)) throw error;
  }
}

const ABANDONED_FINALIZE_CLEANUP_DELAY_MS = 15 * 60 * 1_000;
const CLEANUP_CLAIM_LEASE_MS = 60 * 1_000;
const CLEANUP_BATCH_LIMIT = 10;
const CLEANUP_MAX_BATCHES = 5;
const CLEANUP_RETRY_BASE_DELAY_MS = 60 * 1_000;
const CLEANUP_RETRY_MAX_DELAY_MS = 24 * 60 * 60 * 1_000;

export function memberMediaCleanupRetryDelayMs(attemptNumber: number) {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error("MEMBER_MEDIA_CLEANUP_ATTEMPT_INVALID");
  }
  return Math.min(
    CLEANUP_RETRY_BASE_DELAY_MS * 2 ** Math.min(attemptNumber - 1, 30),
    CLEANUP_RETRY_MAX_DELAY_MS,
  );
}

export class MemberMediaLifecycleService {
  private readonly now: () => Date;
  private readonly createUuid: () => string;
  private readonly normalize: (input: NormalizeMemberImageInput) => Promise<NormalizedMemberImage>;

  constructor(
    private readonly store: MemberMediaStore,
    dependencies: MemberMediaLifecycleDependencies = {},
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.createUuid = dependencies.createUuid ?? randomUUID;
    this.normalize = dependencies.normalize ?? normalizeMemberImage;
  }

  createUpload(userId: string, mimeType: string) {
    return createMemberUploadPolicy(this.store, {
      userId,
      nonce: this.createUuid(),
      mimeType,
    });
  }

  async finalize(
    userId: string,
    input: FinalizeMemberMediaInput,
    persistence: MemberMediaPersistence,
  ) {
    const expectedPrefix = `tmp/users/${userId}/`;
    if (!input.tempKey.startsWith(expectedPrefix) || input.tempKey.length <= expectedPrefix.length) {
      throw new MemberMediaLifecycleError("UPLOAD_OWNERSHIP_MISMATCH");
    }
    if (input.tempKey.slice(expectedPrefix.length).includes("/")) {
      throw new MemberMediaLifecycleError("UPLOAD_OWNERSHIP_MISMATCH");
    }

    let source;
    try {
      source = await this.store.getObject(input.tempKey);
    } catch (error) {
      if (isNoSuchKey(error)) throw new MemberMediaLifecycleError("UPLOAD_NOT_FOUND");
      throw error;
    }
    if (
      source.lastModified &&
      this.now().getTime() - source.lastModified.getTime() > MEMBER_UPLOAD_EXPIRES_SECONDS * 1_000
    ) {
      throw new MemberMediaLifecycleError("UPLOAD_EXPIRED");
    }
    if (source.contentType && source.contentType !== input.claimedMimeType) {
      throw new MemberMediaLifecycleError("INVALID_IMAGE", "claimed MIME does not match upload");
    }

    const normalized = await this.normalize({
      body: source.body,
      claimedMimeType: input.claimedMimeType,
      purpose: input.purpose,
    });
    const mediaId = this.createUuid();
    const folder = input.purpose === "avatar" ? "avatar" : "motorcycles";
    const storageKey = `media/users/${userId}/${folder}/${mediaId}.webp`;
    const record: FinalizedMemberMediaRecord = {
      purpose: input.purpose,
      mediaId,
      storageKey,
      mimeType: normalized.mimeType,
      width: normalized.width,
      height: normalized.height,
      finalizedAt: this.now(),
      motorcyclePhotoPosition: input.motorcyclePhotoPosition,
    };

    await persistence.registerCleanup(
      userId,
      storageKey,
      new Date(record.finalizedAt.getTime() + ABANDONED_FINALIZE_CLEANUP_DELAY_MS),
    );

    try {
      await this.store.putObject({
        key: storageKey,
        body: normalized.bytes,
        mimeType: normalized.mimeType,
      });
    } catch (error) {
      await this.activateAndDrainCleanup(storageKey, persistence, error);
      throw error;
    }

    let persisted;
    try {
      persisted = await persistence.saveFinalized(
        userId,
        record,
        input.tempKey,
        record.finalizedAt,
      );
    } catch (error) {
      await this.activateAndDrainCleanup(storageKey, persistence, error);
      throw error;
    }

    await this.drainPendingCleanup(persistence, {
      now: record.finalizedAt,
      maxBatches: 1,
    }).catch(() => undefined);

    return {
      mediaId: persisted.mediaId,
      url: `/media/${encodeURIComponent(persisted.mediaId)}`,
      width: normalized.width,
      height: normalized.height,
    };
  }

  async delete(userId: string, mediaId: string, persistence: MemberMediaPersistence) {
    const cleanupAt = this.now();
    await persistence.remove(userId, mediaId, cleanupAt);
    await this.drainPendingCleanup(persistence, {
      now: cleanupAt,
      maxBatches: 1,
    }).catch(() => undefined);
  }

  async reorder(userId: string, mediaIds: string[], persistence: MemberMediaPersistence) {
    if (new Set(mediaIds).size !== mediaIds.length || mediaIds.length > 5) {
      throw new MemberMediaLifecycleError("INVALID_INPUT");
    }
    await persistence.reorder(userId, mediaIds);
  }

  async read(descriptor: AuthorizedMemberMediaDescriptor): Promise<MemberMediaDelivery> {
    try {
      const object = await this.store.getObject(descriptor.storageKey);
      return {
        body: object.body,
        mimeType: descriptor.mimeType,
        contentLength: object.contentLength,
      };
    } catch (error) {
      if (isNoSuchKey(error)) throw new MemberMediaLifecycleError("MEDIA_UNAVAILABLE");
      throw error;
    }
  }

  async drainPendingCleanup(
    persistence: MemberMediaPersistence,
    options: {
      now?: Date;
      maxBatches?: number;
      batchSize?: number;
    } = {},
  ): Promise<MemberMediaCleanupResult> {
    const now = options.now ?? this.now();
    const maxBatches = options.maxBatches ?? CLEANUP_MAX_BATCHES;
    const batchSize = options.batchSize ?? CLEANUP_BATCH_LIMIT;
    if (
      !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > CLEANUP_MAX_BATCHES ||
      !Number.isInteger(batchSize) || batchSize < 1 || batchSize > CLEANUP_BATCH_LIMIT
    ) {
      throw new Error("MEMBER_MEDIA_CLEANUP_BOUNDS_INVALID");
    }

    const result: MemberMediaCleanupResult = {
      batches: 0,
      claimed: 0,
      deleted: 0,
      failed: 0,
    };
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const claims = await persistence.claimCleanup({
        limit: batchSize,
        now,
        claimExpiresAt: new Date(now.getTime() + CLEANUP_CLAIM_LEASE_MS),
      });
      if (claims.length === 0) break;
      result.batches += 1;
      result.claimed += claims.length;
      for (const claim of claims) {
        try {
          await deleteIdempotently(this.store, claim.storageKey);
          await persistence.completeCleanup(claim.id, claim.claimToken);
          result.deleted += 1;
        } catch {
          const attemptNumber = claim.attemptCount + 1;
          const retryAt = new Date(
            now.getTime() + memberMediaCleanupRetryDelayMs(attemptNumber),
          );
          await persistence.failCleanup(
            claim.id,
            claim.claimToken,
            now,
            retryAt,
          );
          result.failed += 1;
        }
      }
      if (claims.length < batchSize) break;
    }
    return result;
  }

  private async activateAndDrainCleanup(
    storageKey: string,
    persistence: MemberMediaPersistence,
    operationError: unknown,
  ) {
    const cleanupAt = this.now();
    try {
      await persistence.activateCleanup(storageKey, cleanupAt);
      await this.drainPendingCleanup(persistence, {
        now: cleanupAt,
        maxBatches: 1,
      });
    } catch (cleanupError) {
      throw new AggregateError(
        [operationError, cleanupError],
        operationError instanceof Error ? operationError.message : "MEMBER_MEDIA_OPERATION_FAILED",
        { cause: operationError },
      );
    }
  }

}
