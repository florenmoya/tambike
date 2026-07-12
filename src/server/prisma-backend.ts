import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { venues } from "@/features/tambike-demo/data";
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
  CreateEventInput,
  Event,
  EventType,
  OrganizerQrMode,
  Pass,
  Perk,
  ProfileInput,
  RSVP,
  ScanMethod,
  SelfCheckInContext,
  SelfCheckInQr,
  SelfCheckInResult,
  SignupInput,
  UserProfile,
} from "@/features/tambike-demo/types";
import {
  BackendError,
  type AuditAction,
  type RegistrationInput,
} from "./backend";

type SignupWithPasswordInput = SignupInput & {
  password: string;
};

type PrismaEventRecord = {
  id: string;
  title: string;
  type: string;
  status: string;
  organizerId: string;
  venueId: string | null;
  poster: string;
  dateLabel: string;
  timeLabel: string;
  area: string;
  description: string;
  whatHappens: string;
  expectedRiders: number;
  perkPreview: string;
  tags: string[];
  riskFlags: string[];
  rideOutMeetup: string | null;
  rideOutCallTime: string | null;
  rideOutDeparture: string | null;
  rideOutDestination: string | null;
  rideOutNotes: string | null;
  safetyRules: string[];
  perks: Array<Omit<Perk, "quantity"> & { quantity: number | null }>;
  _count?: {
    passes: number;
    rsvps: number;
  };
};

type PrismaUserRecord = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  verificationStatus: string;
  area: string;
  bikeModel: string | null;
  clubName: string | null;
  createdAt: Date;
  organizerProfile?: { id: string } | null;
  ownedVenues?: Array<{ id: string }>;
};

type CheckInSettingsValue = CheckInConfiguration & {
  eventId: string;
  fixedQrAcknowledged: boolean;
};

const eventTypeToDb: Record<EventType, string> = {
  Tambike: "TAMBIKE",
  "Bike Night": "BIKE_NIGHT",
  "Coffee Ride": "COFFEE_RIDE",
  "Club EB": "CLUB_EB",
  "Brand Event": "BRAND_EVENT",
  "Test Ride": "TEST_RIDE",
  "Charity Ride": "CHARITY_RIDE",
  "Track Day": "TRACK_DAY",
  "Endurance Ride": "ENDURANCE_RIDE",
  "Moto Expo": "MOTO_EXPO",
  Race: "RACE",
};

const dbEventTypeToUi = Object.fromEntries(
  Object.entries(eventTypeToDb).map(([uiValue, dbValue]) => [dbValue, uiValue]),
) as Record<string, EventType>;

const attendanceTypeToDb: Record<AttendanceType, string> = {
  direct: "direct",
  "ride-out": "ride_out",
  club: "club",
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("base64url");
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

function formatJoinedAt(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function defaultRulesForEvent(type: EventType) {
  const baseRules = ["Helmet required", "No racing", "No stunts", "No revving"];
  if (type === "Track Day" || type === "Race") {
    return [...baseRules, "Follow marshal instructions"];
  }

  return [...baseRules, "Respect venue staff"];
}

export class PrismaTambikeBackend {
  private constructor(private readonly prisma: PrismaClient) {}

  static create(databaseUrl: string) {
    const adapter = new PrismaPg(databaseUrl);
    return new PrismaTambikeBackend(new PrismaClient({ adapter }));
  }

  async getSnapshot(sessionToken?: string) {
    const currentUser = sessionToken ? await this.getUserForSessionToken(sessionToken) : null;
    const [users, events, currentPasses, persistedSettings] = await Promise.all([
      this.listPublicUsers(),
      this.listEvents(),
      currentUser ? this.listPassesForUser(currentUser.id) : Promise.resolve([]),
      this.prisma.eventCheckInSettings.findMany(),
    ]);
    const settingsByEventId = new Map(
      persistedSettings.map((settings) => [settings.eventId, this.toCheckInSettings(settings)]),
    );

    return {
      currentUser: currentUser ? this.toUserProfile(currentUser) : null,
      users,
      events,
      passes: currentPasses,
      checkInSettings: events.map(
        (event) =>
          settingsByEventId.get(event.id) ?? {
            eventId: event.id,
            mode: "staff_only" as const,
            state: "closed" as const,
            qrMode: "rotating" as const,
            fixedQrAcknowledged: false,
          },
      ),
      passCreated: currentPasses.length > 0,
    };
  }

  async signUpRider(input: SignupWithPasswordInput) {
    const email = input.email.trim().toLowerCase();
    if (!email || (await this.findUserByEmail(email))) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }
    validateSignupPassword(input.password);

    const user = await this.prisma.user.create({
      data: {
        id: `user-${slugify(email || input.displayName)}`,
        displayName: input.displayName.trim(),
        email,
        passwordHash: await bcrypt.hash(input.password, 10),
        role: "rider",
        verificationStatus: "UNVERIFIED",
        area: input.area.trim(),
        bikeModel: input.bikeModel?.trim() || null,
        clubName: input.clubName?.trim() || null,
      },
      include: { organizerProfile: true, ownedVenues: true },
    });
    await this.audit("USER_CREATED", user.id, "User", user.id);
    const sessionToken = await this.createSessionForUser(user.id);

    return {
      user: this.toUserProfile(user),
      sessionToken,
    };
  }

  async loginWithPassword(email: string, password: string) {
    const user = await this.findUserByEmail(email.trim().toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new BackendError("UNAUTHENTICATED", "UNAUTHENTICATED");
    }

    const sessionToken = await this.createSessionForUser(user.id);
    return {
      user: this.toUserProfile(user),
      sessionToken,
    };
  }

  async getCurrentUser(sessionToken?: string | null) {
    if (!sessionToken) {
      return null;
    }

    const user = await this.getUserForSessionToken(sessionToken);
    return user ? this.toUserProfile(user) : null;
  }

  async updateProfile(sessionToken: string, input: ProfileInput) {
    const user = await this.requireUser(sessionToken);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        displayName: input.displayName.trim(),
        area: input.area.trim(),
        bikeModel: input.bikeModel?.trim() || null,
        clubName: input.clubName?.trim() || null,
      },
      include: { organizerProfile: true, ownedVenues: true },
    });
    await this.audit("PROFILE_UPDATED", user.id, "User", user.id);
    return this.toUserProfile(updated);
  }

  async createEventDraft(sessionToken: string, input: CreateEventInput) {
    const user = await this.requireUser(sessionToken);
    if (user.role !== "organizer" || user.verificationStatus !== "APPROVED") {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    const organizerId = user.organizerProfile?.id;
    if (!organizerId) {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    const venue = await this.prisma.venue.findUnique({ where: { id: input.venueId } });
    if (!venue || venue.status !== "APPROVED") {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const baseSlug = slugify(input.title);
    const existing = await this.prisma.event.findUnique({ where: { slug: baseSlug } });
    const slug = existing ? `${baseSlug}-${Date.now()}` : baseSlug;
    const expectedRiders = Math.max(1, Number(input.expectedRiders) || 1);
    const type = input.type;
    const event = await this.prisma.event.create({
      data: {
        id: slug,
        slug,
        title: input.title.trim(),
        type: eventTypeToDb[type] as never,
        status: "PENDING_VENUE_APPROVAL",
        organizerId,
        venueId: venue.id,
        poster: "/demo/poster-tambike-cafe-classico.jpg",
        dateLabel: input.date.trim(),
        timeLabel: input.time.trim(),
        area: input.area.trim(),
        expectedRiders,
        description: `${input.title.trim()} is awaiting venue approval.`,
        whatHappens:
          "Organizer-created draft that will move through venue approval and admin publish.",
        perkPreview: input.perkPreview.trim(),
        tags: [type, "Venue approval"],
        riskFlags: this.riskFlagsFor(type, expectedRiders),
        safetyRules: defaultRulesForEvent(type),
        checkInSettings: {
          create: {
            mode: "staff_only",
            state: "closed",
            qrMode: "rotating",
          },
        },
        perks: {
          create: {
            id: `perk-${slug}`,
            type: "Check-in perk",
            description: input.perkPreview.trim(),
          },
        },
      },
      include: { perks: true, _count: { select: { passes: true, rsvps: true } } },
    });

    await this.audit("EVENT_DRAFT_CREATED", user.id, "Event", event.id);
    return this.toEvent(event);
  }

  async registerForEvent(sessionToken: string, eventId: string, input: RegistrationInput) {
    const user = await this.requireUser(sessionToken);
    const event = await this.requireEvent(eventId);
    const cta = getEventCtaState(this.toEvent(event));
    if (!cta.canRegister && !cta.canShowInterest) {
      throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
    }

    const rsvp = await this.prisma.rSVP.upsert({
      where: { eventId_userId: { eventId: event.id, userId: user.id } },
      create: {
        eventId: event.id,
        userId: user.id,
        status: input.status,
        attendanceType: attendanceTypeToDb[input.attendanceType] as never,
        clubName: input.clubName?.trim() || user.clubName,
      },
      update: {
        status: input.status,
        attendanceType: attendanceTypeToDb[input.attendanceType] as never,
        clubName: input.clubName?.trim() || user.clubName,
      },
    });

    await this.audit("RSVP_UPDATED", user.id, "Event", event.id);
    const rsvpDto: RSVP & { userId: string } = {
      eventId: rsvp.eventId,
      userId: rsvp.userId,
      status: input.status,
      attendanceType: input.attendanceType,
      clubName: rsvp.clubName ?? undefined,
    };

    if (input.status === "interested") {
      return { rsvp: rsvpDto, pass: null };
    }

    const existingPass = await this.prisma.pass.findUnique({ where: { rsvpId: rsvp.id } });
    const pass =
      existingPass ??
      (await this.prisma.pass.create({
        data: {
          id: `pass-${event.id}-${user.id}`,
          eventId: event.id,
          userId: user.id,
          rsvpId: rsvp.id,
          qrTokenHash: makePassToken(),
          status: "active",
        },
      }));

    await this.audit("PASS_CREATED", user.id, "Pass", pass.id);
    return { rsvp: rsvpDto, pass: this.toPass(pass) };
  }

  async configureCheckIn(
    sessionToken: string,
    eventId: string,
    input: CheckInConfiguration,
  ) {
    const user = await this.requireUser(sessionToken);
    const event = await this.requireCheckInEvent(eventId);
    this.requireCheckInConfigurator(user, event);
    validateCheckInConfiguration(input);
    const settings = await this.prisma.$transaction(async (tx) => {
      const lockedEvent = await this.lockCheckInEvent(tx, event.id);
      const previousSettings = this.settingsForEvent(lockedEvent);
      const nextSettings = await tx.eventCheckInSettings.upsert({
        where: { eventId: lockedEvent.id },
        create: {
          eventId: lockedEvent.id,
          mode: input.mode,
          state: input.state,
          qrMode: input.qrMode,
          fixedQrAcknowledgedAt:
            input.qrMode === "fixed" && input.fixedQrAcknowledged ? new Date() : null,
        },
        update: {
          mode: input.mode,
          state: input.state,
          qrMode: input.qrMode,
          fixedQrAcknowledgedAt:
            input.qrMode === "fixed" && input.fixedQrAcknowledged ? new Date() : null,
        },
      });

      if (
        input.mode === "staff_only" ||
        input.state !== "open" ||
        previousSettings.qrMode !== input.qrMode
      ) {
        await tx.eventSelfCheckInQrSession.updateMany({
          where: { eventId: lockedEvent.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      return nextSettings;
    });

    await this.audit("CHECK_IN_SETTINGS_UPDATED", user.id, "Event", event.id);
    return this.toCheckInSettings(settings);
  }

  async issueSelfCheckInQr(sessionToken: string, eventId: string): Promise<SelfCheckInQr> {
    const user = await this.requireUser(sessionToken);
    const event = await this.requireCheckInEvent(eventId);
    this.requireCheckInConfigurator(user, event);
    return this.prisma.$transaction(async (tx) => {
      const lockedEvent = await this.lockCheckInEvent(tx, event.id);
      const settings = this.settingsForEvent(lockedEvent);

      this.requireSelfCheckInEnabled(settings);
      if (lockedEvent.status !== "PUBLISHED" && lockedEvent.status !== "ONGOING") {
        throw new BackendError("CHECK_IN_NOT_OPEN", "CHECK_IN_NOT_OPEN");
      }
      if (settings.qrMode === "fixed") {
        return { token: `fixed:${lockedEvent.id}`, qrMode: "fixed" };
      }

      const token = `tbk_checkin_${randomBytes(24).toString("base64url")}`;
      const expiresAt = new Date(Date.now() + 90_000);
      await tx.eventSelfCheckInQrSession.create({
        data: {
          eventId: lockedEvent.id,
          tokenHash: hashToken(token),
          expiresAt,
        },
      });
      return { token, expiresAt: expiresAt.toISOString(), qrMode: "rotating" };
    });
  }

  async getSelfCheckInContext(qrToken: string): Promise<SelfCheckInContext> {
    const resolved = await this.resolveSelfCheckInQr(qrToken);
    const settings = this.settingsForEvent(resolved.event);
    if (settings.mode === "staff_only") {
      throw new BackendError("SELF_CHECK_IN_DISABLED", "SELF_CHECK_IN_DISABLED");
    }
    return {
      event: this.toEvent(resolved.event),
      mode: settings.mode,
      state: settings.state,
      qrMode: settings.qrMode,
      available:
        resolved.valid &&
        settings.qrMode === resolved.qrMode &&
        settings.state === "open" &&
        (resolved.event.status === "PUBLISHED" || resolved.event.status === "ONGOING"),
    };
  }

  async selfCheckIn(sessionToken: string, qrToken: string): Promise<SelfCheckInResult> {
    const rider = await this.requireUser(sessionToken);
    if (rider.role !== "rider") {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }
    const resolved = await this.resolveSelfCheckInQr(qrToken);

    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const event = await this.lockCheckInEvent(tx, resolved.event.id);
        const settings = this.settingsForEvent(event);

        this.requireSelfCheckInEnabled(settings);
        if (settings.qrMode !== resolved.qrMode) {
          throw new BackendError("QR_EXPIRED", "QR_EXPIRED");
        }

        let selfCheckInSessionId: string | undefined;
        if (resolved.qrMode === "rotating") {
          const qrSession = await tx.eventSelfCheckInQrSession.findUnique({
            where: { tokenHash: hashToken(qrToken) },
          });
          if (
            !qrSession ||
            qrSession.eventId !== event.id ||
            qrSession.revokedAt ||
            qrSession.expiresAt < new Date()
          ) {
            throw new BackendError("QR_EXPIRED", "QR_EXPIRED");
          }
          selfCheckInSessionId = qrSession.id;
        }

        if (event.status !== "PUBLISHED" && event.status !== "ONGOING") {
          throw new BackendError("CHECK_IN_NOT_OPEN", "CHECK_IN_NOT_OPEN");
        }

        const pass = await tx.pass.findFirst({
          where: { eventId: event.id, userId: rider.id },
        });
        if (!pass) {
          throw new BackendError("NOT_FOUND", "NOT_FOUND");
        }
        if (pass.status === "cancelled") {
          throw new BackendError("CANCELLED_PASS", "CANCELLED_PASS");
        }

        const existing = await tx.checkIn.findUnique({
          where: { eventId_passId: { eventId: event.id, passId: pass.id } },
        });
        if (existing?.status === "pending") {
          return { status: "pending" as const, pass };
        }
        if (existing?.status === "confirmed" || pass.status === "checked_in") {
          throw new BackendError("ALREADY_CHECKED_IN", "ALREADY_CHECKED_IN");
        }

        if (settings.mode === "self_review") {
          await tx.checkIn.create({
            data: {
              eventId: event.id,
              passId: pass.id,
              userId: rider.id,
              status: "pending",
              method: "rider_qr",
              selfCheckInSessionId,
            },
          });
          return { status: "pending" as const, pass };
        }

        const updated = await tx.pass.updateMany({
          where: { id: pass.id, status: "active" },
          data: { status: "checked_in", checkedInAt: new Date() },
        });
        if (updated.count !== 1) {
          throw new BackendError("ALREADY_CHECKED_IN", "ALREADY_CHECKED_IN");
        }
        const confirmedPass = await tx.pass.findUniqueOrThrow({ where: { id: pass.id } });
        await tx.checkIn.create({
          data: {
            eventId: event.id,
            passId: pass.id,
            userId: rider.id,
            status: "confirmed",
            confirmedAt: new Date(),
            method: "rider_qr",
            selfCheckInSessionId,
          },
        });
        return { status: "confirmed" as const, pass: confirmedPass };
      });

      await this.audit("SELF_CHECK_IN_REQUESTED", rider.id, "Event", resolved.event.id);
      if (outcome.status === "confirmed") {
        await this.audit("CHECK_IN_CREATED", rider.id, "CheckIn", outcome.pass.id);
      }
      return { status: outcome.status, pass: this.toPass(outcome.pass) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BackendError("ALREADY_CHECKED_IN", "ALREADY_CHECKED_IN");
      }
      throw error;
    }
  }

  async scanPass(
    sessionToken: string,
    eventId: string,
    qrToken: string,
    method: ScanMethod,
  ) {
    const scanner = await this.requireUser(sessionToken);
    const event = await this.requireCheckInEvent(eventId);
    this.requireCheckInStaff(scanner, event);
    const staffMethod = normalizeStaffScanMethod(method);
    const pass = await this.prisma.pass.findUnique({ where: { qrTokenHash: qrToken } });
    if (!pass) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }
    if (pass.eventId !== event.id) {
      throw new BackendError("WRONG_EVENT", "WRONG_EVENT");
    }
    if (pass.status === "cancelled") {
      throw new BackendError("CANCELLED_PASS", "CANCELLED_PASS");
    }
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        await this.lockCheckInEvent(tx, event.id);
        const existing = await tx.checkIn.findUnique({
          where: { eventId_passId: { eventId: event.id, passId: pass.id } },
        });
        if (existing?.status === "pending") {
          const confirmedAt = new Date();
          await tx.checkIn.update({
            where: { id: existing.id },
            data: {
              status: "confirmed",
              scannedBy: scanner.id,
              confirmedAt,
              confirmationMethod: staffMethod,
            },
          });
          const confirmedPass = await tx.pass.update({
            where: { id: pass.id },
            data: { status: "checked_in", checkedInAt: confirmedAt },
          });
          return { pass: confirmedPass, confirmation: true };
        }
        if (existing?.status === "confirmed" || pass.status === "checked_in") {
          throw new BackendError("ALREADY_CHECKED_IN", "ALREADY_CHECKED_IN");
        }

        const updated = await tx.pass.updateMany({
          where: { id: pass.id, status: "active" },
          data: { status: "checked_in", checkedInAt: new Date() },
        });
        if (updated.count !== 1) {
          throw new BackendError("ALREADY_CHECKED_IN", "ALREADY_CHECKED_IN");
        }
        const confirmedPass = await tx.pass.findUniqueOrThrow({ where: { id: pass.id } });
        await tx.checkIn.create({
          data: {
            id: `checkin-${randomUUID()}`,
            eventId: event.id,
            passId: pass.id,
            userId: pass.userId,
            scannedBy: scanner.id,
            status: "confirmed",
            confirmedAt: new Date(),
            method: staffMethod,
          },
        });
        return { pass: confirmedPass, confirmation: false };
      });

      await this.audit(
        outcome.confirmation ? "CHECK_IN_CONFIRMED" : "CHECK_IN_CREATED",
        scanner.id,
        "CheckIn",
        outcome.pass.id,
      );
      return this.toPass(outcome.pass);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BackendError("ALREADY_CHECKED_IN", "ALREADY_CHECKED_IN");
      }
      throw error;
    }
  }

  async approveVenueWithConditions(sessionToken: string, eventId: string, conditions: string) {
    const user = await this.requireUser(sessionToken);
    if (!["venue", "admin"].includes(user.role)) {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    await this.requireEvent(eventId);
    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: { status: "PENDING_ADMIN_REVIEW" },
      include: { perks: true, _count: { select: { passes: true, rsvps: true } } },
    });
    await this.prisma.eventApproval.upsert({
      where: { id: "req-shell-pugon" },
      create: {
        id: "req-shell-pugon",
        eventId,
        approvalType: "venue",
        reviewerId: user.id,
        decision: "approved_with_conditions",
        conditions: conditions.trim(),
        decidedAt: new Date(),
      },
      update: {
        reviewerId: user.id,
        decision: "approved_with_conditions",
        conditions: conditions.trim(),
        decidedAt: new Date(),
      },
    });
    await this.audit("VENUE_APPROVED", user.id, "Event", event.id);
    return { event: this.toEvent(event), conditions: conditions.trim() };
  }

  async approvePublish(sessionToken: string, eventId: string) {
    const user = await this.requireRole(sessionToken, "admin");
    await this.requireEvent(eventId);
    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: { status: "PUBLISHED" },
      include: { perks: true, _count: { select: { passes: true, rsvps: true } } },
    });
    await this.prisma.eventApproval.upsert({
      where: { id: "rev-arai-hjc-charity-ride" },
      create: {
        id: "rev-arai-hjc-charity-ride",
        eventId,
        approvalType: "admin",
        reviewerId: user.id,
        decision: "published",
        decidedAt: new Date(),
      },
      update: {
        reviewerId: user.id,
        decision: "published",
        decidedAt: new Date(),
      },
    });
    await this.audit("ADMIN_PUBLISHED", user.id, "Event", event.id);
    return this.toEvent(event);
  }

  async exportAttendeesCsv(sessionToken: string, eventId: string) {
    const user = await this.requireRole(sessionToken, "admin");
    const event = await this.requireEvent(eventId);
    const rows = ["event_id,user_email,rsvp_status,pass_status,checked_in_at"];
    const rsvps = await this.prisma.rSVP.findMany({
      where: { eventId: event.id },
      include: { user: true, pass: true },
    });

    for (const rsvp of rsvps) {
      const checkIn = rsvp.pass
        ? await this.prisma.checkIn.findFirst({
            where: { passId: rsvp.pass.id, status: "confirmed" },
          })
        : null;
      rows.push(
        [
          event.id,
          rsvp.user.email,
          rsvp.status,
          rsvp.pass?.status ?? "",
          checkIn?.confirmedAt?.toISOString() ?? checkIn?.timestamp.toISOString() ?? "",
        ]
          .map((value) => JSON.stringify(value))
          .join(","),
      );
    }

    if (rsvps.length === 0) {
      rows.push([event.id, "", "", "", ""].map((value) => JSON.stringify(value)).join(","));
    }

    await this.audit("ATTENDEE_EXPORT_CREATED", user.id, "Event", event.id);
    return rows.join("\n");
  }

  async exportLeadsCsv(sessionToken: string) {
    const user = await this.requireRole(sessionToken, "admin");
    const rows = ["event_id,lead_name,email,interest,status"];
    const leads = await this.prisma.lead.findMany({ include: { event: true, user: true } });

    for (const lead of leads) {
      rows.push(
        [
          lead.eventId,
          lead.name,
          lead.user?.email ?? "",
          lead.interestedModel,
          lead.exportedAt ? "exported" : "captured",
        ]
          .map((value) => JSON.stringify(value))
          .join(","),
      );
    }

    if (leads.length === 0) {
      rows.push(["", "", "", "", ""].map((value) => JSON.stringify(value)).join(","));
    }

    await this.audit("LEAD_EXPORT_CREATED", user.id, "Lead", "lead-export");
    return rows.join("\n");
  }

  async auditCount(action: AuditAction) {
    return this.prisma.auditLog.count({ where: { action } });
  }

  async listPublicUsers() {
    const users = await this.prisma.user.findMany({
      where: {
        email: {
          not: {
            endsWith: "@seed.tambike.local",
          },
        },
      },
      include: { organizerProfile: true, ownedVenues: true },
      orderBy: { createdAt: "asc" },
    });
    return users.map((user) => this.toUserProfile(user));
  }

  async listEvents(query?: EventQueryInput) {
    const [events, groupedCheckIns] = await Promise.all([
      this.prisma.event.findMany({
        include: { perks: true, _count: { select: { passes: true, rsvps: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.checkIn.groupBy({
        by: ["eventId", "status"],
        _count: { _all: true },
      }),
    ]);
    const attendanceByEvent = new Map<string, { confirmed: number; pending: number }>();
    for (const checkInGroup of groupedCheckIns) {
      const current = attendanceByEvent.get(checkInGroup.eventId) ?? {
        confirmed: 0,
        pending: 0,
      };
      if (checkInGroup.status === "confirmed") {
        current.confirmed = checkInGroup._count._all;
      } else if (checkInGroup.status === "pending") {
        current.pending = checkInGroup._count._all;
      }
      attendanceByEvent.set(checkInGroup.eventId, current);
    }
    return filterEventsByQuery(
      events.map((event) => {
        const attendance = attendanceByEvent.get(event.id) ?? { confirmed: 0, pending: 0 };
        return {
          ...this.toEvent(event),
          confirmedCheckIns: attendance.confirmed,
          pendingCheckIns: attendance.pending,
        };
      }),
      query,
    );
  }

  private async listPassesForUser(userId: string) {
    const passes = await this.prisma.pass.findMany({
      where: { userId },
      orderBy: { generatedAt: "desc" },
    });
    return passes.map((pass) => this.toPass(pass));
  }

  private async createSessionForUser(userId: string) {
    const token = makeSessionToken();
    await this.prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      },
    });
    await this.audit("SESSION_CREATED", userId, "Session", userId);
    return token;
  }

  private async getUserForSessionToken(sessionToken: string) {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(sessionToken) },
      include: { user: { include: { organizerProfile: true, ownedVenues: true } } },
    });
    if (!session || session.expiresAt < new Date()) {
      return null;
    }

    return session.user;
  }

  private async requireUser(sessionToken: string) {
    const user = await this.getUserForSessionToken(sessionToken);
    if (!user) {
      throw new BackendError("UNAUTHENTICATED", "UNAUTHENTICATED");
    }
    if (user.verificationStatus === "SUSPENDED") {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    return user;
  }

  private async requireRole(sessionToken: string, role: AccountRole) {
    const user = await this.requireUser(sessionToken);
    if (user.role !== role) {
      throw new BackendError("FORBIDDEN", "FORBIDDEN");
    }

    return user;
  }

  private async requireEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { perks: true, _count: { select: { passes: true, rsvps: true } } },
    });
    if (!event) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    return event;
  }

  private async lockCheckInEvent(tx: Prisma.TransactionClient, eventId: string) {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`,
    );
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        status: true,
        checkInSettings: true,
      },
    });
    if (!event) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    return event;
  }

  private async requireCheckInEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organizer: { select: { userId: true } },
        venue: { select: { ownerUserId: true } },
        checkInSettings: true,
        perks: true,
        _count: { select: { passes: true, rsvps: true } },
      },
    });
    if (!event) {
      throw new BackendError("NOT_FOUND", "NOT_FOUND");
    }

    return event;
  }

  private async resolveSelfCheckInQr(qrToken: string) {
    if (qrToken.startsWith("fixed:")) {
      return {
        event: await this.requireCheckInEvent(qrToken.slice("fixed:".length)),
        sessionId: undefined,
        qrMode: "fixed" as const,
        valid: true,
      };
    }

    const session = await this.prisma.eventSelfCheckInQrSession.findUnique({
      where: { tokenHash: hashToken(qrToken) },
      include: {
        event: {
          include: {
            organizer: { select: { userId: true } },
            venue: { select: { ownerUserId: true } },
            checkInSettings: true,
            perks: true,
            _count: { select: { passes: true, rsvps: true } },
          },
        },
      },
    });
    if (!session) {
      throw new BackendError("QR_EXPIRED", "QR_EXPIRED");
    }

    return {
      event: session.event,
      sessionId: session.id,
      qrMode: "rotating" as const,
      valid: !session.revokedAt && session.expiresAt >= new Date(),
    };
  }

  private settingsForEvent(event: {
    id: string;
    checkInSettings: {
      eventId: string;
      mode: string;
      state: string;
      qrMode: string;
      fixedQrAcknowledgedAt: Date | null;
    } | null;
  }): CheckInSettingsValue {
    return event.checkInSettings
      ? this.toCheckInSettings(event.checkInSettings)
      : {
          eventId: event.id,
          mode: "staff_only",
          state: "closed",
          qrMode: "rotating",
          fixedQrAcknowledged: false,
        };
  }

  private toCheckInSettings(settings: {
    eventId: string;
    mode: string;
    state: string;
    qrMode: string;
    fixedQrAcknowledgedAt: Date | null;
  }): CheckInSettingsValue {
    return {
      eventId: settings.eventId,
      mode: settings.mode as CheckInMode,
      state: settings.state as CheckInState,
      qrMode: settings.qrMode as OrganizerQrMode,
      fixedQrAcknowledged: Boolean(settings.fixedQrAcknowledgedAt),
    };
  }

  private requireSelfCheckInEnabled(settings: CheckInSettingsValue) {
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

  private requireCheckInConfigurator(
    user: { id: string; role: string; verificationStatus: string },
    event: { organizer: { userId: string } },
  ) {
    if (user.role === "admin") {
      return;
    }
    if (
      user.role === "organizer" &&
      user.verificationStatus === "APPROVED" &&
      event.organizer.userId === user.id
    ) {
      return;
    }
    throw new BackendError("FORBIDDEN", "FORBIDDEN");
  }

  private requireCheckInStaff(
    user: { id: string; role: string; verificationStatus: string },
    event: { organizer: { userId: string }; venue: { ownerUserId: string | null } | null },
  ) {
    if (user.role === "admin") {
      return;
    }
    if (
      user.role === "organizer" &&
      user.verificationStatus === "APPROVED" &&
      event.organizer.userId === user.id
    ) {
      return;
    }
    if (
      user.role === "venue" &&
      user.verificationStatus === "APPROVED" &&
      event.venue?.ownerUserId === user.id
    ) {
      return;
    }
    throw new BackendError("FORBIDDEN", "FORBIDDEN");
  }

  private findUserByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: { organizerProfile: true, ownedVenues: true },
    });
  }

  private async audit(
    action: AuditAction,
    actorUserId: string | undefined,
    targetType: string,
    targetId?: string,
  ) {
    await this.prisma.auditLog.create({
      data: {
        action,
        actorUserId,
        targetType,
        targetId,
      },
    });
  }

  private toUserProfile(user: PrismaUserRecord): UserProfile {
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      role: user.role as AccountRole,
      verificationStatus: user.verificationStatus as UserProfile["verificationStatus"],
      area: user.area,
      bikeModel: user.bikeModel ?? undefined,
      clubName: user.clubName ?? undefined,
      joinedAt: formatJoinedAt(user.createdAt),
      organizerProfileId: user.organizerProfile?.id,
      venueId: user.ownedVenues?.[0]?.id,
    };
  }

  private toEvent(event: PrismaEventRecord): Event {
    const type = dbEventTypeToUi[event.type] ?? "Tambike";
    return {
      id: event.id,
      title: event.title,
      type,
      status: event.status as Event["status"],
      organizerId: event.organizerId,
      venueId: event.venueId ?? venues[0].id,
      poster: event.poster,
      date: event.dateLabel,
      time: event.timeLabel,
      area: event.area,
      shortDescription: event.description,
      whatHappens: event.whatHappens,
      going: event._count?.passes ?? 0,
      interested: event._count?.rsvps ?? 0,
      expectedRiders: event.expectedRiders,
      perkPreview: event.perkPreview,
      tags: event.tags,
      riskFlags: event.riskFlags,
      rideOut: event.rideOutMeetup
        ? {
            meetup: event.rideOutMeetup,
            callTime: event.rideOutCallTime ?? "",
            departure: event.rideOutDeparture ?? "",
            destination: event.rideOutDestination ?? "",
            notes: event.rideOutNotes ?? "",
          }
        : undefined,
      rules: event.safetyRules,
      perks: event.perks.map((perk) => ({
        id: perk.id,
        type: perk.type,
        description: perk.description,
        quantity: perk.quantity ?? undefined,
      })),
    };
  }

  private toPass(pass: {
    id: string;
    eventId: string;
    qrTokenHash: string;
    status: string;
    generatedAt: Date;
  }): Pass {
    return {
      id: pass.id,
      eventId: pass.eventId,
      qrToken: pass.qrTokenHash,
      status: pass.status as Pass["status"],
      generatedAt: pass.generatedAt.toISOString(),
    };
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
