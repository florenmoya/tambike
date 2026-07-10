import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnvConfig } from "@next/env";
import { demoEvents, mockUsers, organizers, venues } from "../src/features/tambike-demo/data";
import type { EventType } from "../src/features/tambike-demo/types";
import { requireMigrationDatabaseUrl } from "../src/server/database-url";

loadEnvConfig(process.cwd());

const adapter = new PrismaPg(requireMigrationDatabaseUrl());
const prisma = new PrismaClient({ adapter });

const eventTypeMap: Record<EventType, string> = {
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

const demoScannerPass = {
  eventId: "arai-hjc-charity-ride",
  userId: "user-demo-scan-rider",
  rsvpId: "rsvp-arai-hjc-charity-ride-user-demo-scan-rider",
  passId: "pass-arai-hjc-charity-ride-user-demo-scan-rider",
  qrToken: "tbk_yKZKcLiDPmQ91TgS-eqvp4hLRR2PBumJtKt6e2HMA0s",
};

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);
  const adminPasswordHash = await bcrypt.hash("secret_123", 10);
  const internalOwnerPasswordHash = await bcrypt.hash(randomUUID(), 10);

  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.flagReport.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.perkRedemption.deleteMany();
  await prisma.checkIn.deleteMany();
  await prisma.pass.deleteMany();
  await prisma.rSVP.deleteMany();
  await prisma.eventApproval.deleteMany();
  await prisma.perk.deleteMany();
  await prisma.event.deleteMany();
  await prisma.venue.deleteMany();
  await prisma.organizerProfile.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();

  for (const user of mockUsers) {
    await prisma.user.create({
      data: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        passwordHash: user.role === "admin" ? adminPasswordHash : passwordHash,
        role: user.role,
        verificationStatus: user.verificationStatus,
        area: user.area,
        bikeModel: user.bikeModel,
        clubName: user.clubName,
      },
    });

    if (user.role === "organizer") {
      await prisma.organizerProfile.create({
        data: {
          id: `${user.id}-profile`,
          userId: user.id,
          organizerType: "Sample organizer",
          displayName: user.displayName,
          realName: user.displayName,
          contactNumber: "09000000000",
          fbLink: "https://facebook.com/tambike",
          clubPageName: user.displayName,
          reason: "Seeded organizer account for Tambike event operations.",
          pastEventLinks: [],
          verificationStatus: user.verificationStatus,
        },
      });
    }
  }

  await prisma.user.create({
    data: {
      id: demoScannerPass.userId,
      displayName: "Seeded Scan Rider",
      email: "scan-rider@seed.tambike.local",
      passwordHash: internalOwnerPasswordHash,
      role: "rider",
      verificationStatus: "UNVERIFIED",
      area: "Antipolo",
    },
  });

  for (const organizer of organizers) {
    const ownerId = `user-${organizer.id}`;
    await prisma.user.upsert({
      where: { email: `${organizer.id}@seed.tambike.local` },
      create: {
        id: ownerId,
        displayName: organizer.displayName,
        email: `${organizer.id}@seed.tambike.local`,
        passwordHash: internalOwnerPasswordHash,
        role: "organizer",
        verificationStatus: organizer.verificationStatus,
        area: "Philippines",
      },
      update: {},
    });
    await prisma.organizerProfile.upsert({
      where: { id: organizer.id },
      create: {
        id: organizer.id,
        userId: ownerId,
        organizerType: organizer.type,
        displayName: organizer.displayName,
        realName: organizer.displayName,
        contactNumber: "09000000000",
        fbLink: organizer.fbLink,
        clubPageName: organizer.displayName,
        reason: "Seeded organizer profile for Tambike event content.",
        pastEventLinks: [],
        verificationStatus: organizer.verificationStatus,
      },
      update: {},
    });
  }

  for (const venue of venues) {
    await prisma.venue.create({
      data: {
        id: venue.id,
        name: venue.name,
        area: venue.area,
        address: venue.address,
        mapLink: venue.mapLink,
        status: venue.status,
        capacityNotes: venue.capacityNote,
        houseRules: venue.houseRules,
        contact: "Seeded venue contact",
      },
    });
  }

  for (const event of demoEvents) {
    await prisma.event.create({
      data: {
        id: event.id,
        slug: event.id,
        title: event.title,
        type: eventTypeMap[event.type] as never,
        status: event.status,
        organizerId: event.organizerId,
        venueId: event.venueId,
        dateLabel: event.date,
        timeLabel: event.time,
        area: event.area,
        expectedRiders: event.expectedRiders,
        description: event.shortDescription,
        whatHappens: event.whatHappens,
        poster: event.poster,
        perkPreview: event.perkPreview,
        tags: event.tags,
        riskFlags: event.riskFlags,
        rideOutMeetup: event.rideOut?.meetup,
        rideOutCallTime: event.rideOut?.callTime,
        rideOutDeparture: event.rideOut?.departure,
        rideOutDestination: event.rideOut?.destination,
        rideOutNotes: event.rideOut?.notes,
        safetyRules: event.rules,
        perks: {
          create: event.perks.map((perk) => ({
            id: perk.id,
            type: perk.type,
            description: perk.description,
            quantity: perk.quantity,
          })),
        },
      },
    });
  }

  await prisma.rSVP.create({
    data: {
      id: demoScannerPass.rsvpId,
      eventId: demoScannerPass.eventId,
      userId: demoScannerPass.userId,
      status: "going",
      attendanceType: "direct",
      clubName: "Weekend Tambike Crew",
    },
  });
  await prisma.pass.create({
    data: {
      id: demoScannerPass.passId,
      eventId: demoScannerPass.eventId,
      userId: demoScannerPass.userId,
      rsvpId: demoScannerPass.rsvpId,
      qrTokenHash: demoScannerPass.qrToken,
      status: "active",
    },
  });

  await prisma.eventApproval.create({
    data: {
      id: "req-shell-pugon",
      eventId: "arai-hjc-charity-ride",
      approvalType: "venue",
      decision: "pending",
      notes: "Pending driveway staging, donation drop-off table, and batch departure conditions.",
    },
  });
  await prisma.eventApproval.create({
    data: {
      id: "rev-arai-hjc-charity-ride",
      eventId: "arai-hjc-charity-ride",
      approvalType: "admin",
      decision: "pending",
      notes: "Review donation collection, public road ride-out, and beneficiary coordination.",
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
