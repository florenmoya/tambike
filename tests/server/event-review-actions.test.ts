import type {
  AdminEventReviewView,
  OrganizerEventSubmissionView,
} from "../../src/features/admin/event-review-types";
import type { ActionState } from "../../src/features/shared/action-state";
import type {
  CreateEventInput,
  Event,
} from "../../src/features/tambike-demo/types";
import { BackendError } from "../../src/server/backend";
import { beforeEach, describe, expect, test, vi } from "vitest";

const legacyBackend = vi.hoisted(() => ({
  getAdminEventReview: vi.fn(),
  reviewEvent: vi.fn(),
}));
const legacyRevalidatePath = vi.hoisted(() => vi.fn());
const legacyReadRequiredSessionToken = vi.hoisted(() => vi.fn());

vi.mock("../../src/server/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/backend")>();
  return {
    ...actual,
    getTambikeBackend: vi.fn(async () => legacyBackend),
  };
});

vi.mock("../../src/server/session-cookie", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/server/session-cookie")
  >();
  return {
    ...actual,
    readRequiredSessionToken: legacyReadRequiredSessionToken,
  };
});

vi.mock("next/cache", () => ({ revalidatePath: legacyRevalidatePath }));

type AdminBackend = {
  getAdminEventReview(
    sessionToken: string,
    eventId: string,
  ): Promise<AdminEventReviewView>;
  reviewEvent(
    sessionToken: string,
    eventId: string,
    input: {
      decision: "PUBLISH" | "REQUEST_CHANGES" | "REJECT";
      reason?: string;
      expectedUpdatedAt: string;
    },
  ): Promise<AdminEventReviewView>;
  disableEvent(
    sessionToken: string,
    eventId: string,
    input: { reason: string; expectedUpdatedAt: string },
  ): Promise<AdminEventReviewView>;
  restoreEventToReview(
    sessionToken: string,
    eventId: string,
    input: { reason: string; expectedUpdatedAt: string },
  ): Promise<AdminEventReviewView>;
};

type OrganizerBackend = {
  getOrganizerEventSubmission(
    sessionToken: string,
    eventId: string,
  ): Promise<OrganizerEventSubmissionView>;
  getRejectedEventCopySource(
    sessionToken: string,
    eventId: string,
  ): Promise<CreateEventInput>;
  resubmitEvent(
    sessionToken: string,
    eventId: string,
    input: {
      event: CreateEventInput;
      reason: string;
      expectedUpdatedAt: string;
    },
  ): Promise<OrganizerEventSubmissionView>;
};

type Dependencies<T> = {
  readRequiredSessionToken(): Promise<string>;
  getBackend(): Promise<T>;
  revalidate(path: string): void;
};

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

const adminView: AdminEventReviewView = {
  event,
  organizerName: "Tambike QC",
  submissionVersion: 1,
  expectedUpdatedAt: "2026-07-31T03:00:00.000Z",
  history: [
    {
      id: "approval-1",
      submissionVersion: 1,
      decision: "pending",
      submittedAt: "2026-07-31T03:00:00.000Z",
    },
  ],
};

const organizerView: OrganizerEventSubmissionView = {
  event: { ...event, status: "NEEDS_CHANGES" },
  submissionVersion: 1,
  expectedUpdatedAt: "2026-07-31T03:00:00.000Z",
  latestDecision: {
    id: "approval-1",
    submissionVersion: 1,
    decision: "needs_changes",
    reason: "Please clarify the exact assembly point.",
    submittedAt: "2026-07-31T03:00:00.000Z",
    decidedAt: "2026-07-31T03:05:00.000Z",
  },
  history: [],
};

const copySource: CreateEventInput = {
  title: "Quezon City Night Ride",
  type: "Bike Night",
  startDate: "2099-08-07",
  startTime: "18:00",
  endDate: "2099-08-07",
  endTime: "21:00",
  timeZone: "Asia/Manila",
  recurrence: "NONE",
  locationName: "Quezon Memorial Circle",
  locationAddress: "Elliptical Road, Quezon City",
  locationMapLink: "https://maps.example.test/quezon-circle",
  area: "Quezon City",
  expectedRiders: 40,
  perkPreview: "Event sticker",
};

const idleAdmin: ActionState<AdminEventReviewView> = {
  status: "idle",
  message: "",
};
const idleOrganizer: ActionState<OrganizerEventSubmissionView> = {
  status: "idle",
  message: "",
};

function adminBackend(
  overrides: Partial<AdminBackend> = {},
): AdminBackend {
  return {
    getAdminEventReview: async () => adminView,
    reviewEvent: async () => adminView,
    disableEvent: async () => adminView,
    restoreEventToReview: async () => adminView,
    ...overrides,
  };
}

function organizerBackend(
  overrides: Partial<OrganizerBackend> = {},
): OrganizerBackend {
  return {
    getOrganizerEventSubmission: async () => organizerView,
    getRejectedEventCopySource: async () => copySource,
    resubmitEvent: async () => organizerView,
    ...overrides,
  };
}

function dependencies<T>(
  backend: T,
  overrides: Partial<Dependencies<T>> = {},
): Dependencies<T> {
  return {
    readRequiredSessionToken: async () => "session-1",
    getBackend: async () => backend,
    revalidate: () => undefined,
    ...overrides,
  };
}

function reviewForm(
  overrides: Record<string, string | undefined> = {},
) {
  const form = new FormData();
  form.set("eventId", "event-1");
  form.set("decision", "PUBLISH");
  form.set("expectedUpdatedAt", "2026-07-31T03:00:00.000Z");
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) form.delete(name);
    else form.set(name, value);
  }
  return form;
}

function statusForm(overrides: Record<string, string> = {}) {
  return reviewForm({
    decision: undefined,
    reason: "A clear operational reason for this event.",
    ...overrides,
  });
}

function resubmitForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    eventId: "event-1",
    reason: "Clarified the assembly point and arrival instructions.",
    expectedUpdatedAt: "2026-07-31T03:00:00.000Z",
    title: "  Quezon City Night Ride Revised  ",
    type: "Bike Night",
    startDate: "2099-08-07",
    startTime: "18:00",
    endDate: "2099-08-07",
    endTime: "21:00",
    timeZone: "Asia/Manila",
    recurrence: "NONE",
    locationName: "  Quezon Memorial Circle  ",
    locationAddress: "  Elliptical Road, Quezon City  ",
    locationMapLink: "  https://maps.example.test/quezon-circle  ",
    area: "  Quezon City  ",
    expectedRiders: "40",
    perkPreview: "  Event sticker  ",
    ...overrides,
  })) {
    form.set(name, value);
  }
  return form;
}

async function loadAdminCore() {
  const modulePath = `../../src/server/admin/${"event-review-actions-core"}`;
  return import(modulePath);
}

async function loadOrganizerCore() {
  const modulePath = `../../src/server/organizer/${"event-submission-actions-core"}`;
  return import(modulePath);
}

beforeEach(() => {
  vi.clearAllMocks();
  legacyReadRequiredSessionToken.mockResolvedValue("admin-session");
  legacyBackend.getAdminEventReview.mockResolvedValue(adminView);
  legacyBackend.reviewEvent.mockResolvedValue(adminView);
});

describe("event review validation", () => {
  test("requires a meaningful reason for request-changes but not publish", async () => {
    const { reviewSchema } = await loadAdminCore();

    expect(
      reviewSchema.safeParse({
        eventId: "event-1",
        decision: "REQUEST_CHANGES",
        reason: "",
        expectedUpdatedAt: "2026-07-31T03:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      reviewSchema.safeParse({
        eventId: "event-1",
        decision: "PUBLISH",
        expectedUpdatedAt: "2026-07-31T03:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  test.each([
    ["unknown decision", { decision: "APPROVE" }],
    ["malformed timestamp", { expectedUpdatedAt: "yesterday" }],
    ["untrusted extra field", { reviewerId: "admin-2" }],
    ["framework-prefix lookalike", { $ACTIONARY_ID: "not-framework-owned" }],
  ])("rejects %s before backend access", async (_name, override) => {
    const { createAdminEventReviewActions } = await loadAdminCore();
    const getBackend = vi.fn(async () => {
      throw new Error("backend must not load");
    });
    const revalidate = vi.fn();

    const result = await createAdminEventReviewActions(
      dependencies(adminBackend(), { getBackend, revalidate }),
    ).reviewEventAction(idleAdmin, reviewForm(override));

    expect(result).toMatchObject({
      status: "error",
      code: "INVALID_INPUT",
      fieldErrors: expect.any(Object),
    });
    expect(getBackend).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });

  test("preserves duplicate and typed FormData validation semantics", async () => {
    const { createAdminEventReviewActions } = await loadAdminCore();
    const reviewEvent = vi.fn(async () => adminView);
    const getBackend = vi.fn(async () => adminBackend({ reviewEvent }));
    const actions = createAdminEventReviewActions(
      dependencies(adminBackend(), { getBackend }),
    );
    const duplicateForm = reviewForm();
    duplicateForm.append("eventId", "event-last");

    await expect(
      actions.reviewEventAction(idleAdmin, duplicateForm),
    ).resolves.toMatchObject({ status: "success" });
    expect(reviewEvent).toHaveBeenCalledWith("session-1", "event-last", {
      decision: "PUBLISH",
      expectedUpdatedAt: "2026-07-31T03:00:00.000Z",
    });

    vi.clearAllMocks();
    const typedForm = reviewForm();
    typedForm.set(
      "eventId",
      new Blob(["event-1"], { type: "text/plain" }),
      "event.txt",
    );
    await expect(
      actions.reviewEventAction(idleAdmin, typedForm),
    ).resolves.toMatchObject({ status: "error", code: "INVALID_INPUT" });
    expect(getBackend).not.toHaveBeenCalled();
    expect(reviewEvent).not.toHaveBeenCalled();
  });

  test.each([
    ["disable", "123456789", "2026-07-31T03:00:00.000Z"],
    ["restore", "x".repeat(501), "2026-07-31T03:00:00.000Z"],
    ["disable", "A valid reason for the event.", "not-an-instant"],
  ])("rejects invalid %s reason or timestamp", async (kind, reason, timestamp) => {
    const { createAdminEventReviewActions } = await loadAdminCore();
    const getBackend = vi.fn(async () => adminBackend());
    const actions = createAdminEventReviewActions(
      dependencies(adminBackend(), { getBackend }),
    );
    const action = kind === "restore" ? actions.restoreEventAction : actions.disableEventAction;

    const result = await action(
      idleAdmin,
      statusForm({ reason, expectedUpdatedAt: timestamp }),
    );

    expect(result).toMatchObject({ status: "error", code: "INVALID_INPUT" });
    expect(getBackend).not.toHaveBeenCalled();
  });
});

describe("admin event review actions", () => {
  test("loads an authenticated admin review and hides expected access failures", async () => {
    const { createAdminEventReviewActions } = await loadAdminCore();
    const allowed = createAdminEventReviewActions(dependencies(adminBackend()));
    const denied = createAdminEventReviewActions(
      dependencies(
        adminBackend({
          getAdminEventReview: async () => {
            throw new BackendError("FORBIDDEN");
          },
        }),
      ),
    );
    const suspended = createAdminEventReviewActions(
      dependencies(adminBackend(), {
        readRequiredSessionToken: async () => {
          throw new BackendError("UNAUTHENTICATED");
        },
      }),
    );

    await expect(allowed.loadAdminEventReviewForPage("event-1")).resolves.toBe(
      adminView,
    );
    await expect(denied.loadAdminEventReviewForPage("event-1")).resolves.toBeNull();
    await expect(suspended.loadAdminEventReviewForPage("event-1")).resolves.toBeNull();
  });

  test("publishes through the authoritative backend and revalidates exact affected paths", async () => {
    const { createAdminEventReviewActions } = await loadAdminCore();
    const reviewEvent = vi.fn(async () => adminView);
    const revalidate = vi.fn();
    const action = createAdminEventReviewActions(
      dependencies(adminBackend({ reviewEvent }), { revalidate }),
    );

    await expect(
      action.reviewEventAction(idleAdmin, reviewForm()),
    ).resolves.toEqual({
      status: "success",
      code: "SUCCESS",
      message: "Event published.",
      data: adminView,
    });
    expect(reviewEvent).toHaveBeenCalledWith("session-1", "event-1", {
      decision: "PUBLISH",
      expectedUpdatedAt: "2026-07-31T03:00:00.000Z",
    });
    expect(revalidate.mock.calls).toEqual([
      ["/admin/events/review/event-1"],
      ["/admin/events/review"],
      ["/events/event-1"],
      ["/organizer/events/event-1"],
    ]);
  });

  test("accepts Next action metadata without weakening strict review validation", async () => {
    const { createAdminEventReviewActions } = await loadAdminCore();
    const reviewEvent = vi.fn(async () => adminView);
    const form = reviewForm();
    form.set("$ACTION_ID_9f72", "framework-action-id");
    form.set("$ACTION_REF_1", "framework-action-reference");
    const action = createAdminEventReviewActions(
      dependencies(adminBackend({ reviewEvent })),
    );

    await expect(action.reviewEventAction(idleAdmin, form)).resolves.toMatchObject({
      status: "success",
      data: adminView,
    });
    expect(reviewEvent).toHaveBeenCalledWith("session-1", "event-1", {
      decision: "PUBLISH",
      expectedUpdatedAt: "2026-07-31T03:00:00.000Z",
    });
  });

  test.each([
    ["REQUEST_CHANGES", "Event changes requested."],
    ["REJECT", "Event submission rejected."],
  ] as const)("passes a normalized reason for %s", async (decision, message) => {
    const { createAdminEventReviewActions } = await loadAdminCore();
    const reviewEvent = vi.fn(async () => adminView);
    const action = createAdminEventReviewActions(
      dependencies(adminBackend({ reviewEvent })),
    );

    await expect(
      action.reviewEventAction(
        idleAdmin,
        reviewForm({
          decision,
          reason: "  Please clarify the exact assembly point.  ",
        }),
      ),
    ).resolves.toMatchObject({ status: "success", message });
    expect(reviewEvent).toHaveBeenCalledWith("session-1", "event-1", {
      decision,
      reason: "Please clarify the exact assembly point.",
      expectedUpdatedAt: "2026-07-31T03:00:00.000Z",
    });
  });

  test.each([
    ["CONFLICT", "This event changed in another session. Reload and try again."],
    ["FORBIDDEN", "Your account cannot perform this action."],
    ["NOT_FOUND", "This event is no longer available."],
    ["UNAUTHENTICATED", "Log in with an admin account and try again."],
  ] as const)("maps %s without revalidation", async (code, message) => {
    const { createAdminEventReviewActions } = await loadAdminCore();
    const revalidate = vi.fn();
    const action = createAdminEventReviewActions(
      dependencies(
        adminBackend({
          reviewEvent: async () => {
            throw new BackendError(code);
          },
        }),
        { revalidate },
      ),
    );

    await expect(action.reviewEventAction(idleAdmin, reviewForm())).resolves.toEqual({
      status: "error",
      code,
      message,
    });
    expect(revalidate).not.toHaveBeenCalled();
  });

  test("maps a backend conflict across a development module reload", async () => {
    const { createAdminEventReviewActions } = await loadAdminCore();
    const revalidate = vi.fn();
    const reloadedConflict = Object.assign(new Error("CONFLICT"), {
      code: "CONFLICT" as const,
      name: "BackendError",
    });
    const action = createAdminEventReviewActions(
      dependencies(
        adminBackend({
          reviewEvent: async () => {
            throw reloadedConflict;
          },
        }),
        { revalidate },
      ),
    );

    await expect(action.reviewEventAction(idleAdmin, reviewForm())).resolves.toEqual({
      status: "error",
      code: "CONFLICT",
      message: "This event changed in another session. Reload and try again.",
    });
    expect(revalidate).not.toHaveBeenCalled();
  });

  test.each([
    ["disable", "Event disabled."],
    ["restore", "Event restored to review."],
  ] as const)("commits and revalidates %s", async (kind, message) => {
    const { createAdminEventReviewActions } = await loadAdminCore();
    const disableEvent = vi.fn(async () => adminView);
    const restoreEventToReview = vi.fn(async () => adminView);
    const revalidate = vi.fn();
    const actions = createAdminEventReviewActions(
      dependencies(
        adminBackend({ disableEvent, restoreEventToReview }),
        { revalidate },
      ),
    );
    const action = kind === "disable" ? actions.disableEventAction : actions.restoreEventAction;

    await expect(action(idleAdmin, statusForm())).resolves.toMatchObject({
      status: "success",
      message,
      data: adminView,
    });
    const mutation = kind === "disable" ? disableEvent : restoreEventToReview;
    expect(mutation).toHaveBeenCalledWith("session-1", "event-1", {
      reason: "A clear operational reason for this event.",
      expectedUpdatedAt: "2026-07-31T03:00:00.000Z",
    });
    expect(revalidate).toHaveBeenCalledTimes(4);
  });

  test.each(["disable", "restore"] as const)(
    "accepts Next action metadata for %s without accepting arbitrary extras",
    async (kind) => {
      const { createAdminEventReviewActions } = await loadAdminCore();
      const disableEvent = vi.fn(async () => adminView);
      const restoreEventToReview = vi.fn(async () => adminView);
      const getBackend = vi.fn(async () =>
        adminBackend({ disableEvent, restoreEventToReview }),
      );
      const revalidate = vi.fn();
      const actions = createAdminEventReviewActions(
        dependencies(adminBackend(), { getBackend, revalidate }),
      );
      const action =
        kind === "disable" ? actions.disableEventAction : actions.restoreEventAction;
      const frameworkForm = statusForm();
      frameworkForm.set("$ACTION_ID_status", "framework-action-id");
      frameworkForm.set("$ACTION_REF_status", "framework-action-reference");

      await expect(action(idleAdmin, frameworkForm)).resolves.toMatchObject({
        status: "success",
        data: adminView,
      });
      const mutation = kind === "disable" ? disableEvent : restoreEventToReview;
      expect(mutation).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();
      const unexpectedForm = statusForm({ operatorId: "admin-2" });
      await expect(action(idleAdmin, unexpectedForm)).resolves.toMatchObject({
        status: "error",
        code: "INVALID_INPUT",
      });
      expect(getBackend).not.toHaveBeenCalled();
      expect(disableEvent).not.toHaveBeenCalled();
      expect(restoreEventToReview).not.toHaveBeenCalled();
      expect(revalidate).not.toHaveBeenCalled();
    },
  );

  test("throws unexpected failures without revalidation", async () => {
    const { createAdminEventReviewActions } = await loadAdminCore();
    const unexpected = new Error("connection secret");
    const revalidate = vi.fn();
    const action = createAdminEventReviewActions(
      dependencies(
        adminBackend({
          reviewEvent: async () => {
            throw unexpected;
          },
        }),
        { revalidate },
      ),
    );

    await expect(action.reviewEventAction(idleAdmin, reviewForm())).rejects.toBe(
      unexpected,
    );
    expect(revalidate).not.toHaveBeenCalled();
  });
});

describe("organizer event submission actions", () => {
  test("loads only the authenticated owner's submission and rejected copy", async () => {
    const { createOrganizerEventSubmissionActions } = await loadOrganizerCore();
    const actions = createOrganizerEventSubmissionActions(
      dependencies(organizerBackend()),
    );

    await expect(
      actions.loadOrganizerEventSubmissionForPage("event-1"),
    ).resolves.toBe(organizerView);
    await expect(actions.loadRejectedEventCopySource("event-1")).resolves.toEqual(
      copySource,
    );
  });

  test.each(["FORBIDDEN", "NOT_FOUND", "CONFLICT", "UNAUTHENTICATED"] as const)(
    "hides %s copy-source failures",
    async (code) => {
      const { createOrganizerEventSubmissionActions } = await loadOrganizerCore();
      const actions = createOrganizerEventSubmissionActions(
        dependencies(
          organizerBackend({
            getRejectedEventCopySource: async () => {
              throw new BackendError(code);
            },
          }),
        ),
      );

      await expect(actions.loadRejectedEventCopySource("event-1")).resolves.toBeNull();
    },
  );

  test.each([
    ["short reason", { reason: "short" }],
    ["long reason", { reason: "x".repeat(501) }],
    ["invalid timestamp", { expectedUpdatedAt: "tomorrow" }],
    ["invalid event type", { type: "Meetup" }],
    ["invalid schedule", { endTime: "17:59" }],
    ["invalid location", { locationMapLink: "javascript:alert(1)" }],
    ["invalid riders", { expectedRiders: "1.5" }],
  ])("rejects %s before backend access", async (_name, overrides) => {
    const { createOrganizerEventSubmissionActions } = await loadOrganizerCore();
    const getBackend = vi.fn(async () => {
      throw new Error("backend must not load");
    });
    const action = createOrganizerEventSubmissionActions(
      dependencies(organizerBackend(), { getBackend }),
    );

    const result = await action.resubmitEventAction(
      idleOrganizer,
      resubmitForm(overrides),
    );

    expect(result).toMatchObject({
      status: "error",
      code: "INVALID_INPUT",
      fieldErrors: expect.any(Object),
    });
    expect(getBackend).not.toHaveBeenCalled();
  });

  test("resubmits normalized event fields and revalidates exact affected paths", async () => {
    const { createOrganizerEventSubmissionActions } = await loadOrganizerCore();
    const resubmitEvent = vi.fn(async () => organizerView);
    const revalidate = vi.fn();
    const action = createOrganizerEventSubmissionActions(
      dependencies(organizerBackend({ resubmitEvent }), { revalidate }),
    );

    await expect(
      action.resubmitEventAction(idleOrganizer, resubmitForm()),
    ).resolves.toEqual({
      status: "success",
      code: "SUCCESS",
      message: "Event resubmitted for review.",
      data: organizerView,
    });
    expect(resubmitEvent).toHaveBeenCalledWith("session-1", "event-1", {
      reason: "Clarified the assembly point and arrival instructions.",
      expectedUpdatedAt: "2026-07-31T03:00:00.000Z",
      event: {
        ...copySource,
        title: "Quezon City Night Ride Revised",
      },
    });
    expect(revalidate.mock.calls).toEqual([
      ["/organizer/events/event-1"],
      ["/admin/events/review"],
      ["/events/event-1"],
    ]);
  });

  test("accepts Next action metadata for resubmission but rejects arbitrary extras", async () => {
    const { createOrganizerEventSubmissionActions } = await loadOrganizerCore();
    const resubmitEvent = vi.fn(async () => organizerView);
    const getBackend = vi.fn(async () => organizerBackend({ resubmitEvent }));
    const revalidate = vi.fn();
    const action = createOrganizerEventSubmissionActions(
      dependencies(organizerBackend(), { getBackend, revalidate }),
    );
    const frameworkForm = resubmitForm();
    frameworkForm.set("$ACTION_ID_resubmit", "framework-action-id");
    frameworkForm.set("$ACTION_REF_resubmit", "framework-action-reference");

    await expect(
      action.resubmitEventAction(idleOrganizer, frameworkForm),
    ).resolves.toMatchObject({ status: "success", data: organizerView });
    expect(resubmitEvent).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    const unexpectedForm = resubmitForm({ organizerId: "organizer-2" });
    await expect(
      action.resubmitEventAction(idleOrganizer, unexpectedForm),
    ).resolves.toMatchObject({ status: "error", code: "INVALID_INPUT" });
    expect(getBackend).not.toHaveBeenCalled();
    expect(resubmitEvent).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });

  test.each([
    ["CONFLICT", "This event changed in another session. Reload and try again."],
    ["FORBIDDEN", "Your account cannot perform this action."],
    ["UNAUTHENTICATED", "Log in with an admin account and try again."],
  ] as const)("maps %s and does not revalidate", async (code, message) => {
    const { createOrganizerEventSubmissionActions } = await loadOrganizerCore();
    const revalidate = vi.fn();
    const action = createOrganizerEventSubmissionActions(
      dependencies(
        organizerBackend({
          resubmitEvent: async () => {
            throw new BackendError(code);
          },
        }),
        { revalidate },
      ),
    );

    await expect(
      action.resubmitEventAction(idleOrganizer, resubmitForm()),
    ).resolves.toEqual({ status: "error", code, message });
    expect(revalidate).not.toHaveBeenCalled();
  });
});

describe("Server Action boundaries", () => {
  test.each([
    ["admin", `../../src/server/admin/${"event-review-actions"}`, [
      "disableEventAction",
      "loadAdminEventReviewForPage",
      "restoreEventAction",
      "reviewEventAction",
    ]],
    ["organizer", `../../src/server/organizer/${"event-submission-actions"}`, [
      "loadOrganizerEventSubmissionForPage",
      "loadRejectedEventCopySource",
      "resubmitEventAction",
    ]],
  ] as const)("%s module exports only async functions", async (_name, modulePath, names) => {
    const actionModule = await import(modulePath);
    const runtimeExports = Object.entries(actionModule);

    expect(runtimeExports.map(([name]) => name).sort()).toEqual([...names].sort());
    for (const [, value] of runtimeExports) {
      expect(Object.prototype.toString.call(value)).toBe("[object AsyncFunction]");
    }
  });

  test("legacy publish delegates to the persisted lifecycle with the current revision", async () => {
    const { approvePublishAction } = await import("../../src/server/actions");

    await expect(approvePublishAction("event-1")).resolves.toBe(adminView);
    expect(legacyBackend.getAdminEventReview).toHaveBeenCalledWith(
      "admin-session",
      "event-1",
    );
    expect(legacyBackend.reviewEvent).toHaveBeenCalledWith(
      "admin-session",
      "event-1",
      {
        decision: "PUBLISH",
        expectedUpdatedAt: "2026-07-31T03:00:00.000Z",
      },
    );
  });
});
