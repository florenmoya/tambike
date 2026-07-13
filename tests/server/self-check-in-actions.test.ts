import { describe, expect, test, vi } from "vitest";

const getSelfCheckInContext = vi.hoisted(() => vi.fn());

vi.mock("../../src/server/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/backend")>();

  return {
    ...actual,
    getTambikeBackend: vi.fn(async () => ({ getSelfCheckInContext })),
  };
});

import { getSelfCheckInContextAction } from "../../src/server/actions";
import { BackendError } from "../../src/server/backend";

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
