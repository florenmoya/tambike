import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  DemoState,
  UserProfile,
} from "../../src/features/tambike-demo/types";

const loginWithPassword = vi.hoisted(() => vi.fn());
const getSnapshot = vi.hoisted(() => vi.fn());
const setSessionToken = vi.hoisted(() => vi.fn());

vi.mock("../../src/server/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/backend")>();
  return {
    ...actual,
    getTambikeBackend: vi.fn(async () => ({ loginWithPassword, getSnapshot })),
  };
});

vi.mock("../../src/server/session-cookie", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/server/session-cookie")
  >();
  return {
    ...actual,
    readSessionToken: vi.fn(async () => undefined),
    setSessionToken,
  };
});

import { loginWithPasswordAction } from "../../src/server/actions";
import { BackendError } from "../../src/server/backend";

const organizer: UserProfile = {
  id: "organizer-1",
  displayName: "Tambike Organizer",
  email: "organizer@bayanko.ph",
  role: "organizer",
  verificationStatus: "APPROVED",
  accountStatus: "ACTIVE",
  area: "Metro Manila",
  joinedAt: "2026-01-01T00:00:00.000Z",
  organizerProfileId: "organizer-profile-1",
};

const authenticatedState: DemoState = {
  currentUser: organizer,
  users: [organizer],
  events: [],
  passes: [],
  checkInSettings: [],
  passCreated: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  getSnapshot.mockResolvedValue(authenticatedState);
});

describe("loginWithPasswordAction", () => {
  test("returns authenticated state after setting the new session", async () => {
    loginWithPassword.mockResolvedValue({
      user: organizer,
      sessionToken: "session-1",
    });

    await expect(
      loginWithPasswordAction("organizer@bayanko.ph", "password123"),
    ).resolves.toEqual({ ok: true, state: authenticatedState });
    expect(setSessionToken).toHaveBeenCalledWith("session-1");
    expect(getSnapshot).toHaveBeenCalledWith("session-1");
    expect(setSessionToken.mock.invocationCallOrder[0]).toBeLessThan(
      getSnapshot.mock.invocationCallOrder[0],
    );
  });

  test.each([
    ["UNAUTHENTICATED", "INVALID_CREDENTIALS"],
    ["FORBIDDEN", "ACCOUNT_SUSPENDED"],
  ] as const)(
    "maps %s to %s without creating a session",
    async (backendCode, code) => {
      loginWithPassword.mockRejectedValue(new BackendError(backendCode));

      await expect(
        loginWithPasswordAction("rider@example.com", "password123"),
      ).resolves.toEqual({ ok: false, code });
      expect(setSessionToken).not.toHaveBeenCalled();
      expect(getSnapshot).not.toHaveBeenCalled();
    },
  );

  test("maps an expected backend error across a development module reload", async () => {
    const reloadedBackendError = Object.assign(new Error("UNAUTHENTICATED"), {
      name: "BackendError",
      code: "UNAUTHENTICATED" as const,
    });
    loginWithPassword.mockRejectedValue(reloadedBackendError);

    await expect(
      loginWithPasswordAction("rider@example.com", "password123"),
    ).resolves.toEqual({ ok: false, code: "INVALID_CREDENTIALS" });
    expect(setSessionToken).not.toHaveBeenCalled();
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  test("rethrows unexpected failures without creating a session", async () => {
    const unexpected = new Error("database unavailable");
    loginWithPassword.mockRejectedValue(unexpected);

    await expect(
      loginWithPasswordAction("rider@example.com", "password123"),
    ).rejects.toBe(unexpected);
    expect(setSessionToken).not.toHaveBeenCalled();
    expect(getSnapshot).not.toHaveBeenCalled();
  });
});
