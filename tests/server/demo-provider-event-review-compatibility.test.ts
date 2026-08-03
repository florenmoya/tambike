/** @vitest-environment jsdom */

import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { AdminEventReviewView } from "../../src/features/admin/event-review-types";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import type { DemoState } from "../../src/features/tambike-demo/types";
import { adminApproval, demoEvents, seedUsers } from "../../src/features/tambike-demo/data";

const approvePublishAction = vi.hoisted(() => vi.fn());

vi.mock("../../src/server/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/actions")>();
  return {
    ...actual,
    approvePublishAction,
  };
});

import { AdminConsole } from "../../src/features/admin/admin-console";
import { DemoProvider } from "../../src/features/tambike-demo/demo-provider";

const pendingEvent = demoEvents.find(
  (event) => event.id === adminApproval.eventId,
)!;
const currentAdmin = seedUsers.find((user) => user.role === "admin")!;
const initialState: DemoState = {
  currentUser: currentAdmin,
  users: seedUsers,
  events: [pendingEvent],
  passes: [],
  checkInSettings: [],
  passCreated: false,
};

describe("DemoProvider event-review compatibility", () => {
  beforeEach(() => {
    approvePublishAction.mockReset();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  test("replaces the pending event with the published action result", async () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const publishedEvent = { ...pendingEvent, status: "PUBLISHED" as const };
    const publishedView: AdminEventReviewView = {
      event: publishedEvent,
      organizerName: "Tambike Organizer",
      submissionVersion: 1,
      expectedUpdatedAt: "2026-08-04T01:00:00.000Z",
      history: [],
    };
    approvePublishAction.mockResolvedValue(publishedView);

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(
            TooltipProvider,
            null,
            createElement(
              DemoProvider,
              { initialState } as ComponentProps<typeof DemoProvider>,
              createElement(AdminConsole, {
                section: "events",
                reviewId: pendingEvent.id,
              }),
            ),
          ),
        );
      });

      const approveButton = [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Approve publish",
      );
      expect(approveButton).toBeDefined();

      await act(async () => approveButton!.click());

      expect(approvePublishAction).toHaveBeenCalledWith(pendingEvent.id);
      expect(container.textContent).toContain("Published to riders");
      expect(container.textContent).toContain("published and visible to riders");
      expect(
        [...container.querySelectorAll("button")].some(
          (button) => button.textContent?.trim() === "Approve publish",
        ),
      ).toBe(false);
      expect(container.textContent).not.toContain("Request changes");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
