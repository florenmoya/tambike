/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { EventAttendeeRoster } from "../../src/features/member-profiles/event-attendee-roster";
import { ExistingRsvpIdentityForm } from "../../src/features/tambike-demo/tambike-screen";
import type {
  EventAttendeeRosterPage,
  MemberProfileEditorView,
} from "../../src/features/member-profiles/types";

const summary = {
  eventId: "ride-1",
  eventTitle: "Marilaque Dawn Roll",
  rosterEnabled: true,
  goingCount: 2,
  visibleCount: 2,
  anonymousCount: 0,
};

function rosterPage(
  attendees: EventAttendeeRosterPage["attendees"],
  nextCursor?: string,
): EventAttendeeRosterPage {
  return { summary, attendees, nextCursor, pageSize: 1 };
}

const mika = {
  slug: "mika",
  displayName: "Mika",
  area: "Quezon City",
  motorcycle: {
    make: "Honda",
    model: "CB650R",
    photos: [
      { url: "/media/mika-side", position: 1, width: 1200, height: 900 },
      { url: "/media/mika-front", position: 0, width: 1600, height: 1200 },
    ],
  },
};
const bea = { slug: "bea", displayName: "Bea", area: "Pasig" };

describe("interactive roster state transitions", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  test("preserves appended pages on equivalent rerenders and resets when the organizer toggles off then on", async () => {
    const loadPage = vi.fn(async () => rosterPage([bea]));
    const firstPage = rosterPage([mika], "cursor-1");

    await act(async () => {
      root.render(createElement(EventAttendeeRoster, { initialPage: firstPage, signedIn: true, loadPage }));
    });
    expect(container.textContent).toContain("Mika");
    expect(container.textContent).toContain("Load more riders");

    const loadButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Load more riders"));
    await act(async () => {
      loadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Bea");
    expect(container.textContent).not.toContain("Load more riders");

    await act(async () => {
      root.render(createElement(EventAttendeeRoster, {
        initialPage: {
          ...firstPage,
          summary: { ...firstPage.summary },
          attendees: firstPage.attendees.map((attendee) => ({
            ...attendee,
            motorcycle: attendee.motorcycle
              ? { ...attendee.motorcycle, photos: attendee.motorcycle.photos.toReversed() }
              : undefined,
          })),
        },
        signedIn: true,
        loadPage,
      }));
    });
    expect(container.textContent).toContain("Bea");

    loadPage.mockRejectedValueOnce(new Error("temporary outage"));
    const errorPage = rosterPage([mika], "cursor-error");
    await act(async () => root.render(createElement(EventAttendeeRoster, {
      initialPage: errorPage,
      signedIn: true,
      loadPage,
    })));
    const errorButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Load more riders"));
    await act(async () => {
      errorButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("could not be loaded");

    const refreshedMika = {
      slug: "mika",
      displayName: "Mika Updated",
      area: "Cebu City",
      profilePhotoUrl: "/media/mika-updated-avatar",
      motorcycle: {
        make: "Honda",
        model: "CB650R",
        year: 2026,
        displacementCc: 649,
        nickname: "Ember Two",
        description: "Fresh garage notes.",
        photos: [
          {
            url: "/media/mika-updated-bike",
            position: 0,
            width: 1600,
            height: 1200,
          },
        ],
      },
    };
    await act(async () => root.render(createElement(EventAttendeeRoster, {
      initialPage: rosterPage([refreshedMika], "cursor-error"),
      signedIn: true,
      loadPage,
    })));
    expect(container.textContent).toContain("Mika Updated");
    expect(container.textContent).toContain("Cebu City");
    expect(container.textContent).toContain("Ember Two");
    expect(container.textContent).not.toContain("could not be loaded");
    expect(container.querySelector('img[src="/media/mika-updated-avatar"]')).not.toBeNull();
    expect(container.querySelector('img[src="/media/mika-updated-bike"]')).not.toBeNull();

    const disabled = {
      ...firstPage,
      summary: { ...firstPage.summary, rosterEnabled: false, visibleCount: 0, anonymousCount: 2 },
      attendees: [],
      nextCursor: undefined,
    };
    await act(async () => root.render(createElement(EventAttendeeRoster, {
      initialPage: disabled,
      signedIn: true,
      loadPage,
    })));
    expect(container.textContent).toContain("Roster is counts only");
    expect(container.textContent).not.toContain("Mika");

    const enabledAgain = rosterPage([bea], "cursor-2");
    await act(async () => root.render(createElement(EventAttendeeRoster, {
      initialPage: enabledAgain,
      signedIn: true,
      loadPage,
    })));
    expect(container.textContent).toContain("Bea");
    expect(container.textContent).not.toContain("Mika");
    expect(container.textContent).toContain("Load more riders");
    expect(container.textContent).not.toContain("could not be loaded");
  });

  test("submits anonymous for a forced-private stored visible RSVP and keeps it anonymous after publication", async () => {
    const saveIdentity = vi.fn(async (_eventId: string, identity: "VISIBLE" | "ANONYMOUS") => identity);
    const profile = {
      visibility: "PRIVATE",
      isPublished: true,
      defaultRosterIdentity: "VISIBLE",
    } as Pick<MemberProfileEditorView, "visibility" | "isPublished" | "defaultRosterIdentity">;

    await act(async () => root.render(createElement(ExistingRsvpIdentityForm, {
      eventId: "ride-1",
      profile,
      storedIdentity: "VISIBLE",
      saveIdentity,
    })));
    const changeButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Change for this event"));
    await act(async () => changeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const saveButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Save event privacy"));
    await act(async () => saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(saveIdentity).toHaveBeenCalledWith("ride-1", "ANONYMOUS");

    await act(async () => root.render(createElement(ExistingRsvpIdentityForm, {
      eventId: "ride-1",
      profile: { ...profile, visibility: "PUBLIC" },
      storedIdentity: "VISIBLE",
      saveIdentity,
    })));
    const anonymous = container.querySelector<HTMLInputElement>('input[value="ANONYMOUS"]');
    expect(anonymous?.checked).toBe(true);
  });

  test("keeps an existing RSVP privacy editor collapsed until the rider requests it", async () => {
    const profile = {
      visibility: "PUBLIC",
      isPublished: true,
      defaultRosterIdentity: "VISIBLE",
    } as Pick<MemberProfileEditorView, "visibility" | "isPublished" | "defaultRosterIdentity">;

    await act(async () => root.render(createElement(ExistingRsvpIdentityForm, {
      eventId: "ride-2",
      profile,
      storedIdentity: "ANONYMOUS",
      saveIdentity: async (_eventId, identity) => identity,
    })));

    expect(container.textContent).toContain("Profile default");
    expect(container.textContent).toContain("Change for this event");
    expect(container.querySelector('a[href="/profile#attendance-privacy"]')).not.toBeNull();
    expect(container.querySelector(".roster-identity-field")).toBeNull();

    const changeButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Change for this event"));
    await act(async () => changeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.querySelector(".roster-identity-field")).not.toBeNull();
  });
});
