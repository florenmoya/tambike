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
  saveFinalized(
    userId: string,
    record: FinalizedMemberMediaRecord,
  ): Promise<{ mediaId: string; replacedStorageKeys: string[] }>;
  remove(userId: string, mediaId: string): Promise<{ storageKey: string }>;
  reorder(userId: string, mediaIds: string[]): Promise<void>;
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

    await this.store.putObject({
      key: storageKey,
      body: normalized.bytes,
      mimeType: normalized.mimeType,
    });

    let persisted;
    try {
      persisted = await persistence.saveFinalized(userId, record);
    } catch (error) {
      await deleteIdempotently(this.store, storageKey);
      throw error;
    }

    await deleteIdempotently(this.store, input.tempKey);
    for (const replacedStorageKey of new Set(persisted.replacedStorageKeys)) {
      if (replacedStorageKey !== storageKey) {
        await deleteIdempotently(this.store, replacedStorageKey);
      }
    }

    return {
      mediaId: persisted.mediaId,
      url: `/media/${encodeURIComponent(persisted.mediaId)}`,
      width: normalized.width,
      height: normalized.height,
    };
  }

  async delete(userId: string, mediaId: string, persistence: MemberMediaPersistence) {
    const removed = await persistence.remove(userId, mediaId);
    await deleteIdempotently(this.store, removed.storageKey);
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
}
