import { readFile } from "node:fs/promises";

import { describe, expect, test, vi } from "vitest";

import {
  COMPLETED_SAMPLE_RAFFLE_TITLE,
  SAMPLE_RAFFLE_EVENT_ID,
  SAMPLE_RAFFLE_WINNER_ALIAS,
  SAMPLE_RAFFLE_WINNER_NAME,
  completedSampleRaffleInput,
  createDedicatedSampleRaffleLock,
  expectedSampleRafflePresentationComplianceStatus,
  ongoingSampleRaffleInput,
  productionSampleRaffleManifest,
  provisionSampleRaffles,
  validateSampleRaffleDatabaseIdentities,
  validateDirectSampleRaffleLockUrl,
  type SampleRaffleManifest,
  type SampleRaffleLockClient,
  type PrismaSampleRaffleProvisioner,
  type SampleRaffleProvisionerDependencies,
  type SampleRaffleProvisioningInput,
  type SampleRaffleProvisioningReceipt,
  type SampleRaffleTargetInspection,
} from "@/server/giveaways/sample-raffles";
import { runSampleRaffleCli } from "../../scripts/provision-sample-raffles";

describe("dedicated sample raffle advisory lock", () => {
  test("keeps the session lock on its own client through unlock and close", async () => {
    const events: string[] = [];
    const client: SampleRaffleLockClient = {
      connect: vi.fn(async () => {
        events.push("connect");
      }),
      query: vi.fn(async (sql) => {
        events.push(sql.includes("unlock") ? "unlock" : "lock");
        return sql.includes("unlock")
          ? { rows: [{ unlocked: true }] }
          : { rows: [{ locked: true }] };
      }),
      end: vi.fn(async () => {
        events.push("end");
      }),
    };
    const lock = createDedicatedSampleRaffleLock(
      "postgresql://direct.example.test:5432/tambike",
      () => client,
    );

    await lock.acquire();
    events.push("normal-prisma-work");
    await lock.release();
    await lock.close();

    expect(events).toEqual([
      "connect",
      "lock",
      "normal-prisma-work",
      "unlock",
      "end",
    ]);
  });

  test("ends the dedicated client when advisory unlock fails", async () => {
    const client: SampleRaffleLockClient = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async (sql) => ({
        rows: sql.includes("unlock")
          ? [{ unlocked: false }]
          : [{ locked: true }],
      })),
      end: vi.fn(async () => undefined),
    };
    const lock = createDedicatedSampleRaffleLock(
      "postgresql://direct.example.test:5432/tambike",
      () => client,
    );

    await lock.acquire();

    await expect(lock.release()).rejects.toThrow(
      "ADVISORY_LOCK_RELEASE_FAILED",
    );
    expect(client.end).toHaveBeenCalledTimes(1);
  });
});

type FakeOptions = {
  inspection?: SampleRaffleTargetInspection;
  finalInspection?: SampleRaffleTargetInspection;
  failAt?: keyof SampleRaffleProvisionerDependencies;
  replaceExisting?: boolean;
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
    dedicatedWinnerId: "sample-winner",
    completedCampaigns: [{
      giveawayId: "completed-sample-raffle",
      title: manifest.completedTitle,
      state: "completed",
      complianceStatus: "approved",
      winnerCount: 1,
      winnerAlias: manifest.winnerAlias,
      drawCount: 1,
      publishedDrawCount: 1,
      currentAwardCount: 1,
      fulfilledAwardCount: 1,
      publicWinnerAliases: [manifest.winnerAlias],
      winnerUserId: "sample-winner",
      currentAwards: [{
        awardId: "completed-sample-award",
        status: "fulfilled",
        winnerAlias: manifest.winnerAlias,
        winnerAliasPublished: true,
      }],
      presentation: {
        mechanics: "One eligible rider was selected from valid entries.",
        terms:
          "The winner receives one Cafe Classico Helmet. The organizer will contact the winner with claiming instructions.",
        prizePoolId: "sample-helmet-pool",
        publicTitle: "Cafe Classico Helmet",
        publicDescription: "A full-face helmet for safer everyday rides.",
        publicImageMediaId: "sample-raffle-helmet-photo-v1",
      },
    }],
    ongoingCampaigns: [{
      giveawayId: "ongoing-sample-raffle",
      title: manifest.ongoingTitle,
      state: "open",
      complianceStatus: "approved",
      winnerCount: 0,
      snapshotCount: 0,
      drawCount: 0,
      awardCount: 0,
      resultCount: 0,
      presentation: {
        mechanics: "Registered event riders may enter once while the raffle is open.",
        terms:
          "One winner will receive the Weekend Rider Gear Package. The organizer will announce and contact the winner after the draw.",
        prizePoolId: "sample-rider-gear-pool",
        publicTitle: "Weekend Rider Gear Package",
        publicDescription: "Helmet, riding gloves, and Tambike gear for your next ride.",
        publicImageMediaId: "sample-raffle-gear-photo-v1",
      },
    }],
  } as RichTargetInspection;
}

function stalePresentationInspection(): RichTargetInspection {
  const inspection = structuredClone(exactFinalInspection());
  const completed = inspection.completedCampaigns[0];
  const ongoing = inspection.ongoingCampaigns[0];
  completed.winnerAlias = "Raffle Sample Rider";
  completed.publicWinnerAliases = ["Raffle Sample Rider"];
  completed.currentAwards[0].winnerAlias = "Raffle Sample Rider";
  completed.presentation = {
    ...completed.presentation!,
    mechanics: "One designated demo rider entry is selected for this sample raffle.",
    terms: "Sample raffle for demonstrating a completed Tambike winner flow.",
    publicDescription: undefined,
    publicImageMediaId: undefined,
  };
  ongoing.presentation = {
    ...ongoing.presentation!,
    mechanics: "Registered event riders may enter once while this sample raffle is open.",
    terms: "Sample ongoing raffle. No winner has been selected.",
    publicDescription: undefined,
    publicImageMediaId: undefined,
  };
  return inspection;
}

function draftCreatedInspection(
  manifest: SampleRaffleManifest = productionSampleRaffleManifest,
): RichTargetInspection {
  const inspection = structuredClone(exactFinalInspection(manifest));
  inspection.completedCampaigns[0] = {
    ...inspection.completedCampaigns[0],
    state: "draft",
    complianceStatus: "draft",
    winnerCount: 0,
    winnerAlias: undefined,
    drawCount: 0,
    publishedDrawCount: 0,
    currentAwardCount: 0,
    fulfilledAwardCount: 0,
    publicWinnerAliases: [],
    winnerUserId: undefined,
    currentAwards: [],
  };
  inspection.ongoingCampaigns[0] = {
    ...inspection.ongoingCampaigns[0],
    state: "draft",
    complianceStatus: "draft",
  };
  return inspection;
}

function partialInspection(): SampleRaffleTargetInspection {
  return {
    ...emptyInspection(),
    completedCampaigns: [{
      giveawayId: "partial-completed-sample-raffle",
      title: COMPLETED_SAMPLE_RAFFLE_TITLE,
      state: "open",
      complianceStatus: "approved",
      winnerCount: 0,
      drawCount: 0,
      publishedDrawCount: 0,
      currentAwardCount: 0,
      fulfilledAwardCount: 0,
      publicWinnerAliases: [],
      currentAwards: [],
    }],
  };
}

function fakeDependencies(options: FakeOptions = {}) {
  const calls: string[] = [];
  let inspectionCount = 0;
  let archived = false;
  let completedCreated = false;
  let ongoingCreated = false;
  let lifecycleCompleted = false;
  const dependencies: SampleRaffleProvisionerDependencies = {
    async inspectTarget(manifest) {
      calls.push("inspectTarget");
      if (options.failAt === "inspectTarget") throw new Error("inspection failed");
      inspectionCount += 1;
      if (options.replaceExisting && !archived) {
        return options.inspection ?? stalePresentationInspection();
      }
      if (
        options.replaceExisting &&
        archived &&
        !completedCreated &&
        !ongoingCreated
      ) {
        return emptyInspection(manifest);
      }
      if (lifecycleCompleted) {
        return options.finalInspection ?? exactFinalInspection(manifest);
      }
      if (completedCreated && ongoingCreated) {
        return draftCreatedInspection(manifest);
      }
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
    async archiveExistingLifecycle() {
      calls.push("archiveExistingLifecycle");
      archived = true;
    },
    async authenticateOrganizer() {
      calls.push("authenticateOrganizer");
      if (options.failAt === "authenticateOrganizer") throw new Error("authentication failed");
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
      completedCreated = true;
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
      if (options.failAt === "selectCompletedWinner") throw new Error("draw failed");
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
      if (options.failAt === "verifyClaim") throw new Error("verification failed");
    },
    async fulfillAward() {
      calls.push("fulfillAward");
    },
    async completeClaims() {
      calls.push("completeClaims");
    },
    async createOngoingCampaign() {
      calls.push("createOngoingCampaign");
      ongoingCreated = true;
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
      lifecycleCompleted = true;
    },
    async prepareCreatedPresentation() {
      calls.push("prepareCreatedPresentation");
    },
    async finish() {
      calls.push("finish");
    },
  };
  return Object.assign(dependencies, { calls });
}

function completeEnvironment() {
  return {
    DATABASE_URL: "postgresql://runtime.example.test/tambike",
    DIRECT_URL: "postgresql://direct.example.test/tambike",
    GIVEAWAY_DRAW_ENCRYPTION_KEY: "runtime-only",
    TAMBIKE_SAMPLE_RAFFLE_ORGANIZER_PASSWORD: "organizer-secret",
    TAMBIKE_SAMPLE_RAFFLE_ADMIN_PASSWORD: "admin-secret",
    TAMBIKE_SAMPLE_RAFFLE_WINNER_PASSWORD: "winner-secret",
  };
}

function exactReceipt(): SampleRaffleProvisioningReceipt {
  return {
    eventId: SAMPLE_RAFFLE_EVENT_ID,
    completed: {
      giveawayId: "completed-sample-raffle",
      title: COMPLETED_SAMPLE_RAFFLE_TITLE,
      state: "completed",
      winnerCount: 1,
      winnerAlias: SAMPLE_RAFFLE_WINNER_ALIAS,
    },
    ongoing: {
      giveawayId: "ongoing-sample-raffle",
      title: "Weekend Rider Gear Raffle",
      state: "open",
      winnerCount: 0,
    },
    changed: true,
  };
}

function fakePrismaProvisioner(receipt: SampleRaffleProvisioningReceipt): PrismaSampleRaffleProvisioner {
  void receipt;
  return {
    dependencies: fakeDependencies(),
    async close() {},
  };
}

describe("sample raffle provisioner safety", () => {
  test("uses clean public identity labels for the seeded winner", () => {
    expect(SAMPLE_RAFFLE_WINNER_NAME).toBe("Raffle Winner");
    expect(SAMPLE_RAFFLE_WINNER_ALIAS).toBe("Cafe Classico Rider");
    expect(productionSampleRaffleManifest).toMatchObject({
      winnerName: "Raffle Winner",
      winnerAlias: "Cafe Classico Rider",
    });
  });

  test.each([
    ["draft", "draft"],
    ["open", "approved"],
    ["completed", "approved"],
  ])(
    "expects %s raffle presentation persistence to use %s compliance",
    (state, expected) => {
      expect(
        expectedSampleRafflePresentationComplianceStatus(state),
      ).toBe(expected);
    },
  );

  test("allows the two-image presentation transaction a bounded production window", async () => {
    const source = await readFile(
      "src/server/giveaways/sample-raffles.ts",
      "utf8",
    );

    expect(source).toContain("timeout: 60_000");
  });

  test("publishes explicit prize names without changing the sample inventory", () => {
    const completed = completedSampleRaffleInput();
    const ongoing = ongoingSampleRaffleInput();

    expect(SAMPLE_RAFFLE_WINNER_ALIAS).toBe("Cafe Classico Rider");
    expect(completed.mechanics).toBe(
      "One eligible rider was selected from valid entries.",
    );
    expect(completed.terms).toBe(
      "The winner receives one Cafe Classico Helmet. The organizer will contact the winner with claiming instructions.",
    );
    expect(completed.prizePools).toEqual([
      expect.objectContaining({
        title: "Helmet",
        publicPresentation: {
          disclosure: "revealed",
          title: "Cafe Classico Helmet",
          description: "A full-face helmet for safer everyday rides.",
        },
        items: [{ title: "Cafe Classico Helmet" }],
      }),
    ]);
    expect(ongoing.mechanics).toBe(
      "Registered event riders may enter once while the raffle is open.",
    );
    expect(ongoing.terms).toBe(
      "One winner will receive the Weekend Rider Gear Package. The organizer will announce and contact the winner after the draw.",
    );
    expect(ongoing.prizePools).toEqual([
      expect.objectContaining({
        title: "Rider gear package",
        publicPresentation: {
          disclosure: "revealed",
          title: "Weekend Rider Gear Package",
          description: "Helmet, riding gloves, and Tambike gear for your next ride.",
        },
        items: [{ title: "Weekend Rider Gear Package" }],
      }),
    ]);
  });

  test("rejects inspection and runtime connections that resolve to different servers", () => {
    expect(() => validateSampleRaffleDatabaseIdentities(
      {
        databaseName: "tambike",
        serverAddress: "10.0.0.10",
        serverPort: 5432,
      },
      {
        databaseName: "tambike",
        serverAddress: "10.0.0.11",
        serverPort: 5432,
      },
    )).toThrow("DIRECT_LOCK_REQUIRED");
  });

  test("accepts inspection and runtime connections that resolve to the same server", () => {
    expect(() => validateSampleRaffleDatabaseIdentities(
      {
        databaseName: "tambike",
        serverAddress: "10.0.0.10",
        serverPort: 5432,
      },
      {
        databaseName: "tambike",
        serverAddress: "10.0.0.10",
        serverPort: 5432,
      },
    )).not.toThrow();
  });

  test("runbook acquires production environment before exact preflight and guarantees secret cleanup", async () => {
    const runbook = await readFile(
      new URL("../../docs/deployment/sample-raffle-provisioning.md", import.meta.url),
      "utf8",
    );
    const pullIndex = runbook.indexOf(
      "vercel env pull .env.production.local --environment=production",
    );
    const directUrlLoadIndex = runbook.indexOf("$env:DIRECT_URL = (& node", pullIndex);
    const preflightIndex = runbook.indexOf("$preflightState =", directUrlLoadIndex);
    const provisionIndex = runbook.indexOf(
      "https://tambike.bayanko.ph/api/jobs/sample-raffle-presentation",
      preflightIndex,
    );
    const postflightIndex = runbook.indexOf("$postflightState =", provisionIndex);

    expect(pullIndex).toBeGreaterThan(-1);
    expect(directUrlLoadIndex).toBeGreaterThan(pullIndex);
    expect(preflightIndex).toBeGreaterThan(directUrlLoadIndex);
    expect(provisionIndex).toBeGreaterThan(preflightIndex);
    expect(postflightIndex).toBeGreaterThan(provisionIndex);
    expect(runbook).not.toContain("psql");
    expect(runbook).toContain("import nextEnv from '@next/env';");
    expect(runbook).toContain("const { loadEnvConfig } = nextEnv;");
    expect(runbook).toContain("import pg from 'pg';");
    expect(runbook).toContain("new Client({ connectionString: process.env.DIRECT_URL })");
    expect(runbook).toContain(
      "'x-tambike-sample-raffle-refresh': 'cafe-classico-replace-v1'",
    );
    expect(runbook).toContain("Authorization: 'Bearer ' + secret");
    expect(runbook).toContain("finally {");
    expect(runbook).toContain("Remove-Item -LiteralPath $temporaryEnvFile -Force -ErrorAction Stop");
    expect(runbook).toContain("Remove-Item -LiteralPath 'Env:DIRECT_URL'");
    expect(runbook).toContain("Remove-Item -LiteralPath 'Env:TAMBIKE_SAMPLE_RAFFLE_INSPECTION_SQL'");

    for (const invariant of [
      "snapshot_count",
      "draw_count",
      "published_draw_count",
      "current_award_count",
      "fulfilled_current_award_count",
      "exact_published_winner_count",
      '"winnerAliasOptedInAt"',
      '"winnerAliasRevokedAt"',
      "raffle.winner.sample@tambike.ph",
      "Cafe Classico Rider",
      "A full-face helmet for safer everyday rides.",
      "Helmet, riding gloves, and Tambike gear for your next ride.",
      '"GiveawayPrizeImage"',
      "sample-raffle-helmet-photo-v1",
      "sample-raffle-gear-photo-v1",
      "15928222",
      "15625079",
    ]) {
      expect(runbook).toContain(invariant);
    }
  });

  test("CLI requires --confirm-production before constructing a provisioner", async () => {
    const createProvisioner = vi.fn();
    await expect(runSampleRaffleCli({ argv: [], environment: {}, createProvisioner }))
      .rejects.toMatchObject({ code: "PRODUCTION_CONFIRMATION_REQUIRED" });
    expect(createProvisioner).not.toHaveBeenCalled();
  });

  test("CLI rejects a non-direct or non-Postgres lock URL", () => {
    expect(() => validateDirectSampleRaffleLockUrl("https://example.com"))
      .toThrow("DIRECT_LOCK_REQUIRED");
  });

  test("CLI output is a safe receipt only", async () => {
    const lines: string[] = [];
    await runSampleRaffleCli({
      argv: ["--confirm-production"],
      environment: completeEnvironment(),
      createProvisioner: async () => fakePrismaProvisioner(exactReceipt()),
      provision: async () => exactReceipt(),
      write: (line) => lines.push(line),
    });
    const output = lines.join("\n");
    expect(output).toContain("Cafe Classico Helmet Raffle");
    for (const forbidden of [
      "organizer-secret",
      "admin-secret",
      "winner-secret",
      "postgresql://",
      "sessionToken",
      "qrPayload",
      "GIVEAWAY_DRAW_ENCRYPTION_KEY",
    ]) {
      expect(output).not.toContain(forbidden);
    }
  });

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
    expect(dependencies.calls).not.toContain("archiveExistingLifecycle");
  });

  test("requires explicit replacement approval for an immutable stale lifecycle", async () => {
    const dependencies = fakeDependencies({
      inspection: stalePresentationInspection(),
    });

    await expect(provisionSampleRaffles(
      {
        ...validInput(),
        organizerPassword: undefined,
        adminPassword: undefined,
        winnerPassword: undefined,
        drawEncryptionKeyPresent: false,
      },
      dependencies,
    ))
      .rejects.toMatchObject({
        code: "IMMUTABLE_SAMPLE_PRESENTATION_REPLACEMENT_REQUIRED",
      });

    expect(dependencies.calls).not.toContain("archiveExistingLifecycle");
    expect(dependencies.calls).not.toContain("createCompletedCampaign");
  });

  test("archives and recreates only the exact stale lifecycle through the trusted production job", async () => {
    const dependencies = fakeDependencies({
      inspection: stalePresentationInspection(),
      finalInspection: exactFinalInspection(),
      replaceExisting: true,
    });

    await expect(provisionSampleRaffles(
      {
        ...validInput(),
        organizerPassword: undefined,
        adminPassword: undefined,
        winnerPassword: undefined,
        replaceExisting: true,
        trustedProductionJob: true,
      },
      dependencies,
    )).resolves.toMatchObject({
      completed: { winnerAlias: "Cafe Classico Rider" },
      ongoing: { state: "open" },
      changed: true,
    });

    expect(dependencies.calls).toContain("archiveExistingLifecycle");
    expect(dependencies.calls.indexOf("prepareCreatedPresentation"))
      .toBeLessThan(dependencies.calls.indexOf("submitCompletedCampaign"));
    expect(dependencies.calls.indexOf("prepareCreatedPresentation"))
      .toBeLessThan(dependencies.calls.indexOf("grantCompletedEntry"));
  });

  test("resumes an exact draft pair without creating duplicate campaigns", async () => {
    const dependencies = fakeDependencies({
      inspection: draftCreatedInspection(),
    });

    await expect(
      provisionSampleRaffles(validInput(), dependencies),
    ).resolves.toMatchObject({
      completed: { state: "completed", winnerCount: 1 },
      ongoing: { state: "open", winnerCount: 0 },
      changed: true,
    });

    expect(dependencies.calls).not.toContain("createCompletedCampaign");
    expect(dependencies.calls).not.toContain("createOngoingCampaign");
    expect(dependencies.calls).toContain("prepareCreatedPresentation");
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
        awardId: "second-sample-award",
        status: "fulfilled",
        winnerAlias: SAMPLE_RAFFLE_WINNER_ALIAS,
        winnerAliasPublished: true,
      });
    }],
    ["completed winner alias is not published", (inspection: RichTargetInspection) => {
      inspection.completedCampaigns[0].currentAwards[0].winnerAliasPublished = false;
    }],
    ["completed campaign compliance is not approved", (inspection: RichTargetInspection) => {
      inspection.completedCampaigns[0].complianceStatus = "pending_review";
    }],
    ["completed campaign has an extra draw", (inspection: RichTargetInspection) => {
      inspection.completedCampaigns[0].drawCount = 2;
    }],
    ["completed campaign draw is not published", (inspection: RichTargetInspection) => {
      inspection.completedCampaigns[0].publishedDrawCount = 0;
    }],
    ["completed award belongs to a different winner", (inspection: RichTargetInspection) => {
      inspection.completedCampaigns[0].winnerUserId = "another-rider";
    }],
    ["ongoing campaign compliance is not approved", (inspection: RichTargetInspection) => {
      inspection.ongoingCampaigns[0].complianceStatus = "pending_review";
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

  test.each([
    ["authentication", "authenticateOrganizer"],
    ["draw", "selectCompletedWinner"],
    ["verification", "verifyClaim"],
  ] as const)("releases the advisory lock and closes clients after a %s failure", async (_label, failAt) => {
    const dependencies = fakeDependencies({ failAt });

    await expect(provisionSampleRaffles(validInput(), dependencies)).rejects.toBeDefined();
    expect(dependencies.calls).toContain("releaseLock");
    expect(dependencies.calls).toContain("finish");
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
    "createOngoingCampaign",
    "inspectTarget",
    "prepareCreatedPresentation",
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
    "submitOngoingCampaign",
    "approveOngoingCampaign",
    "openOngoingCampaign",
    "inspectTarget",
    "releaseLock",
    "finish",
  ]);
});
