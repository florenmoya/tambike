export type ProfileVisibility = "PUBLIC" | "MEMBERS_ONLY" | "PRIVATE";

export type RosterIdentity = "VISIBLE" | "ANONYMOUS";

export interface MotorcycleShowcase {
  make: string;
  model: string;
  year?: number;
  displacementCc?: number;
  nickname?: string;
  description?: string;
  photos: Array<{ url: string; position: number; width: number; height: number }>;
}

export interface MemberProfileView {
  slug: string;
  displayName: string;
  area: string;
  role: "rider" | "organizer" | "admin";
  bio?: string;
  visibility: ProfileVisibility;
  joinedAt: string;
  profilePhotoUrl?: string;
  motorcycle?: MotorcycleShowcase;
  organizer?: { hostedEventCount: number };
}

export interface MemberProfileEditorView extends Omit<MemberProfileView, "slug"> {
  slug: string | null;
  defaultRosterIdentity: RosterIdentity;
  isPublished: boolean;
}

export interface EventAttendeeSummary {
  eventId: string;
  eventTitle: string;
  rosterEnabled: boolean;
  goingCount: number;
  visibleCount: number;
  anonymousCount: number;
}

export interface EventAttendeeRosterPage {
  summary: EventAttendeeSummary;
  attendees: Array<
    Pick<MemberProfileView, "slug" | "displayName" | "area" | "profilePhotoUrl" | "motorcycle">
  >;
  nextCursor?: string;
  pageSize: number;
}

export interface UpdateMemberProfileInput {
  displayName: string;
  area: string;
  bio?: string;
  visibility: ProfileVisibility;
  defaultRosterIdentity: RosterIdentity;
}

export interface UpsertMotorcycleInput {
  make: string;
  model: string;
  year?: number;
  displacementCc?: number;
  nickname?: string;
  description?: string;
}

export interface RosterIdentityInput {
  rosterIdentity: RosterIdentity;
}
