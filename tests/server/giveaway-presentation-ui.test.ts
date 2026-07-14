import { readFile } from "node:fs/promises";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  GiveawayPresentationController,
  GiveawayPresentationStageFallbackLink,
  canResetGiveawayPresentation,
  GiveawayPresentationControllerView,
  canPublishGiveawayPresentation,
  getGiveawayPresentationControllerViewModel,
  isGiveawayPresentationControllerConnectionActionable,
  isGiveawayPresentationOperationCurrent,
} from "../../src/features/giveaways/giveaway-presentation-controller";
import { GiveawayPresentationStageView } from "../../src/features/giveaways/giveaway-presentation-stage";
import { getGiveawayPresentationReelAnimationKey } from "../../src/features/giveaways/giveaway-presentation-reel";
import type { OrganizerGiveawayPresentation } from "../../src/features/giveaways/types";
import type {
  GiveawayPresentationControllerStateMessage,
} from "../../src/features/giveaways/giveaway-presentation-channel";
import type { GiveawayPresentationRuntimeState } from "../../src/features/giveaways/giveaway-presentation-runtime";

const digest = "b".repeat(64);
const presentation: OrganizerGiveawayPresentation = {
  eventId: "event-1",
  giveawayId: "giveaway-1",
  drawId: "draw-1",
  giveawayTitle: "Tambike Night Run Raffle",
  drawStatus: "completed",
  resultDigest: digest,
  candidateCount: 87,
  labelBank: ["Rider ALPHA", "Rider BRAVO", "Rider CHARLIE", "Rider FUTURE"],
  slides: [
    {
      position: 1,
      prizePoolTitle: "Road-ready kit",
      prizeItemTitle: "Full-face helmet",
      winnerLabel: "Rider ALPHA",
    },
    {
      position: 2,
      prizePoolTitle: "Night ride kit",
      prizeItemTitle: "Auxiliary lights",
      winnerLabel: "Rider BRAVO",
    },
    {
      position: 3,
      prizePoolTitle: "Grand prize",
      prizeItemTitle: "Touring jacket",
      winnerLabel: "Rider FUTURE",
    },
  ],
};

const state = (
  phase: GiveawayPresentationRuntimeState["phase"],
  slideIndex = 0,
  mode: GiveawayPresentationRuntimeState["mode"] = "normal",
): GiveawayPresentationRuntimeState => ({ phase, slideIndex, mode, soundEnabled: false });

function viewMarkup(
  runtime: GiveawayPresentationRuntimeState,
  overrides: Partial<React.ComponentProps<typeof GiveawayPresentationControllerView>> = {},
) {
  return renderToStaticMarkup(
    React.createElement(GiveawayPresentationControllerView, {
      presentation,
      state: runtime,
      connected: true,
      popupBlocked: false,
      stageUrl: "/stage?channel=same",
      manualSelectionGate: "clear",
      completedDrawPublishable: true,
      pending: false,
      publicationSucceeded: false,
      publishError: null,
      onOpenStage: vi.fn(),
      onModeChange: vi.fn(),
      onSoundChange: vi.fn(),
      onFullscreen: vi.fn(),
      onReveal: vi.fn(),
      onSkip: vi.fn(),
      onNext: vi.fn(),
      onRestart: vi.fn(),
      onInstantReplay: vi.fn(),
      onPublish: vi.fn(),
      ...overrides,
    }),
  );
}

function controllerMessage(
  runtime: GiveawayPresentationRuntimeState,
): GiveawayPresentationControllerStateMessage {
  return {
    version: 1,
    type: "controller-state",
    channelId: "123e4567-e89b-42d3-a456-426614174000",
    eventId: presentation.eventId,
    giveawayId: presentation.giveawayId,
    drawId: presentation.drawId,
    resultDigest: presentation.resultDigest,
    state: runtime,
    presentation,
  };
}

describe("private giveaway presentation controller", () => {
  test("does not treat a stage heartbeat as actionable when its payload cannot be sent", () => {
    expect(isGiveawayPresentationControllerConnectionActionable(true, presentation)).toBe(true);
    expect(
      isGiveawayPresentationControllerConnectionActionable(true, {
        ...presentation,
        giveawayTitle: "X".repeat(501),
      }),
    ).toBe(false);
    expect(isGiveawayPresentationControllerConnectionActionable(false, presentation)).toBe(false);
  });

  test("uses a fail-closed publication gate", () => {
    const base = {
      presentation,
      state: state("complete", 2),
      manualSelectionGate: "clear" as const,
      completedDrawPublishable: true,
      pending: false,
      publicationSucceeded: false,
    };
    expect(canPublishGiveawayPresentation(base)).toBe(true);
    expect(canPublishGiveawayPresentation({ ...base, state: state("winner", 1) })).toBe(false);
    expect(canPublishGiveawayPresentation({ ...base, manualSelectionGate: "checking" })).toBe(false);
    expect(canPublishGiveawayPresentation({ ...base, manualSelectionGate: "blocked" })).toBe(false);
    expect(canPublishGiveawayPresentation({ ...base, completedDrawPublishable: false })).toBe(false);
    expect(canPublishGiveawayPresentation({ ...base, pending: true })).toBe(false);
    expect(canPublishGiveawayPresentation({ ...base, publicationSucceeded: true })).toBe(false);
    expect(
      canPublishGiveawayPresentation({
        ...base,
        presentation: { ...presentation, drawStatus: "published" },
      }),
    ).toBe(false);
  });

  test("never lets restart or replay cancel an active fixed-winner settle", () => {
    expect(canResetGiveawayPresentation(state("spinning"))).toBe(false);
    expect(canResetGiveawayPresentation(state("winner", 0))).toBe(true);
    expect(canResetGiveawayPresentation(state("complete", 2))).toBe(true);

    const spinning = viewMarkup(state("spinning"), { connected: false });
    for (const label of ["Restart Presentation", "Instant replay"]) {
      const labelIndex = spinning.indexOf(label);
      const openingTag = spinning.slice(spinning.lastIndexOf("<button", labelIndex), labelIndex);
      expect(openingTag).toContain('disabled=""');
    }
  });

  test("rejects an in-flight publication result after identity or operation changes", () => {
    const started = { identity: "draw-a:digest-a", token: 4 };
    expect(isGiveawayPresentationOperationCurrent(started, { ...started })).toBe(true);
    expect(
      isGiveawayPresentationOperationCurrent(started, {
        identity: "draw-b:digest-b",
        token: 4,
      }),
    ).toBe(false);
    expect(
      isGiveawayPresentationOperationCurrent(started, {
        identity: started.identity,
        token: 5,
      }),
    ).toBe(false);
    expect(isGiveawayPresentationOperationCurrent(started, null)).toBe(false);
  });

  test("maps Normal, Instant, Skip, manual Next, final, and published controls", () => {
    expect(getGiveawayPresentationControllerViewModel(state("ready"), presentation.slides.length))
      .toMatchObject({ primaryAction: "reveal", canReveal: true, canSkip: false });
    expect(
      getGiveawayPresentationControllerViewModel(
        state("ready", 0, "instant"),
        presentation.slides.length,
      ),
    ).toMatchObject({ primaryAction: "reveal", mode: "instant" });
    expect(getGiveawayPresentationControllerViewModel(state("spinning"), 3)).toMatchObject({
      primaryAction: "skip",
      canSkip: true,
    });
    expect(getGiveawayPresentationControllerViewModel(state("winner", 0), 3)).toMatchObject({
      primaryAction: "next",
      canNext: true,
    });
    expect(getGiveawayPresentationControllerViewModel(state("complete", 2), 3)).toMatchObject({
      primaryAction: null,
      complete: true,
    });
    expect(getGiveawayPresentationControllerViewModel(state("published", 2), 3)).toMatchObject({
      primaryAction: null,
      published: true,
    });
  });

  test("shows revealed winners and future prize titles without upcoming winner labels", () => {
    const markup = viewMarkup(state("winner", 0));
    expect(markup).toContain("Rider ALPHA");
    expect(markup).toContain("Night ride kit");
    expect(markup).toContain("Grand prize");
    expect(markup).not.toContain("Rider BRAVO");
    expect(markup).not.toContain("Rider FUTURE");
    expect(markup).not.toContain(digest);
    expect(markup).not.toContain("draw-1");
  });

  test("names the current prize before reveal without exposing its fixed winner", () => {
    const markup = viewMarkup(state("ready", 0));
    expect(markup).toContain("Road-ready kit");
    expect(markup).toContain("Full-face helmet");
    expect(markup).not.toContain("Rider ALPHA");
  });

  test("renders a real blocked-popup fallback with the same stage URL and clear gate messages", () => {
    const blocked = viewMarkup(state("ready"), { popupBlocked: true, connected: false });
    expect(blocked).toContain('href="/stage?channel=same"');
    expect(blocked).toContain("Open stage directly");
    expect(blocked).toContain("Stage disconnected");

    const manual = viewMarkup(state("complete", 2), { manualSelectionGate: "blocked" });
    expect(manual).toContain("Complete required manual selections before publishing");
    expect(manual).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Publish &amp; Notify|<button[^>]*disabled=""/);

    const failed = viewMarkup(state("complete", 2), {
      publishError: "Winners were not published. Check the connection and try again.",
    });
    expect(failed).toContain("Winners were not published. Check the connection and try again.");
  });

  test("routes direct fallback activation through the retained projector-window handler", () => {
    const onOpenStage = vi.fn(() => true);
    const link = GiveawayPresentationStageFallbackLink({
      stageUrl: "/stage?channel=same",
      onOpenStage,
    });
    const preventDefault = vi.fn();
    link.props.onClick({ preventDefault });
    expect(onOpenStage).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(link.props).toMatchObject({
      href: "/stage?channel=same",
      target: "tambike-live-raffle-stage",
    });

    const nativeFallback = GiveawayPresentationStageFallbackLink({
      stageUrl: "/stage?channel=same",
      onOpenStage: () => false,
    });
    const nativePreventDefault = vi.fn();
    nativeFallback.props.onClick({ preventDefault: nativePreventDefault });
    expect(nativePreventDefault).not.toHaveBeenCalled();
  });

  test("defaults the reusable interactive controller to sound off", () => {
    const markup = renderToStaticMarkup(
      React.createElement(GiveawayPresentationController, {
        eventId: presentation.eventId,
        giveawayId: presentation.giveawayId,
        presentation,
        manualSelectionGate: "clear",
        completedDrawPublishable: true,
        pending: false,
        onPublish: async () => true,
      }),
    );
    expect(markup).toContain("Sound off");
    expect(markup).toContain("Open stage");
  });
});

describe("clean giveaway presentation stage", () => {
  test("keeps the active reel animation identity stable across heartbeat snapshots", () => {
    expect(getGiveawayPresentationReelAnimationKey(["A", "B", "Winner"]))
      .toBe(getGiveawayPresentationReelAnimationKey(["A", "B", "Winner"]));
    expect(getGiveawayPresentationReelAnimationKey(["A", "B", "Winner"]))
      .not.toBe(getGiveawayPresentationReelAnimationKey(["A", "C", "Winner"]));
  });

  test("renders a restrained waiting state without payload identity", () => {
    const markup = renderToStaticMarkup(
      React.createElement(GiveawayPresentationStageView, {
        message: null,
        disconnected: false,
        settledWhileDisconnected: false,
        fullscreenRequested: false,
        reducedMotion: false,
        onSettled: vi.fn(),
        onFullscreen: vi.fn(),
      }),
    );
    expect(markup).toContain("Tambike Live Draw");
    expect(markup).toContain("Waiting for controller");
    expect(markup).not.toContain("event-1");
    expect(markup).not.toContain("giveaway-1");
  });

  test("shows only the current prize and reel while spinning", () => {
    const markup = renderToStaticMarkup(
      React.createElement(GiveawayPresentationStageView, {
        message: controllerMessage(state("spinning", 0)),
        disconnected: false,
        settledWhileDisconnected: false,
        fullscreenRequested: false,
        reducedMotion: false,
        onSettled: vi.fn(),
        onFullscreen: vi.fn(),
      }),
    );
    expect(markup).toContain("Road-ready kit");
    expect(markup).toContain("Full-face helmet");
    expect(markup).toContain("1 of 3");
    expect(markup).not.toContain("Night ride kit");
    expect(markup).not.toContain("Grand prize");
    expect(markup).not.toContain("Rider FUTURE");
    expect(markup).not.toContain(digest);
    expect(markup).not.toContain("candidateCount");
  });

  test("lands animation finish, Skip, and Instant on the same immutable winner", () => {
    const variants = [
      {
        message: controllerMessage(state("spinning", 0)),
        settledWhileDisconnected: true,
      },
      { message: controllerMessage(state("winner", 0)), settledWhileDisconnected: false },
      {
        message: controllerMessage(state("winner", 0, "instant")),
        settledWhileDisconnected: false,
      },
    ];
    for (const variant of variants) {
      const markup = renderToStaticMarkup(
        React.createElement(GiveawayPresentationStageView, {
          ...variant,
          disconnected: variant.settledWhileDisconnected,
          fullscreenRequested: false,
          reducedMotion: false,
          onSettled: vi.fn(),
          onFullscreen: vi.fn(),
        }),
      );
      expect(markup).toContain("Rider ALPHA");
    }
  });

  test("retains the final winner, announces completion/publication, and exposes only requested fullscreen", () => {
    const complete = renderToStaticMarkup(
      React.createElement(GiveawayPresentationStageView, {
        message: controllerMessage(state("complete", 2)),
        disconnected: false,
        settledWhileDisconnected: false,
        fullscreenRequested: true,
        reducedMotion: false,
        onSettled: vi.fn(),
        onFullscreen: vi.fn(),
      }),
    );
    expect(complete).toContain("Rider FUTURE");
    expect(complete).toContain("All winners revealed.");
    expect(complete).toContain("Enter fullscreen");
    expect(complete).not.toContain("Rider ALPHA");
    expect(complete).not.toContain("Rider BRAVO");

    const publishedMessage = controllerMessage(state("published", 2));
    publishedMessage.presentation = { ...presentation, drawStatus: "published" };
    const published = renderToStaticMarkup(
      React.createElement(GiveawayPresentationStageView, {
        message: publishedMessage,
        disconnected: false,
        settledWhileDisconnected: false,
        fullscreenRequested: false,
        reducedMotion: false,
        onSettled: vi.fn(),
        onFullscreen: vi.fn(),
      }),
    );
    expect(published).toContain("Winners published");
    expect(published).not.toContain("Enter fullscreen");
  });

  test("uses Web Animations without adding another animation package", async () => {
    const [reelSource, stageSource, packageSource] = await Promise.all([
      readFile(new URL("../../src/features/giveaways/giveaway-presentation-reel.tsx", import.meta.url), "utf8"),
      readFile(new URL("../../src/features/giveaways/giveaway-presentation-stage.tsx", import.meta.url), "utf8"),
      readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ]);
    expect(reelSource).toContain(".animate(");
    expect(reelSource).toContain("GIVEAWAY_PRESENTATION_NORMAL_DURATION_MS");
    expect(stageSource).toContain("BroadcastChannel");
    expect(packageSource).not.toMatch(/framer-motion|motion\/react|animejs|gsap/);
  });
});
