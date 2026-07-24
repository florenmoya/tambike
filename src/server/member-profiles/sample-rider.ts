import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { Client as PgClient } from "pg";

import type { UpdateMemberProfileInput, UpsertMotorcycleInput } from "@/features/member-profiles/types";
import type { RegistrationInput } from "@/server/backend";
import { PrismaTambikeBackend } from "@/server/prisma-backend";
import { loadMemberMediaConfig } from "@/server/member-media/config";
import { normalizeMemberImage } from "@/server/member-media/image-normalizer";
import { createS3MemberMediaStore } from "@/server/member-media/s3-store";
import type { MemberMediaBody, MemberMediaStore } from "@/server/member-media/store";
import type { MemberImageMimeType } from "@/server/member-media/types";

const SAMPLE_RIDER_EMAIL = "mika.sample@tambike.ph";
const SAMPLE_RIDER_EVENT_ID = "tambike-cafe-classico";
const SAMPLE_RIDER_NAME = "Mika Santos — Sample Rider";
const SAMPLE_RIDER_AREA = "Davao City";
const SAMPLE_RIDER_LOCK_KEY = "tambike:production-sample-rider";

const sampleProfile: UpdateMemberProfileInput = {
  displayName: SAMPLE_RIDER_NAME,
  area: SAMPLE_RIDER_AREA,
  bio: "Weekend city rider, coffee-stop regular, and caretaker of a classic inline-four.",
  visibility: "PUBLIC",
  defaultRosterIdentity: "VISIBLE",
};

const sampleMotorcycle: UpsertMotorcycleInput = {
  make: "Honda",
  model: "CB400 Super Four",
  year: 1998,
  displacementCc: 399,
  nickname: "Sora",
  description: "A carefully maintained everyday classic built for relaxed city rides and tambike nights.",
};

export type SampleRiderProvisioningErrorCode =
  | "PRODUCTION_CONFIRMATION_REQUIRED"
  | "PASSWORD_REQUIRED"
  | "INVALID_EVENT"
  | "INVALID_ASSET_COUNT"
  | "ASSET_UNAVAILABLE"
  | "EVENT_NOT_FOUND"
  | "INVARIANT_FAILED"
  | "DIRECT_LOCK_URL_REQUIRED";

export class SampleRiderProvisioningError extends Error {
  constructor(public readonly code: SampleRiderProvisioningErrorCode) {
    super(code);
    this.name = "SampleRiderProvisioningError";
  }

  toJSON() {
    return { code: this.code };
  }
}

export class SampleRiderRecoveryError extends AggregateError {
  readonly code = "PROVISION_COMPENSATION_FAILED" as const;

  constructor(primary: unknown | null, recoveryFailures: unknown[]) {
    super(
      primary === null ? recoveryFailures : [primary, ...recoveryFailures],
      "PROVISION_COMPENSATION_FAILED",
    );
    this.name = "SampleRiderRecoveryError";
  }
}

export function toSampleRiderCliErrorCode(error: unknown) {
  if (error instanceof SampleRiderRecoveryError || error instanceof AggregateError) {
    return "PROVISION_COMPENSATION_FAILED";
  }
  if (error instanceof SampleRiderProvisioningError) return error.code;
  return "SAMPLE_RIDER_PROVISIONING_FAILED";
}

const RECOVERY_ATTEMPTS = 3;

export async function runSampleRiderRecoverySteps(
  steps: Array<() => Promise<void>>,
) {
  const terminalFailures: unknown[] = [];
  for (const step of steps) {
    const attemptFailures: unknown[] = [];
    for (let attempt = 0; attempt < RECOVERY_ATTEMPTS; attempt += 1) {
      try {
        await step();
        attemptFailures.length = 0;
        break;
      } catch (error) {
        attemptFailures.push(error);
      }
    }
    if (attemptFailures.length > 0) {
      terminalFailures.push(new AggregateError(attemptFailures, "RECOVERY_STEP_FAILED"));
    }
  }
  if (terminalFailures.length > 0) {
    throw new AggregateError(terminalFailures, "PROVISION_COMPENSATION_FAILED");
  }
}

export async function closeSampleRiderProvisionerResources(
  disconnectSteps: Array<() => Promise<void>>,
) {
  await runSampleRiderRecoverySteps(disconnectSteps);
}

export function collectSampleRiderCleanupKeys(
  currentKeys: Iterable<string>,
  generatedKeys: Iterable<string>,
  temporaryKeys: Iterable<string>,
  originalKeys: ReadonlySet<string>,
) {
  return [...new Set([...currentKeys, ...generatedKeys, ...temporaryKeys])]
    .filter((key) => !originalKeys.has(key));
}

export function validateDirectSampleRiderLockUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) throw new SampleRiderProvisioningError("DIRECT_LOCK_URL_REQUIRED");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new SampleRiderProvisioningError("DIRECT_LOCK_URL_REQUIRED");
  }
  const pooled =
    !["postgresql:", "postgres:"].includes(parsed.protocol) ||
    parsed.hostname.toLowerCase().includes("pooler") ||
    parsed.hostname.toLowerCase().includes("pgbouncer") ||
    parsed.port === "6543" ||
    parsed.searchParams.get("pgbouncer")?.toLowerCase() === "true" ||
    parsed.searchParams.get("pool_mode")?.toLowerCase() === "transaction";
  if (pooled) throw new SampleRiderProvisioningError("DIRECT_LOCK_URL_REQUIRED");
  return trimmed;
}

export interface SampleRiderManifest {
  eventId: string;
  avatar: string;
  motorcyclePhotos: string[];
}

export interface SampleRiderAsset {
  path: string;
  bytes: Uint8Array;
  mimeType: MemberImageMimeType;
}

export interface SampleRiderPreparedAsset extends SampleRiderAsset {
  purpose: "avatar" | "motorcycle-photo";
  normalizedBytes: Uint8Array;
  width: number;
  height: number;
  fingerprint: string;
}

export interface SampleRiderContext {
  userId: string;
  sessionToken: string;
  sessionId?: string;
}

export interface SampleRiderProvisioningResult {
  slug: string;
  eventId: string;
  riders: number;
  motorcycles: number;
  avatars: number;
  motorcyclePhotos: number;
  rsvps: number;
  passes: number;
}

export interface SampleRiderProvisioningVerification extends SampleRiderProvisioningResult {
  account: {
    displayName: string;
    area: string;
    role: string;
    passwordMatches: boolean;
  };
  profile: {
    bio?: string;
    visibility: string;
    defaultRosterIdentity: string;
  };
  motorcycle: null | {
    make: string;
    model: string;
    year?: number;
    displacementCc?: number;
    nickname?: string;
    description?: string;
  };
  avatarFingerprint: string;
  motorcyclePhotoFingerprints: Array<{ position: number; fingerprint: string }>;
  rsvp: null | { status: string; rosterIdentity: string };
  pass: null | { status: string };
}

export interface SampleRiderProvisioningLock {
  release(): Promise<void>;
}

export interface SampleRiderDependencies {
  acquireProvisioningLock(): Promise<SampleRiderProvisioningLock>;
  assertTargetEvent(eventId: string): Promise<void>;
  loadAsset(path: string): Promise<SampleRiderAsset>;
  preflightAsset(
    asset: SampleRiderAsset,
    purpose: "avatar" | "motorcycle-photo",
  ): Promise<SampleRiderPreparedAsset>;
  captureSnapshot(): Promise<unknown>;
  restoreSnapshot(snapshot: unknown): Promise<void>;
  upsertAccount(input: {
    email: string;
    password: string;
    passwordHash: string;
    displayName: string;
    area: string;
    role: "rider";
  }): Promise<SampleRiderContext>;
  updateProfile(context: SampleRiderContext, input: UpdateMemberProfileInput): Promise<void>;
  upsertMotorcycle(context: SampleRiderContext, input: UpsertMotorcycleInput): Promise<void>;
  ensureAvatar(context: SampleRiderContext, asset: SampleRiderPreparedAsset): Promise<void>;
  ensureMotorcyclePhoto(
    context: SampleRiderContext,
    position: number,
    asset: SampleRiderPreparedAsset,
  ): Promise<void>;
  registerForEvent(
    context: SampleRiderContext,
    eventId: string,
    input: RegistrationInput,
  ): Promise<void>;
  ensureActivePass(context: SampleRiderContext, eventId: string): Promise<void>;
  inspectResult(
    context: SampleRiderContext,
    eventId: string,
    password: string,
  ): Promise<SampleRiderProvisioningVerification>;
  finish(context: SampleRiderContext): Promise<void>;
}

export interface ProvisionSampleRiderInput {
  confirmedProduction: boolean;
  password: string | undefined;
  manifest: SampleRiderManifest;
}

function assertValidRequest(input: ProvisionSampleRiderInput) {
  if (!input.confirmedProduction) {
    throw new SampleRiderProvisioningError("PRODUCTION_CONFIRMATION_REQUIRED");
  }
  if (!input.password?.trim()) {
    throw new SampleRiderProvisioningError("PASSWORD_REQUIRED");
  }
  if (input.manifest.eventId !== SAMPLE_RIDER_EVENT_ID) {
    throw new SampleRiderProvisioningError("INVALID_EVENT");
  }
  if (
    !input.manifest.avatar?.trim() ||
    input.manifest.motorcyclePhotos.length !== 5 ||
    input.manifest.motorcyclePhotos.some((path) => !path?.trim())
  ) {
    throw new SampleRiderProvisioningError("INVALID_ASSET_COUNT");
  }
  const assetPaths = [input.manifest.avatar, ...input.manifest.motorcyclePhotos];
  if (new Set(assetPaths).size !== assetPaths.length) {
    throw new SampleRiderProvisioningError("INVALID_ASSET_COUNT");
  }
}

function assertExactResult(
  result: SampleRiderProvisioningVerification,
  avatar: SampleRiderPreparedAsset,
  motorcyclePhotos: SampleRiderPreparedAsset[],
) {
  if (
    !result.slug ||
    result.eventId !== SAMPLE_RIDER_EVENT_ID ||
    result.riders !== 1 ||
    result.motorcycles !== 1 ||
    result.avatars !== 1 ||
    result.motorcyclePhotos !== 5 ||
    result.rsvps !== 1 ||
    result.passes !== 1 ||
    result.account.displayName !== SAMPLE_RIDER_NAME ||
    result.account.area !== SAMPLE_RIDER_AREA ||
    result.account.role !== "rider" ||
    !result.account.passwordMatches ||
    result.profile.bio !== sampleProfile.bio ||
    result.profile.visibility !== sampleProfile.visibility ||
    result.profile.defaultRosterIdentity !== sampleProfile.defaultRosterIdentity ||
    !result.motorcycle ||
    result.motorcycle.make !== sampleMotorcycle.make ||
    result.motorcycle.model !== sampleMotorcycle.model ||
    result.motorcycle.year !== sampleMotorcycle.year ||
    result.motorcycle.displacementCc !== sampleMotorcycle.displacementCc ||
    result.motorcycle.nickname !== sampleMotorcycle.nickname ||
    result.motorcycle.description !== sampleMotorcycle.description ||
    result.avatarFingerprint !== avatar.fingerprint ||
    result.motorcyclePhotoFingerprints.length !== 5 ||
    result.motorcyclePhotoFingerprints.some(
      (photo, position) =>
        photo.position !== position || photo.fingerprint !== motorcyclePhotos[position]?.fingerprint,
    ) ||
    result.rsvp?.status !== "going" ||
    result.rsvp.rosterIdentity !== "VISIBLE" ||
    result.pass?.status !== "active"
  ) {
    throw new SampleRiderProvisioningError("INVARIANT_FAILED");
  }
}

export async function provisionSampleRider(
  input: ProvisionSampleRiderInput,
  dependencies: SampleRiderDependencies,
) {
  assertValidRequest(input);
  const lock = await dependencies.acquireProvisioningLock();
  let snapshot: unknown;
  let snapshotCaptured = false;
  let result: SampleRiderProvisioningResult | undefined;
  let primaryFailure: unknown | null = null;
  const recoveryFailures: unknown[] = [];
  try {
    await dependencies.assertTargetEvent(input.manifest.eventId);
    let preparedAssets: SampleRiderPreparedAsset[];
    try {
      const assets = await Promise.all(
        [input.manifest.avatar, ...input.manifest.motorcyclePhotos].map((path) =>
          dependencies.loadAsset(path),
        ),
      );
      preparedAssets = await Promise.all(
        assets.map((asset, index) =>
          dependencies.preflightAsset(asset, index === 0 ? "avatar" : "motorcycle-photo"),
        ),
      );
    } catch {
      throw new SampleRiderProvisioningError("ASSET_UNAVAILABLE");
    }
    const avatar = preparedAssets[0];
    const motorcyclePhotos = preparedAssets.slice(1);
    if (!avatar || motorcyclePhotos.length !== 5) {
      throw new SampleRiderProvisioningError("INVALID_ASSET_COUNT");
    }

    snapshot = await dependencies.captureSnapshot();
    snapshotCaptured = true;
    const passwordHash = await bcrypt.hash(input.password!, 10);
    const context = await dependencies.upsertAccount({
      email: SAMPLE_RIDER_EMAIL,
      password: input.password!,
      passwordHash,
      displayName: SAMPLE_RIDER_NAME,
      area: SAMPLE_RIDER_AREA,
      role: "rider",
    });
    await dependencies.updateProfile(context, sampleProfile);
    await dependencies.upsertMotorcycle(context, sampleMotorcycle);
    await dependencies.ensureAvatar(context, avatar);
    for (const [position, photo] of motorcyclePhotos.entries()) {
      await dependencies.ensureMotorcyclePhoto(context, position, photo);
    }
    await dependencies.registerForEvent(context, SAMPLE_RIDER_EVENT_ID, {
      status: "going",
      attendanceType: "direct",
    });
    await dependencies.ensureActivePass(context, SAMPLE_RIDER_EVENT_ID);
    const verification = await dependencies.inspectResult(
      context,
      SAMPLE_RIDER_EVENT_ID,
      input.password!,
    );
    assertExactResult(verification, avatar, motorcyclePhotos);
    await dependencies.finish(context);
    result = {
      slug: verification.slug,
      eventId: verification.eventId,
      riders: verification.riders,
      motorcycles: verification.motorcycles,
      avatars: verification.avatars,
      motorcyclePhotos: verification.motorcyclePhotos,
      rsvps: verification.rsvps,
      passes: verification.passes,
    };
  } catch (error) {
    primaryFailure = error;
    if (snapshotCaptured) {
      try {
        await dependencies.restoreSnapshot(snapshot);
      } catch (restoreError) {
        recoveryFailures.push(restoreError);
      }
    }
  }
  try {
    await lock.release();
  } catch (releaseError) {
    recoveryFailures.push(releaseError);
  }
  if (recoveryFailures.length > 0) {
    throw new SampleRiderRecoveryError(primaryFailure, recoveryFailures);
  }
  if (primaryFailure !== null) throw primaryFailure;
  if (!result) throw new SampleRiderProvisioningError("INVARIANT_FAILED");
  return result;
}

function mimeTypeForPath(path: string): MemberImageMimeType {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      throw new SampleRiderProvisioningError("ASSET_UNAVAILABLE");
  }
}

async function loadLocalAsset(path: string): Promise<SampleRiderAsset> {
  const file = await stat(path);
  if (!file.isFile() || file.size < 1) {
    throw new SampleRiderProvisioningError("ASSET_UNAVAILABLE");
  }
  return { path, bytes: await readFile(path), mimeType: mimeTypeForPath(path) };
}

async function bodyToBuffer(body: MemberMediaBody) {
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function fingerprintBytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("base64url");
}

export async function prepareSampleRiderAsset(
  asset: SampleRiderAsset,
  purpose: "avatar" | "motorcycle-photo",
): Promise<SampleRiderPreparedAsset> {
  const normalized = await normalizeMemberImage({
    body: asset.bytes,
    claimedMimeType: asset.mimeType,
    purpose,
  });
  return {
    ...asset,
    purpose,
    normalizedBytes: normalized.bytes,
    width: normalized.width,
    height: normalized.height,
    fingerprint: fingerprintBytes(normalized.bytes),
  };
}

function isMissingObject(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; Code?: string; code?: string };
  return candidate.name === "NoSuchKey" || candidate.Code === "NoSuchKey" || candidate.code === "NoSuchKey";
}

export interface PrismaSampleRiderProvisioner {
  dependencies: SampleRiderDependencies;
  close(): Promise<void>;
}

export interface SampleRiderLockClient {
  connect(): Promise<unknown>;
  query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

export function createPrismaSampleRiderProvisioner(
  runtimeDatabaseUrl: string,
  directLockDatabaseUrl: string,
  options: {
    store?: MemberMediaStore;
    createLockClient?: (connectionString: string) => SampleRiderLockClient;
  } = {},
): PrismaSampleRiderProvisioner {
  const directUrl = validateDirectSampleRiderLockUrl(directLockDatabaseUrl);
  const prisma = new PrismaClient({ adapter: new PrismaPg(runtimeDatabaseUrl) });
  const store = options.store ?? createS3MemberMediaStore(loadMemberMediaConfig());
  const operationGeneratedKeys = new Set<string>();
  const operationTempKeys = new Set<string>();
  let pendingFinalization: {
    userId: string;
    purpose: "avatar" | "motorcycle-photo";
  } | null = null;
  const backend = PrismaTambikeBackend.create(runtimeDatabaseUrl, {
    memberMedia: {
      store,
      createUuid: () => {
        const mediaId = randomUUID();
        if (pendingFinalization) {
          const folder = pendingFinalization.purpose === "avatar" ? "avatar" : "motorcycles";
          operationGeneratedKeys.add(
            `media/users/${pendingFinalization.userId}/${folder}/${mediaId}.webp`,
          );
        }
        return mediaId;
      },
    },
  });
  const createLockClient =
    options.createLockClient ??
    ((connectionString: string): SampleRiderLockClient =>
      new PgClient({ connectionString }) as SampleRiderLockClient);

  const currentMedia = async (userId: string, purpose: "avatar" | "motorcycle-photo", position?: number) => {
    if (purpose === "avatar") {
      return prisma.user.findUnique({
        where: { id: userId },
        select: {
          profilePhotoMediaId: true,
          profilePhotoStorageKey: true,
          profilePhotoWidth: true,
          profilePhotoHeight: true,
        },
      }).then((user) => user?.profilePhotoMediaId && user.profilePhotoStorageKey ? {
        mediaId: user.profilePhotoMediaId,
        storageKey: user.profilePhotoStorageKey,
        width: user.profilePhotoWidth,
        height: user.profilePhotoHeight,
      } : null);
    }
    return prisma.motorcyclePhoto.findFirst({
      where: { motorcycle: { userId }, position },
      select: { mediaId: true, storageKey: true, width: true, height: true },
    });
  };

  const ensureMedia = async (
    context: SampleRiderContext,
    purpose: "avatar" | "motorcycle-photo",
    asset: SampleRiderPreparedAsset,
    position?: number,
  ) => {
    const existing = await currentMedia(context.userId, purpose, position);
    if (existing?.storageKey && existing.width === asset.width && existing.height === asset.height) {
      try {
        const stored = await store.getObject(existing.storageKey);
        if (fingerprintBytes(await bodyToBuffer(stored.body)) === asset.fingerprint) return;
      } catch (error) {
        if (!isMissingObject(error)) throw error;
      }
    }

    const tempKey = `tmp/users/${context.userId}/${randomUUID()}`;
    operationTempKeys.add(tempKey);
    await store.putObject({ key: tempKey, body: asset.bytes, mimeType: asset.mimeType });
    try {
      pendingFinalization = { userId: context.userId, purpose };
      try {
        await backend.finalizeMemberMedia(context.sessionToken, {
          purpose,
          tempKey,
          claimedMimeType: asset.mimeType,
          motorcyclePhotoPosition: position,
        });
      } finally {
        pendingFinalization = null;
      }
      operationTempKeys.delete(tempKey);
    } catch (error) {
      try {
        await runSampleRiderRecoverySteps([
          async () => {
            try {
              await store.deleteObject(tempKey);
            } catch (cleanupError) {
              if (!isMissingObject(cleanupError)) throw cleanupError;
            }
          },
        ]);
        operationTempKeys.delete(tempKey);
      } catch (cleanupError) {
        throw new SampleRiderRecoveryError(error, [cleanupError]);
      }
      throw error;
    }
  };

  const captureSnapshot = async () => {
    const user = await prisma.user.findUnique({
      where: { email: SAMPLE_RIDER_EMAIL },
      include: {
        motorcycle: { include: { photos: { orderBy: { position: "asc" } } } },
        rsvps: {
          where: { eventId: SAMPLE_RIDER_EVENT_ID },
          include: { pass: true },
        },
      },
    });
    const mediaKeys = user
      ? [
          user.profilePhotoStorageKey,
          ...(user.motorcycle?.photos.map((photo) => photo.storageKey) ?? []),
        ].filter((key): key is string => Boolean(key))
      : [];
    const mediaObjects = await Promise.all(mediaKeys.map(async (key) => {
      try {
        const object = await store.getObject(key);
        return { key, bytes: await bodyToBuffer(object.body) };
      } catch (error) {
        if (isMissingObject(error)) return { key, bytes: null };
        throw error;
      }
    }));
    const auditIds = user
      ? (await prisma.auditLog.findMany({
          where: { actorUserId: user.id },
          select: { id: true },
        })).map((audit) => audit.id)
      : [];
    return { user, mediaObjects, auditIds };
  };

  type PrismaSampleRiderSnapshot = Awaited<ReturnType<typeof captureSnapshot>>;

  const restoreSnapshot = async (snapshot: PrismaSampleRiderSnapshot) => {
    const originalKeys = new Set(snapshot.mediaObjects.map((object) => object.key));
    const cleanupKeys = collectSampleRiderCleanupKeys(
      [],
      operationGeneratedKeys,
      operationTempKeys,
      originalKeys,
    );

    const recoverySteps: Array<() => Promise<void>> = snapshot.mediaObjects.map((object) =>
      async () => {
        if (object.bytes) {
          await store.putObject({ key: object.key, body: object.bytes, mimeType: "image/webp" });
          return;
        }
        try {
          await store.deleteObject(object.key);
        } catch (error) {
          if (!isMissingObject(error)) throw error;
        }
      });

    recoverySteps.push(async () => {
      await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { email: SAMPLE_RIDER_EMAIL },
        include: { motorcycle: { include: { photos: true } } },
      });
      if (current) {
        await tx.auditLog.deleteMany({
          where: {
            actorUserId: current.id,
            ...(snapshot.auditIds.length > 0 ? { id: { notIn: snapshot.auditIds } } : {}),
          },
        });
      }
      if (!snapshot.user) {
        if (current) await tx.user.delete({ where: { id: current.id } });
        return;
      }

      const original = snapshot.user;
      await tx.user.update({
        where: { id: original.id },
        data: {
          displayName: original.displayName,
          passwordHash: original.passwordHash,
          role: original.role,
          verificationStatus: original.verificationStatus,
          area: original.area,
          bikeModel: original.bikeModel,
          clubName: original.clubName,
          profileSlug: original.profileSlug,
          profileBio: original.profileBio,
          profileVisibility: original.profileVisibility,
          defaultRosterIdentity: original.defaultRosterIdentity,
          profilePhotoMediaId: original.profilePhotoMediaId,
          profilePhotoStorageKey: original.profilePhotoStorageKey,
          profilePhotoMimeType: original.profilePhotoMimeType,
          profilePhotoWidth: original.profilePhotoWidth,
          profilePhotoHeight: original.profilePhotoHeight,
          profilePhotoFinalizedAt: original.profilePhotoFinalizedAt,
          createdAt: original.createdAt,
          updatedAt: original.updatedAt,
        },
      });

      const currentMotorcycle = await tx.motorcycle.findUnique({ where: { userId: original.id } });
      if (!original.motorcycle) {
        if (currentMotorcycle) await tx.motorcycle.delete({ where: { id: currentMotorcycle.id } });
      } else {
        const motorcycle = original.motorcycle;
        if (currentMotorcycle && currentMotorcycle.id !== motorcycle.id) {
          await tx.motorcycle.delete({ where: { id: currentMotorcycle.id } });
        }
        await tx.motorcycle.upsert({
          where: { userId: original.id },
          create: {
            id: motorcycle.id,
            userId: original.id,
            make: motorcycle.make,
            model: motorcycle.model,
            year: motorcycle.year,
            displacementCc: motorcycle.displacementCc,
            nickname: motorcycle.nickname,
            description: motorcycle.description,
            createdAt: motorcycle.createdAt,
            updatedAt: motorcycle.updatedAt,
          },
          update: {
            make: motorcycle.make,
            model: motorcycle.model,
            year: motorcycle.year,
            displacementCc: motorcycle.displacementCc,
            nickname: motorcycle.nickname,
            description: motorcycle.description,
            createdAt: motorcycle.createdAt,
            updatedAt: motorcycle.updatedAt,
          },
        });
        await tx.motorcyclePhoto.deleteMany({ where: { motorcycleId: motorcycle.id } });
        if (motorcycle.photos.length > 0) {
          await tx.motorcyclePhoto.createMany({
            data: motorcycle.photos.map((photo) => ({
              id: photo.id,
              motorcycleId: motorcycle.id,
              position: photo.position,
              mediaId: photo.mediaId,
              storageKey: photo.storageKey,
              mimeType: photo.mimeType,
              width: photo.width,
              height: photo.height,
              finalizedAt: photo.finalizedAt,
              createdAt: photo.createdAt,
            })),
          });
        }
      }

      const originalRsvp = original.rsvps[0];
      const currentRsvp = await tx.rSVP.findUnique({
        where: { eventId_userId: { eventId: SAMPLE_RIDER_EVENT_ID, userId: original.id } },
        include: { pass: true },
      });
      if (!originalRsvp) {
        if (currentRsvp) await tx.rSVP.delete({ where: { id: currentRsvp.id } });
      } else {
        if (currentRsvp && currentRsvp.id !== originalRsvp.id) {
          await tx.rSVP.delete({ where: { id: currentRsvp.id } });
        }
        await tx.rSVP.upsert({
          where: { eventId_userId: { eventId: originalRsvp.eventId, userId: original.id } },
          create: {
            id: originalRsvp.id,
            eventId: originalRsvp.eventId,
            userId: original.id,
            status: originalRsvp.status,
            goingAt: originalRsvp.goingAt,
            attendanceType: originalRsvp.attendanceType,
            companions: originalRsvp.companions,
            clubName: originalRsvp.clubName,
            rosterIdentity: originalRsvp.rosterIdentity,
            createdAt: originalRsvp.createdAt,
            updatedAt: originalRsvp.updatedAt,
          },
          update: {
            status: originalRsvp.status,
            goingAt: originalRsvp.goingAt,
            attendanceType: originalRsvp.attendanceType,
            companions: originalRsvp.companions,
            clubName: originalRsvp.clubName,
            rosterIdentity: originalRsvp.rosterIdentity,
            createdAt: originalRsvp.createdAt,
            updatedAt: originalRsvp.updatedAt,
          },
        });
        const originalPass = originalRsvp.pass;
        const restoredRsvp = await tx.rSVP.findUniqueOrThrow({ where: { id: originalRsvp.id } });
        const currentPass = await tx.pass.findUnique({ where: { rsvpId: restoredRsvp.id } });
        if (!originalPass) {
          if (currentPass) await tx.pass.delete({ where: { id: currentPass.id } });
        } else if (currentPass?.id === originalPass.id) {
          await tx.pass.update({
            where: { id: originalPass.id },
            data: {
              qrTokenHash: originalPass.qrTokenHash,
              status: originalPass.status,
              generatedAt: originalPass.generatedAt,
              checkedInAt: originalPass.checkedInAt,
            },
          });
        } else {
          if (currentPass) await tx.pass.delete({ where: { id: currentPass.id } });
          await tx.pass.create({
            data: {
              id: originalPass.id,
              eventId: originalPass.eventId,
              userId: original.id,
              rsvpId: originalRsvp.id,
              qrTokenHash: originalPass.qrTokenHash,
              status: originalPass.status,
              generatedAt: originalPass.generatedAt,
              checkedInAt: originalPass.checkedInAt,
            },
          });
        }
      }
      await tx.session.deleteMany({
        where: { userId: original.id, id: { startsWith: "sample-rider-session-" } },
      });
      });
    });

    for (const key of cleanupKeys) {
      recoverySteps.push(async () => {
        try {
          await store.deleteObject(key);
        } catch (error) {
          if (!isMissingObject(error)) throw error;
        }
      });
    }
    await runSampleRiderRecoverySteps(recoverySteps);
    operationGeneratedKeys.clear();
    operationTempKeys.clear();
  };

  const dependencies: SampleRiderDependencies = {
    async acquireProvisioningLock() {
      const client = createLockClient(directUrl);
      try {
        await client.connect();
        await client.query(
          "SELECT pg_advisory_lock(hashtextextended($1, 0))",
          [SAMPLE_RIDER_LOCK_KEY],
        );
      } catch (error) {
        try {
          await runSampleRiderRecoverySteps([() => client.end()]);
        } catch (cleanupError) {
          throw new SampleRiderRecoveryError(error, [cleanupError]);
        }
        throw error;
      }
      let released = false;
      return {
        async release() {
          if (released) return;
          try {
            await runSampleRiderRecoverySteps([
              async () => {
                const result = await client.query(
                  "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
                  [SAMPLE_RIDER_LOCK_KEY],
                );
                if (result.rows[0]?.unlocked !== true) {
                  throw new Error("ADVISORY_LOCK_RELEASE_FAILED");
                }
              },
              () => client.end(),
            ]);
          } finally {
            released = true;
          }
        },
      };
    },
    async assertTargetEvent(eventId) {
      const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
      if (!event) throw new SampleRiderProvisioningError("EVENT_NOT_FOUND");
    },
    loadAsset: loadLocalAsset,
    preflightAsset: prepareSampleRiderAsset,
    captureSnapshot,
    restoreSnapshot: (snapshot) => restoreSnapshot(snapshot as PrismaSampleRiderSnapshot),
    async upsertAccount(input) {
      const sessionToken = randomBytes(32).toString("base64url");
      const sessionId = `sample-rider-session-${randomUUID()}`;
      const user = await prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({
          where: { email: input.email },
          select: { passwordHash: true },
        });
        const passwordHash =
          existing && await bcrypt.compare(input.password, existing.passwordHash)
            ? existing.passwordHash
            : input.passwordHash;
        const account = await tx.user.upsert({
          where: { email: input.email },
          create: {
            id: `sample-rider-${randomUUID()}`,
            email: input.email,
            passwordHash,
            displayName: input.displayName,
            area: input.area,
            role: input.role,
            verificationStatus: "UNVERIFIED",
          },
          update: {
            passwordHash,
            displayName: input.displayName,
            area: input.area,
            role: input.role,
            verificationStatus: "UNVERIFIED",
          },
          select: { id: true },
        });
        await tx.session.create({
          data: {
            id: sessionId,
            tokenHash: createHash("sha256").update(sessionToken).digest("base64url"),
            userId: account.id,
            expiresAt: new Date(Date.now() + 15 * 60 * 1_000),
          },
        });
        return account;
      });
      return { userId: user.id, sessionToken, sessionId };
    },
    async updateProfile(context, input) {
      await backend.updateMemberProfile(context.sessionToken, input);
    },
    async upsertMotorcycle(context, input) {
      await backend.upsertMotorcycle(context.sessionToken, input);
    },
    ensureAvatar: (context, asset) => ensureMedia(context, "avatar", asset),
    ensureMotorcyclePhoto: (context, position, asset) =>
      ensureMedia(context, "motorcycle-photo", asset, position),
    async registerForEvent(context, eventId, input) {
      const registration = await backend.registerForEvent(context.sessionToken, eventId, input);
      if (!registration.pass) throw new SampleRiderProvisioningError("INVARIANT_FAILED");
    },
    async ensureActivePass(context, eventId) {
      await prisma.pass.updateMany({
        where: { userId: context.userId, eventId },
        data: { status: "active" },
      });
    },
    async inspectResult(context, eventId, password) {
      const [riders, user, motorcycles, motorcyclePhotoCount, rsvps, passes] = await Promise.all([
        prisma.user.count({ where: { email: SAMPLE_RIDER_EMAIL, role: "rider" } }),
        prisma.user.findUnique({
          where: { id: context.userId },
          include: {
            motorcycle: { include: { photos: { orderBy: { position: "asc" } } } },
            rsvps: { where: { eventId }, include: { pass: true } },
          },
        }),
        prisma.motorcycle.count({ where: { userId: context.userId } }),
        prisma.motorcyclePhoto.count({ where: { motorcycle: { userId: context.userId } } }),
        prisma.rSVP.count({ where: { userId: context.userId, eventId, status: "going" } }),
        prisma.pass.count({
          where: { userId: context.userId, eventId, status: "active" },
        }),
      ]);
      if (!user?.profilePhotoStorageKey) throw new SampleRiderProvisioningError("INVARIANT_FAILED");
      const avatarObject = await store.getObject(user.profilePhotoStorageKey);
      const photoFingerprints = await Promise.all(
        (user.motorcycle?.photos ?? []).map(async (photo) => ({
          position: photo.position,
          fingerprint: fingerprintBytes(await bodyToBuffer((await store.getObject(photo.storageKey)).body)),
        })),
      );
      const rsvp = user.rsvps[0];
      return {
        slug: user.profileSlug ?? "",
        eventId,
        riders,
        motorcycles,
        avatars: user.profilePhotoMediaId ? 1 : 0,
        motorcyclePhotos: motorcyclePhotoCount,
        rsvps,
        passes,
        account: {
          displayName: user.displayName,
          area: user.area,
          role: user.role,
          passwordMatches: await bcrypt.compare(password, user.passwordHash),
        },
        profile: {
          bio: user.profileBio ?? undefined,
          visibility: user.profileVisibility,
          defaultRosterIdentity: user.defaultRosterIdentity,
        },
        motorcycle: user.motorcycle ? {
          make: user.motorcycle.make,
          model: user.motorcycle.model,
          year: user.motorcycle.year ?? undefined,
          displacementCc: user.motorcycle.displacementCc ?? undefined,
          nickname: user.motorcycle.nickname ?? undefined,
          description: user.motorcycle.description ?? undefined,
        } : null,
        avatarFingerprint: fingerprintBytes(await bodyToBuffer(avatarObject.body)),
        motorcyclePhotoFingerprints: photoFingerprints,
        rsvp: rsvp ? { status: rsvp.status, rosterIdentity: rsvp.rosterIdentity } : null,
        pass: rsvp?.pass ? { status: rsvp.pass.status } : null,
      };
    },
    async finish(context) {
      if (context.sessionId) await prisma.session.deleteMany({ where: { id: context.sessionId } });
      operationGeneratedKeys.clear();
      operationTempKeys.clear();
    },
  };

  return {
    dependencies,
    async close() {
      await closeSampleRiderProvisionerResources([
        () => backend.disconnect(),
        () => prisma.$disconnect(),
      ]);
    },
  };
}
