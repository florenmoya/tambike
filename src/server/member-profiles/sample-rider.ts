import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

import type { UpdateMemberProfileInput, UpsertMotorcycleInput } from "@/features/member-profiles/types";
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
  | "INVARIANT_FAILED";

export class SampleRiderProvisioningError extends Error {
  constructor(public readonly code: SampleRiderProvisioningErrorCode) {
    super(code);
    this.name = "SampleRiderProvisioningError";
  }

  toJSON() {
    return { code: this.code };
  }
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

export interface SampleRiderDependencies {
  assertTargetEvent(eventId: string): Promise<void>;
  loadAsset(path: string): Promise<SampleRiderAsset>;
  upsertAccount(input: {
    email: string;
    passwordHash: string;
    displayName: string;
    area: string;
    role: "rider";
  }): Promise<SampleRiderContext>;
  updateProfile(context: SampleRiderContext, input: UpdateMemberProfileInput): Promise<void>;
  upsertMotorcycle(context: SampleRiderContext, input: UpsertMotorcycleInput): Promise<void>;
  ensureAvatar(context: SampleRiderContext, asset: SampleRiderAsset): Promise<void>;
  ensureMotorcyclePhoto(
    context: SampleRiderContext,
    position: number,
    asset: SampleRiderAsset,
  ): Promise<void>;
  registerForEvent(
    context: SampleRiderContext,
    eventId: string,
    input: { status: "going"; attendanceType: "direct"; rosterIdentity: "VISIBLE" },
  ): Promise<void>;
  inspectResult(context: SampleRiderContext, eventId: string): Promise<SampleRiderProvisioningResult>;
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

function assertExactResult(result: SampleRiderProvisioningResult) {
  if (
    !result.slug ||
    result.eventId !== SAMPLE_RIDER_EVENT_ID ||
    result.riders !== 1 ||
    result.motorcycles !== 1 ||
    result.avatars !== 1 ||
    result.motorcyclePhotos !== 5 ||
    result.rsvps !== 1 ||
    result.passes !== 1
  ) {
    throw new SampleRiderProvisioningError("INVARIANT_FAILED");
  }
}

export async function provisionSampleRider(
  input: ProvisionSampleRiderInput,
  dependencies: SampleRiderDependencies,
) {
  assertValidRequest(input);
  await dependencies.assertTargetEvent(input.manifest.eventId);

  let assets: SampleRiderAsset[];
  try {
    assets = await Promise.all(
      [input.manifest.avatar, ...input.manifest.motorcyclePhotos].map((path) =>
        dependencies.loadAsset(path),
      ),
    );
  } catch {
    throw new SampleRiderProvisioningError("ASSET_UNAVAILABLE");
  }

  const passwordHash = await bcrypt.hash(input.password!, 10);
  const context = await dependencies.upsertAccount({
    email: SAMPLE_RIDER_EMAIL,
    passwordHash,
    displayName: SAMPLE_RIDER_NAME,
    area: SAMPLE_RIDER_AREA,
    role: "rider",
  });

  try {
    await dependencies.updateProfile(context, sampleProfile);
    await dependencies.upsertMotorcycle(context, sampleMotorcycle);
    await dependencies.ensureAvatar(context, assets[0]);
    for (let position = 0; position < 5; position += 1) {
      await dependencies.ensureMotorcyclePhoto(context, position, assets[position + 1]);
    }
    await dependencies.registerForEvent(context, SAMPLE_RIDER_EVENT_ID, {
      status: "going",
      attendanceType: "direct",
      rosterIdentity: "VISIBLE",
    });
    const result = await dependencies.inspectResult(context, SAMPLE_RIDER_EVENT_ID);
    assertExactResult(result);
    return result;
  } finally {
    await dependencies.finish(context);
  }
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

function isMissingObject(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; Code?: string; code?: string };
  return candidate.name === "NoSuchKey" || candidate.Code === "NoSuchKey" || candidate.code === "NoSuchKey";
}

export interface PrismaSampleRiderProvisioner {
  dependencies: SampleRiderDependencies;
  close(): Promise<void>;
}

export function createPrismaSampleRiderProvisioner(
  databaseUrl: string,
  options: { store?: MemberMediaStore } = {},
): PrismaSampleRiderProvisioner {
  const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
  const store = options.store ?? createS3MemberMediaStore(loadMemberMediaConfig());
  const backend = PrismaTambikeBackend.create(databaseUrl, { memberMedia: { store } });

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
    asset: SampleRiderAsset,
    position?: number,
  ) => {
    const normalized = await normalizeMemberImage({
      body: asset.bytes,
      claimedMimeType: asset.mimeType,
      purpose,
    });
    const existing = await currentMedia(context.userId, purpose, position);
    if (existing?.storageKey && existing.width === normalized.width && existing.height === normalized.height) {
      try {
        const stored = await store.getObject(existing.storageKey);
        if ((await bodyToBuffer(stored.body)).equals(Buffer.from(normalized.bytes))) return;
      } catch (error) {
        if (!isMissingObject(error)) throw error;
      }
    }

    const tempKey = `tmp/users/${context.userId}/${randomUUID()}`;
    await store.putObject({ key: tempKey, body: asset.bytes, mimeType: asset.mimeType });
    try {
      await backend.finalizeMemberMedia(context.sessionToken, {
        purpose,
        tempKey,
        claimedMimeType: asset.mimeType,
        motorcyclePhotoPosition: position,
      });
    } catch (error) {
      try {
        await store.deleteObject(tempKey);
      } catch (cleanupError) {
        if (!isMissingObject(cleanupError)) throw cleanupError;
      }
      throw error;
    }
  };

  const dependencies: SampleRiderDependencies = {
    async assertTargetEvent(eventId) {
      const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
      if (!event) throw new SampleRiderProvisioningError("EVENT_NOT_FOUND");
    },
    loadAsset: loadLocalAsset,
    async upsertAccount(input) {
      const sessionToken = randomBytes(32).toString("base64url");
      const sessionId = `sample-rider-session-${randomUUID()}`;
      const user = await prisma.$transaction(async (tx) => {
        const lockName = `sample-rider-account:${input.email}`;
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))`);
        const account = await tx.user.upsert({
          where: { email: input.email },
          create: {
            id: `sample-rider-${randomUUID()}`,
            email: input.email,
            passwordHash: input.passwordHash,
            displayName: input.displayName,
            area: input.area,
            role: input.role,
            verificationStatus: "UNVERIFIED",
          },
          update: {
            passwordHash: input.passwordHash,
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
      await prisma.pass.updateMany({
        where: { id: registration.pass.id, userId: context.userId, eventId },
        data: { status: "active" },
      });
    },
    async inspectResult(context, eventId) {
      const [riders, user, motorcycles, motorcyclePhotos, rsvps, passes] = await Promise.all([
        prisma.user.count({ where: { email: SAMPLE_RIDER_EMAIL, role: "rider" } }),
        prisma.user.findUnique({
          where: { id: context.userId },
          select: { profileSlug: true, profilePhotoMediaId: true },
        }),
        prisma.motorcycle.count({ where: { userId: context.userId } }),
        prisma.motorcyclePhoto.count({ where: { motorcycle: { userId: context.userId } } }),
        prisma.rSVP.count({ where: { userId: context.userId, eventId, status: "going" } }),
        prisma.pass.count({
          where: { userId: context.userId, eventId, status: "active" },
        }),
      ]);
      return {
        slug: user?.profileSlug ?? "",
        eventId,
        riders,
        motorcycles,
        avatars: user?.profilePhotoMediaId ? 1 : 0,
        motorcyclePhotos,
        rsvps,
        passes,
      };
    },
    async finish(context) {
      if (context.sessionId) await prisma.session.deleteMany({ where: { id: context.sessionId } });
    },
  };

  return {
    dependencies,
    async close() {
      await Promise.all([backend.disconnect(), prisma.$disconnect()]);
    },
  };
}
