import { readFile } from "node:fs/promises";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import type { RiderEventGiveawayState } from "../../src/features/giveaways/types";

vi.mock("../../src/server/giveaway-actions", () => ({
  claimGiveawayCampaignCodeAction: vi.fn(),
  listRiderGiveawayStatesForEventAction: vi.fn(),
  optInToGiveawayAction: vi.fn(),
  setGiveawayLivePresentationPreferenceAction: vi.fn(),
  setGiveawayWinnerPublicationAction: vi.fn(),
}));

describe("rider giveaway entry controls", () => {
  test("renders a separate live-raffle consent toggle, safe preview, and frozen explanation", async () => {
    const riderPanelModule = (await import("../../src/features/giveaways/rider-giveaway-status-panel")) as Record<
      string,
      unknown
    >;
    const livePresentationControl = riderPanelModule.RiderGiveawayLivePresentationControl;

    expect(livePresentationControl).toBeTypeOf("function");
    if (typeof livePresentationControl !== "function") return;

    const Control = livePresentationControl as React.ComponentType<{
      giveawayId: string;
      giveawayState: RiderEventGiveawayState["giveawayState"];
      livePresentation: NonNullable<RiderEventGiveawayState["riderState"]["livePresentation"]>;
      onUpdate: (optedIn: boolean) => void;
    }>;
    const editable = renderToStaticMarkup(
      React.createElement(Control, {
        giveawayId: "giveaway-open",
        giveawayState: "open",
        livePresentation: { optedIn: false, canUpdate: true, labelPreview: "Rider A1B2" },
        onUpdate: () => undefined,
      }),
    );
    const frozen = renderToStaticMarkup(
      React.createElement(Control, {
        giveawayId: "giveaway-locked",
        giveawayState: "locked",
        livePresentation: { optedIn: true, canUpdate: false, labelPreview: "Mina R." },
        onUpdate: () => undefined,
      }),
    );

    expect(editable).toContain("Show my first name + last initial during this live raffle");
    expect(editable).toContain("Rider A1B2");
    expect(editable).not.toContain("disabled=\"\"");
    expect(frozen).toContain("Mina R.");
    expect(frozen).toContain("label was frozen when entries closed");
    expect(frozen).toContain("disabled=\"\"");
    expect(frozen).not.toContain("Public winner alias");
  });

  test("only offers self-entry for an open opt-in or campaign-code campaign without an existing entry", async () => {
    const surfaceStateModule = (await import("../../src/features/giveaways/giveaway-surface-state")) as Record<
      string,
      unknown
    >;
    const canEnter = surfaceStateModule.canRiderSubmitGiveawayEntry;

    expect(canEnter).toBeTypeOf("function");
    if (typeof canEnter !== "function") {
      return;
    }

    const predicate = canEnter as (input: {
      state: string;
      entryMode: string;
      riderStatus: string;
    }) => boolean;

    expect(predicate({ state: "open", entryMode: "opt_in", riderStatus: "not_eligible" })).toBe(true);
    expect(predicate({ state: "open", entryMode: "claim_code", riderStatus: "eligible" })).toBe(true);
    expect(predicate({ state: "open", entryMode: "automatic", riderStatus: "not_eligible" })).toBe(false);
    expect(predicate({ state: "open", entryMode: "manual_only", riderStatus: "not_eligible" })).toBe(false);
    expect(predicate({ state: "paused", entryMode: "opt_in", riderStatus: "not_eligible" })).toBe(false);
    expect(predicate({ state: "locked", entryMode: "claim_code", riderStatus: "not_eligible" })).toBe(false);
    expect(predicate({ state: "open", entryMode: "opt_in", riderStatus: "entered" })).toBe(false);
  });

  test("submits opt-in and campaign-code entries through their dedicated actions without mixing inputs", async () => {
    const riderPanelModule = (await import("../../src/features/giveaways/rider-giveaway-status-panel")) as Record<
      string,
      unknown
    >;
    const submitEntry = riderPanelModule.submitRiderGiveawayEntry;

    expect(submitEntry).toBeTypeOf("function");
    if (typeof submitEntry !== "function") {
      return;
    }

    const enteredState = { giveawayId: "giveaway-1", status: "entered", entryCount: 1 };
    const optIn = vi.fn().mockResolvedValue({ ok: true, code: "OK", data: enteredState });
    const claimCode = vi.fn().mockResolvedValue({ ok: false, code: "ERROR" });
    const submit = submitEntry as (
      input: { giveawayId: string; entryMode: "opt_in" | "claim_code"; code?: string },
      actions: {
        optIn: (giveawayId: string) => Promise<unknown>;
        claimCode: (giveawayId: string, code: string) => Promise<unknown>;
      },
    ) => Promise<unknown>;

    await expect(
      submit({ giveawayId: "giveaway-1", entryMode: "opt_in", code: "must-not-be-sent" }, { optIn, claimCode }),
    ).resolves.toEqual({ ok: true, code: "OK", data: enteredState });
    expect(optIn).toHaveBeenCalledWith("giveaway-1");
    expect(claimCode).not.toHaveBeenCalled();

    const claimed = await submit(
      { giveawayId: "giveaway-2", entryMode: "claim_code", code: "  gwy_code  " },
      { optIn, claimCode },
    );
    expect(claimed).toEqual({ ok: false, code: "ERROR" });
    expect(claimCode).toHaveBeenCalledWith("giveaway-2", "gwy_code");
  });

  test("keeps entry failures generic and preserves the event return route for guest login", async () => {
    const [riderPanelModule, publicPanelModule] = await Promise.all([
      import("../../src/features/giveaways/rider-giveaway-status-panel") as Promise<Record<string, unknown>>,
      import("../../src/features/giveaways/public-giveaway-panel") as Promise<Record<string, unknown>>,
    ]);
    const failureMessage = riderPanelModule.riderGiveawayEntryFailureMessage;
    const loginHref = publicPanelModule.giveawayEntryLoginHref;

    expect(failureMessage).toBeTypeOf("function");
    expect(loginHref).toBeTypeOf("function");
    if (typeof failureMessage !== "function" || typeof loginHref !== "function") {
      return;
    }

    const messageFor = failureMessage as (code: "UNAUTHENTICATED" | "ERROR") => string;
    const hrefFor = loginHref as (eventId: string) => string;

    expect(messageFor("UNAUTHENTICATED")).toMatch(/log in.*rider/i);
    expect(messageFor("ERROR")).toMatch(/code.*wrong|eligible|open/i);
    expect(hrefFor("event / 1")).toBe("/login?next=%2Fevents%2Fevent%2520%252F%25201");
  });

  test("only shows the public login affordance for a guest and an open rider self-entry mode", async () => {
    const publicPanelModule = (await import("../../src/features/giveaways/public-giveaway-panel")) as Record<
      string,
      unknown
    >;
    const canOfferLogin = publicPanelModule.canOfferPublicGiveawayEntryLogin;

    expect(canOfferLogin).toBeTypeOf("function");
    if (typeof canOfferLogin !== "function") {
      return;
    }

    const predicate = canOfferLogin as (input: {
      state: string;
      entryMode: string;
      viewerRole: string;
    }) => boolean;

    expect(predicate({ state: "open", entryMode: "opt_in", viewerRole: "guest" })).toBe(true);
    expect(predicate({ state: "open", entryMode: "claim_code", viewerRole: "guest" })).toBe(true);
    expect(predicate({ state: "open", entryMode: "automatic", viewerRole: "guest" })).toBe(false);
    expect(predicate({ state: "open", entryMode: "manual_only", viewerRole: "guest" })).toBe(false);
    expect(predicate({ state: "locked", entryMode: "opt_in", viewerRole: "guest" })).toBe(false);
    expect(predicate({ state: "open", entryMode: "opt_in", viewerRole: "rider" })).toBe(false);
  });

  test("hides self-entry after a rejected action refreshes a paused, locked, automatic, or omitted campaign", async () => {
    const [riderPanelModule, surfaceStateModule] = await Promise.all([
      import("../../src/features/giveaways/rider-giveaway-status-panel") as Promise<Record<string, unknown>>,
      import("../../src/features/giveaways/giveaway-surface-state") as Promise<Record<string, unknown>>,
    ]);
    const submitEntry = riderPanelModule.submitRiderGiveawayEntry;
    const reconcileCampaigns = riderPanelModule.reconcileRiderGiveawayCampaigns;
    const entryControl = riderPanelModule.RiderGiveawayEntryControl;
    const canEnter = surfaceStateModule.canRiderSubmitGiveawayEntry;

    expect(submitEntry).toBeTypeOf("function");
    expect(reconcileCampaigns).toBeTypeOf("function");
    expect(entryControl).toBeTypeOf("function");
    expect(canEnter).toBeTypeOf("function");
    if (
      typeof submitEntry !== "function" ||
      typeof reconcileCampaigns !== "function" ||
      typeof entryControl !== "function" ||
      typeof canEnter !== "function"
    ) {
      return;
    }

    const submit = submitEntry as (
      input: { giveawayId: string; entryMode: "opt_in" | "claim_code"; code?: string },
      actions: {
        optIn: (giveawayId: string) => Promise<unknown>;
        claimCode: (giveawayId: string, code: string) => Promise<unknown>;
      },
    ) => Promise<unknown>;
    const reconcile = reconcileCampaigns as (
      campaigns: RiderEventGiveawayState[],
      giveawayId: string,
      refreshed?: RiderEventGiveawayState,
    ) => RiderEventGiveawayState[];
    const Control = entryControl as React.ComponentType<{
      giveawayId: string;
      giveawayState: RiderEventGiveawayState["giveawayState"];
      entryMode: RiderEventGiveawayState["entryMode"];
      riderStatus: RiderEventGiveawayState["riderState"]["status"];
      onEntryRecorded: () => void;
      onRefresh: () => Promise<void>;
    }>;
    const shouldOfferEntry = canEnter as (input: {
      state: RiderEventGiveawayState["giveawayState"];
      entryMode: RiderEventGiveawayState["entryMode"];
      riderStatus: RiderEventGiveawayState["riderState"]["status"];
    }) => boolean;
    const openCampaign: RiderEventGiveawayState = {
      giveawayId: "giveaway-1",
      giveawayTitle: "Rider helmet draw",
      giveawayState: "open",
      entryMode: "opt_in",
      riderState: { giveawayId: "giveaway-1", status: "not_eligible", entryCount: 0 },
    };

    await expect(
      submit(
        { giveawayId: openCampaign.giveawayId, entryMode: "opt_in" },
        {
          optIn: vi.fn().mockResolvedValue({ ok: false, code: "ERROR" }),
          claimCode: vi.fn(),
        },
      ),
    ).resolves.toEqual({ ok: false, code: "ERROR" });

    for (const refreshed of [
      { ...openCampaign, giveawayState: "paused" as const },
      { ...openCampaign, giveawayState: "locked" as const },
      { ...openCampaign, entryMode: "automatic" as const },
    ]) {
      const reconciled = reconcile([openCampaign], openCampaign.giveawayId, refreshed);

      expect(reconciled).toEqual([refreshed]);
      expect(
        shouldOfferEntry({
          state: reconciled[0].giveawayState,
          entryMode: reconciled[0].entryMode,
          riderStatus: reconciled[0].riderState.status,
        }),
      ).toBe(false);
      expect(
        renderToStaticMarkup(
          React.createElement(Control, {
            giveawayId: reconciled[0].giveawayId,
            giveawayState: reconciled[0].giveawayState,
            entryMode: reconciled[0].entryMode,
            riderStatus: reconciled[0].riderState.status,
            onEntryRecorded: () => undefined,
            onRefresh: async () => undefined,
          }),
        ),
      ).toBe("");
    }

    expect(reconcile([openCampaign], openCampaign.giveawayId)).toEqual([]);
  });

  test("renders self-entry controls only for the right open modes and keeps a campaign code transient", async () => {
    const riderPanelModule = (await import("../../src/features/giveaways/rider-giveaway-status-panel")) as Record<
      string,
      unknown
    >;
    const entryControl = riderPanelModule.RiderGiveawayEntryControl;

    expect(entryControl).toBeTypeOf("function");
    if (typeof entryControl !== "function") {
      return;
    }

    const Control = entryControl as React.ComponentType<{
      giveawayId: string;
      giveawayState: "open" | "locked";
      entryMode: "opt_in" | "claim_code" | "automatic" | "manual_only";
      riderStatus: "not_eligible" | "eligible" | "entered";
      onEntryRecorded: () => void;
      onRefresh: () => Promise<void>;
    }>;
    const commonProps = {
      giveawayId: "giveaway-1",
      giveawayState: "open" as const,
      riderStatus: "not_eligible" as const,
      onEntryRecorded: () => undefined,
      onRefresh: async () => undefined,
    };

    const optInMarkup = renderToStaticMarkup(
      React.createElement(Control, { ...commonProps, entryMode: "opt_in" }),
    );
    const codeMarkup = renderToStaticMarkup(
      React.createElement(Control, { ...commonProps, entryMode: "claim_code" }),
    );
    const automaticMarkup = renderToStaticMarkup(
      React.createElement(Control, { ...commonProps, entryMode: "automatic" }),
    );
    const lockedMarkup = renderToStaticMarkup(
      React.createElement(Control, {
        ...commonProps,
        entryMode: "opt_in",
        giveawayState: "locked",
      }),
    );

    expect(optInMarkup).toContain("Enter giveaway");
    expect(optInMarkup).not.toContain("Campaign code");
    expect(codeMarkup).toContain("Campaign code");
    expect(codeMarkup).toContain("Enter code");
    expect(automaticMarkup).toBe("");
    expect(lockedMarkup).toBe("");

    const source = await readFile(
      new URL("../../src/features/giveaways/rider-giveaway-status-panel.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('const [campaignCode, setCampaignCode] = useState("");');
    expect(source).toContain('setCampaignCode("");');
    expect(source).toContain("await onRefresh(giveawayId);");
    expect(source).not.toMatch(/localStorage|sessionStorage|URLSearchParams|window\.location|router\./);
    expect(source).not.toMatch(/console\.(?:log|warn|error)/);
  });

  test("keeps raw campaign codes out of both backend audit payloads", async () => {
    const [memoryBackend, prismaBackend] = await Promise.all([
      readFile(new URL("../../src/server/backend.ts", import.meta.url), "utf8"),
      readFile(new URL("../../src/server/prisma-backend.ts", import.meta.url), "utf8"),
    ]);

    for (const backend of [memoryBackend, prismaBackend]) {
      const claimStart = backend.indexOf("async claimGiveawayCampaignCode(");
      const nextMethod = backend.indexOf("async grantManualGiveawayEntry(", claimStart);
      const claimMethod = backend.slice(claimStart, nextMethod);
      const auditStart = claimMethod.indexOf("GIVEAWAY_CAMPAIGN_CODE_CLAIMED");
      const auditPayload = claimMethod.slice(auditStart, auditStart + 600);

      expect(auditStart).toBeGreaterThanOrEqual(0);
      expect(auditPayload).toContain("campaignCodeId: code.id");
      expect(auditPayload).not.toMatch(/\brawCode\b|\bcode\s*:/);
    }
  });
});
