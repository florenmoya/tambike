import type {
  MemberProfileEditorView,
  MemberProfileView,
  MotorcycleShowcase,
  ProfileVisibility,
  RosterIdentity,
  UpdateMemberProfileInput,
  UpsertMotorcycleInput,
} from "@/features/member-profiles/types";

export const MEMBER_PROFILE_LIMITS = {
  displayName: 80,
  area: 120,
  bio: 500,
  make: 80,
  model: 80,
  yearMin: 1885,
  yearMax: 2100,
  displacementCcMax: 10_000,
  nickname: 80,
  motorcycleDescription: 500,
} as const;

type Viewer = { role: "rider" | "organizer" | "admin"; ownsProfile: boolean } | null;

type InternalMotorcyclePhoto = {
  id?: string;
  mediaId: string;
  storageKey?: string;
  position: number;
  width: number;
  height: number;
};

type InternalMotorcycle = {
  id?: string;
  userId?: string;
  make: string;
  model: string;
  year?: number | null;
  displacementCc?: number | null;
  nickname?: string | null;
  description?: string | null;
  photos: InternalMotorcyclePhoto[];
};

export type InternalMemberProfile = {
  userId?: string;
  email?: string;
  passwordHash?: string;
  verificationStatus?: string;
  profilePhotoStorageKey?: string | null;
  slug: string;
  displayName: string;
  area: string;
  role: "rider" | "organizer" | "admin";
  bio?: string | null;
  visibility: ProfileVisibility;
  joinedAt: string;
  profilePhotoMediaId?: string | null;
  motorcycle?: InternalMotorcycle | null;
  hostedEventCount?: number;
};

export function canViewMemberProfile(viewer: Viewer, visibility: ProfileVisibility) {
  if (viewer?.ownsProfile || viewer?.role === "admin") return true;
  if (visibility === "PUBLIC") return true;
  return visibility === "MEMBERS_ONLY" && viewer !== null;
}

export function profileSlugBase(displayName: string) {
  return (
    displayName
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "rider"
  );
}

export function profileOwnerLockResource(userId: string) {
  return `tambike:member-profile-owner:${userId}`;
}

export function profileSlugLockResource(slugBase: string) {
  return `tambike:member-profile-slug:${slugBase}`;
}

export async function resolveStableProfileSlug(
  displayName: string,
  dependencies: {
    acquireOwnerLock: () => Promise<unknown>;
    readCurrentSlug: () => Promise<string | null>;
    acquireSlugLock: (slugBase: string) => Promise<unknown>;
    allocateSlug: (slugBase: string) => Promise<string>;
  },
) {
  await dependencies.acquireOwnerLock();
  const currentSlug = await dependencies.readCurrentSlug();
  if (currentSlug) return currentSlug;

  const base = profileSlugBase(displayName);
  await dependencies.acquireSlugLock(base);
  return dependencies.allocateSlug(base);
}

function invalidInput(): never {
  throw new Error("INVALID_INPUT");
}

function requiredString(value: unknown, maximum: number) {
  if (typeof value !== "string") invalidInput();
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) invalidInput();
  return normalized;
}

function optionalString(value: unknown, maximum: number) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") invalidInput();
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maximum) invalidInput();
  return normalized;
}

function optionalInteger(value: unknown, minimum: number, maximum: number) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalidInput();
  }
  return value as number;
}

export function parseProfileInput(input: UpdateMemberProfileInput): UpdateMemberProfileInput {
  if (!input || typeof input !== "object") invalidInput();
  if (!["PUBLIC", "MEMBERS_ONLY", "PRIVATE"].includes(input.visibility)) invalidInput();
  if (!["VISIBLE", "ANONYMOUS"].includes(input.defaultRosterIdentity)) invalidInput();

  return {
    displayName: requiredString(input.displayName, MEMBER_PROFILE_LIMITS.displayName),
    area: requiredString(input.area, MEMBER_PROFILE_LIMITS.area),
    bio: optionalString(input.bio, MEMBER_PROFILE_LIMITS.bio),
    visibility: input.visibility as ProfileVisibility,
    defaultRosterIdentity: input.defaultRosterIdentity as RosterIdentity,
  };
}

export function parseMotorcycleInput(input: UpsertMotorcycleInput): UpsertMotorcycleInput {
  if (!input || typeof input !== "object") invalidInput();
  return {
    make: requiredString(input.make, MEMBER_PROFILE_LIMITS.make),
    model: requiredString(input.model, MEMBER_PROFILE_LIMITS.model),
    year: optionalInteger(input.year, MEMBER_PROFILE_LIMITS.yearMin, MEMBER_PROFILE_LIMITS.yearMax),
    displacementCc: optionalInteger(input.displacementCc, 1, MEMBER_PROFILE_LIMITS.displacementCcMax),
    nickname: optionalString(input.nickname, MEMBER_PROFILE_LIMITS.nickname),
    description: optionalString(input.description, MEMBER_PROFILE_LIMITS.motorcycleDescription),
  };
}

function mediaUrl(mediaId: string) {
  return `/media/${encodeURIComponent(mediaId)}`;
}

function toMotorcycleShowcase(motorcycle: InternalMotorcycle): MotorcycleShowcase {
  return {
    make: motorcycle.make,
    model: motorcycle.model,
    year: motorcycle.year ?? undefined,
    displacementCc: motorcycle.displacementCc ?? undefined,
    nickname: motorcycle.nickname ?? undefined,
    description: motorcycle.description ?? undefined,
    photos: [...motorcycle.photos]
      .sort((left, right) => left.position - right.position)
      .slice(0, 5)
      .map((photo) => ({
        url: mediaUrl(photo.mediaId),
        position: photo.position,
        width: photo.width,
        height: photo.height,
      })),
  };
}

export function toMemberProfileView(profile: InternalMemberProfile): MemberProfileView {
  return {
    slug: profile.slug,
    displayName: profile.displayName,
    area: profile.area,
    role: profile.role,
    bio: profile.bio ?? undefined,
    visibility: profile.visibility,
    joinedAt: profile.joinedAt,
    profilePhotoUrl: profile.profilePhotoMediaId
      ? mediaUrl(profile.profilePhotoMediaId)
      : undefined,
    motorcycle: profile.motorcycle ? toMotorcycleShowcase(profile.motorcycle) : undefined,
    organizer:
      profile.role === "organizer"
        ? { hostedEventCount: profile.hostedEventCount ?? 0 }
        : undefined,
  };
}

export function toMemberProfileEditorView(
  profile: Omit<InternalMemberProfile, "slug"> & { slug: string | null },
  defaultRosterIdentity: RosterIdentity,
): MemberProfileEditorView {
  const view = toMemberProfileView({ ...profile, slug: profile.slug ?? "" });
  return {
    ...view,
    slug: profile.slug,
    defaultRosterIdentity,
    isPublished: profile.slug !== null,
  };
}
