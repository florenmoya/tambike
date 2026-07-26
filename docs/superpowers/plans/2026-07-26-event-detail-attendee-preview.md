# Event Detail Attendee Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make event attendance people-first by showing a privacy-safe preview of up to four riders near the RSVP actions and demoting the event perk to supporting context.

**Architecture:** Load the attendee preview in the event route’s Server Component using the current session, then pass a small serializable DTO into the existing client-side `TambikeScreen`. A focused presentation component renders member identities only when the backend has authorized them; the event detail keeps its own attendance totals as a resilient fallback when the preview cannot load.

**Tech Stack:** Next.js 16.2.11 App Router, React 19.2.4, TypeScript, Next Image, CSS Modules plus existing global CSS, Vitest, Prisma/PostgreSQL backend, Codex browser.

## Global Constraints

- Work directly on the current `main` checkout; do not create a branch or worktree.
- Preserve unrelated local changes and stop if they overlap a planned file.
- Use test-driven steps: add the focused failing regression, run it, implement the smallest change, and rerun it.
- Actual attendee identities remain signed-in-member-only and server-authorized.
- Never expose email addresses, internal IDs, verification state, password data, storage keys, or anonymous attendee identities.
- Preserve organizer roster enablement, global profile privacy precedence, RSVP, Share, poster, attendee-page, map, giveaway, and check-in behavior.
- Do not add a schema migration, dependency, search, filtering, messaging, following, or social graph.
- Keep the complete attendee page as the only surface with motorcycle showcase cards.
- Use `next/image` with fixed `width` and `height` for the 52-pixel portraits and keep private same-origin media `unoptimized`, matching the existing roster behavior.
- Before running `npm run dev`, check for an existing Tambike server and reuse it.
- Use only the Codex browser for browser verification; do not run Playwright.
- Do not deploy or push unless the user separately requests it.

---

## File Structure

- `src/features/member-profiles/types.ts`
  - Defines the serializable, privacy-limited attendee-preview DTO.
- `src/app/events/[eventId]/load-event-attendee-preview.ts`
  - Loads at most four authorized riders and converts authentication or backend failures into safe UI states.
- `tests/server/event-attendee-preview-loader.test.ts`
  - Proves loader authorization, sanitization, not-found behavior, and non-fatal fallback.
- `src/features/member-profiles/event-attendee-preview.tsx`
  - Renders turnout, the signed-in rider facepile, guest login guidance, and roster navigation.
- `src/features/member-profiles/event-attendee-preview.module.css`
  - Owns the preview’s bounded responsive visual system and focus states.
- `tests/server/event-attendee-preview-ui.test.tsx`
  - Proves member, guest, disabled, unavailable, empty-visible, accessibility, and privacy presentation.
- `src/app/events/[eventId]/page.tsx`
  - Loads and passes the preview from the server boundary.
- `src/features/tambike-demo/tambike-screen.tsx`
  - Places social proof beside the event decision, removes the old attendance-stat panel, and demotes the perk.
- `src/app/globals.css`
  - Styles the compact perk callout and removes obsolete attendance-panel rules.
- `tests/server/event-detail-ui-contract.test.ts`
  - Locks the new information order and responsive event-page contract.

---

### Task 1: Add the Privacy-Safe Preview Loader

**Files:**

- Modify: `src/features/member-profiles/types.ts:34-50`
- Create: `src/app/events/[eventId]/load-event-attendee-preview.ts`
- Create: `tests/server/event-attendee-preview-loader.test.ts`

**Interfaces:**

- Consumes:
  - `listEventAttendeesAction(eventId, { limit: 4 })`
  - `getEventAttendeeSummaryAction(eventId)`
  - `BackendError.code`
- Produces:

```ts
export type EventAttendeePreviewRider = Pick<
  MemberProfileView,
  "slug" | "displayName" | "area" | "profilePhotoUrl"
>;

export interface EventAttendeePreviewData {
  summary: EventAttendeeSummary | null;
  attendees: EventAttendeePreviewRider[];
  signedIn: boolean;
  unavailable: boolean;
}

export function loadEventAttendeePreview(
  eventId: string,
  listRoster?: typeof listEventAttendeesAction,
  getSummary?: typeof getEventAttendeeSummaryAction,
  showNotFound?: () => never,
): Promise<EventAttendeePreviewData>;
```

- Later tasks pass `EventAttendeePreviewData` through the route and into `EventAttendeePreview`.

- [ ] **Step 1: Write the failing loader tests**

Create `tests/server/event-attendee-preview-loader.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import type {
  EventAttendeeRosterPage,
  EventAttendeeSummary,
} from "../../src/features/member-profiles/types";
import { BackendError } from "../../src/server/backend";

const summary: EventAttendeeSummary = {
  eventId: "ride-1",
  eventTitle: "Marilaque Dawn Roll",
  rosterEnabled: true,
  goingCount: 8,
  visibleCount: 5,
  anonymousCount: 3,
};

const rosterPage: EventAttendeeRosterPage = {
  summary,
  attendees: Array.from({ length: 5 }, (_, index) => ({
    slug: `rider-${index + 1}`,
    displayName: `Rider ${index + 1}`,
    area: "Davao City",
    profilePhotoUrl: `/media/rider-${index + 1}`,
    motorcycle: {
      make: "Honda",
      model: "CB400",
      photos: [],
    },
  })),
  pageSize: 5,
};

describe("event attendee preview loader", () => {
  test("requests four riders and returns only preview-safe fields", async () => {
    const { loadEventAttendeePreview } = await import(
      "../../src/app/events/[eventId]/load-event-attendee-preview"
    );
    const calls: unknown[] = [];

    const result = await loadEventAttendeePreview(
      "ride-1",
      async (eventId, options) => {
        calls.push([eventId, options]);
        return rosterPage;
      },
      async () => summary,
      () => {
        throw new Error("unexpected not-found");
      },
    );

    expect(calls).toEqual([["ride-1", { limit: 4 }]]);
    expect(result).toEqual({
      summary,
      signedIn: true,
      unavailable: false,
      attendees: [
        {
          slug: "rider-1",
          displayName: "Rider 1",
          area: "Davao City",
          profilePhotoUrl: "/media/rider-1",
        },
        {
          slug: "rider-2",
          displayName: "Rider 2",
          area: "Davao City",
          profilePhotoUrl: "/media/rider-2",
        },
        {
          slug: "rider-3",
          displayName: "Rider 3",
          area: "Davao City",
          profilePhotoUrl: "/media/rider-3",
        },
        {
          slug: "rider-4",
          displayName: "Rider 4",
          area: "Davao City",
          profilePhotoUrl: "/media/rider-4",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /motorcycle|email|userId|verification|storageKey/i,
    );
  });

  test("returns public summary data without identities for a guest", async () => {
    const { loadEventAttendeePreview } = await import(
      "../../src/app/events/[eventId]/load-event-attendee-preview"
    );

    await expect(
      loadEventAttendeePreview(
        "ride-1",
        async () => {
          throw new BackendError("UNAUTHENTICATED", "UNAUTHENTICATED");
        },
        async () => summary,
        () => {
          throw new Error("unexpected not-found");
        },
      ),
    ).resolves.toEqual({
      summary,
      attendees: [],
      signedIn: false,
      unavailable: false,
    });
  });

  test("maps not-found to the route boundary", async () => {
    const { loadEventAttendeePreview } = await import(
      "../../src/app/events/[eventId]/load-event-attendee-preview"
    );
    const marker = new Error("route-not-found");

    await expect(
      loadEventAttendeePreview(
        "missing",
        async () => {
          throw new BackendError("NOT_FOUND", "NOT_FOUND");
        },
        async () => summary,
        () => {
          throw marker;
        },
      ),
    ).rejects.toBe(marker);
  });

  test("keeps the event route usable when preview data is unavailable", async () => {
    const { loadEventAttendeePreview } = await import(
      "../../src/app/events/[eventId]/load-event-attendee-preview"
    );

    await expect(
      loadEventAttendeePreview(
        "ride-1",
        async () => {
          throw new Error("database unavailable");
        },
        async () => {
          throw new Error("database unavailable");
        },
        () => {
          throw new Error("unexpected not-found");
        },
      ),
    ).resolves.toEqual({
      summary: null,
      attendees: [],
      signedIn: false,
      unavailable: true,
    });
  });
});
```

- [ ] **Step 2: Run the loader test and confirm the missing module failure**

Run:

```powershell
npx vitest run tests/server/event-attendee-preview-loader.test.ts
```

Expected: FAIL because `load-event-attendee-preview.ts` does not exist.

- [ ] **Step 3: Add the preview DTO**

Append to `src/features/member-profiles/types.ts` immediately after `EventAttendeeRosterPage`:

```ts
export type EventAttendeePreviewRider = Pick<
  MemberProfileView,
  "slug" | "displayName" | "area" | "profilePhotoUrl"
>;

export interface EventAttendeePreviewData {
  summary: EventAttendeeSummary | null;
  attendees: EventAttendeePreviewRider[];
  signedIn: boolean;
  unavailable: boolean;
}
```

- [ ] **Step 4: Implement the server-only loader**

Create `src/app/events/[eventId]/load-event-attendee-preview.ts`:

```ts
import "server-only";

import { notFound } from "next/navigation";

import type {
  EventAttendeePreviewData,
  EventAttendeePreviewRider,
} from "@/features/member-profiles/types";
import {
  getEventAttendeeSummaryAction,
  listEventAttendeesAction,
} from "@/server/actions";
import { BackendError } from "@/server/backend";

const PREVIEW_LIMIT = 4;

function unavailablePreview(): EventAttendeePreviewData {
  return {
    summary: null,
    attendees: [],
    signedIn: false,
    unavailable: true,
  };
}

function toPreviewRider(
  attendee: Awaited<ReturnType<typeof listEventAttendeesAction>>["attendees"][number],
): EventAttendeePreviewRider {
  return {
    slug: attendee.slug,
    displayName: attendee.displayName,
    area: attendee.area,
    profilePhotoUrl: attendee.profilePhotoUrl,
  };
}

export async function loadEventAttendeePreview(
  eventId: string,
  listRoster: typeof listEventAttendeesAction = listEventAttendeesAction,
  getSummary: typeof getEventAttendeeSummaryAction = getEventAttendeeSummaryAction,
  showNotFound: () => never = () => notFound(),
): Promise<EventAttendeePreviewData> {
  try {
    const page = await listRoster(eventId, { limit: PREVIEW_LIMIT });
    return {
      summary: page.summary,
      attendees: page.attendees.slice(0, PREVIEW_LIMIT).map(toPreviewRider),
      signedIn: true,
      unavailable: false,
    };
  } catch (error) {
    if (error instanceof BackendError && error.code === "NOT_FOUND") {
      return showNotFound();
    }

    if (error instanceof BackendError && error.code === "UNAUTHENTICATED") {
      try {
        return {
          summary: await getSummary(eventId),
          attendees: [],
          signedIn: false,
          unavailable: false,
        };
      } catch (summaryError) {
        if (
          summaryError instanceof BackendError &&
          summaryError.code === "NOT_FOUND"
        ) {
          return showNotFound();
        }
        return unavailablePreview();
      }
    }

    return unavailablePreview();
  }
}
```

The `server-only` import prevents the action/session loader from entering the client module graph.

- [ ] **Step 5: Run the loader tests**

Run:

```powershell
npx vitest run tests/server/event-attendee-preview-loader.test.ts
```

Expected: all four tests PASS.

- [ ] **Step 6: Commit the loader boundary**

```powershell
git add src/features/member-profiles/types.ts "src/app/events/[eventId]/load-event-attendee-preview.ts" tests/server/event-attendee-preview-loader.test.ts
git commit -m "feat: load safe event attendee previews"
```

---

### Task 2: Build the Compact Social-Proof Component

**Files:**

- Create: `src/features/member-profiles/event-attendee-preview.tsx`
- Create: `src/features/member-profiles/event-attendee-preview.module.css`
- Create: `tests/server/event-attendee-preview-ui.test.tsx`

**Interfaces:**

- Consumes:

```ts
export interface EventAttendeePreviewProps {
  eventId: string;
  fallbackGoing: number;
  interested: number;
  expected: number;
  preview?: EventAttendeePreviewData;
}
```

- Produces:

```ts
export function EventAttendeePreview(
  props: EventAttendeePreviewProps,
): React.ReactNode;
```

- Task 3 renders this component between event-action feedback and the poster.

- [ ] **Step 1: Write the failing presentation tests**

Create `tests/server/event-attendee-preview-ui.test.tsx`:

```tsx
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { EventAttendeePreview } from "../../src/features/member-profiles/event-attendee-preview";
import type { EventAttendeePreviewData } from "../../src/features/member-profiles/types";

const memberPreview: EventAttendeePreviewData = {
  summary: {
    eventId: "ride-1",
    eventTitle: "Marilaque Dawn Roll",
    rosterEnabled: true,
    goingCount: 15,
    visibleCount: 4,
    anonymousCount: 11,
  },
  attendees: [
    {
      slug: "mika-santos",
      displayName: "Mika Santos",
      area: "Davao City",
      profilePhotoUrl: "/media/mika",
    },
    {
      slug: "paolo-reyes",
      displayName: "Paolo Reyes",
      area: "Quezon City",
    },
  ],
  signedIn: true,
  unavailable: false,
};

function render(preview: EventAttendeePreviewData | undefined) {
  return renderToStaticMarkup(
    createElement(EventAttendeePreview, {
      eventId: "ride-1",
      fallbackGoing: 12,
      interested: 15,
      expected: 55,
      preview,
    }),
  );
}

describe("event attendee preview", () => {
  test("leads with turnout and authorized rider identities", () => {
    const markup = render(memberPreview);

    expect(markup).toContain("Who’s going");
    expect(markup).toContain("15 riders are going");
    expect(markup).toContain("15 interested");
    expect(markup).toContain("Around 55 expected");
    expect(markup).toContain("Mika Santos");
    expect(markup).toContain("Paolo Reyes");
    expect(markup).toContain('href="/riders/mika-santos"');
    expect(markup).toContain('src="/media/mika"');
    expect(markup).toContain('href="/events/ride-1/attendees"');
    expect(markup).toContain("See who’s going");
    expect(markup).not.toMatch(
      /anonymous riders|visible riders|email|userId|verification|motorcycle/i,
    );
  });

  test("shows a count and login action without identities for guests", () => {
    const markup = render({
      ...memberPreview,
      attendees: [],
      signedIn: false,
    });

    expect(markup).toContain("15 riders are going");
    expect(markup).toContain("Log in to see riders");
    expect(markup).toContain(
      'href="/login?next=%2Fevents%2Fride-1"',
    );
    expect(markup).not.toContain("Mika Santos");
  });

  test("does not expose roster navigation when the organizer disabled it", () => {
    const markup = render({
      ...memberPreview,
      summary: {
        ...memberPreview.summary!,
        rosterEnabled: false,
      },
      attendees: [],
    });

    expect(markup).toContain("15 riders are going");
    expect(markup).not.toContain("See who’s going");
    expect(markup).not.toContain("Log in to see riders");
    expect(markup).not.toMatch(/organizer|privacy|disabled/i);
  });

  test("uses event counts and keeps the roster path during a preview outage", () => {
    const markup = render({
      summary: null,
      attendees: [],
      signedIn: false,
      unavailable: true,
    });

    expect(markup).toContain("12 riders are going");
    expect(markup).toContain("See who’s going");
    expect(markup).toContain('href="/events/ride-1/attendees"');
    expect(markup).not.toContain("Log in to see riders");
  });

  test("guides signed-in riders when no visible profiles are available", () => {
    const markup = render({
      ...memberPreview,
      attendees: [],
    });

    expect(markup).toContain(
      "Rider profiles will appear here as they join",
    );
    expect(markup).toContain("See who’s going");
  });
});
```

- [ ] **Step 2: Run the presentation test and confirm the missing component failure**

Run:

```powershell
npx vitest run tests/server/event-attendee-preview-ui.test.tsx
```

Expected: FAIL because `event-attendee-preview.tsx` does not exist.

- [ ] **Step 3: Implement the preview component**

Create `src/features/member-profiles/event-attendee-preview.tsx`:

```tsx
import Image from "next/image";
import Link from "next/link";

import type { EventAttendeePreviewData } from "./types";
import styles from "./event-attendee-preview.module.css";

export interface EventAttendeePreviewProps {
  eventId: string;
  fallbackGoing: number;
  interested: number;
  expected: number;
  preview?: EventAttendeePreviewData;
}

export function EventAttendeePreview({
  eventId,
  fallbackGoing,
  interested,
  expected,
  preview,
}: EventAttendeePreviewProps) {
  const going = preview?.summary?.goingCount ?? fallbackGoing;
  const rosterEnabled = preview?.summary?.rosterEnabled !== false;
  const riders =
    preview?.signedIn && rosterEnabled ? preview.attendees.slice(0, 4) : [];
  const memberCanBrowse = preview?.signedIn && rosterEnabled;
  const guestCanLogIn =
    preview?.signedIn === false && !preview.unavailable && rosterEnabled;
  const canOpenRoster = rosterEnabled && !guestCanLogIn;

  return (
    <section className={styles.preview} aria-labelledby="event-attendee-preview-title">
      <div className={styles.heading}>
        <span>Who’s going</span>
        <h2 id="event-attendee-preview-title">{going} riders are going</h2>
        <p>{interested} interested · Around {expected} expected</p>
      </div>

      {riders.length > 0 ? (
        <div className={styles.riderSummary}>
          <div className={styles.facepile} aria-label="Featured attendees">
            {riders.map((rider) => (
              <Link
                key={rider.slug}
                className={styles.rider}
                href={`/riders/${rider.slug}`}
                aria-label={`View ${rider.displayName}’s rider profile`}
              >
                {rider.profilePhotoUrl ? (
                  <Image
                    src={rider.profilePhotoUrl}
                    alt=""
                    width={52}
                    height={52}
                    sizes="52px"
                    unoptimized
                  />
                ) : (
                  <span aria-hidden="true">
                    {rider.displayName.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </Link>
            ))}
          </div>
          <p className={styles.names}>
            {riders.map((rider) => rider.displayName).join(", ")}
          </p>
        </div>
      ) : memberCanBrowse ? (
        <p className={styles.state}>Rider profiles will appear here as they join.</p>
      ) : null}

      <div className={styles.footer}>
        {guestCanLogIn ? (
          <Link
            className={styles.action}
            href={`/login?next=${encodeURIComponent(`/events/${eventId}`)}`}
          >
            Log in to see riders
          </Link>
        ) : canOpenRoster ? (
          <Link className={styles.action} href={`/events/${eventId}/attendees`}>
            See who’s going
          </Link>
        ) : null}
      </div>
    </section>
  );
}
```

The portrait uses an empty `alt` because the containing link already supplies the rider’s accessible name.

- [ ] **Step 4: Add the bounded facepile visual system**

Create `src/features/member-profiles/event-attendee-preview.module.css`:

```css
.preview {
  display: grid;
  gap: 0.9rem;
  max-width: 760px;
  margin-top: 1rem;
  padding: 1rem 1.1rem;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--event-accent) 30%, transparent);
  border-radius: 0.9rem;
  background:
    linear-gradient(
      115deg,
      color-mix(in srgb, var(--event-accent) 12%, transparent),
      transparent 48%
    ),
    rgba(16, 14, 16, 0.9);
}

.heading {
  display: grid;
  gap: 0.25rem;
}

.heading > span {
  color: color-mix(in srgb, var(--event-accent) 82%, #fff);
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.055em;
  text-transform: uppercase;
}

.heading h2 {
  margin: 0;
  color: #fff;
  font-size: clamp(1.2rem, 3vw, 1.65rem);
  line-height: 1.1;
}

.heading p,
.names,
.state {
  margin: 0;
  color: rgba(255, 255, 255, 0.68);
  font-size: 0.82rem;
  line-height: 1.45;
}

.riderSummary {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  min-width: 0;
}

.facepile {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  padding-left: 0.65rem;
}

.facepile::before {
  content: "";
  position: absolute;
  right: 0.2rem;
  left: 0;
  top: 50%;
  height: 1px;
  background: color-mix(in srgb, var(--event-accent) 38%, transparent);
}

.rider {
  position: relative;
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  margin-left: -0.65rem;
  overflow: hidden;
  border: 2px solid #191417;
  border-radius: 999px;
  background: color-mix(in srgb, var(--event-accent) 22%, #21181d);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 850;
}

.rider img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.rider:focus-visible,
.action:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--event-accent) 64%, #fff);
  outline-offset: 3px;
}

.names {
  min-width: 0;
  overflow-wrap: anywhere;
  color: rgba(255, 255, 255, 0.82);
}

.footer {
  min-height: 44px;
  display: flex;
  align-items: center;
}

.action {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  color: color-mix(in srgb, var(--event-accent) 86%, #fff);
  font-size: 0.84rem;
  font-weight: 820;
  text-decoration: underline;
  text-underline-offset: 0.25rem;
}

@media (max-width: 430px) {
  .preview {
    padding: 0.9rem;
  }

  .riderSummary {
    align-items: flex-start;
    flex-direction: column;
  }
}
```

- [ ] **Step 5: Run the focused component test**

Run:

```powershell
npx vitest run tests/server/event-attendee-preview-ui.test.tsx
```

Expected: all five tests PASS.

- [ ] **Step 6: Commit the social-proof component**

```powershell
git add src/features/member-profiles/event-attendee-preview.tsx src/features/member-profiles/event-attendee-preview.module.css tests/server/event-attendee-preview-ui.test.tsx
git commit -m "feat: show compact event social proof"
```

---

### Task 3: Integrate the Preview and Demote the Perk

**Files:**

- Modify: `src/app/events/[eventId]/page.tsx:1-11`
- Modify: `src/features/tambike-demo/tambike-screen.tsx:1-77`
- Modify: `src/features/tambike-demo/tambike-screen.tsx:244-273`
- Modify: `src/features/tambike-demo/tambike-screen.tsx:919-1082`
- Modify: `src/app/globals.css:3733-3948`
- Modify: `tests/server/event-detail-ui-contract.test.ts:51-157`

**Interfaces:**

- Consumes:
  - `loadEventAttendeePreview(eventId)`
  - `EventAttendeePreviewData`
  - `EventAttendeePreview`
- Produces:

```ts
interface TambikeScreenProps {
  view: TambikeView;
  id?: string;
  eventQuery?: EventQueryInput;
  nextHref?: string;
  attendeePreview?: EventAttendeePreviewData;
}

function EventDetail({
  eventId,
  attendeePreview,
}: {
  eventId?: string;
  attendeePreview?: EventAttendeePreviewData;
}): React.ReactNode;
```

- [ ] **Step 1: Update the event-detail contract with the new hierarchy**

In `tests/server/event-detail-ui-contract.test.ts`, update the first test to locate the preview:

```ts
const attendeePreview = sourceIndex(screen, "<EventAttendeePreview");

expect(actions).toBeLessThan(attendeePreview);
expect(attendeePreview).toBeLessThan(poster);
```

Replace the explanatory-order test with:

```ts
test("keeps social proof near the decision and treats the perk as supporting context", () => {
  const screen = componentSource("EventDetail");
  const actions = sourceIndex(screen, 'className="event-detail-actions"');
  const attendeePreview = sourceIndex(screen, "<EventAttendeePreview");
  const poster = sourceIndex(screen, 'className="event-detail-poster-wrap"');
  const whatToExpect = sourceIndex(screen, 'eyebrow="What to expect"');
  const perk = sourceIndex(screen, 'className="event-detail-perk"');
  const venue = sourceIndex(screen, 'eyebrow="Venue"');
  const rideMeetup = sourceIndex(screen, 'eyebrow="Ride / meetup"');
  const rules = sourceIndex(screen, 'eyebrow="Rules"');
  const organizer = sourceIndex(screen, 'eyebrow="Organizer"');
  const giveaways = sourceIndex(screen, "<PublicGiveawayPanel");

  expect(actions).toBeLessThan(attendeePreview);
  expect(attendeePreview).toBeLessThan(poster);
  expect(poster).toBeLessThan(whatToExpect);
  expect(whatToExpect).toBeLessThan(perk);
  expect(perk).toBeLessThan(venue);
  expect(venue).toBeLessThan(rideMeetup);
  expect(rideMeetup).toBeLessThan(rules);
  expect(rules).toBeLessThan(organizer);
  expect(organizer).toBeLessThan(giveaways);

  expect(screen).toContain("{event.perkPreview}");
  expect(screen).not.toContain('eyebrow="Perk and attendance"');
  expect(screen).not.toContain('className="event-detail-pass-stats"');
  expect(screen).not.toContain("View attendee roster");
});
```

Add a route-boundary test:

```ts
test("loads attendee preview data at the event route server boundary", () => {
  const route = readFileSync(
    join(process.cwd(), "src/app/events/[eventId]/page.tsx"),
    "utf8",
  );

  expect(route).toContain("loadEventAttendeePreview");
  expect(route).toContain("attendeePreview={attendeePreview}");
  expect(route).not.toContain('"use client"');
});
```

- [ ] **Step 2: Run the event-detail contract and confirm the old panel fails**

Run:

```powershell
npx vitest run tests/server/event-detail-ui-contract.test.ts
```

Expected: FAIL because `EventAttendeePreview` and `event-detail-perk` are absent and the old `Perk and attendance` panel remains.

- [ ] **Step 3: Load the preview in the event route**

Update `src/app/events/[eventId]/page.tsx`:

```tsx
import { loadEventAttendeePreview } from "./load-event-attendee-preview";
import { demoEvents } from "@/features/tambike-demo/data";
import { TambikeScreen } from "@/features/tambike-demo/tambike-screen";

export function generateStaticParams() {
  return demoEvents.map((event) => ({ eventId: event.id }));
}

export default async function Page({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const attendeePreview = await loadEventAttendeePreview(eventId);

  return (
    <TambikeScreen
      view="event-detail"
      id={eventId}
      attendeePreview={attendeePreview}
    />
  );
}
```

This keeps session-aware loading inside the Server Component and passes only serializable public fields into the client tree.

- [ ] **Step 4: Thread the preview through `TambikeScreen`**

Add `Coffee` to the existing `lucide-react` named import in
`src/features/tambike-demo/tambike-screen.tsx`:

```tsx
import {
  Building2,
  Coffee,
  Gauge,
  LockKeyhole,
  LogIn,
  LogOut,
  Menu,
  Motorbike,
  QrCode,
  Route,
  Search,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Ticket,
  User,
  UserPlus,
} from "lucide-react";
```

Add the preview imports:

```tsx
import { EventAttendeePreview } from "@/features/member-profiles/event-attendee-preview";
import type { EventAttendeePreviewData } from "@/features/member-profiles/types";
```

Add the optional prop:

```ts
interface TambikeScreenProps {
  view: TambikeView;
  id?: string;
  eventQuery?: EventQueryInput;
  nextHref?: string;
  attendeePreview?: EventAttendeePreviewData;
}
```

Destructure and pass it:

```tsx
export function TambikeScreen({
  view,
  id,
  eventQuery,
  nextHref,
  attendeePreview,
}: TambikeScreenProps) {
  // existing discovery and events branches remain unchanged

  const content = (
    <>
      {view === "event-detail" && (
        <EventDetail eventId={id} attendeePreview={attendeePreview} />
      )}
      {/* existing route branches remain unchanged */}
    </>
  );
```

- [ ] **Step 5: Place social proof after event actions**

Change the `EventDetail` signature:

```tsx
function EventDetail({
  eventId,
  attendeePreview,
}: {
  eventId?: string;
  attendeePreview?: EventAttendeePreviewData;
}) {
```

After the existing `shareFeedback` and `actionError` blocks, add:

```tsx
<EventAttendeePreview
  eventId={event.id}
  fallbackGoing={event.going}
  interested={event.interested}
  expected={event.expectedRiders}
  preview={attendeePreview}
/>
```

Keep this component inside `.event-detail-copy`, before `.event-detail-poster-wrap`, so it appears before the poster on mobile and inside the wider text column on desktop.

- [ ] **Step 6: Replace the old perk-and-attendance panel**

Immediately after the `What to expect` `InfoPanel`, add:

```tsx
<aside className="event-detail-perk" aria-label="Event perk">
  <Coffee aria-hidden="true" />
  <span>Perk</span>
  <strong>{event.perkPreview}</strong>
</aside>
```

Render the existing Venue panel directly after the perk:

```tsx
<InfoPanel eyebrow="Venue" title={event.locationName}>
  <p>{event.locationAddress}</p>
  <strong>{event.area}</strong>
  {event.locationMapLink ? (
    <Link
      className="primary-action event-detail-map-link"
      href={event.locationMapLink}
      target="_blank"
      rel="noreferrer"
    >
      Open map
    </Link>
  ) : null}
</InfoPanel>
```

Move the existing conditional `Ride / meetup` panel after Venue. Delete:

```tsx
<div className="event-detail-essentials">
  {/* Venue panel */}
  <InfoPanel eyebrow="Perk and attendance" title={event.perkPreview}>
    <div className="event-detail-pass-stats">
      <Detail label="Going" value={String(event.going)} />
      <Detail label="Interested" value={String(event.interested)} />
      <Detail label="Expected" value={String(event.expectedRiders)} />
    </div>
    <Link className="ghost-action as-link" href={`/events/${event.id}/attendees`}>
      View attendee roster
    </Link>
  </InfoPanel>
</div>
```

Do not duplicate the attendee link; `EventAttendeePreview` now owns member, guest, disabled, and unavailable navigation.

- [ ] **Step 7: Style the perk and remove obsolete attendance CSS**

Add to `src/app/globals.css` beside the event-detail section rules:

```css
.event-detail-perk {
  width: fit-content;
  max-width: 100%;
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
  gap: 0.55rem;
  min-height: 46px;
  padding: 0.65rem 0.85rem;
  border: 1px solid color-mix(in srgb, var(--event-accent) 34%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--event-accent) 9%, rgba(18, 17, 19, 0.82));
  color: rgba(255, 255, 255, 0.82);
}

.event-detail-perk svg {
  width: 18px;
  height: 18px;
  color: var(--event-accent);
}

.event-detail-perk span {
  color: color-mix(in srgb, var(--event-accent) 82%, #fff);
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.055em;
  text-transform: uppercase;
}

.event-detail-perk strong {
  min-width: 0;
  overflow-wrap: anywhere;
  color: #fff;
  font-size: 0.86rem;
  line-height: 1.3;
}
```

Delete the obsolete `.event-detail-essentials`, `.event-detail-pass-stats`, and `.event-detail-essentials .as-link` rules and remove those selectors from grouped focus, touch-target, and mobile rules.

At `max-width: 430px`, add:

```css
.event-detail-perk {
  width: 100%;
  border-radius: 0.75rem;
}
```

- [ ] **Step 8: Run the integrated UI contracts**

Run:

```powershell
npx vitest run tests/server/event-attendee-preview-loader.test.ts tests/server/event-attendee-preview-ui.test.tsx tests/server/event-detail-ui-contract.test.ts tests/server/event-roster-ui-contract.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 9: Check obsolete symbols and whitespace**

Run:

```powershell
rg -n "Perk and attendance|event-detail-pass-stats|event-detail-essentials|View attendee roster" src/features/tambike-demo/tambike-screen.tsx src/app/globals.css
git diff --check
```

Expected: `rg` returns no matches and `git diff --check` exits successfully.

- [ ] **Step 10: Commit the event-page integration**

```powershell
git add "src/app/events/[eventId]/page.tsx" src/features/tambike-demo/tambike-screen.tsx src/app/globals.css tests/server/event-detail-ui-contract.test.ts
git commit -m "feat: make event attendance people first"
```

---

### Task 4: Run the Complete Verification Gate

**Files:**

- Modify only if a failure reveals a directly related defect in the files listed above.

**Interfaces:**

- Consumes the complete implementation from Tasks 1–3.
- Produces automated, build, responsive-browser, privacy, and interaction evidence.

- [ ] **Step 1: Run the complete server test suite**

Run:

```powershell
npm run test:server
```

Expected: all server tests PASS.

- [ ] **Step 2: Run Prisma integration tests**

Run:

```powershell
npm run test:prisma
```

Expected: all Prisma integration tests PASS. If the configured test database is unavailable, preserve the exact infrastructure error and do not report Prisma verification as passing.

- [ ] **Step 3: Run lint**

Run:

```powershell
npm run lint
```

Expected: exit code `0`.

- [ ] **Step 4: Run the production build**

Run:

```powershell
npm run build
```

Expected: Next.js 16.2.11 completes without type, serialization, route, or image errors.

- [ ] **Step 5: Inspect final scope and repository state**

Run:

```powershell
git diff --check HEAD~3..HEAD
git status --short --branch
git log --oneline --decorate -8
```

Confirm:

- no schema or dependency files changed;
- no attendee authorization or privacy-domain logic changed;
- no full motorcycle data enters `EventAttendeePreviewData`;
- only the approved route, preview, event detail, styles, tests, spec, and plan changed.

- [ ] **Step 6: Check for an existing Tambike development server**

Run:

```powershell
netstat -ano -p tcp | Select-String -Pattern ":3000|:3001|:3002|:3003"
```

If a listener exists, inspect its process command line and working directory and reuse it only when it is this `D:\Github\personal\tambike` checkout. If no verified Tambike listener exists, start `npm run dev` from this checkout and retain the terminal session for logs.

- [ ] **Step 7: Verify the signed-in mobile experience with the Codex browser**

Open `/events/tambike-cafe-classico` on the exact localhost origin verified in Step 6.

At 390 × 844 verify:

- `15 riders are going` uses the live backend count;
- up to four authorized rider portraits and visible names appear after the RSVP actions and before the poster;
- every portrait links to the matching `/riders/{slug}` profile;
- `See who’s going` opens `/events/tambike-cafe-classico/attendees`;
- the coffee discount appears as a compact Perk callout, not a section heading;
- Interested and Expected are supporting text rather than stacked statistic cards;
- no identity, image, action, or panel overflows the viewport;
- there is no horizontal document overflow.

- [ ] **Step 8: Verify guest and privacy states**

Using a signed-out browser state, verify:

- the Going total remains visible;
- no rider name, portrait URL, or profile link is present;
- `Log in to see riders` returns to the event detail route after authentication.

With an organizer-disabled roster fixture or test state, verify:

- the Going total remains visible;
- no identity or roster link is rendered;
- no public copy mentions organizer settings, privacy precedence, anonymous totals, or visible totals.

- [ ] **Step 9: Verify desktop layout and retained actions**

At a desktop width verify:

- the social-proof strip remains in the event text column;
- the poster remains balanced in the left column;
- RSVP Going, Interested, Share, View full poster, Open map, organizer, and giveaway surfaces retain their behavior;
- keyboard focus is visible on portraits, login, roster, RSVP, Share, poster, and map actions;
- no new console errors appear.

- [ ] **Step 10: Commit any directly related verification correction**

Only when verification required a code correction:

```powershell
git add "src/app/events/[eventId]/page.tsx" "src/app/events/[eventId]/load-event-attendee-preview.ts" src/features/member-profiles/types.ts src/features/member-profiles/event-attendee-preview.tsx src/features/member-profiles/event-attendee-preview.module.css src/features/tambike-demo/tambike-screen.tsx src/app/globals.css tests/server/event-attendee-preview-loader.test.ts tests/server/event-attendee-preview-ui.test.tsx tests/server/event-detail-ui-contract.test.ts
git commit -m "fix: harden event attendee preview"
```

Then rerun the failed focused check plus `npm run test:server`, `npm run lint`, and `npm run build`.

- [ ] **Step 11: Final handoff**

Report:

- the new people-first event hierarchy;
- signed-in, guest, roster-disabled, empty-visible, and unavailable behavior;
- exact test counts and commands;
- Prisma, lint, build, mobile, desktop, privacy, and console results;
- any remaining deployment boundary.
