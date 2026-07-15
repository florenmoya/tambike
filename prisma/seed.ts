import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnvConfig } from "@next/env";
import { PrismaClient as RuntimePrismaClient } from "@prisma/client";
import {
  demoEvents,
  seedUsers,
  TAMBIKE_ORGANIZER_PROFILE_ID,
  TAMBIKE_ORGANIZER_USER_ID,
} from "../src/features/tambike-demo/data";
import type { EventType } from "../src/features/tambike-demo/types";
import { requireMigrationDatabaseUrl } from "../src/server/database-url";

loadEnvConfig(process.cwd());

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

function parseDatabaseName(databaseUrl: string) {
  try {
    const parsed = new URL(databaseUrl);
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
}

export function assertDisposableSeedClient(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const databaseName = parseDatabaseName(databaseUrl);
  if (
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname) ||
    !/^tambike_test_[a-z0-9_]+$/.test(databaseName)
  ) {
    throw new Error("Seed integration calls require a loopback tambike_test_* database URL.");
  }
}

export async function seedPrisma(prisma: PrismaClient) {
  const [giveawayCount, giveawayAuditCount] = await Promise.all([
    prisma.eventGiveaway.count(),
    prisma.giveawayAuditEvent.count(),
  ]);
  if (giveawayCount > 0 || giveawayAuditCount > 0) {
    throw new Error("REFUSING_TO_SEED_WITH_GIVEAWAY_HISTORY");
  }

  const organizer = seedUsers.find((user) => user.id === TAMBIKE_ORGANIZER_USER_ID);
  const admin = seedUsers.find((user) => user.role === "admin");
  if (!organizer || !admin) {
    throw new Error("CANONICAL_SEED_USERS_MISSING");
  }

  const passwordHash = await bcrypt.hash("password123", 10);
  const adminPasswordHash = await bcrypt.hash("secret_123", 10);

  await prisma.$transaction(async (transaction) => {
    await transaction.auditLog.deleteMany();
    await transaction.notification.deleteMany();
    await transaction.flagReport.deleteMany();
    await transaction.lead.deleteMany();
    await transaction.perkRedemption.deleteMany();
    await transaction.checkIn.deleteMany();
    await transaction.eventSelfCheckInQrSession.deleteMany();
    await transaction.eventCheckInSettings.deleteMany();
    await transaction.pass.deleteMany();
    await transaction.rSVP.deleteMany();
    await transaction.eventApproval.deleteMany();
    await transaction.perk.deleteMany();
    await transaction.event.deleteMany();
    await transaction.organizerProfile.deleteMany();
    await transaction.session.deleteMany();
    await transaction.user.deleteMany();

    await transaction.user.create({
      data: {
        id: organizer.id,
        displayName: "Tambike Organizer",
        email: "organizer@bayanko.ph",
        passwordHash,
        role: "organizer",
        verificationStatus: "APPROVED",
        area: organizer.area,
        bikeModel: organizer.bikeModel ?? null,
        clubName: "Tambike Organizer",
      },
    });
    await transaction.organizerProfile.create({
      data: {
        id: TAMBIKE_ORGANIZER_PROFILE_ID,
        userId: TAMBIKE_ORGANIZER_USER_ID,
        organizerType: "Tambike event organizer",
        displayName: "Tambike Organizer",
        realName: "Tambike Organizer",
        contactNumber: "09000000000",
        fbLink: "https://www.facebook.com/tambike",
        clubPageName: "Tambike Organizer",
        reason: "Canonical Tambike organizer account for event operations.",
        pastEventLinks: [],
        verificationStatus: "APPROVED",
      },
    });
    await transaction.user.create({
      data: {
        id: admin.id,
        displayName: admin.displayName,
        email: admin.email,
        passwordHash: adminPasswordHash,
        role: "admin",
        verificationStatus: "APPROVED",
        area: admin.area,
        bikeModel: admin.bikeModel ?? null,
        clubName: admin.clubName ?? null,
      },
    });

    for (const event of demoEvents) {
      await transaction.event.create({
        data: {
          id: event.id,
          slug: event.id,
          title: event.title,
          type: eventTypeMap[event.type] as never,
          status: event.status,
          organizerId: TAMBIKE_ORGANIZER_PROFILE_ID,
          locationName: event.locationName,
          locationAddress: event.locationAddress,
          locationMapLink: event.locationMapLink ?? null,
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
          checkInSettings: {
            create: {
              mode: "staff_only",
              state: "closed",
              qrMode: "rotating",
            },
          },
        },
      });
    }
  });
}

async function main() {
  const databaseUrl = requireMigrationDatabaseUrl();
  const adapter = new PrismaPg(databaseUrl);
  const prisma = new RuntimePrismaClient({ adapter });
  try {
    await seedPrisma(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
