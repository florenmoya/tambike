import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import type { EventLocationInput } from "../../src/features/tambike-demo/types";

function sessionTokenHash(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

const defaultLocation: EventLocationInput = {
  locationName: "Integration Tambike Cafe",
  locationAddress: "42 Integration Avenue, Antipolo, Rizal",
  locationMapLink: "https://maps.example.test/integration-tambike-cafe",
  area: "Antipolo",
};

export async function createPrismaEventFixture(
  prisma: PrismaClient,
  options: {
    suffix?: string;
    riderCount?: number;
    location?: EventLocationInput;
  } = {},
): Promise<{
  eventId: string;
  organizerId: string;
  organizerProfileId: string;
  organizerSession: string;
  adminId: string;
  adminSession: string;
  riders: Array<{ userId: string; sessionToken: string; passId?: string }>;
}> {
  const suffix = options.suffix ?? randomUUID();
  const riderCount = options.riderCount ?? 1;
  const location = options.location ?? defaultLocation;
  const organizerId = `integration-organizer-${suffix}`;
  const organizerProfileId = `integration-organizer-profile-${suffix}`;
  const adminId = `integration-admin-${suffix}`;
  const eventId = `integration-event-${suffix}`;
  const organizerSession = `integration-organizer-session-${suffix}`;
  const adminSession = `integration-admin-session-${suffix}`;
  const riders = Array.from({ length: riderCount }, (_, index) => {
    const riderKey = index === 0 ? "rider" : `rider-${index + 1}`;
    return {
      userId: `integration-${riderKey}-${suffix}`,
      sessionToken: `integration-${riderKey}-session-${suffix}`,
      passId: `integration-pass-${riderKey}-${suffix}`,
      rsvpId: `integration-rsvp-${riderKey}-${suffix}`,
      index,
    };
  });

  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({
      data: [
        {
          id: organizerId,
          displayName: "Integration Organizer",
          email: `integration-organizer-${suffix}@example.test`,
          passwordHash: "integration-only",
          role: "organizer",
          verificationStatus: "APPROVED",
          accountStatus: "ACTIVE",
          area: location.area,
        },
        {
          id: adminId,
          displayName: "Integration Administrator",
          email: `integration-admin-${suffix}@example.test`,
          passwordHash: "integration-only",
          role: "admin",
          verificationStatus: "APPROVED",
          accountStatus: "ACTIVE",
          area: location.area,
        },
        ...riders.map((rider) => ({
          id: rider.userId,
          displayName: rider.index === 0 ? "Integration Rider" : `Integration Rider ${String.fromCharCode(65 + rider.index)}`,
          email: `integration-rider-${rider.index + 1}-${suffix}@example.test`,
          passwordHash: "integration-only",
          role: "rider" as const,
          verificationStatus: "UNVERIFIED" as const,
          accountStatus: "ACTIVE" as const,
          area: location.area,
        })),
      ],
    });
    await tx.organizerProfile.create({
      data: {
        id: organizerProfileId,
        userId: organizerId,
        organizerType: "Integration test organizer",
        displayName: "Integration Organizer",
        realName: "Integration Organizer",
        contactNumber: "09000000000",
        fbLink: "https://example.test/organizer",
        reason: "Disposable integration test only.",
        pastEventLinks: [],
        verificationStatus: "APPROVED",
      },
    });
    await tx.event.create({
      data: {
        id: eventId,
        slug: eventId,
        title: "Disposable integration event",
        type: "BIKE_NIGHT",
        status: "PUBLISHED",
        submissionVersion: 1,
        organizerId: organizerProfileId,
        locationName: location.locationName,
        locationAddress: location.locationAddress,
        locationMapLink: location.locationMapLink ?? null,
        dateLabel: "July 25, 2099",
        timeLabel: "7:00 PM - 10:00 PM",
        startsAt: new Date("2099-07-25T11:00:00.000Z"),
        endsAt: new Date("2099-07-25T14:00:00.000Z"),
        timeZone: "Asia/Manila",
        recurrence: "NONE",
        area: location.area,
        expectedRiders: Math.max(1, riderCount),
        description: "Disposable integration event.",
        whatHappens: "Tests Prisma fixture ownership.",
        poster: "/integration-poster.png",
        perkPreview: "Disposable giveaway",
        tags: [],
        riskFlags: [],
        safetyRules: [],
      },
    });
    const approvedAt = new Date();
    await tx.eventApproval.create({
      data: {
        id: `integration-event-approval-${suffix}`,
        eventId,
        submissionVersion: 1,
        reviewerId: adminId,
        decision: "published",
        submittedAt: approvedAt,
        decidedAt: approvedAt,
      },
    });
    for (const rider of riders) {
      await tx.rSVP.create({
        data: {
          id: rider.rsvpId,
          eventId,
          userId: rider.userId,
          status: "going",
          goingAt: new Date(),
          attendanceType: "direct",
        },
      });
      await tx.pass.create({
        data: {
          id: rider.passId,
          eventId,
          userId: rider.userId,
          rsvpId: rider.rsvpId,
          qrTokenHash: `integration-pass-token-${rider.index + 1}-${suffix}`,
          status: "active",
        },
      });
    }
    await tx.session.createMany({
      data: [
        {
          id: `integration-session-organizer-${suffix}`,
          tokenHash: sessionTokenHash(organizerSession),
          userId: organizerId,
          expiresAt: new Date(Date.now() + 60_000),
        },
        {
          id: `integration-session-admin-${suffix}`,
          tokenHash: sessionTokenHash(adminSession),
          userId: adminId,
          expiresAt: new Date(Date.now() + 60_000),
        },
        ...riders.map((rider) => ({
          id: `integration-session-rider-${rider.index + 1}-${suffix}`,
          tokenHash: sessionTokenHash(rider.sessionToken),
          userId: rider.userId,
          expiresAt: new Date(Date.now() + 60_000),
        })),
      ],
    });
  });

  return {
    eventId,
    organizerId,
    organizerProfileId,
    organizerSession,
    adminId,
    adminSession,
    riders: riders.map((rider) => ({
      userId: rider.userId,
      sessionToken: rider.sessionToken,
      passId: rider.passId,
    })),
  };
}
