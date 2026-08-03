/** @vitest-environment jsdom */

import { act, createElement, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type {
  AdminEventReviewView,
  OrganizerEventSubmissionView,
} from "../../src/features/admin/event-review-types";
import type { ActionState } from "../../src/features/shared/action-state";
import type { Event } from "../../src/features/tambike-demo/types";

vi.mock("next/link", async () => {
  const react = await import("react");
  return {
    default: ({ href, ...props }: { href: string; children: ReactNode }) =>
      react.createElement("a", { ...props, href, "data-next-link": "true" }),
  };
});

const adminActions = vi.hoisted(() => ({
  reviewEventAction: vi.fn(),
  disableEventAction: vi.fn(),
  restoreEventAction: vi.fn(),
}));
const organizerActions = vi.hoisted(() => ({
  resubmitEventAction: vi.fn(),
}));

vi.mock("../../src/server/admin/event-review-actions", () => adminActions);
vi.mock(
  "../../src/server/organizer/event-submission-actions",
  () => organizerActions,
);

const event: Event = {
  id: "event-1",
  title: "Quezon City Night Ride",
  type: "Bike Night",
  status: "PENDING_ADMIN_REVIEW",
  organizerId: "organizer-1",
  poster: "/event.jpg",
  date: "Fri · Aug 7, 2099",
  time: "6:00 PM – 9:00 PM",
  startsAt: "2099-08-07T10:00:00.000Z",
  endsAt: "2099-08-07T13:00:00.000Z",
  timeZone: "Asia/Manila",
  recurrence: "NONE",
  locationName: "Quezon Memorial Circle",
  locationAddress: "Elliptical Road, Quezon City",
  locationMapLink: "https://maps.example.test/quezon-circle",
  area: "Quezon City",
  shortDescription: "A city night ride.",
  whatHappens: "Check in, ride, and follow the event rules.",
  going: 0,
  interested: 0,
  expectedRiders: 40,
  perkPreview: "Event sticker",
  tags: ["Bike Night"],
  riskFlags: [],
  rules: ["Follow marshal instructions."],
  perks: [],
};

const history = [
  {
    id: "approval-1",
    submissionVersion: 1,
    decision: "needs_changes" as const,
    reviewerName: "Tambike Ops",
    reason: "Please clarify the exact assembly point.",
    submittedAt: "2026-08-04T01:00:00.000Z",
    decidedAt: "2026-08-04T01:10:00.000Z",
  },
];

function adminView(status: Event["status"]): AdminEventReviewView {
  return {
    event: { ...event, status },
    organizerName: "Tambike QC",
    submissionVersion: 1,
    expectedUpdatedAt: "2026-08-04T01:10:00.000Z",
    history,
  };
}

function organizerView(status: Event["status"]): OrganizerEventSubmissionView {
  return {
    event: { ...event, status },
    submissionVersion: 1,
    expectedUpdatedAt: "2026-08-04T01:10:00.000Z",
    latestDecision: history[0],
    history,
  };
}

async function loadAdminControls() {
  const modulePath = `../../src/features/admin/${"event-review-controls"}`;
  return import(modulePath) as Promise<{
    EventReviewControls: ComponentType<{ initialView: AdminEventReviewView }>;
  }>;
}

async function loadOrganizerPanel() {
  const modulePath = `../../src/features/organizer/${"event-submission-panel"}`;
  return import(modulePath) as Promise<{
    EventSubmissionPanel: ComponentType<{
      initialView: OrganizerEventSubmissionView;
    }>;
  }>;
}

async function loadEditorFields() {
  const modulePath = `../../src/features/organizer/${"event-editor-fields"}`;
  return import(modulePath) as Promise<{
    EventEditorFields: ComponentType<{
      idPrefix: string;
      defaults?: Record<string, unknown>;
      disabled?: boolean;
    }>;
  }>;
}

async function loadDemoProvider() {
  const modulePath = `../../src/features/tambike-demo/${"demo-provider"}`;
  return import(modulePath);
}

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("persisted event review UI", () => {
  test("shows only legal admin actions for each persisted status", async () => {
    const { EventReviewControls } = await loadAdminControls();
    const pending = renderToStaticMarkup(
      createElement(EventReviewControls, { initialView: adminView("PENDING_ADMIN_REVIEW") }),
    );
    const published = renderToStaticMarkup(
      createElement(EventReviewControls, { initialView: adminView("PUBLISHED") }),
    );
    const disabled = renderToStaticMarkup(
      createElement(EventReviewControls, { initialView: adminView("DISABLED") }),
    );
    const needsChanges = renderToStaticMarkup(
      createElement(EventReviewControls, { initialView: adminView("NEEDS_CHANGES") }),
    );

    expect(pending).toContain("Approve and publish");
    expect(pending).toContain("Request changes");
    expect(pending).toContain("Reject submission");
    expect(pending).not.toContain("Disable event");
    expect(published).toContain("Disable event");
    expect(published).not.toContain("Approve and publish");
    expect(disabled).toContain("Restore to review");
    expect(disabled).not.toContain("Disable event");
    expect(needsChanges).toContain("Changes requested");
    expect(needsChanges).toContain("Back to review queue");
    expect(needsChanges).not.toContain("Approve and publish");
    expect(pending).toContain('aria-live="polite"');
    expect(pending.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(4);
  });

  test("opens an origin-bound required-reason dialog with concurrency fields", async () => {
    const { EventReviewControls } = await loadAdminControls();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(createElement(EventReviewControls, {
          initialView: adminView("PENDING_ADMIN_REVIEW"),
        }));
      });
      const requestChanges = [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Request changes",
      );
      await act(async () => requestChanges!.click());

      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.textContent).toContain("Request changes");
      expect(dialog.querySelector('input[name="eventId"]')?.getAttribute("value")).toBe(
        "event-1",
      );
      expect(
        dialog.querySelector('input[name="expectedUpdatedAt"]')?.getAttribute("value"),
      ).toBe("2026-08-04T01:10:00.000Z");
      expect(dialog.querySelector('input[name="decision"]')?.getAttribute("value")).toBe(
        "REQUEST_CHANGES",
      );
      const reason = dialog.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;
      expect(reason.required).toBe(true);
      expect(reason.minLength).toBe(10);
      expect(reason.maxLength).toBe(500);
      expect(dialog.querySelector('[aria-live="polite"]')).not.toBeNull();
      expect(
        [...dialog.querySelectorAll("button")].every((button) =>
          button.classList.contains("min-h-11"),
        ),
      ).toBe(true);
    } finally {
      await act(async () => root.unmount());
    }
  });

  test("locks the originating admin dialog and all sibling actions while pending", async () => {
    const { EventReviewControls } = await loadAdminControls();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let resolveAction!: (
      value: ActionState<AdminEventReviewView>,
    ) => void;
    adminActions.reviewEventAction.mockImplementationOnce(
      () => new Promise((resolve) => (resolveAction = resolve)),
    );

    try {
      await act(async () => {
        root.render(createElement(EventReviewControls, {
          initialView: adminView("PENDING_ADMIN_REVIEW"),
        }));
      });
      const requestChanges = [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Request changes",
      )!;
      await act(async () => requestChanges.click());
      const form = document.querySelector<HTMLFormElement>('[role="dialog"] form')!;
      const reason = form.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;

      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          reason,
          "Please clarify the exact assembly point.",
        );
        reason.dispatchEvent(new Event("input", { bubbles: true }));
        form.requestSubmit();
      });

      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        "Requesting changes…",
      );
      const siblingActions = [...container.querySelectorAll<HTMLButtonElement>("button")].filter(
        (button) =>
          ["Approve and publish", "Request changes", "Reject submission"].includes(
            button.textContent?.trim() ?? "",
          ),
      );
      expect(siblingActions).toHaveLength(3);
      expect(siblingActions.every((button) => button.disabled)).toBe(true);

      await act(async () => {
        document.querySelector<HTMLElement>('[role="dialog"]')!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        document.querySelector<HTMLElement>("[data-radix-dialog-overlay]")!.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true }),
        );
      });
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();

      await act(async () => {
        resolveAction({
          status: "success",
          code: "SUCCESS",
          message: "Event changes requested.",
          data: {
            ...adminView("NEEDS_CHANGES"),
            expectedUpdatedAt: "2026-08-04T01:20:00.000Z",
          },
        });
      });

      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(container.textContent).toContain("Event changes requested.");
      expect(container.textContent).toContain("Changes requested");
      expect(container.textContent).not.toContain("Approve and publish");
    } finally {
      await act(async () => root.unmount());
    }
  });

  test("focuses the admin reason when the server rejects that field", async () => {
    const { EventReviewControls } = await loadAdminControls();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    adminActions.reviewEventAction.mockResolvedValueOnce({
      status: "error",
      code: "INVALID_INPUT",
      message: "Review the highlighted fields and try again.",
      fieldErrors: { reason: ["Enter at least 10 characters."] },
    });

    try {
      await act(async () => {
        root.render(createElement(EventReviewControls, {
          initialView: adminView("PENDING_ADMIN_REVIEW"),
        }));
      });
      const requestChanges = [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Request changes",
      )!;
      await act(async () => requestChanges.click());
      const form = document.querySelector<HTMLFormElement>('[role="dialog"] form')!;
      const reason = form.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;
      const cancel = [...form.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.trim() === "Cancel",
      )!;
      cancel.focus();
      expect(document.activeElement).toBe(cancel);
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          reason,
          "Please clarify the exact assembly point.",
        );
        reason.dispatchEvent(new Event("input", { bubbles: true }));
        form.requestSubmit();
      });

      expect(reason.getAttribute("aria-invalid")).toBe("true");
      expect(document.activeElement).toBe(reason);
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        "Review the highlighted fields and try again.",
      );
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        "Enter at least 10 characters.",
      );
    } finally {
      await act(async () => root.unmount());
    }
  });

  test("renders editable needs-changes fields and a complete authorized history", async () => {
    const { EventSubmissionPanel } = await loadOrganizerPanel();
    const markup = renderToStaticMarkup(
      createElement(EventSubmissionPanel, {
        initialView: organizerView("NEEDS_CHANGES"),
      }),
    );

    expect(markup).toContain("Changes requested");
    expect(markup).toContain("Please clarify the exact assembly point.");
    expect(markup).toContain("What changed?");
    expect(markup).toContain("Update and resubmit");
    expect(markup).toContain("Review history");
    expect(markup).toContain('name="eventId"');
    expect(markup).toContain('name="expectedUpdatedAt"');
    expect(markup).toContain('name="title"');
    expect(markup).toContain('value="Quezon City Night Ride"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain("approval-1");
    expect(markup).not.toContain("organizer-1");
  });

  test("keeps the organizer success message after the editor closes", async () => {
    const { EventSubmissionPanel } = await loadOrganizerPanel();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    organizerActions.resubmitEventAction.mockResolvedValueOnce({
      status: "success",
      code: "SUCCESS",
      message: "Event resubmitted for review.",
      data: {
        ...organizerView("PENDING_ADMIN_REVIEW"),
        expectedUpdatedAt: "2026-08-04T01:20:00.000Z",
      },
    });

    try {
      await act(async () => {
        root.render(createElement(EventSubmissionPanel, {
          initialView: organizerView("NEEDS_CHANGES"),
        }));
      });
      const form = container.querySelector<HTMLFormElement>("form")!;
      const reason = form.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          reason,
          "Clarified the assembly point and arrival instructions.",
        );
        reason.dispatchEvent(new Event("input", { bubbles: true }));
        form.requestSubmit();
      });

      expect(container.textContent).toContain("Event resubmitted for review.");
      expect(container.textContent).toContain("Pending review");
      expect(container.textContent).not.toContain("Update and resubmit");
    } finally {
      await act(async () => root.unmount());
    }
  });

  test("focuses the first invalid organizer field returned by the server", async () => {
    const { EventSubmissionPanel } = await loadOrganizerPanel();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    organizerActions.resubmitEventAction.mockResolvedValueOnce({
      status: "error",
      code: "INVALID_INPUT",
      message: "Review the highlighted fields and try again.",
      fieldErrors: { title: ["Enter an event title."] },
    });

    try {
      await act(async () => {
        root.render(createElement(EventSubmissionPanel, {
          initialView: organizerView("NEEDS_CHANGES"),
        }));
      });
      const form = container.querySelector<HTMLFormElement>("form")!;
      const reason = form.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          reason,
          "Clarified the assembly point and arrival instructions.",
        );
        reason.dispatchEvent(new Event("input", { bubbles: true }));
        form.requestSubmit();
      });

      const title = form.querySelector<HTMLInputElement>('input[name="title"]')!;
      expect(title.getAttribute("aria-invalid")).toBe("true");
      expect(document.activeElement).toBe(title);
      expect(form.textContent).toContain("Enter an event title.");
    } finally {
      await act(async () => root.unmount());
    }
  });

  test("keeps rejected submissions final and offers an owner-scoped clean copy", async () => {
    const { EventSubmissionPanel } = await loadOrganizerPanel();
    const markup = renderToStaticMarkup(
      createElement(EventSubmissionPanel, {
        initialView: organizerView("REJECTED"),
      }),
    );

    expect(markup).toContain("Submission rejected");
    expect(markup).toContain("Create a new event from these details");
    expect(markup).toContain('/organizer/events/create?copy=event-1');
    expect(markup).toContain("!text-primary-foreground");
    expect(markup).not.toContain("Update and resubmit");
  });

  test("prefixes editor ids while preserving action field names and copy defaults", async () => {
    const { EventEditorFields } = await loadEditorFields();
    const markup = renderToStaticMarkup(
      createElement(EventEditorFields, {
        idPrefix: "copy-event",
        defaults: {
          title: "Quezon City Night Ride",
          type: "Bike Night",
          startDate: "2099-08-07",
          startTime: "18:00",
          endDate: "2099-08-07",
          endTime: "21:00",
          timeZone: "Asia/Tokyo",
          recurrence: "WEEKLY",
          recurrenceEndsOn: "2099-09-04",
          locationName: "Quezon Memorial Circle",
          locationAddress: "Elliptical Road, Quezon City",
          locationMapLink: "https://maps.example.test/quezon-circle",
          area: "Quezon City",
          expectedRiders: 40,
          perkPreview: "Event sticker",
        },
      }),
    );

    expect(markup).toContain('id="copy-event-title"');
    expect(markup).toContain('for="copy-event-title"');
    expect(markup).toContain('name="title"');
    expect(markup).toContain('value="Quezon City Night Ride"');
    expect(markup).toContain('<input type="hidden" name="recurrence" value="WEEKLY"');
    expect(markup).toContain('<input type="hidden" name="recurrenceEndsOn" value="2099-09-04"');
    expect(markup).toContain('<input type="hidden" name="timeZone" value="Asia/Tokyo"');
    expect(markup).not.toContain("Schedule</label>");
    expect(markup).not.toContain("Time zone</label>");
    expect(markup.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(12);
  });

  test("synchronizes successful admin and organizer transitions into the shared event catalog", async () => {
    const { EventReviewControls } = await loadAdminControls();
    const { EventSubmissionPanel } = await loadOrganizerPanel();
    const { DemoProvider, useDemo } = await loadDemoProvider();
    const unrelated = { ...event, id: "event-2", title: "Unrelated event" };
    const initialState = {
      currentUser: {
        id: "admin-1",
        displayName: "Tambike Ops",
        email: "ops@example.test",
        role: "admin" as const,
        verificationStatus: "APPROVED" as const,
        accountStatus: "ACTIVE" as const,
        area: "Metro Manila",
        joinedAt: "2026-01-01T00:00:00.000Z",
      },
      users: [],
      events: [event, unrelated],
      passes: [],
      checkInSettings: [],
      passCreated: false,
    };

    function CatalogProbe() {
      const { events } = useDemo();
      return createElement(
        "output",
        { "data-testid": "catalog" },
        events.map((item: Event) => `${item.id}:${item.status}`).join("|"),
      );
    }

    async function runTransition(
      detail: ReactNode,
      submitLabel: string,
      action: ReturnType<typeof vi.fn>,
      nextStatus: Event["status"],
    ) {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      action.mockResolvedValueOnce({
        status: "success",
        code: "SUCCESS",
        message: "Saved.",
        data: nextStatus === "PUBLISHED"
          ? { ...adminView(nextStatus), event: { ...event, status: nextStatus } }
          : { ...organizerView(nextStatus), event: { ...event, status: nextStatus } },
      });
      try {
        await act(async () => {
          root.render(
            createElement(
              DemoProvider,
              { initialState },
              createElement("div", null, detail, createElement(CatalogProbe)),
            ),
          );
        });
        const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
          (candidate) => candidate.textContent?.trim() === submitLabel,
        )!;
        await act(async () => button.click());
        const form = document.querySelector<HTMLFormElement>('[role="dialog"] form')
          ?? container.querySelector<HTMLFormElement>("form")!;
        if (submitLabel === "Update and resubmit") {
          const reason = form.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
            reason,
            "Clarified the route and assembly point.",
          );
          reason.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await act(async () => form.requestSubmit());

        expect(container.querySelector('[data-testid="catalog"]')?.textContent).toBe(
          `event-1:${nextStatus}|event-2:PENDING_ADMIN_REVIEW`,
        );
      } finally {
        await act(async () => root.unmount());
      }
    }

    await runTransition(
      createElement(EventReviewControls, { initialView: adminView("PENDING_ADMIN_REVIEW") }),
      "Approve and publish",
      adminActions.reviewEventAction,
      "PUBLISHED",
    );
    await runTransition(
      createElement(EventSubmissionPanel, { initialView: organizerView("NEEDS_CHANGES") }),
      "Update and resubmit",
      organizerActions.resubmitEventAction,
      "PENDING_ADMIN_REVIEW",
    );
  });

  test("uses a document reload after a conflict so a fresh retry adopts the new version", async () => {
    const { EventReviewControls } = await loadAdminControls();
    const container = document.createElement("div");
    document.body.append(container);
    let root = createRoot(container);
    adminActions.reviewEventAction.mockResolvedValueOnce({
      status: "error",
      code: "CONFLICT",
      message: "This event changed while you were reviewing it.",
    });

    await act(async () => {
      root.render(createElement(EventReviewControls, {
        initialView: adminView("PENDING_ADMIN_REVIEW"),
      }));
    });
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.trim() === "Approve and publish",
      )!.click();
    });
    await act(async () => {
      document.querySelector<HTMLFormElement>('[role="dialog"] form')!.requestSubmit();
    });
    const reload = document.querySelector<HTMLAnchorElement>('[role="dialog"] a[href="/admin/events/review/event-1"]')!;
    expect(reload.textContent).toBe("Reload event");
    expect(reload.hasAttribute("data-next-link")).toBe(false);

    await act(async () => root.unmount());
    container.replaceChildren();
    root = createRoot(container);
    const freshView = {
      ...adminView("PENDING_ADMIN_REVIEW"),
      expectedUpdatedAt: "2026-08-04T01:20:00.000Z",
    };
    adminActions.reviewEventAction.mockResolvedValueOnce({
      status: "success",
      code: "SUCCESS",
      message: "Event published.",
      data: { ...freshView, event: { ...freshView.event, status: "PUBLISHED" } },
    });
    try {
      await act(async () => {
        root.render(createElement(EventReviewControls, { initialView: freshView }));
      });
      await act(async () => {
        [...container.querySelectorAll<HTMLButtonElement>("button")].find(
          (button) => button.textContent?.trim() === "Approve and publish",
        )!.click();
      });
      const retryForm = document.querySelector<HTMLFormElement>('[role="dialog"] form')!;
      expect(retryForm.querySelector<HTMLInputElement>('input[name="expectedUpdatedAt"]')?.value)
        .toBe("2026-08-04T01:20:00.000Z");
      await act(async () => retryForm.requestSubmit());
      expect(container.textContent).toContain("Event published.");
      expect(container.textContent).toContain("Disable event");
    } finally {
      await act(async () => root.unmount());
    }
  });

  test("removes all compatibility-only event status state and action wiring", () => {
    const adminSource = readFileSync(
      resolve(process.cwd(), "src/features/admin/admin-console.tsx"),
      "utf8",
    );
    const providerSource = readFileSync(
      resolve(process.cwd(), "src/features/tambike-demo/demo-provider.tsx"),
      "utf8",
    );

    expect(adminSource).not.toContain("eventStatusOverrides");
    expect(adminSource).not.toContain("setEventStatus");
    expect(adminSource).not.toContain("onSetStatus");
    expect(adminSource).not.toContain("adminDecision");
    expect(providerSource).not.toContain("approvePublishAction");
    expect(providerSource).not.toContain("approvePublish");
    expect(providerSource).not.toContain("adminDecision");
  });

});
