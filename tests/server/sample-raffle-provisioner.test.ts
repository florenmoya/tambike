import { describe, expect, test } from "vitest";

import {
  COMPLETED_SAMPLE_RAFFLE_TITLE,
  ONGOING_SAMPLE_RAFFLE_TITLE,
  SAMPLE_RAFFLE_EVENT_ID,
  SAMPLE_RAFFLE_WINNER_ALIAS,
  provisionSampleRaffles,
  type SampleRaffleProvisionerDependencies,
  type SampleRaffleProvisioningInput,
  type SampleRaffleTargetInspection,
} from "@/server/giveaways/sample-raffles";

type FakeOptions = {
  inspection?: SampleRaffleTargetInspection;
};

function validInput(): SampleRaffleProvisioningInput {
  return {
    confirmedProduction: true,
    organizerPassword: "runtime-only",
    adminPassword: "runtime-only",
    winnerPassword: "runtime-only",
    drawEncryptionKeyPresent: true,
  };
}

function emptyInspection(): SampleRaffleTargetInspection {
  return {
    eventId: SAMPLE_RAFFLE_EVENT_ID,
    hostEventValid: true,
    completedCampaigns: [],
    ongoingCampaigns: [],
  };
}

function exactFinalInspection(): SampleRaffleTargetInspection {
  return {
    eventId: SAMPLE_RAFFLE_EVENT_ID,
    hostEventValid: true,
    completedCampaigns: [{
      giveawayId: "completed-sample-raffle",
      title: COMPLETED_SAMPLE_RAFFLE_TITLE,
      state: "completed",
      winnerCount: 1,
      winnerAlias: SAMPLE_RAFFLE_WINNER_ALIAS,
    }],
    ongoingCampaigns: [{
      giveawayId: "ongoing-sample-raffle",
      title: ONGOING_SAMPLE_RAFFLE_TITLE,
      state: "open",
      winnerCount: 0,
    }],
  };
}

function partialInspection(): SampleRaffleTargetInspection {
  return {
    ...emptyInspection(),
    completedCampaigns: [{
      giveawayId: "partial-completed-sample-raffle",
      title: COMPLETED_SAMPLE_RAFFLE_TITLE,
      state: "open",
      winnerCount: 0,
    }],
  };
}

function fakeDependencies(options: FakeOptions = {}) {
  const calls: string[] = [];
  let inspectionCount = 0;
  const dependencies: SampleRaffleProvisionerDependencies = {
    async inspectTarget() {
      calls.push("inspectTarget");
      inspectionCount += 1;
      return options.inspection ?? (inspectionCount === 3 ? exactFinalInspection() : emptyInspection());
    },
    async acquireLock() {
      calls.push("acquireLock");
      return { id: "sample-raffle-lock" };
    },
    async releaseLock() {
      calls.push("releaseLock");
    },
    async authenticateOrganizer() {
      calls.push("authenticateOrganizer");
      return { sessionToken: "organizer-session" };
    },
    async authenticateAdmin() {
      calls.push("authenticateAdmin");
      return { sessionToken: "admin-session" };
    },
    async ensureWinner() {
      calls.push("ensureWinner");
      return { sessionToken: "winner-session", riderId: "sample-winner" };
    },
    async ensureWinnerRegistration() {
      calls.push("ensureWinnerRegistration");
    },
    async createCompletedCampaign() {
      calls.push("createCompletedCampaign");
      return { giveawayId: "completed-sample-raffle" };
    },
    async submitCompletedCampaign() {
      calls.push("submitCompletedCampaign");
    },
    async approveCompletedCampaign() {
      calls.push("approveCompletedCampaign");
    },
    async openCompletedCampaign() {
      calls.push("openCompletedCampaign");
    },
    async grantCompletedEntry() {
      calls.push("grantCompletedEntry");
    },
    async lockCompletedCampaign() {
      calls.push("lockCompletedCampaign");
    },
    async selectCompletedWinner() {
      calls.push("selectCompletedWinner");
      return { awardId: "completed-sample-award", drawId: "completed-sample-draw" };
    },
    async publishCompletedDraw() {
      calls.push("publishCompletedDraw");
    },
    async publishWinnerAlias() {
      calls.push("publishWinnerAlias");
    },
    async issueClaim() {
      calls.push("issueClaim");
      return { qrPayload: "runtime-only-claim-payload" };
    },
    async verifyClaim() {
      calls.push("verifyClaim");
    },
    async fulfillAward() {
      calls.push("fulfillAward");
    },
    async completeClaims() {
      calls.push("completeClaims");
    },
    async createOngoingCampaign() {
      calls.push("createOngoingCampaign");
      return { giveawayId: "ongoing-sample-raffle" };
    },
    async submitOngoingCampaign() {
      calls.push("submitOngoingCampaign");
    },
    async approveOngoingCampaign() {
      calls.push("approveOngoingCampaign");
    },
    async openOngoingCampaign() {
      calls.push("openOngoingCampaign");
    },
    async finish() {
      calls.push("finish");
    },
  };
  return Object.assign(dependencies, { calls });
}

describe("sample raffle provisioner safety", () => {
  test("rejects execution without explicit production confirmation", async () => {
    await expect(
      provisionSampleRaffles(
        {
          confirmedProduction: false,
          organizerPassword: "runtime-only",
          adminPassword: "runtime-only",
          winnerPassword: "runtime-only",
          drawEncryptionKeyPresent: true,
        },
        fakeDependencies(),
      ),
    ).rejects.toMatchObject({ code: "PRODUCTION_CONFIRMATION_REQUIRED" });
  });

  test.each([
    ["organizerPassword", "ORGANIZER_CREDENTIAL_REQUIRED"],
    ["adminPassword", "ADMIN_CREDENTIAL_REQUIRED"],
    ["winnerPassword", "WINNER_CREDENTIAL_REQUIRED"],
  ] as const)("rejects a missing runtime credential", async (field, code) => {
    const input = validInput();
    input[field] = "";
    await expect(provisionSampleRaffles(input, fakeDependencies()))
      .rejects.toMatchObject({ code });
  });

  test("rejects a missing draw encryption key before acquiring the write lock", async () => {
    const dependencies = fakeDependencies();
    await expect(
      provisionSampleRaffles(
        { ...validInput(), drawEncryptionKeyPresent: false },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "DRAW_ENCRYPTION_KEY_REQUIRED" });
    expect(dependencies.calls).toEqual(["inspectTarget"]);
  });

  test("returns the existing receipt when both campaigns already match final invariants", async () => {
    const dependencies = fakeDependencies({ inspection: exactFinalInspection() });
    await expect(provisionSampleRaffles(validInput(), dependencies))
      .resolves.toMatchObject({
        eventId: "tambike-cafe-classico",
        completed: { state: "completed", winnerCount: 1 },
        ongoing: { state: "open", winnerCount: 0 },
        changed: false,
      });
    expect(dependencies.calls).not.toContain("createWinner");
  });

  test("fails closed on a conflicting or partial sample campaign", async () => {
    const dependencies = fakeDependencies({ inspection: partialInspection() });
    await expect(provisionSampleRaffles(validInput(), dependencies))
      .rejects.toMatchObject({ code: "CONFLICTING_SAMPLE_STATE" });
    expect(dependencies.calls).not.toContain("createCompletedCampaign");
  });
});

test("runs the completed and ongoing raffle lifecycle in the required safe order", async () => {
  const dependencies = fakeDependencies();

  await expect(provisionSampleRaffles(validInput(), dependencies)).resolves.toMatchObject({
    eventId: SAMPLE_RAFFLE_EVENT_ID,
    completed: { giveawayId: "completed-sample-raffle", state: "completed", winnerCount: 1 },
    ongoing: { giveawayId: "ongoing-sample-raffle", state: "open", winnerCount: 0 },
    changed: true,
  });

  expect(dependencies.calls).toEqual([
    "inspectTarget",
    "acquireLock",
    "inspectTarget",
    "authenticateOrganizer",
    "authenticateAdmin",
    "ensureWinner",
    "ensureWinnerRegistration",
    "createCompletedCampaign",
    "submitCompletedCampaign",
    "approveCompletedCampaign",
    "openCompletedCampaign",
    "grantCompletedEntry",
    "lockCompletedCampaign",
    "selectCompletedWinner",
    "publishCompletedDraw",
    "publishWinnerAlias",
    "issueClaim",
    "verifyClaim",
    "fulfillAward",
    "completeClaims",
    "createOngoingCampaign",
    "submitOngoingCampaign",
    "approveOngoingCampaign",
    "openOngoingCampaign",
    "inspectTarget",
    "releaseLock",
    "finish",
  ]);
});
