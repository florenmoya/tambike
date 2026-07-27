import { randomUUID } from "node:crypto";

import type { GiveawayPrizeImageSummary } from "@/features/giveaways/types";
import { loadMemberMediaConfig } from "@/server/member-media/config";
import {
  normalizeMemberImage,
  type NormalizeMemberImageInput,
} from "@/server/member-media/image-normalizer";
import { createS3MemberMediaStore } from "@/server/member-media/s3-store";
import type {
  MemberMediaBody,
  MemberMediaStore,
} from "@/server/member-media/store";
import {
  ALLOWED_MEMBER_IMAGE_MIME_TYPES,
  MAX_MEMBER_UPLOAD_BYTES,
  MEMBER_UPLOAD_EXPIRES_SECONDS,
  MemberMediaError,
  type MemberImageMimeType,
  type NormalizedMemberImage,
} from "@/server/member-media/types";

export type GiveawayPrizeMediaLifecycleErrorCode =
  | "INVALID_INPUT"
  | "INVALID_IMAGE"
  | "UPLOAD_NOT_FOUND"
  | "UPLOAD_EXPIRED"
  | "UPLOAD_OWNERSHIP_MISMATCH"
  | "MEDIA_UNAVAILABLE";

export class GiveawayPrizeMediaLifecycleError extends Error {
  constructor(
    public readonly code: GiveawayPrizeMediaLifecycleErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "GiveawayPrizeMediaLifecycleError";
  }
}

export interface FinalizeGiveawayPrizeImageInput {
  giveawayId: string;
  prizePoolId: string;
  tempKey: string;
  claimedMimeType: MemberImageMimeType;
}

export interface GiveawayPrizeMediaPersistence {
  authorizePool(input: {
    userId: string;
    giveawayId: string;
    prizePoolId: string;
  }): Promise<void>;
  replaceFinalized(input: {
    userId: string;
    giveawayId: string;
    prizePoolId: string;
    mediaId: string;
    storageKey: string;
    mimeType: "image/webp";
    width: number;
    height: number;
    finalizedAt: Date;
  }): Promise<GiveawayPrizeImageSummary>;
  remove(input: {
    userId: string;
    giveawayId: string;
    prizePoolId: string;
    mediaId: string;
  }): Promise<string>;
  registerCleanup(input: {
    userId: string;
    storageKey: string;
    cleanupAfter: Date;
  }): Promise<void>;
  activateCleanup(input: {
    storageKey: string;
    cleanupAfter: Date;
  }): Promise<void>;
}

export interface PresignedUpload {
  key: string;
  mimeType: MemberImageMimeType;
  expiresInSeconds: number;
  url: string;
  fields: Record<string, string>;
}

export interface AuthorizedGiveawayPrizeMediaDescriptor {
  storageKey: string;
  mimeType: "image/webp";
  visibility: "event_page" | "registered_riders" | "eligible_riders";
}

export interface GiveawayPrizeMediaDelivery {
  body: MemberMediaBody;
  mimeType: "image/webp";
  contentLength?: number;
  visibility: AuthorizedGiveawayPrizeMediaDescriptor["visibility"];
}

export interface GiveawayPrizeMediaLifecycleDependencies {
  now?: () => Date;
  createUuid?: () => string;
  normalize?: (input: NormalizeMemberImageInput) => Promise<NormalizedMemberImage>;
}

export type GiveawayPrizeMediaLifecycleOptions =
  GiveawayPrizeMediaLifecycleDependencies & {
    store?: MemberMediaStore;
  };

const allowedMimeTypes = new Set<string>(ALLOWED_MEMBER_IMAGE_MIME_TYPES);
const safeKeyComponent = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ABANDONED_FINALIZE_CLEANUP_DELAY_MS = 15 * 60 * 1_000;

function isNoSuchKey(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; Code?: string; code?: string };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.Code === "NoSuchKey" ||
    candidate.code === "NoSuchKey"
  );
}

function requireSafeKeyComponent(value: string) {
  if (!safeKeyComponent.test(value)) {
    throw new GiveawayPrizeMediaLifecycleError("INVALID_INPUT");
  }
}

function requireMimeType(value: string): MemberImageMimeType {
  if (!allowedMimeTypes.has(value)) {
    throw new GiveawayPrizeMediaLifecycleError("INVALID_IMAGE");
  }
  return value as MemberImageMimeType;
}

export function createGiveawayPrizeMediaLifecycleService(
  options: GiveawayPrizeMediaLifecycleOptions = {},
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
  return new GiveawayPrizeMediaLifecycleService(store ?? lazyStore, dependencies);
}

export class GiveawayPrizeMediaLifecycleService {
  private readonly now: () => Date;
  private readonly createUuid: () => string;
  private readonly normalize: (
    input: NormalizeMemberImageInput,
  ) => Promise<NormalizedMemberImage>;

  constructor(
    private readonly store: MemberMediaStore,
    dependencies: GiveawayPrizeMediaLifecycleDependencies = {},
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.createUuid = dependencies.createUuid ?? randomUUID;
    this.normalize = dependencies.normalize ?? normalizeMemberImage;
  }

  async createUpload(
    userId: string,
    giveawayId: string,
    prizePoolId: string,
    claimedMimeType: string,
    persistence: GiveawayPrizeMediaPersistence,
  ): Promise<PresignedUpload> {
    requireSafeKeyComponent(userId);
    requireSafeKeyComponent(giveawayId);
    requireSafeKeyComponent(prizePoolId);
    await persistence.authorizePool({ userId, giveawayId, prizePoolId });
    const mimeType = requireMimeType(claimedMimeType);
    const nonce = this.createUuid();
    requireSafeKeyComponent(nonce);
    const key = `tmp/giveaway-prizes/${userId}/${nonce}`;
    const signed = await this.store.createPresignedPost({
      key,
      mimeType,
      expiresInSeconds: MEMBER_UPLOAD_EXPIRES_SECONDS,
      minimumBytes: 1,
      maximumBytes: MAX_MEMBER_UPLOAD_BYTES,
    });
    return {
      key,
      mimeType,
      expiresInSeconds: MEMBER_UPLOAD_EXPIRES_SECONDS,
      ...signed,
    };
  }

  async finalize(
    userId: string,
    input: FinalizeGiveawayPrizeImageInput,
    persistence: GiveawayPrizeMediaPersistence,
  ): Promise<GiveawayPrizeImageSummary> {
    const expectedPrefix = `tmp/giveaway-prizes/${userId}/`;
    const tempSuffix = input.tempKey.slice(expectedPrefix.length);
    if (
      !input.tempKey.startsWith(expectedPrefix) ||
      !safeKeyComponent.test(tempSuffix)
    ) {
      throw new GiveawayPrizeMediaLifecycleError("UPLOAD_OWNERSHIP_MISMATCH");
    }
    await persistence.authorizePool({
      userId,
      giveawayId: input.giveawayId,
      prizePoolId: input.prizePoolId,
    });
    const claimedMimeType = requireMimeType(input.claimedMimeType);

    let source;
    try {
      source = await this.store.getObject(input.tempKey);
    } catch (error) {
      if (isNoSuchKey(error)) {
        throw new GiveawayPrizeMediaLifecycleError("UPLOAD_NOT_FOUND");
      }
      throw error;
    }
    if (
      source.lastModified &&
      this.now().getTime() - source.lastModified.getTime() >
        MEMBER_UPLOAD_EXPIRES_SECONDS * 1_000
    ) {
      throw new GiveawayPrizeMediaLifecycleError("UPLOAD_EXPIRED");
    }
    if (source.contentType && source.contentType !== claimedMimeType) {
      throw new GiveawayPrizeMediaLifecycleError(
        "INVALID_IMAGE",
        "claimed MIME does not match upload",
      );
    }

    let normalized: NormalizedMemberImage;
    try {
      normalized = await this.normalize({
        body: source.body,
        claimedMimeType,
        purpose: "motorcycle-photo",
      });
    } catch (error) {
      if (error instanceof MemberMediaError) {
        throw new GiveawayPrizeMediaLifecycleError("INVALID_IMAGE");
      }
      throw error;
    }

    const mediaId = this.createUuid();
    requireSafeKeyComponent(mediaId);
    const finalizedAt = this.now();
    const storageKey =
      `media/giveaway-prizes/${input.prizePoolId}/${mediaId}.webp`;
    await persistence.registerCleanup({
      userId,
      storageKey,
      cleanupAfter: new Date(
        finalizedAt.getTime() + ABANDONED_FINALIZE_CLEANUP_DELAY_MS,
      ),
    });

    try {
      await this.store.putObject({
        key: storageKey,
        body: normalized.bytes,
        mimeType: normalized.mimeType,
      });
      await persistence.registerCleanup({
        userId,
        storageKey: input.tempKey,
        cleanupAfter: finalizedAt,
      });
      const image = await persistence.replaceFinalized({
        userId,
        giveawayId: input.giveawayId,
        prizePoolId: input.prizePoolId,
        mediaId,
        storageKey,
        mimeType: normalized.mimeType,
        width: normalized.width,
        height: normalized.height,
        finalizedAt,
      });
      await this.deleteIdempotently(input.tempKey).catch(() => undefined);
      return {
        mediaId: image.mediaId,
        url: `/giveaway-prize-media/${encodeURIComponent(image.mediaId)}`,
        width: image.width,
        height: image.height,
      };
    } catch (error) {
      let cleanupActivated = false;
      try {
        await persistence.activateCleanup({
          storageKey,
          cleanupAfter: this.now(),
        });
        cleanupActivated = true;
      } catch {
        // Persistence may have committed and removed the cleanup intent before
        // an acknowledgement failure. Without activation, object ownership is
        // ambiguous, so the recoverable choice is to leave it in storage.
      }
      if (cleanupActivated) {
        await this.deleteIdempotently(storageKey).catch(() => undefined);
      }
      throw error;
    }
  }

  async delete(
    userId: string,
    input: {
      giveawayId: string;
      prizePoolId: string;
      mediaId: string;
    },
    persistence: GiveawayPrizeMediaPersistence,
  ) {
    await persistence.authorizePool({
      userId,
      giveawayId: input.giveawayId,
      prizePoolId: input.prizePoolId,
    });
    const storageKey = await persistence.remove({ userId, ...input });
    await this.deleteIdempotently(storageKey).catch(() => undefined);
  }

  async read(
    descriptor: AuthorizedGiveawayPrizeMediaDescriptor,
  ): Promise<GiveawayPrizeMediaDelivery> {
    try {
      const object = await this.store.getObject(descriptor.storageKey);
      return {
        body: object.body,
        mimeType: descriptor.mimeType,
        contentLength: object.contentLength,
        visibility: descriptor.visibility,
      };
    } catch (error) {
      if (isNoSuchKey(error)) {
        throw new GiveawayPrizeMediaLifecycleError("MEDIA_UNAVAILABLE");
      }
      throw error;
    }
  }

  private async deleteIdempotently(storageKey: string) {
    try {
      await this.store.deleteObject(storageKey);
    } catch (error) {
      if (!isNoSuchKey(error)) throw error;
    }
  }
}
