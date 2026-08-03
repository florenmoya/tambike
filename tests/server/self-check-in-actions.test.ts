import { beforeEach, describe, expect, test, vi } from "vitest";

const getSelfCheckInContext = vi.hoisted(() => vi.fn());
const registerForEvent = vi.hoisted(() => vi.fn());
const getSnapshot = vi.hoisted(() => vi.fn());
const readSessionToken = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("../../src/server/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/backend")>();

  return {
    ...actual,
    getTambikeBackend: vi.fn(async () => ({
      getSelfCheckInContext,
      registerForEvent,
      getSnapshot,
    })),
  };
});

vi.mock("../../src/server/session-cookie", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/session-cookie")>();
  return {
    ...actual,
    readSessionToken,
    readRequiredSessionToken: async () => {
      const token = await readSessionToken();
      if (!token) throw new Error("UNAUTHENTICATED");
      return token;
    },
  };
});

vi.mock("next/cache", () => ({ revalidatePath }));

import {
  getSelfCheckInContextAction,
  registerForEventAction,
} from "../../src/server/actions";
import { BackendError } from "../../src/server/backend";

beforeEach(() => {
  vi.clearAllMocks();
  readSessionToken.mockResolvedValue("session-token");
  getSnapshot.mockResolvedValue({ events: [] });
});

describe("self-check-in context action", () => {
  test("returns a safe result for an expired or revoked QR instead of rejecting the server action", async () => {
    getSelfCheckInContext.mockRejectedValueOnce(new BackendError("QR_EXPIRED"));

    await expect(getSelfCheckInContextAction("expired-token")).resolves.toMatchObject({
      ok: false,
      code: "QR_EXPIRED",
      title: "This QR is no longer valid",
    });
  });

  test("decodes an encoded fixed QR before resolving its event", async () => {
    getSelfCheckInContext.mockResolvedValueOnce({ available: false });

    await expect(
      getSelfCheckInContextAction("fixed%3Atambike-cafe-classico"),
    ).resolves.toMatchObject({ ok: true, context: { available: false } });
    expect(getSelfCheckInContext).toHaveBeenCalledWith("fixed:tambike-cafe-classico");
  });
});

describe("event registration action", () => {
  test("revalidates the event detail and attendee pages only after registration succeeds", async () => {
    registerForEvent.mockResolvedValueOnce({ rsvp: {}, pass: null });

    await registerForEventAction("event-1", {
      status: "going",
      attendanceType: "direct",
      rosterIdentity: "VISIBLE",
    });

    expect(revalidatePath.mock.calls).toEqual([
      ["/events/event-1"],
      ["/events/event-1/attendees"],
    ]);
    expect(registerForEvent.mock.invocationCallOrder[0]).toBeLessThan(
      revalidatePath.mock.invocationCallOrder[0],
    );
  });

  test("does not revalidate event pages when registration fails", async () => {
    registerForEvent.mockRejectedValueOnce(new BackendError("INVALID_INPUT"));

    await expect(
      registerForEventAction("event-1", {
        status: "going",
        attendanceType: "direct",
        rosterIdentity: "VISIBLE",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
