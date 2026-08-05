import { describe, expect, test } from "vitest";

import type {
  CreateGiveawayInput,
  FulfillGiveawayAwardInput,
  GiveawayDeliveryDetailsInput,
  VerifyGiveawayClaimInput,
} from "../../src/features/giveaways/types";
import { createTambikeTestBackend } from "../../src/server/testing";
import { createPublishedTestEvent, createTestActors } from "./support/tambike-fixtures";

type ClaimBackend = Awaited<ReturnType<typeof createTambikeTestBackend>> & {
  issueGiveawayClaimToken(
    sessionToken: string,
    awardId: string,
    input?: { rotate?: boolean },
  ): Promise<{ awardId: string; token: string; qrPayload: string; version: number }>;
  resolveGiveawayClaim(
    sessionToken: string,
    payload: string,
  ): Promise<{ awardId: string; status: string; claimReference: string }>;
  verifyGiveawayClaim(
    sessionToken: string,
    input: VerifyGiveawayClaimInput,
  ): Promise<{ awardId: string; status: string }>;
  fulfillGiveawayAward(
    sessionToken: string,
    input: FulfillGiveawayAwardInput,
  ): Promise<{ awardId: string; status: string }>;
  grantGiveawayOperator(
    sessionToken: string,
    giveawayId: string,
    userId: string,
  ): Promise<{ id: string }>;
  revokeGiveawayOperator(
    sessionToken: string,
    assignmentId: string,
    reason: string,
  ): Promise<{ id: string }>;
  submitGiveawayDeliveryDetails(
    sessionToken: string,
    awardId: string,
    input: GiveawayDeliveryDetailsInput,
  ): Promise<void>;
  readGiveawayDeliveryDetails(
    sessionToken: string,
    awardId: string,
  ): Promise<{ awardId: string; details: Record<string, unknown> }>;
  withdrawGiveawayDeliveryDetails(sessionToken: string, awardId: string): Promise<void>;
  expireGiveawayClaims(sessionToken: string, giveawayId: string): Promise<{ expiredCount: number }>;
  completeGiveawayClaims(sessionToken: string, giveawayId: string): Promise<{ completed: true }>;
  settleGiveawayAward(
    sessionToken: string,
    awardId: string,
    reason: string,
  ): Promise<{ id: string }>;
  recoverExpiredDirectGiveawayAward(
    sessionToken: string,
    input: { awardId: string; claimDeadlineAt: string; reason: string },
  ): Promise<{ awardId: string | null }>;
  redrawGiveawayAward(
    sessionToken: string,
    input: { awardId: string; idempotencyKey: string; reason: string; claimDeadlineAt?: string },
  ): Promise<unknown>;
};

function asClaimBackend(backend: Awaited<ReturnType<typeof createTambikeTestBackend>>) {
  return backend as ClaimBackend;
}

function giveawayInput(
  eventId: string,
  options: { delivery?: boolean; presence?: boolean; globalPresence?: boolean; randomDraw?: boolean } = {},
): CreateGiveawayInput {
  return {
    eventId,
    title: "Secure claim lifecycle",
    kind: "giveaway",
    entryMode: "automatic",
    maxEntriesPerRider: 10,
    mechanics: "One active-pass rider receives one first-come prize.",
    terms: "Claim requires the campaign QR and an authorized giveaway operator.",
    timeZone: "Asia/Manila",
    winnerLimits: { perRider: 1, total: 1 },
    organizerAttestation: true,
    publicVisibility: "hidden",
    presenceVerificationRequired: options.globalPresence,
    eligibilityGroups: [
      {
        id: "active-pass",
        label: "Active pass",
        weight: 1,
        conditions: [{ source: "active_rsvp_pass" }],
      },
    ],
    prizePools: [
      {
        id: "secure-prize",
        title: options.delivery ? "Delivered helmet" : "Onsite helmet",
        awardMode: options.randomDraw ? "random_draw" : "first_come",
        fulfilmentMode: options.delivery ? "delivery" : "onsite",
        publicPresentation: {
          disclosure: "revealed",
          title: "Claim test item",
        },
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Claim test item" }],
        presenceVerificationRequired: options.presence ?? false,
      },
    ],
  };
}

async function withGiveawayKeys<T>(callback: () => Promise<T>) {
  const oldDraw = process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
  const oldDelivery = process.env.GIVEAWAY_DELIVERY_ENCRYPTION_KEY;
  process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64");
  process.env.GIVEAWAY_DELIVERY_ENCRYPTION_KEY = Buffer.alloc(32, 29).toString("base64");
  try {
    return await callback();
  } finally {
    if (oldDraw === undefined) delete process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY;
    else process.env.GIVEAWAY_DRAW_ENCRYPTION_KEY = oldDraw;
    if (oldDelivery === undefined) delete process.env.GIVEAWAY_DELIVERY_ENCRYPTION_KEY;
    else process.env.GIVEAWAY_DELIVERY_ENCRYPTION_KEY = oldDelivery;
  }
}

async function createClaimableAward(
  backend: ClaimBackend,
  options: { delivery?: boolean; presence?: boolean; globalPresence?: boolean; randomDraw?: boolean } = {},
  withRecoveryRider = false,
) {
  const { organizer, admin, rider, outsider } = await createTestActors(
    backend,
    `giveaway-claims-${++claimFixtureSequence}`,
  );
  const event = await createPublishedTestEvent(backend, { organizer, admin }, {
    title: "Secure claim test event",
    type: "Bike Night",
    startDate: "2026-08-15",
    startTime: "19:00",
    endDate: "2026-08-15",
    endTime: "22:00",
    locationName: "Secure Claim Grounds",
    locationAddress: "15 Claim Avenue, Antipolo",
    locationMapLink: "https://maps.example.test/secure-claim-grounds",
    area: "Antipolo",
    expectedRiders: 20,
    perkPreview: "Secure claim",
  });
  const giveaway = await backend.createGiveaway(
    organizer.sessionToken,
    event.id,
    giveawayInput(event.id, options),
  );
  await backend.submitGiveawayForReview(organizer.sessionToken, giveaway.id);
  await backend.reviewGiveawayCompliance(admin.sessionToken, giveaway.id, { decision: "approved" });
  await backend.openGiveaway(organizer.sessionToken, giveaway.id);
  const recoveryRider = withRecoveryRider
    ? await backend.signUpRider({
        displayName: "Recovery candidate",
        email: `recovery-${giveaway.id}@example.test`,
        password: "password123",
        area: "Antipolo",
      })
    : null;
  await backend.registerForEvent(rider.sessionToken, event.id, { status: "going", attendanceType: "direct" });
  if (recoveryRider) {
    await backend.registerForEvent(recoveryRider.sessionToken, event.id, {
      status: "going",
      attendanceType: "direct",
    });
  }
  await withGiveawayKeys(async () => {
    await backend.lockGiveaway(organizer.sessionToken, giveaway.id);
    const draw = await backend.runGiveawayDraw(organizer.sessionToken, {
      giveawayId: giveaway.id,
      idempotencyKey: `claim-publish-${giveaway.id}`,
    });
    await backend.publishGiveawayDraw(organizer.sessionToken, giveaway.id, draw.drawId);
  });

  let selected = await backend.getRiderGiveawayState(rider.sessionToken, giveaway.id);
  let winner = rider;
  if (!selected.award && recoveryRider) {
    selected = await backend.getRiderGiveawayState(recoveryRider.sessionToken, giveaway.id);
    winner = recoveryRider;
  }
  if (!selected.award) throw new Error("TEST_CLAIM_AWARD_MISSING");

  return {
    organizer,
    admin,
    rider,
    outsider,
    recoveryRider,
    winner,
    giveaway,
    awardId: selected.award.awardId,
  };
}

let claimFixtureSequence = 0;

function internalAward(backend: ClaimBackend, giveawayId: string, awardId: string) {
  const store = backend as unknown as {
    giveaways: {
      campaignsById: Map<
        string,
        {
          awards: Array<{
            id: string;
            claimTokenHash?: string;
            claimTokenVersion: number;
            claimDeadlineAt?: string;
            status: string;
            isCurrent: boolean;
          }>;
          prizePools: Array<{ items: Array<{ status: string }> }>;
          state: string;
          claimDeadlineAt?: string;
          auditEvents: Array<{ payload: Record<string, unknown> }>;
        }
      >;
    };
  };
  const campaign = store.giveaways.campaignsById.get(giveawayId);
  const award = campaign?.awards.find((candidate) => candidate.id === awardId);
  if (!campaign || !award) throw new Error("TEST_INTERNAL_AWARD_MISSING");
  return { campaign, award };
}

function internalDeliveryDetail(backend: ClaimBackend, awardId: string) {
  const store = backend as unknown as {
    giveaways: {
      deliveryDetailsByAwardId: Map<
        string,
        { retentionExpiresAt: string; purgedAt?: string; encryptedPayload?: string }
      >;
    };
  };
  const detail = store.giveaways.deliveryDetailsByAwardId.get(awardId);
  if (!detail) throw new Error("TEST_INTERNAL_DELIVERY_DETAIL_MISSING");
  return detail;
}

describe("in-memory giveaway claim security", () => {
  test("issues hash-only tokens once, rotates atomically, and keeps the strict claim QR separate from attendance", async () => {
    const backend = asClaimBackend(
      await createTambikeTestBackend({
        fixture: {
          users: [
            {
              id: "user-unrelated-organizer-claims",
              displayName: "Unrelated Organizer",
              email: "unrelated-organizer-claims@example.test",
              password: "password123",
              role: "organizer",
              verificationStatus: "APPROVED",
              area: "Cebu City",
              joinedAt: "July 15, 2026",
              organizerProfileId: "unrelated-organizer-profile-claims",
            },
          ],
        },
      }),
    );
    const context = await createClaimableAward(backend);
    const unrelatedOrganizer = await backend.loginWithPassword(
      "unrelated-organizer-claims@example.test",
      "password123",
    );

    const first = await backend.issueGiveawayClaimToken(context.rider.sessionToken, context.awardId);
    expect(first.token).toMatch(/^tbk_gc1_[A-Za-z0-9_-]{43}$/);
    expect(first.qrPayload).toBe(`TAMBIKE:GIVEAWAY-CLAIM:v1:${first.token}`);
    const storedFirst = internalAward(backend, context.giveaway.id, context.awardId);
    expect(storedFirst.award.claimTokenHash).toBeDefined();
    expect(storedFirst.award.claimTokenHash).not.toBe(first.token);
    expect(JSON.stringify(storedFirst.campaign.auditEvents)).not.toContain(first.token);
    expect(JSON.stringify(backend.getSnapshot(context.rider.sessionToken))).not.toContain(first.token);

    await expect(
      backend.issueGiveawayClaimToken(context.rider.sessionToken, context.awardId),
    ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
    const rotated = await backend.issueGiveawayClaimToken(context.rider.sessionToken, context.awardId, {
      rotate: true,
    });
    expect(rotated.version).toBe(2);
    await expect(
      backend.resolveGiveawayClaim(context.organizer.sessionToken, first.qrPayload),
    ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
    await expect(
      backend.resolveGiveawayClaim(context.organizer.sessionToken, `TAMBIKE:PASS:v1:${rotated.token}`),
    ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
    await expect(
      backend.listGiveawayOperatorClaims(context.organizer.sessionToken, context.giveaway.id),
    ).resolves.toBeDefined();
    await expect(
      backend.listGiveawayOperatorClaims(context.admin.sessionToken, context.giveaway.id),
    ).resolves.toBeDefined();
    await expect(
      backend.listGiveawayOperatorClaims(context.outsider.sessionToken, context.giveaway.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      backend.listGiveawayOperatorClaims(unrelatedOrganizer.sessionToken, context.giveaway.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      backend.resolveGiveawayClaim(context.organizer.sessionToken, rotated.qrPayload),
    ).resolves.toMatchObject({
      awardId: context.awardId,
      status: "claimable",
    });
  });

  test("uses authorized operator verification and separate idempotent fulfilment", async () => {
    const backend = asClaimBackend(await createTambikeTestBackend());
    const context = await createClaimableAward(backend, { presence: true });
    const claim = await backend.issueGiveawayClaimToken(context.rider.sessionToken, context.awardId);

    await expect(
      backend.getOrganizerGiveawayOperations(context.organizer.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ canCompleteClaims: false });

    await expect(
      backend.verifyGiveawayClaim(context.organizer.sessionToken, {
        payload: claim.qrPayload,
        method: "camera",
        idempotencyKey: "verify-presence",
      }),
    ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
    await expect(
      backend.verifyGiveawayClaim(context.organizer.sessionToken, {
        payload: claim.qrPayload,
        method: "upload",
        idempotencyKey: "verify-presence",
        presenceObserved: true,
      }),
    ).resolves.toMatchObject({ awardId: context.awardId, status: "verified" });
    await expect(
      backend.verifyGiveawayClaim(context.organizer.sessionToken, {
        payload: claim.qrPayload,
        method: "upload",
        idempotencyKey: "verify-presence",
        presenceObserved: true,
      }),
    ).resolves.toMatchObject({ awardId: context.awardId, status: "verified" });
    await expect(
      backend.fulfillGiveawayAward(context.organizer.sessionToken, {
        awardId: context.awardId,
        idempotencyKey: "fulfill-onsite",
        reference: "desk-1",
      }),
    ).resolves.toMatchObject({ awardId: context.awardId, status: "fulfilled" });
    await expect(
      backend.fulfillGiveawayAward(context.organizer.sessionToken, {
        awardId: context.awardId,
        idempotencyKey: "fulfill-onsite",
        reference: "desk-1",
      }),
    ).resolves.toMatchObject({ awardId: context.awardId, status: "fulfilled" });
    await expect(
      backend.getOrganizerGiveawayOperations(context.organizer.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ canCompleteClaims: true });
    await expect(
      backend.completeGiveawayClaims(context.organizer.sessionToken, context.giveaway.id),
    ).resolves.toEqual({ completed: true });
  });

  test("allows explicit operators only while active and keeps delivery encrypted, consented, scoped, and purgeable", async () => {
    const backend = asClaimBackend(await createTambikeTestBackend());
    const context = await createClaimableAward(backend, { delivery: true });
    const explicit = await backend.signUpRider({
      displayName: "Explicit operator",
      email: "explicit-operator@example.test",
      password: "password123",
      area: "Antipolo",
    });
    const claim = await backend.issueGiveawayClaimToken(context.rider.sessionToken, context.awardId);
    const assignment = await backend.grantGiveawayOperator(
      context.organizer.sessionToken,
      context.giveaway.id,
      explicit.user.id,
    );
    await expect(
      backend.resolveGiveawayClaim(explicit.sessionToken, claim.qrPayload),
    ).resolves.toMatchObject({ awardId: context.awardId });
    await backend.revokeGiveawayOperator(context.organizer.sessionToken, assignment.id, "Shift ended");
    await expect(
      backend.resolveGiveawayClaim(explicit.sessionToken, claim.qrPayload),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await withGiveawayKeys(async () => {
      await backend.verifyGiveawayClaim(context.organizer.sessionToken, {
        payload: claim.qrPayload,
        method: "manual",
        idempotencyKey: "verify-delivery",
      });
      await backend.submitGiveawayDeliveryDetails(context.rider.sessionToken, context.awardId, {
        consent: true,
        consentVersion: "delivery-consent-v1",
        details: { recipientName: "Fixture Rider", address: { line1: "42 Test Street" } },
      });
      await expect(
        backend.readGiveawayDeliveryDetails(context.organizer.sessionToken, context.awardId),
      ).resolves.toMatchObject({
        awardId: context.awardId,
        details: { recipientName: "Fixture Rider", address: { line1: "42 Test Street" } },
      });
      await backend.withdrawGiveawayDeliveryDetails(context.rider.sessionToken, context.awardId);
      await expect(
        backend.readGiveawayDeliveryDetails(context.organizer.sessionToken, context.awardId),
      ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
    });
  });

  test("keeps a verified delivery claim fulfilable after its claim deadline", async () => {
    const backend = asClaimBackend(await createTambikeTestBackend());
    const context = await createClaimableAward(backend, { delivery: true });
    const claim = await backend.issueGiveawayClaimToken(context.rider.sessionToken, context.awardId);

    await withGiveawayKeys(async () => {
      await backend.verifyGiveawayClaim(context.organizer.sessionToken, {
        payload: claim.qrPayload,
        method: "manual",
        idempotencyKey: "verify-before-deadline",
      });
      const { award } = internalAward(backend, context.giveaway.id, context.awardId);
      award.claimDeadlineAt = new Date().toISOString();

      await expect(
        backend.submitGiveawayDeliveryDetails(context.rider.sessionToken, context.awardId, {
          consent: true,
          consentVersion: "delivery-consent-v1",
          details: { recipientName: "Fixture Rider", address: { line1: "42 Test Street" } },
        }),
      ).resolves.toBeUndefined();
      await expect(
        backend.fulfillGiveawayAward(context.organizer.sessionToken, {
          awardId: context.awardId,
          idempotencyKey: "fulfill-after-deadline",
          reference: "courier:TRK_after_deadline",
        }),
      ).resolves.toMatchObject({ status: "fulfilled" });
    });
  });

  test("denies delivery fulfilment after retention expires even before the purge job runs", async () => {
    const backend = asClaimBackend(await createTambikeTestBackend());
    const context = await createClaimableAward(backend, { delivery: true });
    const claim = await backend.issueGiveawayClaimToken(context.rider.sessionToken, context.awardId);

    await withGiveawayKeys(async () => {
      await backend.verifyGiveawayClaim(context.organizer.sessionToken, {
        payload: claim.qrPayload,
        method: "manual",
        idempotencyKey: "verify-expired-retention",
      });
      await backend.submitGiveawayDeliveryDetails(context.rider.sessionToken, context.awardId, {
        consent: true,
        consentVersion: "delivery-consent-v1",
        details: { recipientName: "Fixture Rider", address: { line1: "42 Test Street" } },
      });
      internalDeliveryDetail(backend, context.awardId).retentionExpiresAt = new Date().toISOString();

      await expect(
        backend.fulfillGiveawayAward(context.organizer.sessionToken, {
          awardId: context.awardId,
          idempotencyKey: "fulfill-expired-retention",
          reference: "courier:TRK_expired_retention",
        }),
      ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
      expect(internalAward(backend, context.giveaway.id, context.awardId).award.status).toBe("verified");
    });
  });

  test("does not persist raw claim secrets in idempotency, reference, or consent-version fields", async () => {
    const backend = asClaimBackend(await createTambikeTestBackend());
    const context = await createClaimableAward(backend, { delivery: true });
    const claim = await backend.issueGiveawayClaimToken(context.rider.sessionToken, context.awardId);
    const rawSecret = `tbk_gc1_${"a".repeat(43)}`;

    await expect(
      backend.verifyGiveawayClaim(context.organizer.sessionToken, {
        payload: claim.qrPayload,
        method: "manual",
        idempotencyKey: rawSecret,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await withGiveawayKeys(async () => {
      await backend.verifyGiveawayClaim(context.organizer.sessionToken, {
        payload: claim.qrPayload,
        method: "manual",
        idempotencyKey: "verify-secret-guard",
      });
      await expect(
        backend.submitGiveawayDeliveryDetails(context.rider.sessionToken, context.awardId, {
          consent: true,
          consentVersion: rawSecret,
          details: { recipientName: "Fixture Rider", address: { line1: "42 Test Street" } },
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await backend.submitGiveawayDeliveryDetails(context.rider.sessionToken, context.awardId, {
        consent: true,
        consentVersion: "delivery-consent-v1",
        details: { recipientName: "Fixture Rider", address: { line1: "42 Test Street" } },
      });
      await expect(
        backend.fulfillGiveawayAward(context.organizer.sessionToken, {
          awardId: context.awardId,
          idempotencyKey: rawSecret,
          reference: "courier:TRK_secret_guard",
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(
        backend.fulfillGiveawayAward(context.organizer.sessionToken, {
          awardId: context.awardId,
          idempotencyKey: "fulfill-secret-reference",
          reference: `TAMBIKE:GIVEAWAY-CLAIM:v1:${rawSecret}`,
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });
  });

  test("rejects nested raw claim secrets in rider delivery details", async () => {
    const backend = asClaimBackend(await createTambikeTestBackend());
    const context = await createClaimableAward(backend, { delivery: true });
    const claim = await backend.issueGiveawayClaimToken(context.rider.sessionToken, context.awardId);

    await withGiveawayKeys(async () => {
      await backend.verifyGiveawayClaim(context.organizer.sessionToken, {
        payload: claim.qrPayload,
        method: "manual",
        idempotencyKey: "verify-nested-secret-guard",
      });

      await expect(
        backend.submitGiveawayDeliveryDetails(context.rider.sessionToken, context.awardId, {
          consent: true,
          consentVersion: "delivery-consent-v1",
          details: {
            recipientName: "Fixture Rider",
            deliveryNotes: {
              rawClaimToken: claim.token,
              scans: [{ rawClaimQr: claim.qrPayload }],
            },
          },
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });
  });

  test("rejects deadline equality and expires claims without automatic redraw", async () => {
    const backend = asClaimBackend(await createTambikeTestBackend());
    const context = await createClaimableAward(backend);
    const { award } = internalAward(backend, context.giveaway.id, context.awardId);
    award.claimDeadlineAt = new Date().toISOString();

    await expect(
      backend.issueGiveawayClaimToken(context.rider.sessionToken, context.awardId),
    ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
    await expect(backend.expireGiveawayClaims(context.admin.sessionToken, context.giveaway.id)).resolves.toEqual({
      expiredCount: 1,
    });
    expect(internalAward(backend, context.giveaway.id, context.awardId).award.status).toBe("expired");
  });

  test("only expires pending claims while claims are open", async () => {
    const backend = asClaimBackend(await createTambikeTestBackend());
    const context = await createClaimableAward(backend);
    const { campaign, award } = internalAward(backend, context.giveaway.id, context.awardId);
    award.claimDeadlineAt = new Date().toISOString();

    for (const state of ["open", "suspended"] as const) {
      campaign.state = state;
      await expect(
        backend.expireGiveawayClaims(context.admin.sessionToken, context.giveaway.id),
      ).rejects.toMatchObject({ code: "INVALID_GIVEAWAY_STATE" });
      expect(award.status).toBe("claimable");
    }
  });

  test("honors a campaign-wide presence requirement even when a pool inherited false at creation", async () => {
    const backend = asClaimBackend(await createTambikeTestBackend());
    const context = await createClaimableAward(backend, { globalPresence: true });
    const claim = await backend.issueGiveawayClaimToken(context.rider.sessionToken, context.awardId);

    await expect(
      backend.verifyGiveawayClaim(context.organizer.sessionToken, {
        payload: claim.qrPayload,
        method: "camera",
        idempotencyKey: "global-presence",
      }),
    ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });
    await expect(
      backend.verifyGiveawayClaim(context.organizer.sessionToken, {
        payload: claim.qrPayload,
        method: "camera",
        idempotencyKey: "global-presence",
        presenceObserved: true,
      }),
    ).resolves.toMatchObject({ status: "verified" });
  });

  test("expires a direct finite award without silently reallocating it, releases its reservation, and requires explicit settlement before completion", async () => {
    const backend = asClaimBackend(await createTambikeTestBackend());
    const context = await createClaimableAward(backend);
    const { campaign, award } = internalAward(backend, context.giveaway.id, context.awardId);
    award.claimDeadlineAt = new Date().toISOString();

    await expect(backend.expireGiveawayClaims(context.admin.sessionToken, context.giveaway.id)).resolves.toEqual({
      expiredCount: 1,
    });
    expect(award.status).toBe("expired");
    expect(award.isCurrent).toBe(false);
    expect(campaign.prizePools[0]?.items[0]?.status).toBe("available");
    expect(campaign.state).toBe("claims_open");

    await expect(
      backend.getRiderGiveawayState(context.rider.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ status: "expired", award: { awardId: context.awardId, status: "expired" } });

    await expect(
      backend.completeGiveawayClaims(context.organizer.sessionToken, context.giveaway.id),
    ).rejects.toMatchObject({ code: "INVALID_GIVEAWAY_STATE" });
    await expect(
      backend.settleGiveawayAward(
        context.organizer.sessionToken,
        context.awardId,
        "Close the expired direct-award recovery source.",
      ),
    ).resolves.toEqual({ id: context.awardId });
    await expect(
      backend.completeGiveawayClaims(context.organizer.sessionToken, context.giveaway.id),
    ).resolves.toEqual({ completed: true });
    expect(campaign.state).toBe("completed");
  });

  test("rejects a late rider decline and never persists a human address as a fulfilment reference", async () => {
    const backend = asClaimBackend(await createTambikeTestBackend());
    const context = await createClaimableAward(backend);
    const { award } = internalAward(backend, context.giveaway.id, context.awardId);
    award.claimDeadlineAt = new Date().toISOString();

    await expect(
      backend.declineGiveawayAward(context.rider.sessionToken, context.awardId, "Cannot collect"),
    ).rejects.toMatchObject({ code: "GIVEAWAY_AWARD_INVALID" });

    award.claimDeadlineAt = new Date(Date.now() + 60_000).toISOString();
    const claim = await backend.issueGiveawayClaimToken(context.rider.sessionToken, context.awardId);
    await backend.verifyGiveawayClaim(context.organizer.sessionToken, {
      payload: claim.qrPayload,
      method: "manual",
      idempotencyKey: "verify-opaque-reference",
    });
    await expect(
      backend.fulfillGiveawayAward(context.organizer.sessionToken, {
        awardId: context.awardId,
        idempotencyKey: "fulfill-unsafe-reference",
        reference: "Fixture Rider, 42 Test Street, Antipolo",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      backend.fulfillGiveawayAward(context.organizer.sessionToken, {
        awardId: context.awardId,
        idempotencyKey: "fulfill-opaque-reference",
        reference: "courier:TRK_4pa8-92Z",
      }),
    ).resolves.toMatchObject({ status: "fulfilled" });
  });

  test("requires an explicit future-deadline recovery before an expired direct prize can be reallocated", async () => {
    const backend = asClaimBackend(await createTambikeTestBackend());
    const context = await createClaimableAward(backend, {}, true);
    if (!context.recoveryRider) throw new Error("TEST_RECOVERY_RIDER_MISSING");
    const { award } = internalAward(backend, context.giveaway.id, context.awardId);
    award.claimDeadlineAt = new Date().toISOString();
    await backend.expireGiveawayClaims(context.admin.sessionToken, context.giveaway.id);

    await expect(
      backend.recoverExpiredDirectGiveawayAward(context.organizer.sessionToken, {
        awardId: context.awardId,
        claimDeadlineAt: new Date().toISOString(),
        reason: "Reoffer the released item",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const replacement = await backend.recoverExpiredDirectGiveawayAward(context.organizer.sessionToken, {
      awardId: context.awardId,
      claimDeadlineAt: new Date(Date.now() + 60_000).toISOString(),
      reason: "Reoffer the released item",
    });
    expect(replacement.awardId).toBeTruthy();
    const recoveryState = await backend.getRiderGiveawayState(
      context.recoveryRider.sessionToken,
      context.giveaway.id,
    );
    expect(recoveryState.award).toMatchObject({ awardId: replacement.awardId });
    expect(recoveryState.award?.claimDeadlineAt).not.toBe(award.claimDeadlineAt);
  });

  test("requires and exposes a fresh deadline when redrawing an expired random award", async () => {
    const backend = asClaimBackend(await createTambikeTestBackend());
    const context = await createClaimableAward(backend, { randomDraw: true }, true);
    const { campaign, award } = internalAward(backend, context.giveaway.id, context.awardId);
    const elapsed = new Date().toISOString();
    campaign.claimDeadlineAt = elapsed;
    award.claimDeadlineAt = elapsed;
    await backend.expireGiveawayClaims(context.admin.sessionToken, context.giveaway.id);

    await expect(
      backend.getRiderGiveawayState(context.winner.sessionToken, context.giveaway.id),
    ).resolves.toMatchObject({ status: "expired", award: { awardId: context.awardId, status: "expired" } });

    const freshDeadline = new Date(Date.now() + 60_000).toISOString();
    await withGiveawayKeys(async () => {
      await backend.redrawGiveawayAward(context.organizer.sessionToken, {
        awardId: context.awardId,
        idempotencyKey: "redraw-expired-with-fresh-deadline",
        reason: "Winner did not claim in time",
        claimDeadlineAt: freshDeadline,
      });
    });
    const replacement = campaign.awards.find((candidate) => candidate.isCurrent && candidate.id !== award.id);
    expect(replacement).toMatchObject({ claimDeadlineAt: freshDeadline, status: "claimable" });
  });
});
