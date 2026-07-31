export type Role = "guest" | "rider" | "organizer" | "admin";

export type {
  EventAttendeeRosterPage,
  EventAttendeeSummary,
  MemberProfileEditorView,
  MemberProfileView,
  MotorcycleShowcase,
  ProfileVisibility,
  RosterIdentity,
  UpdateMemberProfileInput,
  UpsertMotorcycleInput,
} from "../member-profiles/types";

export type AccountRole = Exclude<Role, "guest">;

export type VerificationStatus =
  | "UNVERIFIED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED";

export type EventStatus =
  | "DRAFT"
  | "PENDING_ADMIN_REVIEW"
  | "PUBLISHED"
  | "ONGOING"
  | "COMPLETED"
  | "NEEDS_CHANGES"
  | "REJECTED"
  | "CANCELLED";

export type EventType =
  | "Tambike"
  | "Bike Night"
  | "Coffee Ride"
  | "Club EB"
  | "Brand Event"
  | "Test Ride"
  | "Charity Ride"
  | "Track Day"
  | "Endurance Ride"
  | "Moto Expo"
  | "Race";

export type AttendanceType = "direct" | "ride-out" | "club";

export type ScannerOutcome =
  | "idle"
  | "valid"
  | "already"
  | "wrong-event"
  | "cancelled"
  | "inactive";

export type ScanMethod =
  | "qr"
  | "manual"
  | "staff_camera"
  | "staff_upload"
  | "staff_manual"
  | "rider_qr";

export type CheckInMode = "staff_only" | "self_review" | "self_instant";

export type CheckInState = "closed" | "open" | "paused";

export type OrganizerQrMode = "rotating" | "fixed";

export type CheckInStatus = "pending" | "confirmed";

export interface CheckInConfiguration {
  mode: CheckInMode;
  state: CheckInState;
  qrMode: OrganizerQrMode;
  /** Required only when an organizer intentionally enables a lower-assurance fixed QR. */
  fixedQrAcknowledged?: boolean;
}

export interface EventCheckInSettings extends CheckInConfiguration {
  eventId: string;
  fixedQrAcknowledged: boolean;
}

export interface SelfCheckInQr {
  token: string;
  expiresAt?: string;
  qrMode: OrganizerQrMode;
}

export type ScanPassCode =
  | "CHECKED_IN"
  | "ALREADY_CHECKED_IN"
  | "WRONG_EVENT"
  | "CANCELLED_PASS"
  | "NOT_FOUND"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "ERROR";

export interface OrganizerProfile {
  id: string;
  displayName: string;
  type: string;
  fbLink: string;
  verificationStatus: VerificationStatus;
  pastEvents: number;
}

export interface UserProfile {
  id: string;
  displayName: string;
  email: string;
  role: AccountRole;
  verificationStatus: VerificationStatus;
  area: string;
  bikeModel?: string;
  clubName?: string;
  joinedAt: string;
  organizerProfileId?: string;
}

export interface ProfileInput {
  displayName: string;
  area: string;
  bikeModel?: string;
  clubName?: string;
}

export interface SignupInput extends ProfileInput {
  email: string;
  password: string;
}

export interface EventLocationInput {
  locationName: string;
  locationAddress: string;
  locationMapLink?: string;
  area: string;
}

export type EventRecurrence = "NONE" | "WEEKLY";

export interface EventScheduleInput {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timeZone: string;
  recurrence: EventRecurrence;
  recurrenceEndsOn?: string;
}

export interface EventSchedule {
  startsAt: string;
  endsAt: string;
  timeZone: string;
  recurrence: EventRecurrence;
  recurrenceEndsAt?: string;
}

export interface CreateEventInput extends EventLocationInput, EventScheduleInput {
  title: string;
  type: EventType;
  expectedRiders: number;
  perkPreview: string;
}

export interface Perk {
  id: string;
  type: string;
  description: string;
  quantity?: number;
}

export interface Event extends EventLocationInput {
  id: string;
  title: string;
  type: EventType;
  status: EventStatus;
  organizerId: string;
  poster: string;
  date: string;
  time: string;
  startsAt?: string;
  endsAt?: string;
  timeZone?: string;
  recurrence?: EventRecurrence;
  recurrenceEndsAt?: string;
  shortDescription: string;
  whatHappens: string;
  going: number;
  interested: number;
  expectedRiders: number;
  perkPreview: string;
  tags: string[];
  riskFlags: string[];
  rideOut?: {
    meetup: string;
    callTime: string;
    departure: string;
    destination: string;
    notes: string;
  };
  rules: string[];
  perks: Perk[];
  /** Confirmed arrivals only; pending self-review requests are intentionally excluded. */
  confirmedCheckIns?: number;
  pendingCheckIns?: number;
  sourceUrl?: string;
  sourceNote?: string;
}

export interface Approval {
  id: string;
  eventId: string;
  decision: "pending" | "approved" | "approved_with_conditions" | "published";
  reviewer: string;
  notes: string;
}

export interface RSVP {
  eventId: string;
  status: "interested" | "going";
  attendanceType: AttendanceType;
  clubName?: string;
  rosterIdentity?: import("../member-profiles/types").RosterIdentity;
}

export interface Pass {
  id: string;
  eventId: string;
  qrToken: string;
  status: "active" | "checked_in" | "cancelled";
  generatedAt: string;
}

export interface SelfCheckInContext {
  event: Event;
  mode: CheckInMode;
  state: CheckInState;
  qrMode: OrganizerQrMode;
  available: boolean;
}

export interface SelfCheckInResult {
  status: CheckInStatus;
  pass: Pass;
}

export type SelfCheckInCode =
  | "CHECKED_IN"
  | "PENDING_CONFIRMATION"
  | "SELF_CHECK_IN_DISABLED"
  | "CHECK_IN_NOT_OPEN"
  | "QR_EXPIRED"
  | "ALREADY_CHECKED_IN"
  | "CANCELLED_PASS"
  | "NOT_FOUND"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "ERROR";

export type SelfCheckInContextActionResult =
  | {
      ok: true;
      context: SelfCheckInContext;
    }
  | {
      ok: false;
      code: SelfCheckInCode;
      title: string;
      body: string;
    };

export interface DemoState {
  currentUser: UserProfile | null;
  users: UserProfile[];
  events: Event[];
  passes: Pass[];
  checkInSettings: EventCheckInSettings[];
  passCreated: boolean;
}

export interface SelfCheckInActionResult {
  ok: boolean;
  code: SelfCheckInCode;
  title: string;
  body: string;
  status?: CheckInStatus;
  pass?: Pass;
  state: DemoState;
}

export interface ScanPassResult {
  ok: boolean;
  code: ScanPassCode;
  outcome: ScannerOutcome;
  title: string;
  body: string;
  pass?: Pass;
  state: DemoState;
}

export interface CheckIn {
  eventId: string;
  passId: string;
  scannedBy?: string;
  timestamp: string;
  confirmedAt?: string;
  status: CheckInStatus;
  method: ScanMethod;
  confirmationMethod?: ScanMethod;
}

export interface ReportMetric {
  label: string;
  value: string;
  detail: string;
}
