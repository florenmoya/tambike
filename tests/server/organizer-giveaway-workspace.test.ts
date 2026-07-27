import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import * as React from "react";

import { TooltipProvider } from "../../src/components/ui/tooltip";
import { OrganizerConsole } from "../../src/features/organizer/organizer-console";
import { DemoProvider } from "../../src/features/tambike-demo/demo-provider";
import { createTambikeTestBackend } from "../../src/server/testing";
import { createTestActors } from "./support/tambike-fixtures";
import type {
  OrganizerGiveawayOperations,
  OrganizerGiveawayPresentation,
  OrganizerGiveawayWorkspace as OrganizerGiveawayWorkspaceData,
  GiveawayPrizePoolInput,
} from "../../src/features/giveaways/types";
import * as giveawayActions from "../../src/server/giveaway-actions";
import {
  applyOrganizerGiveawayDraftUpdate,
  acknowledgeOrganizerGiveawayPresentationPublication,
  buildGiveawayLifecycleRoute,
  canRunOrganizerInitialRandomDraw,
  CampaignCancellationPanel,
  CampaignEntryOperations,
  CampaignGiveawayPresentationPanel,
  CampaignManualSelectionOperations,
  CampaignOperationalHeader,
  createOrganizerGiveawayPresentationRequest,
  getGiveawayPublicationMode,
  OrganizerGiveawayWorkspace,
  PrizePoolBuilder,
  publishOrganizerGiveawayPresentation,
  readOrganizerGiveawayPresentation,
  resolveGiveawayPresentationLoadFailureState,
  resolveGiveawayPresentationLoadStartState,
  resolveGiveawayManualSelectionGate,
  resolveOrganizerGiveawayPresentationRequest,
  RecoveryQueuePanel,
  resolveGiveawaySubmission,
  resolveInitialDrawSubmission,
  resolveManualSelectionSubmission,
  preserveSurprisePrizePresentationDrafts,
  saveOrganizerGiveawayConfiguration,
  submitCampaignCode,
  toOrganizerGiveawayConfigurationPrizePools,
  toOrganizerGiveawayEditorDraft,
  toOrganizerPrizePoolDisclosureDraft,
  toPublicPrizePreview,
} from "../../src/features/giveaways/organizer-giveaway-workspace";
import {
  GiveawayPrizeImageUploader,
  performGiveawayPrizeImageRemoval,
  performGiveawayPrizeImageUpload,
  runGiveawayPrizeImageUpload,
  validateGiveawayPrizeImageFile,
} from "../../src/features/giveaways/giveaway-prize-image-uploader";

const requireFromOrganizerWorkspaceTest = createRequire(import.meta.url);
const JSDOM = (
  requireFromOrganizerWorkspaceTest("jsdom") as {
    JSDOM: new (
      html: string,
      options?: { url?: string },
    ) => {
      window: {
        document: Document;
        navigator: Navigator;
        close: () => void;
      };
    };
  }
).JSDOM;

const organizerGiveawayWorkspaceSourceUrl = new URL(
  "../../src/features/giveaways/organizer-giveaway-workspace.tsx",
  import.meta.url,
);

async function readCampaignEditorSource() {
  const source = await readFile(organizerGiveawayWorkspaceSourceUrl, "utf8");
  const start = source.indexOf("function CampaignEditor({");
  const end = source.indexOf("\n/**", start);
  return source.slice(start, end);
}

const completedPresentation: OrganizerGiveawayPresentation = {
  giveawayId: "giveaway-random",
  eventId: "event-1",
  drawId: "draw-initial-random",
  giveawayTitle: "Helmet raffle",
  drawStatus: "completed",
  resultDigest: "a".repeat(64),
  candidateCount: 2,
  labelBank: ["Rider A1B2", "Rider C3D4"],
  slides: [
    {
      position: 1,
      prizePoolTitle: "Helmet pool",
      prizeItemTitle: "Road helmet",
      winnerLabel: "Rider A1B2",
    },
  ],
};

function organizerWorkspaceWithPools(
  prizePools: GiveawayPrizePoolInput[],
): OrganizerGiveawayWorkspaceData {
  return {
    id: "giveaway-1",
    eventId: "event-1",
    title: "Rider gear draw",
    kind: "raffle",
    state: "draft",
    complianceStatus: "draft",
    entryMode: "automatic",
    maxEntriesPerRider: 1,
    mechanics: "One entry per eligible rider.",
    terms: "Claim by the stated deadline.",
    timeZone: "Asia/Manila",
    winnerLimits: { perRider: 1, total: prizePools.length },
    publicVisibility: "event_page",
    presenceVerificationRequired: false,
    eligibilityGroups: [
      {
        id: "group-1",
        label: "Registered riders",
        weight: 1,
        conditions: [{ source: "active_rsvp_pass" }],
      },
    ],
    prizePools,
  };
}

describe("organizer giveaway lifecycle route", () => {
  test("shows the factual lifecycle and treats pause as an operational hold", () => {
    expect(buildGiveawayLifecycleRoute("paused", "approved")).toEqual([
      { id: "draft", label: "Draft", status: "complete" },
      { id: "review", label: "Review", status: "complete" },
      { id: "scheduled", label: "Scheduled", status: "complete" },
      { id: "open", label: "Open", status: "hold" },
      { id: "locked", label: "Locked", status: "upcoming" },
      { id: "drawing", label: "Draw", status: "upcoming" },
      { id: "claims_open", label: "Claims", status: "upcoming" },
      { id: "completed", label: "Complete", status: "upcoming" },
    ]);
  });

  test("makes compliance review visible before an approved campaign can be scheduled", () => {
    expect(buildGiveawayLifecycleRoute("draft", "pending_review").slice(0, 3)).toEqual([
      { id: "draft", label: "Draft", status: "complete" },
      { id: "review", label: "Review", status: "active" },
      { id: "scheduled", label: "Scheduled", status: "upcoming" },
    ]);
  });

  test("renders an organizer-only operational workspace with a factual lifecycle strip", () => {
    const markup = renderToStaticMarkup(
      React.createElement(OrganizerGiveawayWorkspace, {
        eventId: "event-1",
        initialCampaigns: [
          {
            id: "giveaway-1",
            eventId: "event-1",
            title: "Rider helmet draw",
            state: "paused",
            complianceStatus: "approved",
            mechanicsVersion: 2,
          },
        ],
      }),
    );

    expect(markup).toContain("Giveaway operations");
    expect(markup).toContain("Rider helmet draw");
    expect(markup).toContain("Paused at open");
    expect(markup).toContain("Compliance approved");
    expect(markup).toContain("Policy details are loading");
  });

  test("hydrates only the scoped organizer configuration into an editable event-time-zone draft", () => {
    const workspace: OrganizerGiveawayWorkspaceData = {
      id: "giveaway-1",
      eventId: "event-1",
      title: "Rider helmet draw",
      kind: "raffle",
      state: "scheduled",
      complianceStatus: "approved",
      entryMode: "claim_code",
      maxEntriesPerRider: 3,
      mechanics: "One entry per code claim.",
      terms: "Claim by the stated deadline.",
      sponsorDisclosure: "Tambike partners",
      timeZone: "Asia/Manila",
      winnerLimits: { perRider: 1, total: 2 },
      publicVisibility: "eligible_riders",
      presenceVerificationRequired: true,
      entryOpensAt: "2026-08-17T09:30:00.000Z",
      entryClosesAt: "2026-08-17T10:30:00.000Z",
      drawAt: "2026-08-17T11:30:00.000Z",
      claimDeadlineAt: "2026-08-18T11:30:00.000Z",
      eligibilityGroups: [
        {
          id: "group-1",
          label: "Code claim",
          weight: 2,
          conditions: [{ source: "campaign_code" }],
        },
      ],
      prizePools: [
        {
          id: "pool-1",
          title: "Helmet pool",
          awardMode: "random_draw",
          fulfilmentMode: "onsite",
          inventory: { kind: "finite", quantity: 1 },
          items: [{ id: "item-1", title: "Ride helmet" }],
          publicPresentation: {
            disclosure: "revealed",
            title: "Ride helmet",
          },
          eligibilityGroupIds: ["group-1"],
          presenceVerificationRequired: true,
        },
      ],
    };

    const draft = toOrganizerGiveawayEditorDraft(workspace);

    expect(draft).toMatchObject({
      title: "Rider helmet draw",
      entryMode: "claim_code",
      entryOpensAt: "2026-08-17T17:30",
      entryClosesAt: "2026-08-17T18:30",
      drawAt: "2026-08-17T19:30",
      claimDeadlineAt: "2026-08-18T19:30",
      eligibilityGroups: [expect.objectContaining({ id: "group-1", weight: 2 })],
      prizePools: [expect.objectContaining({ id: "pool-1", title: "Helmet pool" })],
    });

    const draftsByCampaignId = { [workspace.id]: draft };
    const updatedDrafts = applyOrganizerGiveawayDraftUpdate(
      draftsByCampaignId,
      workspace.id,
      (current) => ({ ...current, entryOpensAt: "2026-08-19T09:00" }),
    );

    expect(updatedDrafts[workspace.id]?.entryOpensAt).toBe("2026-08-19T09:00");
    expect(draftsByCampaignId[workspace.id]?.entryOpensAt).toBe("2026-08-17T17:30");
  });

  test("maps persisted public presentation into the editable pool draft", () => {
    const workspace: OrganizerGiveawayWorkspaceData = {
      id: "giveaway-1",
      eventId: "event-1",
      title: "Rider gear draw",
      kind: "raffle",
      state: "draft",
      complianceStatus: "draft",
      entryMode: "automatic",
      maxEntriesPerRider: 1,
      mechanics: "One entry per eligible rider.",
      terms: "Claim by the stated deadline.",
      timeZone: "Asia/Manila",
      winnerLimits: { perRider: 1, total: 1 },
      publicVisibility: "event_page",
      presenceVerificationRequired: false,
      eligibilityGroups: [
        {
          id: "group-1",
          label: "Registered riders",
          weight: 1,
          conditions: [{ source: "active_rsvp_pass" }],
        },
      ],
      prizePools: [
        {
          id: "pool-1",
          title: "Internal gear inventory",
          awardMode: "random_draw",
          fulfilmentMode: "onsite",
          inventory: { kind: "finite", quantity: 1 },
          items: [{ id: "item-1", title: "Private Ducati Helmet" }],
          publicPresentation: {
            disclosure: "revealed",
            title: "Weekend Rider Gear Package",
            description: "Helmet, gloves, and Tambike gear.",
          },
        },
      ],
    };

    const draft = toOrganizerGiveawayEditorDraft(workspace);

    expect(draft.prizePools[0]?.publicPresentation).toEqual({
      disclosure: "revealed",
      title: "Weekend Rider Gear Package",
      description: "Helmet, gloves, and Tambike gear.",
    });
  });

  test("surprise preview never renders the actual inventory title", () => {
    expect(toPublicPrizePreview({
      disclosure: "surprise",
      title: "Private Ducati Helmet",
    })).toBe("Surprise prize");
  });

  test("switching to surprise immediately clears public copy and the managed image draft", () => {
    const pool = {
      id: "pool-1",
      title: "Internal gear inventory",
      awardMode: "random_draw" as const,
      fulfilmentMode: "onsite" as const,
      inventory: { kind: "finite" as const, quantity: 1 },
      items: [{ id: "item-1", title: "Private Ducati Helmet" }] as [
        { id: string; title: string },
      ],
      publicPresentation: {
        disclosure: "revealed" as const,
        title: "Weekend Rider Gear Package",
        description: "Helmet, gloves, and Tambike gear.",
      },
      publicImage: {
        mediaId: "media-1",
        url: "/giveaway-prize-media/media-1",
        width: 1200,
        height: 800,
      },
    };

    expect(toOrganizerPrizePoolDisclosureDraft(pool, "surprise")).toEqual({
      id: "pool-1",
      title: "Internal gear inventory",
      awardMode: "random_draw",
      fulfilmentMode: "onsite",
      inventory: { kind: "finite", quantity: 1 },
      items: [{ id: "item-1", title: "Private Ducati Helmet" }],
      publicPresentation: { disclosure: "surprise" },
    });
  });

  test("configuration saves public presentation without caller-supplied public image data", () => {
    const pool = {
      id: "pool-1",
      title: "Internal gear inventory",
      awardMode: "random_draw" as const,
      fulfilmentMode: "onsite" as const,
      inventory: { kind: "finite" as const, quantity: 1 },
      items: [{ id: "item-1", title: "Private Ducati Helmet" }] as [
        { id: string; title: string },
      ],
      publicPresentation: {
        disclosure: "revealed" as const,
        title: "Weekend Rider Gear Package",
      },
      publicImage: {
        mediaId: "media-1",
        url: "/giveaway-prize-media/media-1",
        width: 1200,
        height: 800,
      },
    };

    expect(toOrganizerGiveawayConfigurationPrizePools([pool])).toEqual([
      {
        id: "pool-1",
        title: "Internal gear inventory",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 1 },
        items: [{ id: "item-1", title: "Private Ducati Helmet" }],
        publicPresentation: {
          disclosure: "revealed",
          title: "Weekend Rider Gear Package",
        },
      },
    ]);
  });

  test("renders separate internal inventory and public prize display controls", () => {
    const markup = renderToStaticMarkup(
      React.createElement(OrganizerGiveawayWorkspace, {
        eventId: "event-1",
      }),
    );

    expect(markup).toContain("Internal prize group");
    expect(markup).toContain("Actual prizes and inventory");
    expect(markup).toContain("Public prize display");
    expect(markup).toContain("Show the prize");
    expect(markup).toContain("Keep it a surprise");
    expect(markup).toContain("Public prize name");
    expect(markup).toContain("Short description (optional)");
    expect(markup).toContain("Public preview");
    expect(markup).toContain("Save this prize pool before uploading its public image.");
  });

  test("validates public prize image type, empty files, and the 8 MiB limit", () => {
    expect(validateGiveawayPrizeImageFile({ type: "image/jpeg", size: 1 })).toBeNull();
    expect(validateGiveawayPrizeImageFile({ type: "image/png", size: 8 * 1024 * 1024 })).toBeNull();
    expect(validateGiveawayPrizeImageFile({ type: "image/webp", size: 512 })).toBeNull();
    expect(validateGiveawayPrizeImageFile({ type: "image/gif", size: 512 })).toBe(
      "Choose a JPEG, PNG, or WebP image.",
    );
    expect(validateGiveawayPrizeImageFile({ type: "image/png", size: 0 })).toBe(
      "Choose a non-empty image file.",
    );
    expect(validateGiveawayPrizeImageFile({ type: "image/png", size: 8 * 1024 * 1024 + 1 })).toBe(
      "Choose an image no larger than 8 MB.",
    );
  });

  test("uploads a public prize image through presign, storage, and managed finalize", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "prize.png", {
      type: "image/png",
    });
    const statuses: string[] = [];
    const finalizedImage = {
      mediaId: "media-1",
      url: "/giveaway-prize-media/media-1",
      width: 1200,
      height: 800,
    };
    const finalize = vi.fn(async () => ({
      ok: true as const,
      data: finalizedImage,
    }));
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (fetchImpl.mock.calls.length === 1) {
        return Response.json({
          key: "tmp/giveaway-prizes/organizer-1/upload-1",
          mimeType: "image/png",
          url: "https://uploads.example.test",
          fields: {
            key: "tmp/giveaway-prizes/organizer-1/upload-1",
            "Content-Type": "image/png",
          },
        });
      }
      expect(init?.body).toBeInstanceOf(FormData);
      expect((init?.body as FormData).get("key")).toBe(
        "tmp/giveaway-prizes/organizer-1/upload-1",
      );
      expect((init?.body as FormData).get("file")).toBe(file);
      return new Response(null, { status: 204 });
    });

    await expect(performGiveawayPrizeImageUpload({
      file,
      giveawayId: "giveaway-1",
      prizePoolId: "pool-1",
    }, {
      fetchImpl,
      finalize,
      onStatus: (status) => statuses.push(status),
    })).resolves.toEqual(finalizedImage);

    expect(fetchImpl.mock.calls[0]).toEqual([
      "/api/giveaway-prize-media/uploads",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          giveawayId: "giveaway-1",
          prizePoolId: "pool-1",
          mimeType: "image/png",
        }),
      },
    ]);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://uploads.example.test");
    expect(finalize).toHaveBeenCalledWith({
      giveawayId: "giveaway-1",
      prizePoolId: "pool-1",
      tempKey: "tmp/giveaway-prizes/organizer-1/upload-1",
      claimedMimeType: "image/png",
    });
    expect(statuses).toEqual([
      "Preparing secure upload…",
      "Uploading image…",
      "Finishing image…",
    ]);
  });

  test("removes only the current managed public prize image", async () => {
    const remove = vi.fn(async () => ({ ok: true as const, data: undefined }));

    await expect(performGiveawayPrizeImageRemoval({
      giveawayId: "giveaway-1",
      prizePoolId: "pool-1",
      mediaId: "media-1",
    }, remove)).resolves.toBeUndefined();

    expect(remove).toHaveBeenCalledWith({
      giveawayId: "giveaway-1",
      prizePoolId: "pool-1",
      mediaId: "media-1",
    });
  });

  test("renders managed public image replacement and removal controls", () => {
    const markup = renderToStaticMarkup(
      React.createElement(GiveawayPrizeImageUploader, {
        giveawayId: "giveaway-1",
        prizePoolId: "pool-1",
        image: {
          mediaId: "media-1",
          url: "/giveaway-prize-media/media-1",
          width: 1200,
          height: 800,
        },
        disabled: false,
        onChanged: () => undefined,
      }),
    );

    expect(markup).toContain("/giveaway-prize-media/media-1");
    expect(markup).toContain("Replace image");
    expect(markup).toContain("Remove image");
    expect(markup).not.toContain("storageKey");
  });

  test.each([
    {
      operation: "create",
      campaignId: undefined,
      clientPoolIds: ["client-pool-new"],
      serverPoolIds: ["server-pool-created"],
    },
    {
      operation: "update",
      campaignId: "giveaway-1",
      clientPoolIds: ["server-pool-existing", "client-pool-added"],
      serverPoolIds: ["server-pool-existing", "server-pool-added"],
    },
  ] as const)(
    "$operation save enables uploads only for authoritative server pool IDs",
    async ({ campaignId, clientPoolIds, serverPoolIds }) => {
      const basePool: GiveawayPrizePoolInput = {
        id: clientPoolIds[0],
        title: "Internal gear inventory",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Private Ducati Helmet" }],
        publicPresentation: {
          disclosure: "revealed",
          title: "Weekend Rider Gear Package",
        },
      };
      const clientWorkspace = organizerWorkspaceWithPools(
        clientPoolIds.map((id, index) => ({
          ...basePool,
          id,
          title: `Client pool ${index + 1}`,
          items: [{ title: `Client prize ${index + 1}` }],
        })),
      );
      const serverWorkspace = organizerWorkspaceWithPools(
        serverPoolIds.map((id, index) => ({
          ...basePool,
          id,
          title: `Server pool ${index + 1}`,
          items: [{ title: `Server prize ${index + 1}` }],
        })),
      );
      const create = vi.fn(async () => ({
        ok: true as const,
        data: {
          id: "giveaway-1",
          eventId: "event-1",
          title: "Rider gear draw",
          state: "draft" as const,
          complianceStatus: "draft" as const,
          mechanicsVersion: 1,
        },
      }));
      const update = vi.fn(async () => ({ ok: true as const, data: undefined }));
      const readWorkspace = vi.fn(async () => ({
        ok: true as const,
        data: serverWorkspace,
      }));

      const saved = await saveOrganizerGiveawayConfiguration({
        eventId: "event-1",
        campaignId,
        draft: toOrganizerGiveawayEditorDraft(clientWorkspace),
      }, {
        create,
        update,
        readWorkspace,
      });

      expect(saved.giveawayId).toBe("giveaway-1");
      expect(saved.draft.prizePools.map((pool) => pool.id)).toEqual(serverPoolIds);
      expect(saved.persistedPrizePoolIds).toEqual(serverPoolIds);
      expect(readWorkspace).toHaveBeenCalledWith("giveaway-1");
      if (campaignId) {
        expect(update).toHaveBeenCalledOnce();
        expect(create).not.toHaveBeenCalled();
      } else {
        expect(create).toHaveBeenCalledOnce();
        expect(update).not.toHaveBeenCalled();
      }
    },
  );

  test("selecting surprise hides public media without deleting before policy save", async () => {
    const dom = new JSDOM("<div id=\"root\"></div>", {
      url: "http://localhost/organizer/events/event-1/giveaways",
    });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const deleteImage = vi.spyOn(
      giveawayActions,
      "deleteGiveawayPrizeImageAction",
    );
    const onPrizeMediaChanged = vi.fn();
    const root = createRoot(dom.window.document.getElementById("root")!);
    const draft = toOrganizerGiveawayEditorDraft(organizerWorkspaceWithPools([
      {
        id: "server-pool-1",
        title: "Private inventory",
        awardMode: "random_draw",
        fulfilmentMode: "onsite",
        inventory: { kind: "finite", quantity: 1 },
        items: [{ title: "Private Ducati Helmet" }],
        publicPresentation: {
          disclosure: "revealed",
          title: "Weekend Rider Gear Package",
        },
        publicImage: {
          mediaId: "media-1",
          url: "/giveaway-prize-media/media-1",
          width: 1200,
          height: 800,
        },
      },
    ]));

    function Harness() {
      const [current, setCurrent] = React.useState(draft);
      return React.createElement(PrizePoolBuilder, {
        draft: current,
        onChange: setCurrent,
        giveawayId: "giveaway-1",
        persistedPrizePoolIds: new Set(["server-pool-1"]),
        disabled: false,
        onPrizeMediaChanged,
      });
    }

    try {
      await React.act(async () => {
        root.render(React.createElement(Harness));
      });
      const surpriseRadio = dom.window.document.querySelectorAll(
        'input[type="radio"]',
      )[1] as HTMLInputElement;

      await React.act(async () => {
        surpriseRadio.click();
      });

      expect(dom.window.document.body.textContent).toContain("Win: Surprise prize");
      expect(dom.window.document.body.textContent).not.toContain("Public prize name");
      expect(dom.window.document.querySelector('img[alt="Current public prize"]')).toBeNull();
      expect(deleteImage).not.toHaveBeenCalled();
      expect(onPrizeMediaChanged).not.toHaveBeenCalled();
    } finally {
      await React.act(async () => {
        root.unmount();
      });
      deleteImage.mockRestore();
      vi.unstubAllGlobals();
      dom.window.close();
    }
  });

  test("an in-flight upload reload cannot reverse a local surprise draft", () => {
    const authoritative = toOrganizerGiveawayEditorDraft(
      organizerWorkspaceWithPools([
        {
          id: "server-pool-1",
          title: "Private inventory",
          awardMode: "random_draw",
          fulfilmentMode: "onsite",
          inventory: { kind: "finite", quantity: 1 },
          items: [{ title: "Private Ducati Helmet" }],
          publicPresentation: {
            disclosure: "revealed",
            title: "Weekend Rider Gear Package",
          },
          publicImage: {
            mediaId: "media-new",
            url: "/giveaway-prize-media/media-new",
            width: 1200,
            height: 800,
          },
        },
      ]),
    );
    const localSurprise = {
      ...authoritative,
      prizePools: [
        toOrganizerPrizePoolDisclosureDraft(
          authoritative.prizePools[0]!,
          "surprise",
        ),
      ],
    };

    const merged = preserveSurprisePrizePresentationDrafts(
      authoritative,
      localSurprise,
    );

    expect(merged.prizePools[0]?.publicPresentation).toEqual({
      disclosure: "surprise",
    });
    expect(merged.prizePools[0]?.publicImage).toBeUndefined();
  });

  test("presign failure surfaces status without finalize, success, or reload", async () => {
    const file = new File([new Uint8Array([1])], "prize.png", {
      type: "image/png",
    });
    const finalize = vi.fn();
    const onChanged = vi.fn();
    const statuses: string[] = [];

    await expect(runGiveawayPrizeImageUpload({
      file,
      giveawayId: "giveaway-1",
      prizePoolId: "server-pool-1",
    }, {
      fetchImpl: vi.fn(async () => new Response(null, { status: 503 })),
      finalize,
      onChanged,
      onStatus: (status) => statuses.push(status),
    })).resolves.toBe(false);

    expect(finalize).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe(
      "Image uploads are temporarily unavailable. Try again shortly.",
    );
    expect(statuses).not.toContain("Public prize image updated.");
  });

  test("finalize and reload failures never report a false upload success", async () => {
    const file = new File([new Uint8Array([1])], "prize.png", {
      type: "image/png",
    });
    const uploadResponses = () => {
      let call = 0;
      return vi.fn(async () => {
        call += 1;
        return call === 1
          ? Response.json({
              key: "tmp/giveaway-prizes/organizer-1/upload-1",
              mimeType: "image/png",
              url: "https://uploads.example.test",
              fields: { key: "tmp/giveaway-prizes/organizer-1/upload-1" },
            })
          : new Response(null, { status: 204 });
      });
    };

    const finalizeStatuses: string[] = [];
    const finalizeReload = vi.fn();
    await expect(runGiveawayPrizeImageUpload({
      file,
      giveawayId: "giveaway-1",
      prizePoolId: "server-pool-1",
    }, {
      fetchImpl: uploadResponses(),
      finalize: vi.fn(async () => ({ ok: false as const, error: "ACTION_FAILED" })),
      onChanged: finalizeReload,
      onStatus: (status) => finalizeStatuses.push(status),
    })).resolves.toBe(false);
    expect(finalizeReload).not.toHaveBeenCalled();
    expect(finalizeStatuses.at(-1)).toBe(
      "The uploaded image could not be finalized. Try again.",
    );
    expect(finalizeStatuses).not.toContain("Public prize image updated.");

    const reloadStatuses: string[] = [];
    const failedReload = vi.fn(async () => {
      throw new Error("reload failed");
    });
    await expect(runGiveawayPrizeImageUpload({
      file,
      giveawayId: "giveaway-1",
      prizePoolId: "server-pool-1",
    }, {
      fetchImpl: uploadResponses(),
      finalize: vi.fn(async () => ({
        ok: true as const,
        data: {
          mediaId: "media-1",
          url: "/giveaway-prize-media/media-1",
          width: 1200,
          height: 800,
        },
      })),
      onChanged: failedReload,
      onStatus: (status) => reloadStatuses.push(status),
    })).resolves.toBe(false);
    expect(failedReload).toHaveBeenCalledOnce();
    expect(reloadStatuses.at(-1)).toBe(
      "The public prize image was uploaded, but the workspace could not be refreshed. Refresh to see it.",
    );
    expect(reloadStatuses).not.toContain("Public prize image updated.");
  });

  test("wires existing campaign edits through the selected campaign draft dispatcher", async () => {
    const source = await readFile(organizerGiveawayWorkspaceSourceUrl, "utf8");

    expect(source).toContain(
      "setDraftsByCampaignId((current) =>\n        applyOrganizerGiveawayDraftUpdate(current, selectedCampaignId, update),",
    );
    expect(source).toContain("onChange={changeSelectedCampaignDraft}");
  });

  test("keeps the standalone editor draft for a new campaign", async () => {
    const source = await readFile(organizerGiveawayWorkspaceSourceUrl, "utf8");

    expect(source).toContain("if (!selectedCampaignId) {\n        setEditorDraft(update);");
    expect(source).toContain("draft={selectedDraft ?? editorDraft}");
  });

  test("freezes campaign editor controls while a save is pending", async () => {
    const campaignEditorSource = await readCampaignEditorSource();

    expect(campaignEditorSource).toContain(
      '<fieldset disabled={isPending} className="m-0 grid gap-4 border-0 p-0">',
    );
  });

  test("places Giveaways beside scanner and report links for the selected event", async () => {
    const backend = await createTambikeTestBackend();
    const { organizer } = await createTestActors(backend, "organizer-workspace-navigation");
    const event = await backend.createEventDraft(organizer.sessionToken, {
      title: "Giveaway navigation event",
      type: "Bike Night",
      date: "August 18, 2026",
      time: "7:00 PM - 10:00 PM",
      locationName: "Giveaway Navigation Grounds",
      locationAddress: "18 Navigation Avenue, Antipolo",
      locationMapLink: "https://maps.example.test/giveaway-navigation-grounds",
      area: "Antipolo",
      expectedRiders: 40,
      perkPreview: "Prize draw",
    });
    const snapshot = await backend.getSnapshot(organizer.sessionToken);
    const consoleMarkup = React.createElement(OrganizerConsole, {
      section: "event",
      eventId: event.id,
    });
    const demoMarkup = React.createElement(
      DemoProvider,
      { initialState: snapshot } as React.ComponentProps<typeof DemoProvider>,
      consoleMarkup,
    );
    const markup = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        {} as React.ComponentProps<typeof TooltipProvider>,
        demoMarkup,
      ),
    );

    expect(markup).toContain("Giveaways");
    expect(markup).toContain(`/organizer/events/${event.id}/giveaways`);
  });

  test("keeps campaign-code and audited-manual entry controls mode-specific and secret-safe", () => {
    const codeMarkup = renderToStaticMarkup(
      React.createElement(CampaignEntryOperations, {
        campaignId: "giveaway-code",
        entryMode: "claim_code",
        state: "open",
        codeSummaries: [
          {
            id: "code-summary-1",
            maxUses: 30,
            usedUses: 12,
            expiresAt: "2026-08-18T12:00:00.000Z",
            createdAt: "2026-08-17T12:00:00.000Z",
            status: "active",
          },
        ],
        manualCandidates: [],
        issuedCode: {
          id: "code-summary-2",
          code: "gwy_visible_once",
          maxUses: 3,
          expiresAt: "2026-08-19T12:00:00.000Z",
        },
        isPending: false,
        onCreateCode: () => undefined,
        onDismissIssuedCode: () => undefined,
        onGrantManualEntry: () => undefined,
        onRevokeManualEntry: () => undefined,
      }),
    );

    expect(codeMarkup).toContain("Campaign-code access");
    expect(codeMarkup).toContain("Create campaign code");
    expect(codeMarkup).toContain("12 of 30 uses");
    expect(codeMarkup).toContain("gwy_visible_once");
    expect(codeMarkup).toContain("cannot be shown again");
    expect(codeMarkup).not.toContain("Audited manual entry");
    expect(codeMarkup).not.toContain("tokenHash");

    const manualMarkup = renderToStaticMarkup(
      React.createElement(CampaignEntryOperations, {
        campaignId: "giveaway-manual",
        entryMode: "manual_only",
        state: "open",
        codeSummaries: [],
        manualCandidates: [{ riderId: "rider-1", label: "Rider One" }],
        issuedCode: null,
        isPending: false,
        onCreateCode: () => undefined,
        onDismissIssuedCode: () => undefined,
        onGrantManualEntry: () => undefined,
        onRevokeManualEntry: () => undefined,
      }),
    );

    expect(manualMarkup).toContain("Audited manual entry");
    expect(manualMarkup).toContain("Rider One");
    expect(manualMarkup).toContain("Grant entry");
    expect(manualMarkup).toContain("Revoke entry");
    expect(manualMarkup).toContain("Reason for the audit trail");
    expect(manualMarkup).not.toContain("Campaign-code access");
    expect(manualMarkup).not.toContain("gwy_visible_once");
  });

  test("rejects a syntactically valid past campaign-code expiry before creating a code", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    const onCreateCode = vi.fn();

    try {
      const inputError = submitCampaignCode({
        maxUsesInput: "3",
        expiresAtInput: "2029-12-31T23:59",
        onCreateCode,
      });

      expect(inputError).toBe("Choose a future expiry time.");
      expect(onCreateCode).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("keeps the server-controlled default expiry when a campaign-code expiry is blank", () => {
    const onCreateCode = vi.fn();

    const inputError = submitCampaignCode({
      maxUsesInput: "3",
      expiresAtInput: "",
      onCreateCode,
    });

    expect(inputError).toBeNull();
    expect(onCreateCode).toHaveBeenCalledWith({ maxUses: 3 });
  });

  test("renders cancellation only when the server grants the current campaign capability", () => {
    const serverAllowedMarkup = renderToStaticMarkup(
      React.createElement(CampaignCancellationPanel, {
        state: "locked",
        canCancel: true,
        reason: "",
        isPending: false,
        onReasonChange: () => undefined,
        onCancel: () => undefined,
      } as unknown as React.ComponentProps<typeof CampaignCancellationPanel>),
    );
    const serverHiddenMarkup = renderToStaticMarkup(
      React.createElement(CampaignCancellationPanel, {
        state: "paused",
        canCancel: false,
        reason: "No longer needed",
        isPending: false,
        onReasonChange: () => undefined,
        onCancel: () => undefined,
      } as unknown as React.ComponentProps<typeof CampaignCancellationPanel>),
    );

    expect(serverAllowedMarkup).toContain("Cancel campaign before awards exist");
    expect(serverAllowedMarkup).toContain("Cancellation reason");
    expect(serverAllowedMarkup).toContain("Cancel campaign");
    expect(serverAllowedMarkup).toMatch(/disabled/);
    expect(serverHiddenMarkup).toBe("");
  });

  test("uses locked snapshot manual selection without offering a random-draw substitute", () => {
    const manualPools = [{ id: "manual-pool", title: "Community recognition", awardMode: "manual_selection" as const }];
    const manualMarkup = renderToStaticMarkup(
      React.createElement(CampaignManualSelectionOperations, {
        campaignId: "giveaway-manual",
        state: "locked",
        prizePools: manualPools,
        candidatesByPool: {
          "manual-pool": [{ snapshotEntryId: "snapshot-entry-1", label: "Locked entry entry_opaque" }],
        },
        inventoryStatusByPool: { "manual-pool": "ready" },
        isPending: false,
        onSelect: async () => false,
      }),
    );
    const preLockMarkup = renderToStaticMarkup(
      React.createElement(CampaignManualSelectionOperations, {
        campaignId: "giveaway-manual",
        state: "open",
        prizePools: manualPools,
        candidatesByPool: {},
        inventoryStatusByPool: {},
        isPending: false,
        onSelect: async () => false,
      }),
    );
    const lockedManualHeader = renderToStaticMarkup(
      React.createElement(CampaignOperationalHeader, {
        campaign: {
          id: "giveaway-manual",
          eventId: "event-1",
          title: "Manual award campaign",
          state: "locked",
          complianceStatus: "approved",
          mechanicsVersion: 1,
        },
        isPending: false,
        operations: {
          giveawayId: "giveaway-manual",
          canCancel: false,
          canRunInitialRandomDraw: false,
          presentationDrawId: null,
          publishableDrawId: null,
          recoverableAwards: [],
        },
        onSubmit: () => undefined,
        onSchedule: () => undefined,
        onOpen: () => undefined,
        onPause: () => undefined,
        onLock: () => undefined,
        onDraw: () => undefined,
        onPublish: () => undefined,
      }),
    );

    expect(manualMarkup).toContain("Manual award selection");
    expect(manualMarkup).toContain("Locked entry entry_opaque");
    expect(manualMarkup).toContain("Selection reason");
    expect(manualMarkup).toContain("Record selection");
    expect(manualMarkup).not.toContain("Run draw");
    expect(preLockMarkup).toBe("");
    expect(lockedManualHeader).not.toContain("Run draw");
  });

  test("keeps initial random draw and reload-safe publication controls server-owned", () => {
    const operations: OrganizerGiveawayOperations = {
      giveawayId: "giveaway-manual",
      canCancel: false,
      canRunInitialRandomDraw: true,
      presentationDrawId: "draw-opaque",
      publishableDrawId: "draw-opaque",
      recoverableAwards: [],
    };
    const randomProps = {
      campaign: {
        id: "giveaway-manual",
        eventId: "event-1",
        title: "Manual award campaign",
        state: "drawing" as const,
        complianceStatus: "approved" as const,
        mechanicsVersion: 1,
      },
      isPending: false,
      operations,
      publicationMode: "random_presentation",
      manualSelectionGate: "blocked",
      manualSelectionGateReason: "candidates_remaining",
      onSubmit: () => undefined,
      onSchedule: () => undefined,
      onOpen: () => undefined,
      onPause: () => undefined,
      onLock: () => undefined,
      onDraw: () => undefined,
      onPublish: () => undefined,
    } as unknown as React.ComponentProps<typeof CampaignOperationalHeader>;

    const markup = renderToStaticMarkup(
      React.createElement(CampaignOperationalHeader, randomProps),
    );

    expect(markup).toContain("Run draw");
    expect(markup).not.toContain("Publish result");
  });

  test("derives the manual-selection publication gate only from every current server inventory", () => {
    const manualPools = [
      { id: "manual-1", awardMode: "manual_selection" as const },
      { id: "manual-2", awardMode: "manual_selection" as const },
    ];

    expect(resolveGiveawayManualSelectionGate([], {}, {})).toEqual({
      gate: "clear",
      reason: "none",
    });
    expect(resolveGiveawayManualSelectionGate([], {}, {}, false)).toEqual({
      gate: "checking",
      reason: "inventory_checking",
    });
    expect(
      resolveGiveawayManualSelectionGate(
        manualPools,
        { "manual-1": "idle", "manual-2": "ready" },
        { "manual-2": [] },
      ),
    ).toEqual({ gate: "checking", reason: "inventory_checking" });
    expect(
      resolveGiveawayManualSelectionGate(
        manualPools,
        { "manual-1": "loading", "manual-2": "ready" },
        { "manual-2": [] },
      ),
    ).toEqual({ gate: "checking", reason: "inventory_checking" });
    expect(
      resolveGiveawayManualSelectionGate(
        manualPools,
        { "manual-1": "error", "manual-2": "ready" },
        { "manual-1": [], "manual-2": [] },
      ),
    ).toEqual({ gate: "blocked", reason: "inventory_error" });
    expect(
      resolveGiveawayManualSelectionGate(
        manualPools,
        { "manual-1": "ready", "manual-2": "ready" },
        { "manual-1": [], "manual-2": [{ snapshotEntryId: "entry-1", label: "Rider A1B2" }] },
      ),
    ).toEqual({ gate: "blocked", reason: "candidates_remaining" });
    expect(
      resolveGiveawayManualSelectionGate(
        manualPools,
        { "manual-1": "ready", "manual-2": "ready" },
        { "manual-1": [], "manual-2": [] },
      ),
    ).toEqual({ gate: "clear", reason: "none" });
  });

  test("fails closed when deciding between presentation and direct publication", () => {
    const randomPool = { id: "random", awardMode: "random_draw" as const };
    const manualPool = { id: "manual", awardMode: "manual_selection" as const };
    const noPresentationOperations: OrganizerGiveawayOperations = {
      giveawayId: "giveaway-1",
      canCancel: false,
      canRunInitialRandomDraw: false,
      presentationDrawId: null,
      publishableDrawId: "draw-manual-before-random",
      recoverableAwards: [],
    };

    expect(getGiveawayPublicationMode([randomPool], noPresentationOperations)).toBe("random_presentation");
    expect(getGiveawayPublicationMode([manualPool, randomPool], noPresentationOperations)).toBe("random_presentation");
    expect(getGiveawayPublicationMode([manualPool], noPresentationOperations)).toBe("manual_direct");
    expect(getGiveawayPublicationMode(undefined, noPresentationOperations)).toBe("unknown");
    expect(
      getGiveawayPublicationMode(undefined, {
        ...noPresentationOperations,
        canRunInitialRandomDraw: true,
      }),
    ).toBe("random_presentation");
    expect(
      getGiveawayPublicationMode(undefined, {
        ...noPresentationOperations,
        presentationDrawId: "draw-initial-random",
      }),
    ).toBe("random_presentation");
  });

  test("keeps direct publication only for loaded manual-only configuration and fails closed on inventory", () => {
    const baseProps = {
      campaign: {
        id: "giveaway-manual",
        eventId: "event-1",
        title: "Manual awards",
        state: "drawing" as const,
        complianceStatus: "approved" as const,
        mechanicsVersion: 1,
      },
      isPending: false,
      operations: {
        giveawayId: "giveaway-manual",
        canCancel: false,
        canRunInitialRandomDraw: false,
        presentationDrawId: null,
        publishableDrawId: "draw-manual",
        recoverableAwards: [],
      },
      publicationMode: "manual_direct" as const,
      onSubmit: () => undefined,
      onSchedule: () => undefined,
      onOpen: () => undefined,
      onPause: () => undefined,
      onLock: () => undefined,
      onDraw: () => undefined,
      onPublish: () => undefined,
    };
    const checking = renderToStaticMarkup(
      React.createElement(CampaignOperationalHeader, {
        ...baseProps,
        manualSelectionGate: "checking",
        manualSelectionGateReason: "inventory_checking",
      }),
    );
    const failed = renderToStaticMarkup(
      React.createElement(CampaignOperationalHeader, {
        ...baseProps,
        manualSelectionGate: "blocked",
        manualSelectionGateReason: "inventory_error",
      }),
    );
    const clear = renderToStaticMarkup(
      React.createElement(CampaignOperationalHeader, {
        ...baseProps,
        manualSelectionGate: "clear",
        manualSelectionGateReason: "none",
      }),
    );

    expect(checking).toContain("Publish result");
    expect(checking).toContain("Checking the remaining manual selections before publication.");
    expect(checking).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Publish result/);
    expect(failed).toContain("Manual candidate inventory could not be verified. Refresh before publishing.");
    expect(failed).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Publish result/);
    expect(clear).toContain("Publish result");
    expect(clear).not.toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Publish result/);
  });

  test("uses the stable initial draw identity for presentation reads and publication", async () => {
    const operations: OrganizerGiveawayOperations = {
      giveawayId: "giveaway-random",
      canCancel: false,
      canRunInitialRandomDraw: false,
      presentationDrawId: "draw-initial-random",
      publishableDrawId: "draw-later-manual",
      recoverableAwards: [],
    };
    const request = resolveOrganizerGiveawayPresentationRequest("event-1", "giveaway-random", operations);
    const readAction = vi.fn(async () => ({ ok: true as const, data: completedPresentation }));
    const publishAction = vi.fn(async () => ({ ok: true as const, data: {} }));

    expect(request).toEqual({
      eventId: "event-1",
      giveawayId: "giveaway-random",
      drawId: "draw-initial-random",
    });
    await expect(readOrganizerGiveawayPresentation(request!, readAction)).resolves.toEqual(completedPresentation);
    expect(readAction).toHaveBeenCalledWith("giveaway-random", "draw-initial-random");
    await expect(
      publishOrganizerGiveawayPresentation(completedPresentation, publishAction),
    ).resolves.toBe(true);
    expect(publishAction).toHaveBeenCalledWith("giveaway-random", "draw-initial-random");

    expect(
      createOrganizerGiveawayPresentationRequest("event-1", "giveaway-random", "draw-from-action-result"),
    ).toEqual({
      eventId: "event-1",
      giveawayId: "giveaway-random",
      drawId: "draw-from-action-result",
    });
    expect(resolveOrganizerGiveawayPresentationRequest("event-1", "giveaway-random", {
      ...operations,
      presentationDrawId: null,
    })).toBeNull();
  });

  test("retains an action-result presentation request while operations recovery is stale", () => {
    const retainedRequest = createOrganizerGiveawayPresentationRequest(
      "event-1",
      "giveaway-random",
      "draw-from-action-result",
    );
    const staleOperations: OrganizerGiveawayOperations = {
      giveawayId: "giveaway-random",
      canCancel: false,
      canRunInitialRandomDraw: true,
      presentationDrawId: null,
      publishableDrawId: null,
      recoverableAwards: [],
    };

    expect(
      resolveOrganizerGiveawayPresentationRequest(
        "event-1",
        "giveaway-random",
        staleOperations,
        retainedRequest,
      ),
    ).toEqual(retainedRequest);
    expect(canRunOrganizerInitialRandomDraw(staleOperations, retainedRequest)).toBe(false);
    expect(canRunOrganizerInitialRandomDraw(staleOperations, null)).toBe(true);
    expect(
      resolveOrganizerGiveawayPresentationRequest(
        "event-1",
        "giveaway-other",
        { ...staleOperations, giveawayId: "giveaway-other" },
        retainedRequest,
      ),
    ).toBeNull();
  });

  test("acknowledges publication before preserving the ready controller through revalidation", async () => {
    const request = createOrganizerGiveawayPresentationRequest(
      "event-1",
      "giveaway-random",
      "draw-initial-random",
    )!;
    const readyState = {
      request,
      status: "ready" as const,
      presentation: completedPresentation,
    };

    expect(resolveGiveawayPresentationLoadStartState(readyState, request, true)).toBe(readyState);
    expect(resolveGiveawayPresentationLoadFailureState(readyState, request, true)).toBe(readyState);
    expect(resolveGiveawayPresentationLoadStartState(readyState, request, false)).toEqual({
      request,
      status: "loading",
    });
    expect(resolveGiveawayPresentationLoadFailureState(readyState, request, false)).toEqual({
      request,
      status: "error",
    });

    const order: string[] = [];
    let acknowledge!: (value: boolean) => void;
    const publication = new Promise<boolean>((resolve) => {
      acknowledge = resolve;
    });
    const controllerSettlement = publication.then(() => {
      order.push("controller-published");
    });

    acknowledgeOrganizerGiveawayPresentationPublication(acknowledge, async () => {
      order.push("revalidate");
    });
    await controllerSettlement;
    await Promise.resolve();

    expect(order).toEqual(["controller-published", "revalidate"]);
  });

  test("rejects stale presentation identities and renders narrow loading, retry, and published states", async () => {
    await expect(
      readOrganizerGiveawayPresentation(
        { eventId: "event-other", giveawayId: "giveaway-random", drawId: "draw-initial-random" },
        async () => ({ ok: true, data: completedPresentation }),
      ),
    ).rejects.toThrow("GIVEAWAY_PRESENTATION_IDENTITY_MISMATCH");

    const loading = renderToStaticMarkup(
      React.createElement(CampaignGiveawayPresentationPanel, {
        loadState: {
          request: { eventId: "event-1", giveawayId: "giveaway-random", drawId: "draw-initial-random" },
          status: "loading",
        },
        manualSelectionGate: "clear",
        completedDrawPublishable: true,
        pending: false,
        onRetry: () => undefined,
        onPublish: async () => true,
      }),
    );
    const failed = renderToStaticMarkup(
      React.createElement(CampaignGiveawayPresentationPanel, {
        loadState: {
          request: { eventId: "event-1", giveawayId: "giveaway-random", drawId: "draw-initial-random" },
          status: "error",
        },
        manualSelectionGate: "clear",
        completedDrawPublishable: true,
        pending: false,
        onRetry: () => undefined,
        onPublish: async () => true,
      }),
    );
    const published = renderToStaticMarkup(
      React.createElement(CampaignGiveawayPresentationPanel, {
        loadState: {
          request: { eventId: "event-1", giveawayId: "giveaway-random", drawId: "draw-initial-random" },
          status: "ready",
          presentation: { ...completedPresentation, drawStatus: "published" },
        },
        manualSelectionGate: "clear",
        completedDrawPublishable: false,
        pending: false,
        onRetry: () => undefined,
        onPublish: async () => true,
      }),
    );

    expect(loading).toContain("Loading the fixed raffle presentation");
    expect(failed).toContain("The fixed draw is safe, but its presentation could not be loaded.");
    expect(failed).toContain("Retry presentation");
    expect(published).toContain("Presentation published");
    expect(published).toMatch(/<button[^>]*disabled=""[^>]*>Publish &amp; Notify<\/button>/);
  });

  test("uses a server-owned recovery queue without rendering raw terminal award IDs", () => {
    const markup = renderToStaticMarkup(
      React.createElement(RecoveryQueuePanel, {
        recoverableAwards: [
          {
            awardId: "award-opaque-never-display",
            label: "Random redraw for Helmet pool",
            status: "voided",
            recoveryKind: "random_redraw",
            claimDeadlineRequired: true,
          },
        ],
        isPending: false,
        reason: "",
        claimDeadlineAt: "",
        onReasonChange: () => undefined,
        onClaimDeadlineAtChange: () => undefined,
        onRandomRedraw: async () => false,
        onDirectReoffer: () => undefined,
        onLoadManualReplacementOptions: async () => null,
        onReplaceManualAward: async () => false,
      }),
    );

    expect(markup).toContain("Random redraw for Helmet pool");
    expect(markup).toContain("New claim deadline");
    expect(markup).not.toContain("award-opaque-never-display");
    expect(markup).not.toContain("Terminal award ID");

    const manualMarkup = renderToStaticMarkup(
      React.createElement(RecoveryQueuePanel, {
        recoverableAwards: [
          {
            awardId: "manual-award-opaque-never-display",
            label: "Manual replacement for Sponsor pool",
            status: "voided",
            recoveryKind: "manual_replacement",
            claimDeadlineRequired: true,
          },
        ],
        isPending: false,
        reason: "",
        claimDeadlineAt: "",
        onReasonChange: () => undefined,
        onClaimDeadlineAtChange: () => undefined,
        onRandomRedraw: async () => false,
        onDirectReoffer: () => undefined,
        onLoadManualReplacementOptions: async () => null,
        onReplaceManualAward: async () => false,
      }),
    );
    expect(manualMarkup).toContain("Manual replacement");
    expect(manualMarkup).toContain("fresh future claim deadline is required");
    expect(manualMarkup).not.toContain("manual-award-opaque-never-display");
  });

  test("reuses idempotency keys only for identical manual and recovery submissions", () => {
    const manualInput = {
      giveawayId: "giveaway-1",
      prizePoolId: "pool-1",
      snapshotEntryId: "entry-1",
      reason: "Community contribution",
    };
    const firstManual = resolveManualSelectionSubmission(null, manualInput, () => "manual-key-1");

    expect(resolveManualSelectionSubmission(firstManual, manualInput, () => "manual-key-2")).toBe(firstManual);
    expect(
      resolveManualSelectionSubmission(firstManual, { ...manualInput, reason: "Updated reason" }, () => "manual-key-3"),
    ).toMatchObject({ idempotencyKey: "manual-key-3" });

    const firstRecovery = resolveGiveawaySubmission(null, "award|entry|reason|deadline", () => "recovery-key-1");
    expect(resolveGiveawaySubmission(firstRecovery, "award|entry|reason|deadline", () => "recovery-key-2")).toBe(firstRecovery);
    expect(resolveGiveawaySubmission(firstRecovery, "award|entry|new-reason|deadline", () => "recovery-key-3")).toMatchObject({
      idempotencyKey: "recovery-key-3",
    });

    const firstInitialDraw = resolveInitialDrawSubmission(null, "giveaway-1", () => "initial-key-1");
    expect(resolveInitialDrawSubmission(firstInitialDraw, "giveaway-1", () => "initial-key-2")).toBe(firstInitialDraw);
    expect(resolveInitialDrawSubmission(firstInitialDraw, "giveaway-2", () => "initial-key-3")).toMatchObject({
      idempotencyKey: "initial-key-3",
    });
  });
});
