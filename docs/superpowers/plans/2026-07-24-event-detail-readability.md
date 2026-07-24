# Event Detail Readability and Global Roster Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tambike event details readable and decision-first on phones and desktop, deliver bundled posters efficiently through the existing Next.js/Vercel image path, and make Profile attendance privacy the sole rider-level roster preference.

**Architecture:** Keep the existing event and RSVP data models, but treat `User.defaultRosterIdentity` as the live source of truth whenever a roster is classified or queried. Remove event-specific roster controls from the action/provider/UI surfaces while retaining `RSVP.rosterIdentity` as compatibility storage. Resolve bundled poster strings to static image imports, then rebuild `EventDetail` around a copy-first responsive header and ordered information sections.

**Tech Stack:** Next.js 16.2.9 App Router, React 19.2.4, TypeScript, Prisma/PostgreSQL, Vitest, CSS, Next `<Image>`, Codex browser.

## Global Constraints

- Work on `codex/event-detail-readability`; preserve unrelated local changes.
- Read the relevant installed Next.js guides in `node_modules/next/dist/docs/` before changing `<Image>` behavior. The required guides are:
  - `node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md`
  - `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/images.md`
- Use test-first steps: add or update the focused regression, run it and observe the expected failure, make the smallest implementation, then rerun it.
- Do not drop, migrate, or backfill `RSVP.rosterIdentity`.
- Do not create an S3 bucket, CloudFront distribution, or global image-cache TTL override.
- Do not change attendee-page access, organizer roster enablement, RSVP/pass/giveaway/check-in behavior, or unrelated event-discovery design.
- Do not run Playwright. Browser verification must use the Codex browser tool.
- Before starting `npm run dev`, check for and reuse an existing Tambike development server.
- Do not deploy as part of this implementation unless the user separately requests it.

---

## Task 1: Make Global Profile Privacy the Roster Policy

**Files:**

- Modify: `tests/server/event-roster-domain.test.ts:67-225`
- Modify: `src/server/backend.ts:210-216`
- Modify: `src/server/backend.ts:4139-4180`
- Modify: `src/server/backend.ts:4227-4305`
- Modify: `src/server/backend.ts:7698-7722`

### Interfaces

`RegistrationInput` must no longer expose an event-level identity:

```ts
export type RegistrationInput = {
  status: "interested" | "going";
  attendanceType: AttendanceType;
  clubName?: string;
};
```

Roster classification continues using the existing `classifyRosterEntry()` contract, but every caller must pass the rider's current profile setting:

```ts
rosterIdentity: user.defaultRosterIdentity ?? "ANONYMOUS"
```

The compatibility column remains populated when an RSVP is first created. It does not participate in roster output.

### Steps

- [ ] Replace the event-specific identity regression in `tests/server/event-roster-domain.test.ts` with a global-preference regression.

  The test must:

  1. Publish an eligible rider profile with `defaultRosterIdentity: "VISIBLE"`.
  2. Register the rider without a roster-identity argument.
  3. Enable the organizer roster and prove the rider is visible.
  4. Update only the profile to `defaultRosterIdentity: "ANONYMOUS"` and prove the same existing RSVP becomes anonymous.
  5. Update the profile back to `VISIBLE` and prove the same RSVP becomes visible again.
  6. Preserve assertions that a private profile, an unpublished profile, and a globally anonymous rider never expose a card.
  7. Preserve the roster-disabled count-only assertion.

  Use this core assertion sequence:

  ```ts
  await backend.registerForEvent(actors.rider.sessionToken, event.id, {
    status: "going",
    attendanceType: "direct",
  });
  await backend.configureEventRoster(actors.organizer.sessionToken, event.id, {
    enabled: true,
  });

  await expect(
    backend.listEventAttendees(actors.outsider.sessionToken, event.id, {}),
  ).resolves.toMatchObject({
    summary: { visibleCount: 1, anonymousCount: 0 },
    attendees: [{ slug: visibleProfile.slug }],
  });

  await backend.updateMemberProfile(actors.rider.sessionToken, {
    ...visibleProfile,
    defaultRosterIdentity: "ANONYMOUS",
  });

  await expect(
    backend.listEventAttendees(actors.outsider.sessionToken, event.id, {}),
  ).resolves.toMatchObject({
    summary: { visibleCount: 0, anonymousCount: 1 },
    attendees: [],
  });
  ```

- [ ] Run the focused test and confirm it fails because the stored RSVP identity still controls the roster.

  Run:

  ```powershell
  npx vitest run tests/server/event-roster-domain.test.ts
  ```

  Expected failure: after changing the profile default, `visibleCount` remains `1` or the removed per-event API expectations fail.

- [ ] Remove `rosterIdentity` from `RegistrationInput`, remove its validation in `registerForEvent()`, and keep compatibility storage internal.

  For the in-memory RSVP, use:

  ```ts
  rosterIdentity:
    previousRsvp?.rosterIdentity ??
    user.defaultRosterIdentity ??
    "ANONYMOUS",
  ```

- [ ] Change both in-memory roster paths to classify against the current user default.

  In `listEventAttendees()` and `buildMemoryRosterSummary()`:

  ```ts
  classifyRosterEntry({
    enabled,
    rosterIdentity: user.defaultRosterIdentity ?? "ANONYMOUS",
    profileSlug: user.profileSlug,
    profileVisibility: user.profileVisibility ?? "PRIVATE",
  })
  ```

- [ ] Leave the in-memory `updateEventRosterIdentity()` and `getEventRosterIdentity()` methods temporarily in place so the branch remains type-safe while the unchanged action/provider callers still exist. Task 3 removes both methods atomically with those callers.

- [ ] Rerun the focused test.

  ```powershell
  npx vitest run tests/server/event-roster-domain.test.ts
  ```

  Expected: all tests in the file pass.

- [ ] Commit the in-memory policy change.

  ```powershell
  git add src/server/backend.ts tests/server/event-roster-domain.test.ts
  git commit -m "fix: make profile privacy control event rosters"
  ```

---

## Task 2: Apply the Same Policy to Prisma

**Files:**

- Modify: `tests/prisma-integration/event-roster.integration.test.ts:1-90`
- Modify: `src/server/prisma-backend.ts:4619-4688`
- Modify: `src/server/prisma-backend.ts:4744-4809`
- Modify: `src/server/prisma-backend.ts:4830-4870`
- Modify: `src/server/prisma-backend.ts:8825-8865`

### Interfaces

For new rows, continue writing the current default to the compatibility column:

```ts
create: {
  eventId: event.id,
  userId: user.id,
  status: input.status,
  goingAt,
  attendanceType: attendanceTypeToDb[input.attendanceType] as never,
  clubName: input.clubName?.trim() || user.clubName,
  rosterIdentity: user.defaultRosterIdentity,
}
```

On RSVP updates, do not overwrite the compatibility value. Live visibility comes from the related user:

```ts
user: {
  defaultRosterIdentity: "VISIBLE",
  profileSlug: { not: null },
  profileVisibility: { not: "PRIVATE" },
}
```

### Steps

- [ ] Rewrite the Prisma roster integration scenario to prove current Profile privacy controls an already-existing RSVP.

  The test must:

  - Create and publish a `VISIBLE` rider profile.
  - Register once without an event-level identity.
  - Assert the compatibility `rsvp.rosterIdentity` is initially `VISIBLE`.
  - Change only `defaultRosterIdentity` to `ANONYMOUS`.
  - Assert `listEventAttendees()` reports zero visible and one anonymous without re-registering.
  - Change only the global setting back to `VISIBLE`.
  - Assert the original RSVP card returns.
  - Retain pagination, authentication, malformed-cursor, private-profile, and organizer-off coverage.

- [ ] Run only the Prisma roster integration and observe the expected failure.

  ```powershell
  npx vitest run --config vitest.prisma-integration.config.ts tests/prisma-integration/event-roster.integration.test.ts
  ```

  Expected failure: the query still filters `RSVP.rosterIdentity`.

- [ ] Remove `input.rosterIdentity` validation and assignment from the Prisma registration path.

  Keep the create/update split explicit:

  ```ts
  create: {
    eventId: event.id,
    userId: user.id,
    status: input.status,
    goingAt,
    attendanceType: attendanceTypeToDb[input.attendanceType] as never,
    clubName: input.clubName?.trim() || user.clubName,
    rosterIdentity: user.defaultRosterIdentity,
  },
  update: {
    status: input.status,
    goingAt,
    attendanceType: attendanceTypeToDb[input.attendanceType] as never,
    clubName: input.clubName?.trim() || user.clubName,
  },
  ```

- [ ] Change `listEventAttendees()` so `visibleWhere` filters `user.defaultRosterIdentity`, not `rsvp.rosterIdentity`.

  ```ts
  const visibleWhere = {
    eventId,
    status: "going" as const,
    goingAt: { not: null },
    user: {
      defaultRosterIdentity: "VISIBLE" as const,
      profileSlug: { not: null },
      profileVisibility: { not: "PRIVATE" as const },
    },
    ...(cursor
      ? {
          OR: [
            { goingAt: { gt: new Date(cursor.goingAt) } },
            {
              goingAt: new Date(cursor.goingAt),
              id: { gt: cursor.rsvpId },
            },
          ],
        }
      : {}),
  } satisfies Prisma.RSVPWhereInput;
  ```

- [ ] Apply the identical user relation predicate in `buildPrismaRosterSummary()`.

  ```ts
  where: {
    eventId,
    status: "going",
    goingAt: { not: null },
    user: {
      defaultRosterIdentity: "VISIBLE",
      profileSlug: { not: null },
      profileVisibility: { not: "PRIVATE" },
    },
  }
  ```

- [ ] Leave Prisma `updateEventRosterIdentity()` and `getEventRosterIdentity()` temporarily in place so the branch remains type-safe while the unchanged action/provider callers still exist. Task 3 removes both methods atomically with those callers.

- [ ] Rerun the focused integration.

  ```powershell
  npx vitest run --config vitest.prisma-integration.config.ts tests/prisma-integration/event-roster.integration.test.ts
  ```

  Expected: the integration passes.

- [ ] Commit the database-backed policy change.

  ```powershell
  git add src/server/prisma-backend.ts tests/prisma-integration/event-roster.integration.test.ts
  git commit -m "fix: query current profile roster privacy"
  ```

---

## Task 3: Remove Event-Level Privacy APIs and Controls

**Files:**

- Modify: `tests/server/event-roster-ui-contract.test.ts:1-270`
- Delete: `tests/server/event-roster-ui-rerender.test.ts`
- Delete: `src/features/member-profiles/roster-identity-field.tsx`
- Modify: `src/server/actions.ts:1-165`
- Modify: `src/server/backend.ts:4307-4335`
- Modify: `src/server/prisma-backend.ts:4830-4870`
- Modify: `src/features/tambike-demo/demo-provider.tsx:1-410`
- Modify: `src/features/tambike-demo/tambike-screen.tsx:1-1365`
- Modify: `src/app/globals.css:3070-3126`

### Interfaces

The provider registration method becomes:

```ts
registerForEvent: (
  eventId: string,
  attendanceType: AttendanceType,
  status?: "interested" | "going",
) => Promise<string | null>;
```

The server action input becomes:

```ts
input: {
  status: "interested" | "going";
  attendanceType: AttendanceType;
  clubName?: string;
}
```

There will be no event-specific `getEventRosterIdentity` or `updateEventRosterIdentity` action/provider method.

### Steps

- [ ] Replace event-specific UI expectations in `event-roster-ui-contract.test.ts` with absence contracts.

  Read the relevant source files and assert:

  ```ts
  expect(screen).not.toContain("ExistingRsvpIdentityEditor");
  expect(screen).not.toContain("RosterIdentityField");
  expect(screen).not.toContain("Change for this event");
  expect(screen).not.toContain("Profile default");
  expect(screen).not.toContain("Event roster privacy");
  expect(screen).toMatch(
    /registerForEvent\(event\.id,\s*attendance,\s*"going"\)/,
  );

  expect(provider).not.toContain("updateEventRosterIdentityAction");
  expect(provider).not.toContain("getEventRosterIdentityAction");
  expect(actions).not.toContain("updateEventRosterIdentityAction");
  expect(actions).not.toContain("getEventRosterIdentityAction");
  ```

  Keep positive assertions for `View attendee roster`, `configureEventRoster`, and `listEventAttendees`.

- [ ] Run the UI contract test and confirm the new absence assertions fail.

  ```powershell
  npx vitest run tests/server/event-roster-ui-contract.test.ts
  ```

- [ ] Remove `rosterIdentity` from `registerForEventAction()` and delete the two event-specific privacy actions from `src/server/actions.ts`. Remove the `RosterIdentity` import if no longer used.

- [ ] Delete `updateEventRosterIdentity()` and `getEventRosterIdentity()` from both backend implementations in the same change as their action/provider callers.

- [ ] Remove the optional identity argument and the two event-specific methods from `DemoContextValue`, callback implementations, memo dependencies, and provider value in `demo-provider.tsx`.

  The callback must pass only:

  ```ts
  const result = await registerForEventAction(eventId, {
    status,
    attendanceType: nextAttendanceType,
    clubName: currentUser.clubName,
  });
  ```

- [ ] Simplify `RsvpModal` so it asks only how the rider is arriving.

  Use:

  ```ts
  function RsvpModal({ event, onClose }: { event: Event; onClose: () => void }) {
    const { registerForEvent } = useDemo();
    const router = useRouter();
    const [attendance, setAttendance] = useState<AttendanceType>("direct");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState("");

    const submit = async (formEvent: FormEvent<HTMLFormElement>) => {
      formEvent.preventDefault();
      setError("");
      setIsSubmitting(true);
      try {
        const passId = await registerForEvent(event.id, attendance, "going");
        if (passId) {
          onClose();
          router.push(`/passes/${passId}`);
        }
      } catch (actionError) {
        setError(actionErrorMessage(actionError));
      } finally {
        setIsSubmitting(false);
      }
    };

    // Preserve the existing attendance fieldset, error message, and modal actions.
  }
  ```

  Remove the profile-loading effect, identity state, loading copy, identity field, and identity-based submit disabling.

- [ ] Remove `<ExistingRsvpIdentityEditor>` from `EventDetail`, then delete `ExistingRsvpIdentityEditor`, `ExistingRsvpIdentityForm`, `RosterProfileState`, and `normalizeExistingRosterIdentity`.

- [ ] Delete the now-unused `roster-identity-field.tsx` and its component-only rerender test.

- [ ] Remove the obsolete `.existing-rsvp-identity*` CSS block.

- [ ] Rerun the UI contract and the complete focused roster unit file.

  ```powershell
  npx vitest run tests/server/event-roster-ui-contract.test.ts tests/server/event-roster-domain.test.ts
  ```

  Expected: both files pass.

- [ ] Search for stale event-specific symbols.

  ```powershell
  rg -n "ExistingRsvpIdentity|RosterIdentityField|registrationRosterIdentity|updateEventRosterIdentity|getEventRosterIdentity|Change for this event|Profile default" src tests
  ```

  Expected: no matches.

- [ ] Commit the API and control removal.

  ```powershell
  git add src/server/actions.ts src/features/tambike-demo/demo-provider.tsx src/features/tambike-demo/tambike-screen.tsx src/features/member-profiles/roster-identity-field.tsx src/app/globals.css tests/server/event-roster-ui-contract.test.ts tests/server/event-roster-ui-rerender.test.ts
  git commit -m "refactor: remove per-event roster privacy"
  ```

---

## Task 4: Make the Profile Setting Explicitly Global

**Files:**

- Modify: `tests/server/member-profile-ui-contract.test.ts:70-115`
- Modify: `src/features/member-profiles/profile-settings.tsx:331-355`

### Steps

- [ ] Add source contract assertions for global copy and retain both choices.

  ```ts
  expect(settings).toContain(
    "This setting applies to all current and future event rosters.",
  );
  expect(settings).toContain(
    "Private or unpublished profiles always appear anonymously.",
  );
  expect(settings).toContain("Anonymous — count me without my card");
  expect(settings).toContain("Visible — show my eligible rider card");
  expect(settings).not.toContain("future event registrations only");
  expect(settings).not.toContain("Existing RSVPs keep their own choice");
  ```

- [ ] Run the contract and confirm it fails on the old future-only wording.

  ```powershell
  npx vitest run tests/server/member-profile-ui-contract.test.ts
  ```

- [ ] Update only the Profile attendance-privacy copy.

  ```tsx
  <CardDescription>
    This setting applies to all current and future event rosters.
  </CardDescription>
  ```

  Keep the current selector and choices. Replace the help line with:

  ```tsx
  <span>
    Private or unpublished profiles always appear anonymously.
  </span>
  ```

- [ ] Rerun the contract.

  ```powershell
  npx vitest run tests/server/member-profile-ui-contract.test.ts
  ```

- [ ] Commit the copy change.

  ```powershell
  git add src/features/member-profiles/profile-settings.tsx tests/server/member-profile-ui-contract.test.ts
  git commit -m "copy: clarify global attendance privacy"
  ```

---

## Task 5: Resolve Bundled Posters to Static Image Assets

**Files:**

- Create: `tests/server/event-poster-assets-contract.test.ts`
- Create: `src/features/tambike-demo/event-poster-assets.ts`
- Modify: `src/features/tambike-demo/tambike-screen.tsx:884-918`

### Interfaces

```ts
import type { StaticImageData } from "next/image";

export function resolveEventPoster(
  posterPath: string,
): string | StaticImageData;
```

All current `poster:` paths in `src/features/tambike-demo/data.ts` must have a static import entry. Unknown future strings must be returned unchanged.

### Steps

- [ ] Add `event-poster-assets-contract.test.ts`.

  The test must read `data.ts`, `event-poster-assets.ts`, and `tambike-screen.tsx`, then:

  - Extract every `poster: "/demo/...jpg"` value from event data.
  - Assert each path appears as a key in the resolver map.
  - Assert every referenced file exists under `public/demo`.
  - Assert the resolver ends with `return EVENT_POSTER_ASSETS[posterPath] ?? posterPath`.
  - Assert `EventCard` and `EventDetail` call `resolveEventPoster(event.poster)`.
  - Assert a conditional static-image blur placeholder is used.
  - Assert the detail image is preloaded but card images retain selective eager/lazy behavior.

  Core test:

  ```ts
  const posterPaths = [...data.matchAll(/poster:\s*"([^"]+\.jpg)"/g)]
    .map((match) => match[1]);

  expect(posterPaths.length).toBeGreaterThan(0);
  for (const posterPath of posterPaths) {
    expect(resolver).toContain(`"${posterPath}":`);
    expect(
      existsSync(join(process.cwd(), "public", posterPath.replace(/^\//, ""))),
    ).toBe(true);
  }
  expect(resolver).toContain(
    "return EVENT_POSTER_ASSETS[posterPath] ?? posterPath",
  );
  ```

- [ ] Run the new contract and confirm it fails because the resolver does not exist.

  ```powershell
  npx vitest run tests/server/event-poster-assets-contract.test.ts
  ```

- [ ] Create `event-poster-assets.ts` with static imports for every poster currently referenced by `data.ts`.

  Use this shape:

  ```ts
  import type { StaticImageData } from "next/image";
  import araiHjcCharityRide from "../../../public/demo/poster-arai-hjc-charity-ride.jpg";
  import boysGarageCrossmeet from "../../../public/demo/poster-boys-garage-crossmeet-tambike.jpg";
  import boysUnderboneLaguna from "../../../public/demo/poster-boys-underbone-laguna-tambike.jpg";
  import calabarzonEndurance from "../../../public/demo/poster-calabarzon-endurance-ride.jpg";
  import cafeClassico from "../../../public/demo/poster-tambike-cafe-classico.jpg";
  import ccphCebu from "../../../public/demo/poster-ccph-cebu-official-tambike.jpg";
  import ccphUpperEast from "../../../public/demo/poster-ccph-upper-east-tambike.jpg";
  import ducatiTrackDay from "../../../public/demo/poster-ducati-track-day.jpg";
  import fullprintManila from "../../../public/demo/poster-fullprint-manila-tambike.jpg";
  import irEnduranceRound3 from "../../../public/demo/poster-ir-endurance-rd3.jpg";
  import kapeMoToTagaytay from "../../../public/demo/poster-kape-mo-to-tagaytay-tambike.jpg";
  import lagunaMotofest from "../../../public/demo/poster-laguna-motofest-2026.jpg";
  import longRideCharity from "../../../public/demo/poster-long-ride-charity.jpg";
  import makinaMotoExpoCebu from "../../../public/demo/poster-makina-moto-expo-cebu.jpg";
  import mandirigmaEndutour from "../../../public/demo/poster-mandirigma-endutour-v5.jpg";
  import mindanaoMotocross from "../../../public/demo/poster-mindanao-wide-motocross-2026-2nd-leg.jpg";
  import motoirRound4 from "../../../public/demo/poster-motoir-round-4.jpg";
  import motoirRound5 from "../../../public/demo/poster-motoir-round-5.jpg";
  import motoirYouthCup from "../../../public/demo/poster-motoir-youth-cup-15-16.jpg";
  import ngoStreetDragFinal from "../../../public/demo/poster-ngo-street-drag-final.jpg";
  import petronSgpRound3 from "../../../public/demo/poster-petron-sgp-round-3.jpg";
  import swabzClassicBike from "../../../public/demo/poster-swabz-classic-bike-tambike.jpg";
  import tambikeNightMalabon from "../../../public/demo/poster-tambike-night-malabon.jpg";
  import ylocoBandits from "../../../public/demo/poster-yloco-bandits-classic-tambike.jpg";

  const EVENT_POSTER_ASSETS: Record<string, StaticImageData> = {
    "/demo/poster-arai-hjc-charity-ride.jpg": araiHjcCharityRide,
    "/demo/poster-boys-garage-crossmeet-tambike.jpg": boysGarageCrossmeet,
    "/demo/poster-boys-underbone-laguna-tambike.jpg": boysUnderboneLaguna,
    "/demo/poster-calabarzon-endurance-ride.jpg": calabarzonEndurance,
    "/demo/poster-tambike-cafe-classico.jpg": cafeClassico,
    "/demo/poster-ccph-cebu-official-tambike.jpg": ccphCebu,
    "/demo/poster-ccph-upper-east-tambike.jpg": ccphUpperEast,
    "/demo/poster-ducati-track-day.jpg": ducatiTrackDay,
    "/demo/poster-fullprint-manila-tambike.jpg": fullprintManila,
    "/demo/poster-ir-endurance-rd3.jpg": irEnduranceRound3,
    "/demo/poster-kape-mo-to-tagaytay-tambike.jpg": kapeMoToTagaytay,
    "/demo/poster-laguna-motofest-2026.jpg": lagunaMotofest,
    "/demo/poster-long-ride-charity.jpg": longRideCharity,
    "/demo/poster-makina-moto-expo-cebu.jpg": makinaMotoExpoCebu,
    "/demo/poster-mandirigma-endutour-v5.jpg": mandirigmaEndutour,
    "/demo/poster-mindanao-wide-motocross-2026-2nd-leg.jpg": mindanaoMotocross,
    "/demo/poster-motoir-round-4.jpg": motoirRound4,
    "/demo/poster-motoir-round-5.jpg": motoirRound5,
    "/demo/poster-motoir-youth-cup-15-16.jpg": motoirYouthCup,
    "/demo/poster-ngo-street-drag-final.jpg": ngoStreetDragFinal,
    "/demo/poster-petron-sgp-round-3.jpg": petronSgpRound3,
    "/demo/poster-swabz-classic-bike-tambike.jpg": swabzClassicBike,
    "/demo/poster-tambike-night-malabon.jpg": tambikeNightMalabon,
    "/demo/poster-yloco-bandits-classic-tambike.jpg": ylocoBandits,
  };

  export function resolveEventPoster(
    posterPath: string,
  ): string | StaticImageData {
    return EVENT_POSTER_ASSETS[posterPath] ?? posterPath;
  }
  ```

  Do not use a runtime dynamic import or filesystem lookup; Next needs compile-time imports to supply dimensions, hashes, and blur metadata.

- [ ] Update `EventCard` to resolve the poster once.

  ```tsx
  const poster = resolveEventPoster(event.poster);

  <Image
    src={poster}
    alt={`${event.title} poster`}
    fill
    placeholder={typeof poster === "string" ? "empty" : "blur"}
    loading={priority ? "eager" : "lazy"}
    fetchPriority={priority ? "high" : "auto"}
    sizes="(max-width: 560px) calc(100vw - 40px), 260px"
  />
  ```

- [ ] Add the same resolver import and local `poster` value to `EventDetail`. The detail markup itself is changed in Task 6.

- [ ] Rerun the poster contract.

  ```powershell
  npx vitest run tests/server/event-poster-assets-contract.test.ts
  ```

- [ ] Commit the asset resolver.

  ```powershell
  git add src/features/tambike-demo/event-poster-assets.ts src/features/tambike-demo/tambike-screen.tsx tests/server/event-poster-assets-contract.test.ts
  git commit -m "perf: statically resolve event posters"
  ```

---

## Task 6: Rebuild Event Detail as a Decision-First Page

**Files:**

- Create: `tests/server/event-detail-ui-contract.test.ts`
- Modify: `src/features/tambike-demo/tambike-screen.tsx:920-1117`
- Modify: `src/app/globals.css:3530-4135`
- Modify: `src/app/globals.css:5505-5570`
- Modify: `src/app/globals.css:5639-5645`

### Component Structure

`EventDetail` must render this semantic order:

1. Event type
2. `h1` title
3. Short description
4. Date, time, and location brief
5. Going, Interested, and Share actions
6. Compact poster and explicit full-poster link
7. What to expect
8. Conditional ride/meetup details
9. Venue and map
10. Perk and attendance counts
11. Rules
12. Organizer
13. Giveaways

The attendee-roster link remains in the perk/attendance section.

### Steps

- [ ] Create `event-detail-ui-contract.test.ts` with markup and style contracts.

  Assert:

  ```ts
  expect(screen).toContain('className="event-detail-brief"');
  expect(screen).toContain('className="event-detail-poster-link"');
  expect(screen).toContain('target="_blank"');
  expect(screen).toContain('rel="noreferrer"');
  expect(screen).toContain('placeholder={typeof poster === "string" ? "empty" : "blur"}');
  expect(screen).toContain('sizes="(max-width: 640px) 280px, (max-width: 1024px) 34vw, 360px"');
  expect(screen).toContain("preload");
  expect(screen).toContain("View full poster");
  expect(screen).not.toContain("event-detail-poster-stack");
  expect(screen).not.toContain("event-detail-route-line");
  ```

  Assert CSS includes:

  ```ts
  expect(css).toMatch(/\.event-detail-stage\s*\{[\s\S]*grid-template-areas:/);
  expect(css).toMatch(/\.event-detail-poster\s*\{[\s\S]*aspect-ratio:\s*1/);
  expect(css).toMatch(/\.event-detail-poster img\s*\{[\s\S]*object-fit:\s*contain/);
  expect(css).toMatch(/\.event-detail-copy h1\s*\{[\s\S]*clamp\(2rem,/);
  expect(css).toContain("max-width: 280px");
  expect(css).toContain("min-height: 44px");
  ```

  Also compare source indexes to prove the brief appears before actions and location/perk appear before rules/organizer.

- [ ] Run the new contract and confirm it fails against the poster-led page.

  ```powershell
  npx vitest run tests/server/event-detail-ui-contract.test.ts
  ```

- [ ] Rewrite the `EventDetail` header so copy comes first in DOM order and CSS controls the desktop columns.

  Use this structure:

  ```tsx
  <section className="event-detail-stage">
    <div className="event-detail-copy">
      <span className="event-detail-type">{event.type}</span>
      <h1>{event.title}</h1>
      <p>{event.shortDescription}</p>

      <div className="event-detail-brief" aria-label="Event schedule and location">
        <Detail label="Date" value={event.date} />
        <Detail label="Time" value={event.time} />
        <Detail label="Location" value={event.locationName} />
      </div>

      <div className="event-detail-actions">
        {cta.canRegister ? (
          <>
            <button className="primary-action" type="button" onClick={openRegistration}>
              Going
            </button>
            <button
              className="ghost-action"
              type="button"
              onClick={async () => {
                setActionError("");
                if (requireLogin("Log in to save this event")) {
                  try {
                    await registerForEvent(event.id, "direct", "interested");
                  } catch (error) {
                    setActionError(actionErrorMessage(error));
                  }
                }
              }}
            >
              Interested
            </button>
          </>
        ) : (
          <span className="status-pill">{cta.label}</span>
        )}
        <button className="ghost-action" type="button" onClick={() => void shareEvent()}>
          <Share2 aria-hidden="true" />
          Share
        </button>
      </div>
      {shareFeedback ? (
        <p className="inline-feedback" aria-live="polite">{shareFeedback}</p>
      ) : null}
      {actionError ? (
        <p className="inline-error" aria-live="polite">{actionError}</p>
      ) : null}
    </div>

    <div className="event-detail-poster-wrap">
      <figure className="event-detail-poster">
        <Image
          src={poster}
          alt={`${event.title} poster`}
          fill
          placeholder={typeof poster === "string" ? "empty" : "blur"}
          sizes="(max-width: 640px) 280px, (max-width: 1024px) 34vw, 360px"
          preload
        />
      </figure>
      <a
        className="event-detail-poster-link"
        href={event.poster}
        target="_blank"
        rel="noreferrer"
      >
        View full poster <span className="sr-only">(opens in a new tab)</span>
      </a>
    </div>
  </section>
  ```

  Render feedback directly after the action group so `aria-live` behavior remains unchanged.

- [ ] Replace the current main/aside information layout with the approved order.

  Preserve existing data and behavior using:

  ```tsx
  <div className="event-detail-sections">
    <InfoPanel eyebrow="What to expect" title="A relaxed rider meetup">
      <p>{event.whatHappens}</p>
    </InfoPanel>

    {event.rideOut ? (
      <InfoPanel eyebrow="Ride / meetup" title={event.rideOut.meetup}>
        <div className="detail-grid">
          <Detail label="Call time" value={event.rideOut.callTime} />
          <Detail label="Departure" value={event.rideOut.departure} />
          <Detail label="Destination" value={event.rideOut.destination} />
          <Detail label="Note" value={event.rideOut.notes} />
        </div>
      </InfoPanel>
    ) : null}

    <div className="event-detail-essentials">
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

    <InfoPanel eyebrow="Rules" title="Safety and venue notes">
      <div className="chip-list">
        {event.rules.map((rule) => (
          <span key={rule}>{rule}</span>
        ))}
      </div>
    </InfoPanel>

    <InfoPanel eyebrow="Organizer" title={organizer.displayName}>
      <p>
        Verified organizer · {organizer.pastEvents} previous events · {organizer.fbLink}
      </p>
    </InfoPanel>

    <PublicGiveawayPanel
      eventId={event.id}
      viewerRole={currentUser?.role ?? "guest"}
    />
  </div>
  ```

  Remove the event-detail tag strip from this page so “What to expect” is the first explanatory section. Event tags remain in event data for other surfaces.

- [ ] Replace obsolete event-detail CSS with a compact responsive system.

  Desktop foundation:

  ```css
  .event-detail-stage {
    display: grid;
    grid-template-areas: "poster copy";
    grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
    align-items: center;
    gap: clamp(2rem, 5vw, 5rem);
  }

  .event-detail-copy {
    grid-area: copy;
    min-width: 0;
  }

  .event-detail-poster-wrap {
    grid-area: poster;
    width: min(100%, 360px);
  }

  .event-detail-poster {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--event-accent) 28%, transparent);
    border-radius: 1.25rem;
    background: #120f10;
  }

  .event-detail-poster img {
    object-fit: contain;
  }

  .event-detail-copy h1 {
    max-width: 18ch;
    margin: 0;
    font-size: clamp(2rem, 5vw, 3.5rem);
    line-height: 1.05;
    letter-spacing: -0.035em;
    text-transform: none;
  }

  .event-detail-actions button,
  .event-detail-actions a,
  .event-detail-map-link,
  .event-detail-poster-link {
    min-height: 44px;
  }
  ```

  Mobile foundation:

  ```css
  @media (max-width: 640px) {
    .event-detail-stage {
      grid-template-areas:
        "copy"
        "poster";
      grid-template-columns: minmax(0, 1fr);
      gap: 1.5rem;
    }

    .event-detail-poster-wrap {
      width: 100%;
      max-width: 280px;
      margin-inline: auto;
    }

    .event-detail-brief {
      grid-template-columns: 1fr;
    }
  }
  ```

  Remove the rotated poster pseudo-element, route line, forced portrait ratio, oversized uppercase title rules, and duplicate later overrides. Retain sufficient burgundy/amber identity through borders, labels, and primary actions.

- [ ] Rerun the event-detail contract.

  ```powershell
  npx vitest run tests/server/event-detail-ui-contract.test.ts
  ```

- [ ] Run focused UI contracts together to catch accidental reintroduction.

  ```powershell
  npx vitest run tests/server/event-detail-ui-contract.test.ts tests/server/event-poster-assets-contract.test.ts tests/server/event-roster-ui-contract.test.ts tests/server/member-profile-ui-contract.test.ts
  ```

- [ ] Commit the responsive event detail rebuild.

  ```powershell
  git add src/features/tambike-demo/tambike-screen.tsx src/app/globals.css tests/server/event-detail-ui-contract.test.ts
  git commit -m "feat: make event details decision first"
  ```

---

## Task 7: Run the Complete Automated Regression Gate

**Files:**

- Modify only if a regression reveals a directly related defect.

### Steps

- [ ] Run the complete server suite.

  ```powershell
  npm run test:server
  ```

  Expected: all server tests pass.

- [ ] Run the complete Prisma integration suite.

  ```powershell
  npm run test:prisma
  ```

  Expected: all Prisma integrations pass. If the configured test database is unavailable, record the exact infrastructure error; do not report the integration as passed.

- [ ] Run lint.

  ```powershell
  npm run lint
  ```

  Expected: exit code `0`.

- [ ] Run the production build.

  ```powershell
  npm run build
  ```

  Expected: Next.js 16.2.9 production build completes with no type or route errors.

- [ ] Check whitespace and stale symbols.

  ```powershell
  git diff --check
  rg -n "ExistingRsvpIdentity|RosterIdentityField|registrationRosterIdentity|updateEventRosterIdentity|getEventRosterIdentity|Change for this event|Existing RSVPs keep their own choice" src tests
  ```

  Expected: `git diff --check` succeeds and `rg` returns no matches.

- [ ] Review the diff for scope.

  ```powershell
  git status --short
  git diff --stat main...HEAD
  git diff main...HEAD -- src tests
  ```

  Confirm no schema migration, AWS resource, CloudFront configuration, global image TTL, attendee access rule, giveaway, pass, or check-in logic was changed.

---

## Task 8: Verify the User Experience with the Codex Browser

**Files:**

- No planned source changes.

### Steps

- [ ] Check whether Tambike is already listening locally before starting a server.

  ```powershell
  netstat -ano -p tcp | Select-String -Pattern ":3000|:3001|:3002"
  ```

  Reuse an existing verified Tambike process. If none exists, start `npm run dev` from this checkout and keep its session available for logs.

- [ ] Use the Codex browser to open:

  ```text
  http://localhost:<verified-port>/events/tambike-cafe-classico
  ```

- [ ] At 390 × 844, verify:

  - Event type, title, short description, date, time, location, and Going action are visible before or near the first scroll boundary.
  - The poster is square, uncropped, centered, and no wider than about 280 pixels.
  - There is no horizontal overflow.
  - `Event roster`, `Profile default`, and `Change for this event` do not appear.
  - “View full poster” opens the original path in a new tab.
  - Going opens a modal containing arrival choices but no privacy choice.
  - Interested, Share, attendee link, map, and giveaway surfaces retain their behavior.

- [ ] Repeat responsive checks at widths 360, 768, 1024, and 1440. At desktop widths, confirm the poster is 280–360 pixels and balanced against the wider information column.

- [ ] Open `/profile#attendance-privacy` while authenticated and verify:

  - The copy says the setting applies to all current and future event rosters.
  - Both Anonymous and Visible choices remain available.
  - Saving retains the existing pending/success/error feedback.
  - Changing to Anonymous removes the rider card from an existing enabled roster while preserving the anonymous count.
  - Changing back to Visible restores the eligible published rider card.

- [ ] Inspect the poster element and network response in the Codex browser.

  Record:

  - `currentSrc` uses the Next image route with an appropriate selected width.
  - The rendered image uses a square box and `object-fit: contain`.
  - The static-import blur placeholder does not cause layout shift.
  - The repeat request is cached.
  - No second full-size poster request occurs until “View full poster” is activated.
  - There are no new console errors.

- [ ] If the branch is later deployed by explicit request, repeat this browser matrix on `https://tambike.bayanko.ph/events/tambike-cafe-classico` and capture production response/cache evidence. Do not claim production completion from local or build proof alone.

---

## Task 9: Final Review and Handoff

**Files:**

- No planned source changes.

### Steps

- [ ] Run final repository checks:

  ```powershell
  git status --short --branch
  git log --oneline --decorate -8
  git diff --check main...HEAD
  ```

- [ ] Confirm every acceptance criterion from `docs/superpowers/specs/2026-07-24-event-detail-readability-design.md` has automated, browser, or explicitly deferred production evidence.

- [ ] Report:

  - The event-page readability and responsive outcome.
  - The exact roster privacy behavior now enforced.
  - The image delivery path used and why CloudFront was not added.
  - Test, lint, build, Prisma, and browser results with any genuine blockers.
  - That production deployment remains pending unless separately requested.
