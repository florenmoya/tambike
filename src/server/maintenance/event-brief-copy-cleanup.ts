import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { demoEvents } from "@/features/tambike-demo/data";

export const LEGACY_EVENT_BRIEF_COPY_BY_ID = {
  "tambike-cafe-classico":
    "Riders arrive direct at Casa Classico, park, check in, grab coffee, talk bikes, and hang out without a ride-out or formal program.",
  "motoir-national-round-5":
    "Riders, teams, and spectators check in at the circuit, follow paddock access rules, and track the schedule for race heats across the weekend.",
  "motul-motoir-youth-cup-15-16":
    "Youth race teams check in, verify class assignments, stage in paddock lanes, and run the final race weekend under circuit marshal control.",
  "petron-sgp-round-3":
    "Scooter racers and spectators check in at the circuit, follow the posted race calendar, and receive updates if the schedule shifts.",
  "calabarzon-endurance-ride":
    "Riders check in before dawn, attend briefing, confirm route batches, ride the endurance loop, and return for finisher validation.",
  "laguna-motofest-2026":
    "Visitors scan in at the convention center, browse displays and booths, join club networking, and save event updates for the two-day program.",
  "ngo-street-drag-final-2026":
    "Teams and spectators check in at Clark, follow lane and staging controls, and track final-leg updates across the two-day race weekend.",
  "ir-ph-endurance-rd3":
    "Teams submit applications before event day, check in at Tarlac Circuit Hill, verify paddock assignments, and follow endurance championship controls.",
  "mindanao-wide-motocross-2026-2nd-leg":
    "Motocross teams and spectators check in at the race ground, follow staging controls, watch heats, and keep track access limited to marshaled riders.",
  "arai-hjc-charity-ride":
    "Riders meet at Shell Pugon, check in, record cash or kind donations, roll out by batch, and regroup at the beneficiary stop in Pililla.",
  "ducati-track-day-clark":
    "Riders register for track access, pass gear inspection, attend intro lessons, request test-ride slots, and receive paddock support from the technical team.",
  "long-ride-charity-zambales":
    "Participants check in before dawn, confirm convoy batches, ride the north route, and record charity participation for the club report.",
  "mandirigma-endutour-v5":
    "Riders register by category, attend route briefing, scan in before release, complete checkpoints, and return with validated route logs.",
  "motoir-national-round-4":
    "Spectators and teams check in at the circuit, follow pit and paddock access rules, watch scheduled heats, and receive event updates if race dates shift.",
  "makina-moto-expo-cebu":
    "Visitors scan in at the expo, browse motorcycle launches and gear booths, save brand-interest leads, and claim booth priority perks.",
  "tambike-night-malabon":
    "Riders arrive at the cafe, park by group, buy snacks or drinks onsite, compare builds, and keep the night casual with no ride-out program.",
  "boys-underbone-laguna-tambike":
    "Underbone riders check in at Agojo, welcome new members, prepare group content, park together, and keep the meetup casual.",
  "swabz-classic-bike-tambike":
    "Classic bike riders arrive at the shop, check in for raffle eligibility, meet other classic riders, and join the casual re-opening tambike.",
  "yloco-bandits-classic-tambike":
    "Classic motorcycle riders park at Bro's Brew, grab coffee, meet the Yloco Bandits, and hang out with fellow riders from the north.",
  "kape-mo-to-tagaytay-tambike":
    "Riders arrive direct at Kape Mo-To, park at the motorist station, connect with other riders, and keep the activity as a stationary tambike.",
  "fullprint-manila-tambike":
    "Riders and e-scooter owners arrive at the cafe, check in for the breakfast headcount, browse partner displays, and hang out onsite.",
  "boys-garage-crossmeet-tambike":
    "Riders meet at the coffee spot, park with their groups, support the cause, and keep the night stationary with no stunts, racing, or loud revving.",
  "ccph-upper-east-tambike":
    "Riders pin the shop location, register onsite for raffles, park with the chapter, and follow safe tambike rules around the venue.",
  "ccph-cebu-official-tambike":
    "Cebu riders arrive at Mactan Town Center, group by chapter, check in, and keep the meetup focused on parked bikes and community.",
} as const;

export interface EventBriefCopyCleanupSnapshot {
  events: Array<{
    id: string;
    whatHappens: string;
  }>;
}

export interface EventBriefCopyCleanupPlan {
  eventUpdates: Array<{
    id: string;
    from: string;
    to: string;
  }>;
}

export interface EventBriefCopyCleanupStore {
  inspect(): Promise<EventBriefCopyCleanupSnapshot>;
  apply(plan: EventBriefCopyCleanupPlan): Promise<void>;
  close(): Promise<void>;
}

export interface EventBriefCopyCleanupTransaction {
  event: {
    updateMany(input: {
      where: { id: string; whatHappens: string };
      data: { whatHappens: string };
    }): Promise<{ count: number }>;
  };
}

const newDescriptionById = new Map(
  demoEvents.map((event) => [event.id, event.whatHappens]),
);

export function buildEventBriefCopyCleanupPlan(
  snapshot: EventBriefCopyCleanupSnapshot,
): EventBriefCopyCleanupPlan {
  const eventUpdates = snapshot.events.flatMap((event) => {
    const legacyDescription =
      LEGACY_EVENT_BRIEF_COPY_BY_ID[
        event.id as keyof typeof LEGACY_EVENT_BRIEF_COPY_BY_ID
      ];
    const newDescription = newDescriptionById.get(event.id);

    if (
      !legacyDescription ||
      !newDescription ||
      event.whatHappens !== legacyDescription ||
      event.whatHappens === newDescription
    ) {
      return [];
    }

    return [
      {
        id: event.id,
        from: legacyDescription,
        to: newDescription,
      },
    ];
  });

  return { eventUpdates };
}

export function describeEventBriefDatabaseTarget(databaseUrl: string) {
  const target = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(target.protocol)) {
    throw new Error("DATABASE_URL_MUST_BE_POSTGRES");
  }
  const database = decodeURIComponent(target.pathname.replace(/^\/+/, ""));
  if (!target.hostname || !database) {
    throw new Error("DATABASE_URL_TARGET_REQUIRED");
  }
  return { host: target.hostname, database };
}

export async function applyEventBriefCopyCleanupPlan(
  transaction: EventBriefCopyCleanupTransaction,
  plan: EventBriefCopyCleanupPlan,
) {
  for (const update of plan.eventUpdates) {
    const result = await transaction.event.updateMany({
      where: {
        id: update.id,
        whatHappens: update.from,
      },
      data: { whatHappens: update.to },
    });
    if (result.count !== 1) {
      throw new Error(`EVENT_BRIEF_COPY_CHANGED:${update.id}`);
    }
  }
}

export function createPrismaEventBriefCopyCleanup(
  databaseUrl: string,
): EventBriefCopyCleanupStore {
  const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
  const eventIds = Object.keys(LEGACY_EVENT_BRIEF_COPY_BY_ID);

  return {
    async inspect() {
      const events = await prisma.event.findMany({
        where: { id: { in: eventIds } },
        select: { id: true, whatHappens: true },
        orderBy: { id: "asc" },
      });
      return { events };
    },
    async apply(plan) {
      await prisma.$transaction(async (tx) => {
        await applyEventBriefCopyCleanupPlan(
          {
            event: {
              updateMany: (input) => tx.event.updateMany(input),
            },
          },
          plan,
        );
      });
    },
    close: () => prisma.$disconnect(),
  };
}
