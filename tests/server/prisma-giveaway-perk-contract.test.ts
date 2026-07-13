import { describe, expect, test, vi } from "vitest";

import { BackendError } from "../../src/server/backend";
import { PrismaTambikeBackend } from "../../src/server/prisma-backend";

function createPerkRedemptionBackend(input: {
  existingRedemption?: { id: string } | null;
  pass?: { id: string } | null;
  perkQuantity?: number | null;
  redeemedCount?: number;
  role?: "rider" | "organizer";
} = {}) {
  const rider = {
    id: "rider-1",
    role: input.role ?? "rider",
    verificationStatus: "APPROVED",
  };
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "perk-1" }]),
    event: {
      findUnique: vi.fn().mockResolvedValue({
        id: "event-1",
        organizer: { userId: "organizer-1" },
        perks: [],
      }),
    },
    perk: {
      findUnique: vi.fn().mockResolvedValue({
        id: "perk-1",
        eventId: "event-1",
        quantity: input.perkQuantity ?? null,
      }),
    },
    pass: {
      findFirst: vi.fn().mockResolvedValue(input.pass === undefined ? { id: "pass-1" } : input.pass),
    },
    perkRedemption: {
      findFirst: vi.fn().mockResolvedValue(input.existingRedemption ?? null),
      count: vi.fn().mockResolvedValue(input.redeemedCount ?? 0),
      create: vi.fn().mockResolvedValue({ id: "redemption-1" }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
    eventGiveaway: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const prisma = {
    session: {
      findUnique: vi.fn().mockResolvedValue({
        expiresAt: new Date(Date.now() + 60_000),
        user: rider,
      }),
    },
    perk: { findUnique: vi.fn().mockResolvedValue({ eventId: "event-1" }) },
    $transaction: vi.fn(async (operation: (tx: typeof transaction) => unknown) => operation(transaction)),
  };
  const backend = new (
    PrismaTambikeBackend as unknown as {
      new (client: typeof prisma): PrismaTambikeBackend;
    }
  )(prisma);

  return { backend, prisma, transaction };
}

describe("Prisma giveaway perk redemption contract", () => {
  test("exposes the rider-owned giveaway perk redemption API", () => {
    const redeemGiveawayPerk = (
      PrismaTambikeBackend.prototype as unknown as {
        redeemGiveawayPerk?: unknown;
      }
    ).redeemGiveawayPerk;

    expect(redeemGiveawayPerk).toBeTypeOf("function");
    expect(
      (redeemGiveawayPerk as (sessionToken: string, perkId: string) => Promise<unknown>).length,
    ).toBe(2);
  });

  test("records a rider's eligible redemption, audits it, and reconciles open automatic campaigns", async () => {
    const { backend, transaction } = createPerkRedemptionBackend();

    await expect(backend.redeemGiveawayPerk("session-token", "perk-1")).resolves.toEqual({
      perkId: "perk-1",
      status: "redeemed",
    });

    expect(transaction.pass.findFirst).toHaveBeenCalledWith({
      where: {
        eventId: "event-1",
        userId: "rider-1",
        status: { not: "cancelled" },
      },
      orderBy: { generatedAt: "asc" },
    });
    expect(transaction.perkRedemption.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        perkId: "perk-1",
        userId: "rider-1",
        status: "redeemed",
        redeemedBy: "rider-1",
      }),
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "GIVEAWAY_PERK_REDEEMED",
        actorUserId: "rider-1",
        targetType: "PerkRedemption",
        targetId: "redemption-1",
        metadata: { eventId: "event-1", perkId: "perk-1" },
      }),
    });
    expect(transaction.eventGiveaway.findMany).toHaveBeenCalledWith({
      where: { eventId: "event-1", status: "open", entryMode: "automatic" },
      select: { id: true },
      orderBy: { id: "asc" },
    });
  });

  test("rejects a non-rider before it starts a perk redemption transaction", async () => {
    const { backend, prisma } = createPerkRedemptionBackend({ role: "organizer" });

    await expect(backend.redeemGiveawayPerk("session-token", "perk-1")).rejects.toEqual(
      new BackendError("FORBIDDEN", "FORBIDDEN"),
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test("returns an existing redeemed record without consuming another finite perk", async () => {
    const { backend, transaction } = createPerkRedemptionBackend({
      existingRedemption: { id: "redemption-existing" },
      perkQuantity: 1,
      redeemedCount: 1,
    });

    await expect(backend.redeemGiveawayPerk("session-token", "perk-1")).resolves.toEqual({
      perkId: "perk-1",
      status: "redeemed",
    });

    expect(transaction.perkRedemption.count).not.toHaveBeenCalled();
    expect(transaction.perkRedemption.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
    expect(transaction.eventGiveaway.findMany).not.toHaveBeenCalled();
  });

  test("rejects a rider without a non-cancelled pass before allocating a redemption", async () => {
    const { backend, transaction } = createPerkRedemptionBackend({ pass: null });

    await expect(backend.redeemGiveawayPerk("session-token", "perk-1")).rejects.toEqual(
      new BackendError("GIVEAWAY_ENTRY_NOT_ELIGIBLE", "GIVEAWAY_ENTRY_NOT_ELIGIBLE"),
    );

    expect(transaction.perkRedemption.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  test("keeps a finite perk unavailable once its locked redeemed capacity is full", async () => {
    const { backend, transaction } = createPerkRedemptionBackend({
      perkQuantity: 1,
      redeemedCount: 1,
    });

    await expect(backend.redeemGiveawayPerk("session-token", "perk-1")).rejects.toEqual(
      new BackendError("GIVEAWAY_PERK_UNAVAILABLE", "GIVEAWAY_PERK_UNAVAILABLE"),
    );

    expect(transaction.perkRedemption.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });
});
