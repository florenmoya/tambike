import { describe, expect, test } from "vitest";

import {
  COMPLETED_SAMPLE_RAFFLE_TITLE,
  SAMPLE_RAFFLE_EVENT_ID,
  SAMPLE_RAFFLE_WINNER_ALIAS,
  productionSampleRaffleManifest,
  provisionSampleRaffles,
  type SampleRaffleManifest,
  type SampleRaffleProvisionerDependencies,
  type SampleRaffleProvisioningInput,
  type SampleRaffleTargetInspection,
} from "@/server/giveaways/sample-raffles";

type FakeOptions = {
  inspection?: SampleRaffleTargetInspection;
  finalInspection?: SampleRaffleTargetInspection;
};

type CompletedFinalCampaign = SampleRaffleTargetInspection["completedCampaigns"][number] & {
  currentAwards: Array<{
    status: string;
    winnerAlias?: string;
    winnerAliasPublished: boolean;
  }>;
};

type OngoingFinalCampaign = SampleRaffleTargetInspection["ongoingCampaigns"][number] & {
  snapshotCount: number;
  drawCount: number;
  awardCount: number;
  resultCount: number;
};

type RichTargetInspection = Omit<SampleRaffleTargetInspection, "completedCampaigns" | "ongoingCampaigns"> & {
  completedCampaigns: CompletedFinalCampaign[];
  ongoingCampaigns: OngoingFinalCampaign[];
};

function validInput(): SampleRaffleProvisioningInput {
  return {
    confirmedProduction: true,
    organizerPassword: "runtime-only",
    adminPassword: "runtime-only",
    winnerPassword: "runtime-only",
    drawEncryptionKeyPresent: true,
    databaseTargetPresent: true,
    directLockPresent: true,
  };
}

function emptyInspection(
  manifest: SampleRaffleManifest = productionSampleRaffleManifest,
): SampleRaffleTargetInspection {
  return {
    eventId: manifest.eventId,
    hostEventValid: true,
    completedCampaigns: [],
    ongoingCampaigns: [],
  };
}

function exactFinalInspection(
  manifest: SampleRaffleManifest = productionSampleRaffleManifest,
): RichTargetInspection {
  return {
    eventId: manifest.eventId,
    hostEventValid: true,
    completedCampaigns: [{
      giveawayId: "completed-sample-raffle",
      title: manifest.completedTitle,
      state: "completed",
      winnerCount: 1,
      winnerAlias: manifest.winnerAlias,
      currentAwards: [{
        status: "fulfilled",
        winnerAlias: manifest.winnerAlias,
        winnerAliasPublished: true,
      }],
    }],
    ongoingCampaigns: [{
      giveawayId: "ongoing-sample-raffle",
      title: manifest.ongoingTitle,
      state: "open",
      winnerCount: 0,
      snapshotCount: 0,
      drawCount: 0,
      awardCount: 0,
      resultCount: 0,
    }],
  } as RichTargetInspection;
}

function partialInspection(): SampleRaffleTargetInspection {
  return {
    ...emptyInspection(),
    completedCampaigns: [{
      giveawayId: "partial-completed-sample-raffle",
      title: COMPLETED_SAMPLE_RAFFLE_TITLE,
      state: "open",
      winnerCount: 0,
      currentAwards: [],
    }],
  };
}

function fakeDependencies(options: FakeOptions = {}) {
  const calls: string[] = [];
  let inspectionCount = 0;
  const dependencies: SampleRaffleProvisionerDependencies = {
    async inspectTarget(manifest) {
      calls.push("inspectTarget");
      inspectionCount += 1;
      return options.inspection ?? (
        inspectionCount === 3
          ? (options.finalInspection ?? exactFinalInspection(manifest))
          : emptyInspection(manifest)
      );
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
          databaseTargetPresent: true,
          directLockPresent: true,
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

  test.each([
    ["databaseTargetPresent", "DATABASE_TARGET_REQUIRED"],
    ["directLockPresent", "DIRECT_LOCK_REQUIRED"],
  ] as const)("requires an explicit true %s prerequisite before any write activity", async (field, code) => {
    const input = { ...validInput() } as Record<string, unknown>;
    delete input[field];
    const dependencies = fakeDependencies();

    await expect(provisionSampleRaffles(input as unknown as SampleRaffleProvisioningInput, dependencies))
      .rejects.toMatchObject({ code });
    expect(dependencies.calls).toEqual([]);
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

  test.each([
    ["completed award is not fulfilled", (inspection: RichTargetInspection) => {
      inspection.completedCampaigns[0].currentAwards[0].status = "verified";
    }],
    ["completed campaign has more than one current award", (inspection: RichTargetInspection) => {
      inspection.completedCampaigns[0].currentAwards.push({
        status: "fulfilled",
        winnerAlias: SAMPLE_RAFFLE_WINNER_ALIAS,
        winnerAliasPublished: true,
      });
    }],
    ["completed winner alias is not published", (inspection: RichTargetInspection) => {
      inspection.completedCampaigns[0].currentAwards[0].winnerAliasPublished = false;
    }],
    ["ongoing campaign has a draw snapshot", (inspection: RichTargetInspection) => {
      inspection.ongoingCampaigns[0].snapshotCount = 1;
    }],
    ["ongoing campaign has a draw", (inspection: RichTargetInspection) => {
      inspection.ongoingCampaigns[0].drawCount = 1;
    }],
    ["ongoing campaign has an award", (inspection: RichTargetInspection) => {
      inspection.ongoingCampaigns[0].awardCount = 1;
    }],
    ["ongoing campaign has a published result", (inspection: RichTargetInspection) => {
      inspection.ongoingCampaigns[0].resultCount = 1;
    }],
  ])("rejects a final inspection when the %s", async (_description, mutate) => {
    const inspection = structuredClone(exactFinalInspection());
    mutate(inspection);
    const dependencies = fakeDependencies({ finalInspection: inspection });

    await expect(provisionSampleRaffles(validInput(), dependencies))
      .rejects.toMatchObject({ code: "FINAL_INVARIANT_FAILED" });
  });

  test("uses a disposable manifest's winner alias in the exact final receipt", async () => {
    const manifest: SampleRaffleManifest = {
      eventId: "disposable-raffle-event",
      completedTitle: "Disposable Completed Raffle",
      ongoingTitle: "Disposable Ongoing Raffle",
      winnerEmail: "disposable.winner@example.invalid",
      winnerName: "Disposable Winner",
      winnerAlias: "Disposable Public Alias",
    };
    const dependencies = fakeDependencies();

    await expect(provisionSampleRaffles(validInput(), dependencies, manifest)).resolves.toMatchObject({
      eventId: "disposable-raffle-event",
      completed: { winnerAlias: "Disposable Public Alias" },
      changed: true,
    });
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
