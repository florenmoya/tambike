import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaTambikeBackend } from "./prisma-backend";
import { getRuntimeDatabaseUrl } from "./database-url";
import { demoEvents, mockUsers, venues } from "@/features/tambike-demo/data";
import {
  filterEventsByQuery,
  getEventCtaState,
  type EventQueryInput,
} from "@/features/tambike-demo/event-state";
import type {
  AccountRole,
  AttendanceType,
  CheckInConfiguration,
  CheckInMode,
  CheckInState,
  CheckInStatus,
  CreateEventInput,
  Event,
  EventType,
  OrganizerQrMode,
  Pass,
  ProfileInput,
  RSVP,
  ScanMethod,
  SelfCheckInContext,
  SelfCheckInQr,
  SelfCheckInResult,
  SignupInput,
  UserProfile,
} from "@/features/tambike-demo/types";

export class BackendError extends Error {
  constructor(
    public readonly code:
      | "UNAUTHENTICATED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "WRONG_EVENT"
      | "ALREADY_CHECKED_IN"
      | "CANCELLED_PASS"
      | "SELF_CHECK_IN_DISABLED"
      | "CHECK_IN_NOT_OPEN"
      | "QR_EXPIRED",
    message = code,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

export type RegistrationInput = {
  status: "interested" | "going";
  attendanceType: AttendanceType;
  clubName?: string;
};

export type SignupWithPasswordInput = SignupInput & {
  password: string;
};

export type AuditAction =
  | "USER_CREATED"
  | "SESSION_CREATED"
  | "PROFILE_UPDATED"
  | "EVENT_DRAFT_CREATED"
  | "RSVP_UPDATED"
  | "PASS_CREATED"
  | "CHECK_IN_CREATED"
  | "CHECK_IN_CONFIRMED"
  | "CHECK_IN_SETTINGS_UPDATED"
  | "SELF_CHECK_IN_REQUESTED"
  | "VENUE_APPROVED"
  | "ADMIN_PUBLISHED"
  | "ATTENDEE_EXPORT_CREATED"
  | "LEAD_EXPORT_CREATED";

type BackendUser = UserProfile & {
  passwordHash: string;
};

type SessionRecord = {
  token: string;
  userId: string;
  createdAt: Date;
};

type CheckInRecord = {
  id: string;
  eventId: string;
  passId: string;
  userId: string;
  scannedBy?: string;
  timestamp: string;
  confirmedAt?: string;
  status: CheckInStatus;
  method: ScanMethod;
  confirmationMethod?: ScanMethod;
};

type CheckInSettings = {
  eventId: string;
  mode: CheckInMode;
  state: CheckInState;
  qrMode: OrganizerQrMode;
  fixedQrAcknowledged: boolean;
};

type SelfCheckInSession = {
  eventId: string;
  expiresAt: number;
  revokedAt?: number;
};

type AuditRecord = {
  id: string;
  action: AuditAction;
  actorUserId?: string;
  targetId?: string;
  createdAt: Date;
};

type BackendSeed = {
  users: BackendUser[];
  events: Event[];
  rsvps: Array<RSVP & { userId: string }>;
  passes: Array<Pass & { userId: string }>;
};

const demoScannerPass = {
  eventId: "arai-hjc-charity-ride",
  userId: "user-demo-scan-rider",
  passId: "pass-arai-hjc-charity-ride-user-demo-scan-rider",
  qrToken: "tbk_yKZKcLiDPmQ91TgS-eqvp4hLRR2PBumJtKt6e2HMA0s",
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cloneEvent(event: Event): Event {
  return {
    ...event,
    tags: [...event.tags],
    riskFlags: [...event.riskFlags],
    rules: [...event.rules],
    perks: event.perks.map((perk) => ({ ...perk })),
    rideOut: event.rideOut ? { ...event.rideOut } : undefined,
  };
}

function cloneUser(user: UserProfile): UserProfile {
  return { ...user };
}

function makeSessionToken() {
  return randomBytes(32).toString("base64url");
}

function makePassToken() {
  return `tbk_${randomBytes(32).toString("base64url")}`;
}

function validateSignupPassword(password: string) {
  if (password.trim().length < 8) {
    throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
  }
}

function validateCheckInConfiguration(input: CheckInConfiguration) {
  if (
    !["staff_only", "self_review", "self_instant"].includes(input.mode) ||
    !["closed", "open", "paused"].includes(input.state) ||
    !["rotating", "fixed"].includes(input.qrMode) ||
    (input.qrMode === "fixed" && input.fixedQrAcknowledged !== true)
  ) {
    throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
  }
}

function normalizeStaffScanMethod(method: ScanMethod): "staff_camera" | "staff_upload" | "staff_manual" {
  switch (method) {
    case "staff_camera":
    case "staff_upload":
    case "staff_manual":
      return method;
    case "qr":
      return "staff_camera";
    case "manual":
      return "staff_manual";
    default:
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
  }
}

function passIdForEvent(eventId: string, userId: string) {
  return `pass-${eventId}-${userId}`;
}

function defaultRulesForEvent(type: EventType) {
  const baseRules = ["Helmet required", "No racing", "No stunts", "No revving"];
  if (type === "Track Day" || type === "Race") {
    return [...baseRules, "Follow marshal instructions"];
  }

  return [...baseRules, "Respect venue staff"];
}

async function createSeed(): Promise<BackendSeed> {
  const passwordHash = await bcrypt.hash("password123", 10);
  const adminPasswordHash = await bcrypt.hash("secret_123", 10);
  const users: BackendUser[] = [
    ...mockUsers.map<BackendUser>((user) => ({
      ...user,
      passwordHash: user.role === "admin" ? adminPasswordHash : passwordHash,
    })),
    {
      id: demoScannerPass.userId,
      displayName: "Seeded Scan Rider",
      email: "scan-rider@seed.tambike.local",
      role: "rider",
      verificationStatus: "UNVERIFIED",
      area: "Antipolo",
      joinedAt: "July 9, 2026",
      passwordHash,
    },
  ];

  return {
    users,
    events: demoEvents.map(cloneEvent),
    rsvps: [
      {
        eventId: demoScannerPass.eventId,
        userId: demoScannerPass.userId,
        status: "going",
        attendanceType: "direct",
        clubName: "Weekend Tambike Crew",
      },
    ],
    passes: [
      {
        id: demoScannerPass.passId,
        eventId: demoScannerPass.eventId,
        userId: demoScannerPass.userId,
        qrToken: demoScannerPass.qrToken,
        status: "active",
        generatedAt: "2026-07-09T00:00:00.000Z",
      },
    ],
  };
}

export class TambikeBackend {
  private readonly users = new Map<string, BackendUser>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly events = new Map<string, Event>();
  private readonly rsvps = new Map<string, RSVP & { userId: string }>();
  private readonly passes = new Map<string, Pass & { userId: string }>();
  private readonly checkIns = new Map<string, CheckInRecord>();
  private readonly checkInSettings = new Map<string, CheckInSettings>();
  private readonly selfCheckInSessions = new Map<string, SelfCheckInSession>();
  private readonly audits: AuditRecord[] = [];

  private constructor(seed: BackendSeed) {
    for (const user of seed.users) {
      this.users.set(user.id, { ...user });
    }

    for (const event of seed.events) {
      this.events.set(event.id, cloneEvent(event));
    }

    for (const rsvp of seed.rsvps) {
      this.rsvps.set(`${rsvp.eventId}:${rsvp.userId}`, { ...rsvp });
    }

    for (const pass of seed.passes) {
      this.passes.set(pass.id, { ...pass });
    }
  }

  static async create() {
    return new TambikeBackend(await createSeed());
  }

  getSnapshot(sessionToken?: string) {
    const currentUser = sessionToken ? this.getUserForSessionToken(sessionToken) : null;
    const currentPasses = currentUser
      ? Array.from(this.passes.values())
          .filter((pass) => pass.userId === currentUser.id)
          .map((pass) => ({
            id: pass.id,
            eventId: pass.eventId,
            qrToken: pass.qrToken,
            status: pass.status,
            generatedAt: pass.generatedAt,
          }))
      : [];

    const events = this.listEvents();

    return {
      currentUser: currentUser ? cloneUser(currentUser) : null,
      users: this.listPublicUsers(),
      events,
      passes: currentPasses,
      checkInSettings: events.map((event) => ({ ...this.getCheckInSettings(event.id) })),
      passCreated: currentPasses.length > 0,
    };
  }

  async signUpRider(input: SignupWithPasswordInput) {
    const email = input.email.trim().toLowerCase();
    if (!email || this.findUserByEmail(email)) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    validateSignupPassword(input.password);

    const user: BackendUser = {
      id: `user-${slugify(email || input.displayName)}`,
      displayName: input.displayName.trim(),
      email,
      role: "rider",
      verificationStatus: "UNVERIFIED",
      area: input.area.trim(),
      bikeModel: input.bikeModel?.trim() || undefined,
      clubName: input.clubName?.trim() || undefined,
      joinedAt: "July 4, 2026",
      passwordHash: await bcrypt.hash(input.password, 10),
    };

    this.users.set(user.id, user);
    this.audit("USER_CREATED", user.id, user.id);
    const session = this.createSessionForUser(user.id);

    return {
      user: cloneUser(user),
      sessionToken: session.token,
    };
  }

  async loginWithPassword(email: string, password: string) {
    const user = this.findUserByEmail(email.trim().toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new BackendError("UNAUTHENTICATED", "UNAUTHENTICATED");
    }

    const session = this.createSessionForUser(user.id);
    return {
      user: cloneUser(user),
      sessionToken: session.token,
    };
  }

  async getCurrentUser(sessionToken?: string | null) {
    if (!sessionToken) {
      return null;
    }

    const user = this.getUserForSessionToken(sessionToken);
    return user ? cloneUser(user) : null;
  }

  async updateProfile(sessionToken: string, input: ProfileInput) {
    const user = this.requireUser(sessionToken);
    const updated: BackendUser = {
      ...user,
      displayName: input.displayName.trim(),
      area: input.area.trim(),
      bikeModel: input.bikeModel?.trim() || undefined,
      clubName: input.clubName?.trim() || undefined,
    };

    this.users.set(updated.id, updated);
    this.audit("PROFILE_UPDATED", user.id, user.id);
    return cloneUser(updated);
  }

  async createEventDraft(sessionToken: string, input: CreateEventInput) {
    const user = this.requireUser(sessionToken);
    if (user.role !== "organizer" || user.verificationStatus !== "APPROVED") {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    const venue = venues.find((candidate) => candidate.id === input.venueId);
    if (!venue || venue.status !== "APPROVED") {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const baseId = slugify(input.title);
    const eventId = this.events.has(baseId) ? `${baseId}-${this.events.size + 1}` : baseId;
    const expectedRiders = Math.max(1, Number(input.expectedRiders) || 1);
    const event: Event = {
      id: eventId,
      title: input.title.trim(),
      type: input.type,
      status: "PENDING_VENUE_APPROVAL",
      organizerId: user.organizerProfileId ?? "arai-hjc-riders",
      venueId: venue.id,
      poster: "/demo/poster-tambike-cafe-classico.jpg",
      date: input.date.trim(),
      time: input.time.trim(),
      area: input.area.trim(),
      shortDescription: `${input.title.trim()} is awaiting venue approval.`,
      whatHappens:
        "Organizer-created draft that will move through venue approval and admin publish.",
      going: 0,
      interested: 0,
      expectedRiders,
      perkPreview: input.perkPreview.trim(),
      tags: [input.type, "Venue approval"],
      riskFlags: this.riskFlagsFor(input.type, expectedRiders),
      rules: defaultRulesForEvent(input.type),
      perks: [
        {
          id: `perk-${eventId}`,
          type: "Check-in perk",
          description: input.perkPreview.trim(),
        },
      ],
    };

    this.events.set(event.id, event);
    this.checkInSettings.set(event.id, {
      eventId: event.id,
      mode: "staff_only",
      state: "closed",
      qrMode: "rotating",
      fixedQrAcknowledged: false,
    });
    this.audit("EVENT_DRAFT_CREATED", user.id, event.id);
    return cloneEvent(event);
  }

  async registerForEvent(sessionToken: string, eventId: string, input: RegistrationInput) {
    const user = this.requireUser(sessionToken);
    const event = this.requireEvent(eventId);
    const cta = getEventCtaState(event);
    if (!cta.canRegister && !cta.canShowInterest) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const rsvpKey = `${event.id}:${user.id}`;
    const rsvp: RSVP & { userId: string } = {
      eventId: event.id,
      userId: user.id,
      status: input.status,
      attendanceType: input.attendanceType,
      clubName: input.clubName?.trim() || user.clubName,
    };

    this.rsvps.set(rsvpKey, rsvp);
    if (input.status === "interested") {
      event.interested += 1;
      this.audit("RSVP_UPDATED", user.id, event.id);
      return { rsvp, pass: null };
    }

    event.going += 1;
    const pass: Pass & { userId: string } = {
      id: passIdForEvent(event.id, user.id),
      eventId: event.id,
      userId: user.id,
      qrToken: makePassToken(),
      status: "active",
      generatedAt: new Date().toISOString(),
    };

    this.passes.set(pass.id, pass);
    this.audit("RSVP_UPDATED", user.id, event.id);
    this.audit("PASS_CREATED", user.id, pass.id);
    return { rsvp, pass: { ...pass } };
  }

  async configureCheckIn(
    sessionToken: string,
    eventId: string,
    input: CheckInConfiguration,
  ) {
    const user = this.requireUser(sessionToken);
    const event = this.requireEvent(eventId);
    this.requireCheckInConfigurator(user, event);
    validateCheckInConfiguration(input);
    const previousSettings = this.getCheckInSettings(event.id);

    const settings: CheckInSettings = {
      eventId: event.id,
      mode: input.mode,
      state: input.state,
      qrMode: input.qrMode,
      fixedQrAcknowledged: input.qrMode === "fixed",
    };
    this.checkInSettings.set(event.id, settings);

    if (
      input.mode === "staff_only" ||
      input.state !== "open" ||
      previousSettings.qrMode !== input.qrMode
    ) {
      const now = Date.now();
      for (const session of this.selfCheckInSessions.values()) {
        if (session.eventId === event.id && !session.revokedAt) {
          session.revokedAt = now;
        }
      }
    }

    this.audit("CHECK_IN_SETTINGS_UPDATED", user.id, event.id);
    return { ...settings };
  }

  async issueSelfCheckInQr(sessionToken: string, eventId: string): Promise<SelfCheckInQr> {
    const user = this.requireUser(sessionToken);
    const event = this.requireEvent(eventId);
    this.requireCheckInConfigurator(user, event);
    const settings = this.getCheckInSettings(event.id);

    this.requireSelfCheckInEnabled(settings);
    if (!this.isSelfCheckInEvent(event)) {
      throw new BackendError("CHECK_IN_NOT_OPEN", "CHECK_IN_NOT_OPEN");
    }
    if (settings.qrMode === "fixed") {
      return { token: `fixed:${event.id}`, qrMode: "fixed" };
    }

    const token = `tbk_checkin_${randomBytes(24).toString("base64url")}`;
    const expiresAt = Date.now() + 90_000;
    this.selfCheckInSessions.set(token, { eventId: event.id, expiresAt });
    return { token, expiresAt: new Date(expiresAt).toISOString(), qrMode: "rotating" };
  }

  async getSelfCheckInContext(qrToken: string): Promise<SelfCheckInContext> {
    const resolved = this.resolveSelfCheckInQr(qrToken);
    const event = resolved.event;
    const settings = this.getCheckInSettings(event.id);
    if (settings.mode === "staff_only") {
      throw new BackendError("SELF_CHECK_IN_DISABLED", "SELF_CHECK_IN_DISABLED");
    }
    return {
      event: cloneEvent(event),
      mode: settings.mode,
      state: settings.state,
      qrMode: settings.qrMode,
      available:
        resolved.valid &&
        settings.qrMode === resolved.qrMode &&
        settings.state === "open" &&
        this.isSelfCheckInEvent(event),
    };
  }

  async selfCheckIn(sessionToken: string, qrToken: string): Promise<SelfCheckInResult> {
    const rider = this.requireUser(sessionToken);
    if (rider.role !== "rider") {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }
    const resolved = this.resolveSelfCheckInQr(qrToken);
    const event = resolved.event;
    const settings = this.getCheckInSettings(event.id);

    this.requireSelfCheckInEnabled(settings);
    if (settings.qrMode !== resolved.qrMode) {
      throw new BackendError("QR_EXPIRED", "QR_EXPIRED");
    }
    if (!resolved.valid) {
      throw new BackendError("QR_EXPIRED", "QR_EXPIRED");
    }
    if (!this.isSelfCheckInEvent(event)) {
      throw new BackendError("CHECK_IN_NOT_OPEN", "CHECK_IN_NOT_OPEN");
    }

    const pass = Array.from(this.passes.values()).find(
      (candidate) => candidate.eventId === event.id && candidate.userId === rider.id,
    );
    if (!pass) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }
    if (pass.status === "cancelled") {
      throw new BackendError("CANCELLED_PASS", "CANCELLED_PASS");
    }

    const existing = this.findCheckIn(event.id, pass.id);
    if (existing?.status === "pending") {
      return { status: "pending", pass: { ...pass } };
    }
    if (existing?.status === "confirmed" || pass.status === "checked_in") {
      throw new BackendError("ALREADY_CHECKED_IN", "ALREADY_CHECKED_IN");
    }

    const timestamp = new Date().toISOString();
    const status: CheckInStatus = settings.mode === "self_review" ? "pending" : "confirmed";
    const checkIn: CheckInRecord = {
      id: `checkin-${randomUUID()}`,
      eventId: event.id,
      passId: pass.id,
      userId: rider.id,
      timestamp,
      confirmedAt: status === "confirmed" ? timestamp : undefined,
      status,
      method: "rider_qr",
    };
    this.checkIns.set(checkIn.id, checkIn);
    this.audit("SELF_CHECK_IN_REQUESTED", rider.id, checkIn.id);

    if (status === "confirmed") {
      pass.status = "checked_in";
      this.audit("CHECK_IN_CREATED", rider.id, checkIn.id);
    }

    return { status, pass: { ...pass } };
  }

  async scanPass(
    sessionToken: string,
    eventId: string,
    qrToken: string,
    method: ScanMethod,
  ) {
    const scanner = this.requireUser(sessionToken);
    const event = this.requireEvent(eventId);
    this.requireCheckInStaff(scanner, event);
    const staffMethod = normalizeStaffScanMethod(method);
    const pass = Array.from(this.passes.values()).find(
      (candidate) => candidate.qrToken === qrToken,
    );
    if (!pass) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }
    if (pass.eventId !== event.id) {
      throw new BackendError("WRONG_EVENT", "WRONG_EVENT");
    }
    if (pass.status === "cancelled") {
      throw new BackendError("CANCELLED_PASS", "CANCELLED_PASS");
    }
    const existing = this.findCheckIn(event.id, pass.id);
    if (existing?.status === "pending") {
      const confirmedAt = new Date().toISOString();
      existing.status = "confirmed";
      existing.scannedBy = scanner.id;
      existing.confirmedAt = confirmedAt;
      existing.confirmationMethod = staffMethod;
      pass.status = "checked_in";
      this.audit("CHECK_IN_CONFIRMED", scanner.id, existing.id);
      return { ...pass };
    }
    if (existing?.status === "confirmed" || pass.status === "checked_in") {
      throw new BackendError("ALREADY_CHECKED_IN", "ALREADY_CHECKED_IN");
    }

    const timestamp = new Date().toISOString();
    const checkIn: CheckInRecord = {
      id: `checkin-${randomUUID()}`,
      eventId: event.id,
      passId: pass.id,
      userId: pass.userId,
      scannedBy: scanner.id,
      timestamp,
      confirmedAt: timestamp,
      status: "confirmed",
      method: staffMethod,
    };

    pass.status = "checked_in";
    this.checkIns.set(checkIn.id, checkIn);
    this.audit("CHECK_IN_CREATED", scanner.id, checkIn.id);
    return { ...pass };
  }

  async approveVenueWithConditions(sessionToken: string, eventId: string, conditions: string) {
    const user = this.requireUser(sessionToken);
    if (!["venue", "admin"].includes(user.role)) {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    const event = this.requireEvent(eventId);
    event.status = "PENDING_ADMIN_REVIEW";
    this.audit("VENUE_APPROVED", user.id, event.id);
    return { event: cloneEvent(event), conditions: conditions.trim() };
  }

  async approvePublish(sessionToken: string, eventId: string) {
    const user = this.requireRole(sessionToken, "admin");
    const event = this.requireEvent(eventId);
    event.status = "PUBLISHED";
    this.audit("ADMIN_PUBLISHED", user.id, event.id);
    return cloneEvent(event);
  }

  async exportAttendeesCsv(sessionToken: string, eventId: string) {
    const user = this.requireRole(sessionToken, "admin");
    const event = this.requireEvent(eventId);
    const rows = ["event_id,user_email,rsvp_status,pass_status,checked_in_at"];
    const eventRsvps = Array.from(this.rsvps.values()).filter((rsvp) => rsvp.eventId === event.id);

    for (const rsvp of eventRsvps) {
      const attendee = this.users.get(rsvp.userId);
      const pass = Array.from(this.passes.values()).find(
        (candidate) => candidate.eventId === event.id && candidate.userId === rsvp.userId,
      );
      const checkIn = pass
        ? Array.from(this.checkIns.values()).find(
            (candidate) => candidate.passId === pass.id && candidate.status === "confirmed",
          )
        : null;
      rows.push(
        [
          event.id,
          attendee?.email ?? "",
          rsvp.status,
          pass?.status ?? "",
          checkIn?.confirmedAt ?? checkIn?.timestamp ?? "",
        ]
          .map((value) => JSON.stringify(value))
          .join(","),
      );
    }

    if (eventRsvps.length === 0) {
      rows.push([event.id, "", "", "", ""].map((value) => JSON.stringify(value)).join(","));
    }

    this.audit("ATTENDEE_EXPORT_CREATED", user.id, event.id);
    return rows.join("\n");
  }

  async exportLeadsCsv(sessionToken: string) {
    const user = this.requireRole(sessionToken, "admin");
    const rows = ["event_id,lead_name,email,interest,status"];
    const leadEvents = Array.from(this.events.values()).filter(
      (event) => event.type === "Test Ride" || event.tags.includes("Lead collection"),
    );

    for (const event of leadEvents) {
      rows.push(
        [
          event.id,
          "Seeded Tambike Lead",
          "lead@example.com",
          event.perkPreview,
          "captured",
        ]
          .map((value) => JSON.stringify(value))
          .join(","),
      );
    }

    if (leadEvents.length === 0) {
      rows.push(["", "", "", "", ""].map((value) => JSON.stringify(value)).join(","));
    }

    this.audit("LEAD_EXPORT_CREATED", user.id, "lead-export");
    return rows.join("\n");
  }

  async auditCount(action: AuditAction) {
    return this.audits.filter((audit) => audit.action === action).length;
  }

  listPublicUsers() {
    return Array.from(this.users.values())
      .filter((user) => !user.email.endsWith("@seed.tambike.local"))
      .map(cloneUser);
  }

  listEvents(query?: EventQueryInput) {
    return filterEventsByQuery(
      Array.from(this.events.values()).map((event) => this.withAttendanceCounts(event)),
      query,
    );
  }

  private withAttendanceCounts(event: Event): Event {
    const arrivals = Array.from(this.checkIns.values()).filter(
      (checkIn) => checkIn.eventId === event.id,
    );
    return {
      ...cloneEvent(event),
      confirmedCheckIns: arrivals.filter((checkIn) => checkIn.status === "confirmed").length,
      pendingCheckIns: arrivals.filter((checkIn) => checkIn.status === "pending").length,
    };
  }

  private createSessionForUser(userId: string): SessionRecord {
    const session: SessionRecord = {
      token: makeSessionToken(),
      userId,
      createdAt: new Date(),
    };
    this.sessions.set(session.token, session);
    this.audit("SESSION_CREATED", userId, userId);
    return session;
  }

  private getUserForSessionToken(sessionToken: string) {
    const session = this.sessions.get(sessionToken);
    return session ? this.users.get(session.userId) ?? null : null;
  }

  private requireUser(sessionToken: string) {
    const user = this.getUserForSessionToken(sessionToken);
    if (!user) {
      throw new BackendError("UNAUTHENTICATED", "UNAUTHENTICATED");
    }
    if (user.verificationStatus === "SUSPENDED") {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    return user;
  }

  private requireRole(sessionToken: string, role: AccountRole) {
    const user = this.requireUser(sessionToken);
    if (user.role !== role) {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    return user;
  }

  private requireEvent(eventId: string) {
    const event = this.events.get(eventId);
    if (!event) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    return event;
  }

  private getCheckInSettings(eventId: string): CheckInSettings {
    return this.checkInSettings.get(eventId) ?? {
      eventId,
      mode: "staff_only",
      state: "closed",
      qrMode: "rotating",
      fixedQrAcknowledged: false,
    };
  }

  private resolveSelfCheckInQr(qrToken: string) {
    if (qrToken.startsWith("fixed:")) {
      return {
        event: this.requireEvent(qrToken.slice("fixed:".length)),
        qrMode: "fixed" as const,
        valid: true,
      };
    }

    const session = this.selfCheckInSessions.get(qrToken);
    if (!session) {
      throw new BackendError("QR_EXPIRED", "QR_EXPIRED");
    }
    return {
      event: this.requireEvent(session.eventId),
      qrMode: "rotating" as const,
      valid: !session.revokedAt && session.expiresAt >= Date.now(),
    };
  }

  private requireSelfCheckInEnabled(settings: CheckInSettings) {
    if (settings.mode === "staff_only") {
      throw new BackendError("SELF_CHECK_IN_DISABLED", "SELF_CHECK_IN_DISABLED");
    }
    if (settings.state !== "open") {
      throw new BackendError("CHECK_IN_NOT_OPEN", "CHECK_IN_NOT_OPEN");
    }
    if (settings.qrMode === "fixed" && !settings.fixedQrAcknowledged) {
      throw new BackendError("SELF_CHECK_IN_DISABLED", "SELF_CHECK_IN_DISABLED");
    }
  }

  private isSelfCheckInEvent(event: Event) {
    return event.status === "PUBLISHED" || event.status === "ONGOING";
  }

  private requireCheckInConfigurator(user: BackendUser, event: Event) {
    if (user.role === "admin") {
      return;
    }
    if (
      user.role === "organizer" &&
      user.verificationStatus === "APPROVED" &&
      user.organizerProfileId === event.organizerId
    ) {
      return;
    }
    throw new BackendError("FORBIDDEN", "FORBIDDEN");
  }

  private requireCheckInStaff(user: BackendUser, event: Event) {
    if (user.role === "admin") {
      return;
    }
    if (
      user.role === "organizer" &&
      user.verificationStatus === "APPROVED" &&
      user.organizerProfileId === event.organizerId
    ) {
      return;
    }
    if (
      user.role === "venue" &&
      user.verificationStatus === "APPROVED" &&
      user.venueId === event.venueId
    ) {
      return;
    }
    throw new BackendError("FORBIDDEN", "FORBIDDEN");
  }

  private findCheckIn(eventId: string, passId: string) {
    return Array.from(this.checkIns.values()).find(
      (checkIn) => checkIn.eventId === eventId && checkIn.passId === passId,
    );
  }

  private findUserByEmail(email: string) {
    return Array.from(this.users.values()).find((user) => user.email === email) ?? null;
  }

  private audit(action: AuditAction, actorUserId?: string, targetId?: string) {
    this.audits.push({
      id: `audit-${randomUUID()}`,
      action,
      actorUserId,
      targetId,
      createdAt: new Date(),
    });
  }

  private riskFlagsFor(type: EventType, expectedRiders: number) {
    const flags: string[] = [];
    if (["Charity Ride", "Test Ride", "Track Day", "Race"].includes(type)) {
      flags.push(`${type} requires admin review`);
    }
    if (expectedRiders >= 50) {
      flags.push("Expected riders need review");
    }

    return flags.length > 0 ? flags : ["Standard venue approval"];
  }
}

type RuntimeBackend = TambikeBackend | PrismaTambikeBackend;

type RuntimeBackendState = {
  backend: Promise<RuntimeBackend> | null;
};

const runtimeBackendState = (() => {
  const state = globalThis as typeof globalThis & {
    __tambikeRuntimeBackend?: RuntimeBackendState;
  };

  state.__tambikeRuntimeBackend ??= { backend: null };
  return state.__tambikeRuntimeBackend;
})();

async function createRuntimeBackend(): Promise<RuntimeBackend> {
  const databaseUrl = getRuntimeDatabaseUrl();
  if (databaseUrl) {
    const { PrismaTambikeBackend } = await import("./prisma-backend");
    return PrismaTambikeBackend.create(databaseUrl);
  }

  return TambikeBackend.create();
}

export function getTambikeBackend() {
  runtimeBackendState.backend ??= createRuntimeBackend();
  return runtimeBackendState.backend;
}

export async function resetTambikeBackendForTests() {
  runtimeBackendState.backend = TambikeBackend.create();
  return runtimeBackendState.backend;
}
