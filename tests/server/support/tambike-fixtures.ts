import type { TambikeBackend } from "../../../src/server/backend";
import type {
  CreateEventInput,
  Event,
  Pass,
  UserProfile,
} from "../../../src/features/tambike-demo/types";

export type AuthenticatedFixture = {
  user: UserProfile;
  sessionToken: string;
};

export type TestActors = {
  admin: AuthenticatedFixture;
  organizer: AuthenticatedFixture;
  rider: AuthenticatedFixture;
  outsider: AuthenticatedFixture;
};

function fixtureNamespace(namespace: string) {
  const normalized = namespace.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized || "fixture";
}

export async function createTestActors(
  backend: TambikeBackend,
  namespace: string,
): Promise<TestActors> {
  const suffix = fixtureNamespace(namespace);
  const [admin, organizer, rider, outsider] = await Promise.all([
    backend.loginWithPassword("admin@bayanko.ph", "secret_123"),
    backend.loginWithPassword("organizer@bayanko.ph", "password123"),
    backend.signUpRider({
      displayName: "Fixture Rider",
      email: `rider-${suffix}@example.test`,
      password: "password123",
      area: "Quezon City",
    }),
    backend.signUpRider({
      displayName: "Fixture Outsider",
      email: `outsider-${suffix}@example.test`,
      password: "password123",
      area: "Makati City",
    }),
  ]);

  return { admin, organizer, rider, outsider };
}

export async function createPublishedTestEvent(
  backend: TambikeBackend,
  actors: Pick<TestActors, "admin" | "organizer">,
  overrides: Partial<CreateEventInput> = {},
): Promise<Event> {
  const event = await backend.createEventDraft(actors.organizer.sessionToken, {
    title: "Fixture Published Event",
    type: "Bike Night",
    date: "Sat · July 25",
    time: "6:00 PM - 9:00 PM",
    expectedRiders: 40,
    perkPreview: "Fixture check-in sticker",
    locationName: "Fixture Event Grounds",
    locationAddress: "123 Fixture Avenue, Quezon City",
    locationMapLink: "https://maps.example.test/fixture-event",
    area: "Quezon City",
    ...overrides,
  });

  return backend.approvePublish(actors.admin.sessionToken, event.id);
}

export async function registerTestPass(
  backend: TambikeBackend,
  rider: AuthenticatedFixture,
  eventId: string,
): Promise<Pass> {
  const registration = await backend.registerForEvent(rider.sessionToken, eventId, {
    status: "going",
    attendanceType: "direct",
  });

  if (!registration.pass) {
    throw new Error("TEST_PASS_NOT_CREATED");
  }

  return registration.pass;
}
