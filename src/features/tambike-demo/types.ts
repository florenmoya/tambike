export type Role = "guest" | "rider" | "organizer" | "venue" | "admin";

export type AccountRole = Exclude<Role, "guest">;

export type VerificationStatus =
  | "UNVERIFIED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED";

export type EventStatus =
  | "DRAFT"
  | "PENDING_VENUE_APPROVAL"
  | "PENDING_ADMIN_REVIEW"
  | "PUBLISHED"
  | "ONGOING"
  | "COMPLETED"
  | "NEEDS_CHANGES";

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

export interface Venue {
  id: string;
  name: string;
  area: string;
  address: string;
  mapLink: string;
  capacityNote: string;
  status: VerificationStatus;
  houseRules: string[];
}

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
  venueId?: string;
}

export interface ProfileInput {
  displayName: string;
  area: string;
  bikeModel?: string;
  clubName?: string;
}

export interface SignupInput extends ProfileInput {
  email: string;
}

export interface CreateEventInput {
  title: string;
  type: EventType;
  venueId: string;
  date: string;
  time: string;
  area: string;
  expectedRiders: number;
  perkPreview: string;
}

export interface Perk {
  id: string;
  type: string;
  description: string;
  quantity?: number;
}

export interface Event {
  id: string;
  title: string;
  type: EventType;
  status: EventStatus;
  organizerId: string;
  venueId: string;
  poster: string;
  date: string;
  time: string;
  area: string;
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
  sourceUrl?: string;
  sourceNote?: string;
}

export interface Approval {
  id: string;
  eventId: string;
  type: "venue" | "admin";
  decision: "pending" | "approved" | "approved_with_conditions" | "published";
  reviewer: string;
  notes: string;
}

export interface RSVP {
  eventId: string;
  status: "interested" | "going";
  attendanceType: AttendanceType;
  clubName?: string;
}

export interface Pass {
  id: string;
  eventId: string;
  qrToken: string;
  status: "active" | "checked_in" | "cancelled";
  generatedAt: string;
}

export interface CheckIn {
  eventId: string;
  passId: string;
  scannedBy: string;
  timestamp: string;
  method: "qr" | "manual";
}

export interface ReportMetric {
  label: string;
  value: string;
  detail: string;
}
