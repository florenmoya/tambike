import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

async function readSource(relativePath: string) {
  return readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("giveaway action and API contracts", () => {
  test("server actions use the narrow authenticated envelope and omit raw CSV export", async () => {
    const source = await readSource("src/server/giveaway-actions.ts");

    expect(source).toContain('"use server"');
    expect(source).toContain("executeGiveawayAction");
    expect(source).toContain("readSessionToken");
    expect(source).toContain("createGiveawayAction");
    expect(source).toContain("issueGiveawayClaimTokenAction");
    expect(source).toContain("verifyGiveawayClaimAction");
    expect(source).toContain("getOrganizerGiveawayReportAction");
    expect(source).toContain("getOrganizerGiveawayPresentationAction");
    expect(source).toContain(
      "backend.getOrganizerGiveawayPresentation(sessionToken, giveawayId, drawId)",
    );
    expect(source).toContain("getOrganizerGiveawayOperationsAction");
    expect(source).toContain("listManualGiveawayReplacementCandidatesAction");
    expect(source).toContain("replaceManualGiveawayAwardAction");
    expect(source).toContain("getAdminGiveawayAuditAction");
    expect(source).toContain("listGiveawayOperatorClaimsAction");
    expect(source).toContain("setGiveawayLivePresentationPreferenceAction");
    expect(source).not.toContain("exportGiveawayCsv");
    expect(source).not.toContain("console.");
  });

  test("lifecycle cron uses dynamic Node runtime and has no query-secret fallback", async () => {
    const source = await readSource("src/app/api/jobs/giveaway-lifecycle/route.ts");

    expect(source).toContain('runtime = "nodejs"');
    expect(source).toContain('dynamic = "force-dynamic"');
    expect(source).toContain("hasExactGiveawayCronAuthorization");
    expect(source).toContain("advanceScheduledGiveawayLifecycle(new Date())");
    expect(source).not.toContain("searchParams");
    expect(source).not.toContain("startsWith");
    expect(source).not.toContain("error.message");
  });

  test("route helpers use a length-safe constant-time cron comparison", async () => {
    const source = await readSource("src/server/giveaway-route-runtime.ts");

    expect(source).toContain("timingSafeEqual");
    expect(source).toContain("actual.length !== expected.length");
  });

  test("organizer workspace wires the stable presentation draw through load, recovery, and publication", async () => {
    const source = await readSource(
      "src/features/giveaways/organizer-giveaway-workspace.tsx",
    );

    expect(source).toContain("presentationLoadsByKey");
    expect(source).toContain("presentationRequestsByCampaignId");
    expect(source).toContain("loadGiveawayPresentation");
    expect(source).toContain("selectedPresentationLoadState");
    expect(source).toContain("<CampaignGiveawayPresentationPanel");
    expect(source).toContain("publishRandomPresentation");
    expect(source).toContain("createOrganizerGiveawayPresentationRequest(");
    expect(source).toContain("resolveOrganizerGiveawayPresentationRequest(");
    expect(source).toContain("publishOrganizerGiveawayPresentation(presentation)");
    expect(source).toContain("The fixed raffle result is ready to present.");
    expect(source).not.toContain("The initial draw is ready for review");
    expect(source).not.toContain("GIVEAWAY_DRAW_RESPONSE_INVALID");
    expect(source).toContain("refreshCampaignOperations(selectedCampaign.id).catch");
    expect(source).toContain("acknowledgeOrganizerGiveawayPresentationPublication(");
  });

  test("admin export awaits Next params and protects raw CSV response data", async () => {
    const source = await readSource(
      "src/app/api/admin/exports/giveaways/[giveawayId]/route.ts",
    );

    expect(source).toContain("await params");
    expect(source).toContain("exportGiveawayCsv");
    expect(source).toContain("createGiveawayCsvExportResponse");
    expect(source).toContain("sessionCookieName");
    expect(source).toContain("createGiveawayCsvExportErrorResponse");
    expect(source).not.toContain("error.message");
    expect(source).not.toContain("claimToken");
    expect(source).not.toContain("encryptedPayload");
  });
});
