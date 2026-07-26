# Public Event Attendee Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show up to four privacy-eligible public Going riders to every event-page visitor and replace failed portrait images with stable initial avatars.

**Architecture:** Add a dedicated public attendee-preview operation to both backend implementations instead of weakening the protected roster operation. The event loader consumes that operation without session branching, and the existing preview component renders its safe DTO with image-error fallback while the full roster remains login-aware.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript, Prisma, Vitest, CSS Modules.

## Global Constraints

- Work directly on the existing `main` checkout because this repository forbids AI/Codex branches and worktrees and the user explicitly authorized subagent execution.
- Before editing Next.js or React code, read `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` and `node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md` completely.
- Use test-driven development: add the focused failing test, observe the expected failure, then write the minimum production change.
- The public preview contains at most four riders and only when the roster is enabled, RSVP is Going, roster identity is `VISIBLE`, the profile has a published slug, and profile visibility is `PUBLIC`.
- `MEMBERS_ONLY`, `PRIVATE`, anonymous, unpublished, and non-Going identities must not enter the public preview.
- Public DTO fields are limited to `slug`, `displayName`, `area`, and optional same-origin `profilePhotoUrl`; never expose email, verification state, internal IDs, RSVP IDs, or storage keys.
- The full attendee roster remains login-aware and its authorization semantics must not change.
- Preview errors remain non-fatal; `NOT_FOUND` must retain the route boundary behavior.
- Missing and failed portrait URLs render an initial inside the existing 52-pixel circle; no broken-image icon or long comma-separated name paragraph remains.
- Browser verification may use only the Codex browser surface. Never use Playwright or another browser driver.
- Do not add dependencies, schema migrations, media/CDN configuration, or unrelated refactors.
- Do not push or deploy unless the user separately authorizes it.

---

### Task 1: Public attendee-preview backend contract

**Files:**
- Modify: `src/features/member-profiles/types.ts`
- Modify: `src/server/member-profiles/roster-domain.ts`
- Modify: `src/server/backend.ts`
- Modify: `src/server/prisma-backend.ts`
- Modify: `src/server/actions.ts`
- Create: `tests/server/event-attendee-public-preview-domain.test.ts`
- Create: `tests/server/event-attendee-public-preview-contract.test.ts`

**Interfaces:**
- Produces: `PUBLIC_ATTENDEE_PREVIEW_LIMIT = 4`
- Produces: `EventAttendeePublicPreview`
- Produces: `TambikeBackend#getPublicEventAttendeePreview(eventId: string): Promise<EventAttendeePublicPreview>`
- Produces: `PrismaTambikeBackend#getPublicEventAttendeePreview(eventId: string): Promise<EventAttendeePublicPreview>`
- Produces: `getPublicEventAttendeePreviewAction(eventId: string): Promise<EventAttendeePublicPreview>`

- [ ] **Step 1: Add failing behavioral tests for the public privacy boundary**

Create `tests/server/event-attendee-public-preview-domain.test.ts` with a
future-dated event so the test never depends on today’s registration state:

```ts
test("returns only public visible Going riders in the anonymous preview", async () => {
  const backend = await createTambikeTestBackend();
  const actors = await createTestActors(backend, "public-preview");
  const event = await createPublishedTestEvent(backend, actors, {
    date: "Fri · December 31, 2099",
  });
  await backend.configureEventRoster(actors.organizer.sessionToken, event.id, {
    enabled: true,
  });

  await backend.updateMemberProfile(actors.rider.sessionToken, {
    ...visibleProfile,
    displayName: "Public Rider",
    visibility: "PUBLIC",
  });
  await backend.registerForEvent(actors.rider.sessionToken, event.id, {
    status: "going",
    attendanceType: "direct",
  });

  await backend.updateMemberProfile(actors.outsider.sessionToken, {
    ...visibleProfile,
    displayName: "Members Rider",
    visibility: "MEMBERS_ONLY",
  });
  await backend.registerForEvent(actors.outsider.sessionToken, event.id, {
    status: "going",
    attendanceType: "direct",
  });

  const preview = await backend.getPublicEventAttendeePreview(event.id);

  expect(preview.summary).toMatchObject({
    rosterEnabled: true,
    goingCount: 2,
  });
  expect(preview.attendees).toEqual([
    expect.objectContaining({
      slug: "public-rider",
      displayName: "Public Rider",
    }),
  ]);
  expect(JSON.stringify(preview)).not.toMatch(
    /Members Rider|email|userId|rsvpId|verification|storageKey|motorcycle/i,
  );
});
```

Add a disabled-roster assertion in the same test:

```ts
await backend.configureEventRoster(actors.organizer.sessionToken, event.id, {
  enabled: false,
});
await expect(
  backend.getPublicEventAttendeePreview(event.id),
).resolves.toMatchObject({
  summary: { rosterEnabled: false, goingCount: 2 },
  attendees: [],
});
```

Add a second test that registers five public riders against a
`"Fri · December 31, 2099"` event:

```ts
for (let index = 0; index < 5; index += 1) {
  const rider = await backend.signUpRider({
    displayName: `Public Preview Rider ${index}`,
    email: `public-preview-${index}@example.test`,
    password: "password123",
    area: "Manila",
  });
  await backend.updateMemberProfile(rider.sessionToken, {
    ...visibleProfile,
    displayName: `Public Preview Rider ${index}`,
    visibility: "PUBLIC",
  });
  await backend.registerForEvent(rider.sessionToken, event.id, {
    status: "going",
    attendanceType: "direct",
  });
}

const preview = await backend.getPublicEventAttendeePreview(event.id);
expect(preview.attendees).toHaveLength(4);
expect(preview.attendees.map(({ displayName }) => displayName)).toEqual([
  "Public Preview Rider 0",
  "Public Preview Rider 1",
  "Public Preview Rider 2",
  "Public Preview Rider 3",
]);
```

The first test’s members-only rider proves one public exclusion. Add this
test-local helper and the remaining exclusions:

```ts
async function addPreviewCandidate(input: {
  backend: Awaited<ReturnType<typeof createTambikeTestBackend>>;
  eventId: string;
  label: string;
  visibility?: "PUBLIC" | "MEMBERS_ONLY" | "PRIVATE";
  identity?: "VISIBLE" | "ANONYMOUS";
  status?: "going" | "interested";
  publish?: boolean;
}) {
  const rider = await input.backend.signUpRider({
    displayName: input.label,
    email: `${input.label.toLowerCase().replace(/\s+/g, "-")}@example.test`,
    password: "password123",
    area: "Manila",
  });
  if (input.publish !== false) {
    await input.backend.updateMemberProfile(rider.sessionToken, {
      ...visibleProfile,
      displayName: input.label,
      visibility: input.visibility ?? "PUBLIC",
      defaultRosterIdentity: input.identity ?? "VISIBLE",
    });
  }
  await input.backend.registerForEvent(rider.sessionToken, input.eventId, {
    status: input.status ?? "going",
    attendanceType: "direct",
  });
}

await addPreviewCandidate({
  backend,
  eventId: event.id,
  label: "Anonymous Going",
  identity: "ANONYMOUS",
});
await addPreviewCandidate({
  backend,
  eventId: event.id,
  label: "Private Going",
  visibility: "PRIVATE",
});
await addPreviewCandidate({
  backend,
  eventId: event.id,
  label: "Unpublished Going",
  publish: false,
});
await addPreviewCandidate({
  backend,
  eventId: event.id,
  label: "Public Interested",
  status: "interested",
});

expect(JSON.stringify(preview.attendees)).not.toMatch(
  /Anonymous Going|Private Going|Unpublished Going|Public Interested/,
);
```

- [ ] **Step 2: Add a failing source contract for the Prisma and action paths**

Create `tests/server/event-attendee-public-preview-contract.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();
const read = (file: string) =>
  fs.readFileSync(path.join(root, file), "utf8");

describe("public attendee preview source contract", () => {
  test("keeps public preview separate from the protected roster", () => {
    const actions = read("src/server/actions.ts");
    const memory = read("src/server/backend.ts");
    const prisma = read("src/server/prisma-backend.ts");

    expect(actions).toContain("getPublicEventAttendeePreviewAction");
    expect(actions).toContain("backend.getPublicEventAttendeePreview(eventId)");
    expect(memory).toContain("getPublicEventAttendeePreview(");
    expect(prisma).toContain("getPublicEventAttendeePreview(");
    expect(prisma).toContain('profileVisibility: "PUBLIC"');
    expect(prisma).toContain('defaultRosterIdentity: "VISIBLE"');
    expect(prisma).toContain('status: "going"');
    expect(actions).not.toMatch(
      /getPublicEventAttendeePreviewAction[\s\S]{0,300}readRequiredSessionToken/,
    );
  });
});
```

- [ ] **Step 3: Run the two focused files and verify RED**

Run:

```powershell
npx vitest run tests/server/event-attendee-public-preview-domain.test.ts tests/server/event-attendee-public-preview-contract.test.ts
```

Expected: FAIL because `getPublicEventAttendeePreview` and
`getPublicEventAttendeePreviewAction` do not exist.

- [ ] **Step 4: Add the public DTO and fixed limit**

In `src/features/member-profiles/types.ts` add:

```ts
export interface EventAttendeePublicPreview {
  summary: EventAttendeeSummary;
  attendees: EventAttendeePreviewRider[];
}
```

In `src/server/member-profiles/roster-domain.ts` add:

```ts
export const PUBLIC_ATTENDEE_PREVIEW_LIMIT = 4;
```

- [ ] **Step 5: Implement the in-memory public selection**

In `TambikeBackend`, add:

```ts
async getPublicEventAttendeePreview(
  eventId: string,
): Promise<EventAttendeePublicPreview> {
  const event = this.requireEvent(eventId);
  const enabled = this.rosterSettings.get(event.id) ?? false;
  const summary = this.buildMemoryRosterSummary(event, enabled);
  if (!enabled) return { summary, attendees: [] };

  const attendees = Array.from(this.rsvps.values())
    .filter(
      (rsvp) =>
        rsvp.eventId === event.id &&
        rsvp.status === "going" &&
        Boolean(rsvp.goingAt),
    )
    .map((rsvp) => ({ rsvp, user: this.users.get(rsvp.userId) }))
    .filter(
      (entry): entry is typeof entry & { user: BackendUser } =>
        Boolean(
          entry.user &&
            entry.user.defaultRosterIdentity === "VISIBLE" &&
            entry.user.profileSlug &&
            entry.user.profileVisibility === "PUBLIC",
        ),
    )
    .sort(
      (left, right) =>
        left.rsvp.goingAt!.localeCompare(right.rsvp.goingAt!) ||
        compareRosterRsvpIds(
          left.rsvp.id ?? `${left.rsvp.eventId}:${left.rsvp.userId}`,
          right.rsvp.id ?? `${right.rsvp.eventId}:${right.rsvp.userId}`,
        ),
    )
    .slice(0, PUBLIC_ATTENDEE_PREVIEW_LIMIT)
    .map(({ user }) => {
      const profile = this.toMemberProfileView(user);
      return {
        slug: profile.slug,
        displayName: profile.displayName,
        area: profile.area,
        profilePhotoUrl: profile.profilePhotoUrl,
      };
    });

  return { summary, attendees };
}
```

Import the new type, constant, and existing RSVP-id comparator through the
same modules already used by the protected roster.

- [ ] **Step 6: Implement the Prisma public selection**

In `PrismaTambikeBackend`, resolve the roster event and summary exactly as the
protected roster does, but do not read or require a session:

```ts
async getPublicEventAttendeePreview(
  eventId: string,
): Promise<EventAttendeePublicPreview> {
  const event = await this.requireRosterEvent(eventId);
  const enabled = event.rosterSettings?.enabled ?? false;
  const summary = await this.buildPrismaRosterSummary(
    event.id,
    event.title,
    enabled,
  );
  if (!enabled) return { summary, attendees: [] };

  const rows = await this.prisma.rSVP.findMany({
    where: {
      eventId,
      status: "going",
      goingAt: { not: null },
      user: {
        defaultRosterIdentity: "VISIBLE",
        profileSlug: { not: null },
        profileVisibility: "PUBLIC",
      },
    },
    orderBy: [{ goingAt: "asc" }, { id: "asc" }],
    take: PUBLIC_ATTENDEE_PREVIEW_LIMIT,
    select: {
      user: {
        include: {
          motorcycle: {
            include: { photos: { orderBy: { position: "asc" } } },
          },
        },
      },
    },
  });

  const attendees = await Promise.all(
    rows.map(async ({ user }) => {
      const profile = await this.sanitizeMemberProfile(user);
      return {
        slug: profile.slug,
        displayName: profile.displayName,
        area: profile.area,
        profilePhotoUrl: profile.profilePhotoUrl,
      };
    }),
  );
  return { summary, attendees };
}
```

- [ ] **Step 7: Expose the session-free action**

In `src/server/actions.ts` add:

```ts
export async function getPublicEventAttendeePreviewAction(eventId: string) {
  const backend = await getTambikeBackend();
  return backend.getPublicEventAttendeePreview(eventId);
}
```

Do not call `readSessionToken` or `readRequiredSessionToken` in this action.

- [ ] **Step 8: Run focused tests and commit**

Run:

```powershell
npx vitest run tests/server/event-attendee-public-preview-domain.test.ts tests/server/event-attendee-public-preview-contract.test.ts
git diff --check
```

Expected: both files pass and the diff check is clean.

Commit:

```powershell
git add src/features/member-profiles/types.ts src/server/member-profiles/roster-domain.ts src/server/backend.ts src/server/prisma-backend.ts src/server/actions.ts tests/server/event-attendee-public-preview-domain.test.ts tests/server/event-attendee-public-preview-contract.test.ts
git commit -m "feat: expose safe public attendee previews"
```

---

### Task 2: Public event loader and resilient facepile

**Files:**
- Modify: `src/features/member-profiles/types.ts`
- Modify: `src/app/events/[eventId]/load-event-attendee-preview.ts`
- Modify: `src/features/member-profiles/event-attendee-preview.tsx`
- Modify: `src/features/member-profiles/event-attendee-preview.module.css`
- Modify: `tests/server/event-attendee-preview-loader.test.ts`
- Modify: `tests/server/event-attendee-preview-ui.test.tsx`
- Modify: `tests/server/event-detail-ui-contract.test.ts`

**Interfaces:**
- Consumes: `getPublicEventAttendeePreviewAction(eventId)`
- Consumes: `EventAttendeePublicPreview`
- Produces: `EventAttendeePreviewData` with `{ summary, attendees, unavailable }` and no session flag
- Preserves: `EventAttendeePreview` props and live `fallbackGoing` synchronization

- [ ] **Step 1: Rewrite loader tests for a session-free preview**

Replace the member/guest branches in
`tests/server/event-attendee-preview-loader.test.ts` with a single public
operation dependency:

```ts
test("returns four public preview riders without session state", async () => {
  const calls: string[] = [];
  const result = await loadEventAttendeePreview(
    "ride-1",
    async (eventId) => {
      calls.push(eventId);
      return {
        summary,
        attendees: rosterPage.attendees.slice(0, 4).map(
          ({ slug, displayName, area, profilePhotoUrl }) => ({
            slug,
            displayName,
            area,
            profilePhotoUrl,
          }),
        ),
      };
    },
    () => {
      throw new Error("unexpected not-found");
    },
  );

  expect(calls).toEqual(["ride-1"]);
  expect(result).toMatchObject({
    summary,
    unavailable: false,
    attendees: [{ slug: "rider-1" }],
  });
  expect(JSON.stringify(result)).not.toMatch(
    /signedIn|motorcycle|email|userId|verification|storageKey/i,
  );
});
```

Retain explicit tests for `NOT_FOUND` mapping and generic-error fallback:

```ts
expect(result).toEqual({
  summary: null,
  attendees: [],
  unavailable: true,
});
```

- [ ] **Step 2: Add failing UI tests for public riders and image failure**

Update `memberPreview` to remove `signedIn`. Replace the guest-login test with:

```ts
test("shows public rider links without a login gate or long name list", () => {
  const markup = render(memberPreview);
  expect(markup).toContain('href="/riders/mika-santos"');
  expect(markup).toContain('href="/riders/paolo-reyes"');
  expect(markup).toContain("See who’s going");
  expect(markup).not.toContain("Log in to see riders");
  expect(markup).not.toContain("Mika Santos, Paolo Reyes");
});
```

Add a jsdom image-error test:

```ts
test("replaces a failed portrait with the rider initial", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        createElement(EventAttendeePreview, {
          eventId: "ride-1",
          fallbackGoing: 15,
          interested: 15,
          expected: 55,
          preview: memberPreview,
        }),
      );
    });
    const image = container.querySelector('img[src="/media/mika"]');
    expect(image).not.toBeNull();

    await act(async () => {
      image!.dispatchEvent(new Event("error"));
    });

    const mikaLink = container.querySelector(
      'a[href="/riders/mika-santos"]',
    );
    expect(mikaLink?.querySelector("img")).toBeNull();
    expect(mikaLink?.textContent).toBe("M");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
```

Add an assertion that a rider without `profilePhotoUrl` renders its initial
from the first non-whitespace display-name character.

- [ ] **Step 3: Run loader and UI tests and verify RED**

Run:

```powershell
npx vitest run tests/server/event-attendee-preview-loader.test.ts tests/server/event-attendee-preview-ui.test.tsx
```

Expected: FAIL because the loader still branches on authentication, the
component still checks `signedIn`, the visible names remain, and portrait
errors do not switch to initials.

- [ ] **Step 4: Simplify the preview data type and loader**

Change `EventAttendeePreviewData` to:

```ts
export interface EventAttendeePreviewData {
  summary: EventAttendeeSummary | null;
  attendees: EventAttendeePreviewRider[];
  unavailable: boolean;
}
```

Replace the loader dependencies and body with:

```ts
export async function loadEventAttendeePreview(
  eventId: string,
  getPublicPreview: typeof getPublicEventAttendeePreviewAction =
    getPublicEventAttendeePreviewAction,
  showNotFound: () => never = () => notFound(),
): Promise<EventAttendeePreviewData> {
  try {
    const preview = await getPublicPreview(eventId);
    return { ...preview, unavailable: false };
  } catch (error) {
    if (error instanceof BackendError && error.code === "NOT_FOUND") {
      return showNotFound();
    }
    return { summary: null, attendees: [], unavailable: true };
  }
}
```

Remove imports and code paths for the protected roster action, public-summary
fallback, and `signedIn`.

- [ ] **Step 5: Render public portraits with per-image fallback**

Keep the existing turnout-count synchronization. Replace session-derived
visibility with:

```ts
const rosterEnabled = preview?.summary?.rosterEnabled !== false;
const riders = rosterEnabled ? preview?.attendees.slice(0, 4) ?? [] : [];
const canOpenRoster = rosterEnabled;
const [failedPhotos, setFailedPhotos] = useState<Set<string>>(
  () => new Set(),
);
```

Inside each rider link:

```tsx
const photoFailed = failedPhotos.has(rider.slug);
const initial = rider.displayName.trim().charAt(0).toUpperCase() || "R";

{rider.profilePhotoUrl && !photoFailed ? (
  <Image
    src={rider.profilePhotoUrl}
    alt=""
    width={52}
    height={52}
    sizes="52px"
    unoptimized
    onError={() => {
      setFailedPhotos((current) => {
        const next = new Set(current);
        next.add(rider.slug);
        return next;
      });
    }}
  />
) : (
  <span aria-hidden="true">{initial}</span>
)}
```

Retain each link’s `aria-label`. Remove the `.names` paragraph and all
`guestCanLogIn`, `memberCanBrowse`, and “Log in to see riders” branches.
Render “See who’s going” whenever `canOpenRoster` is true, including outage
fallback where `summary` is `null`.

- [ ] **Step 6: Tighten the layout contract**

Remove `.names` from the shared typography rule and delete its standalone
style. Keep `.riderSummary` as a compact single-row container at mobile sizes;
remove the mobile `flex-direction: column` override. Add:

```css
.riderSummary {
  min-height: 52px;
}

@media (max-width: 430px) {
  .facepile {
    max-width: 100%;
  }
}
```

Update `tests/server/event-detail-ui-contract.test.ts` to assert the obsolete
names paragraph and guest login copy are absent while the facepile and roster
action remain.

- [ ] **Step 7: Run focused tests and commit**

Run:

```powershell
npx vitest run tests/server/event-attendee-preview-loader.test.ts tests/server/event-attendee-preview-ui.test.tsx tests/server/event-detail-ui-contract.test.ts tests/server/event-roster-ui-contract.test.ts tests/server/account-role-location-ui-contract.test.ts tests/server/event-attendee-public-preview-contract.test.ts
git diff --check
```

Expected: all focused files pass and the diff check is clean.

Commit:

```powershell
git add src/features/member-profiles/types.ts src/app/events/[eventId]/load-event-attendee-preview.ts src/features/member-profiles/event-attendee-preview.tsx src/features/member-profiles/event-attendee-preview.module.css tests/server/event-attendee-preview-loader.test.ts tests/server/event-attendee-preview-ui.test.tsx tests/server/event-detail-ui-contract.test.ts
git commit -m "fix: show resilient public rider previews"
```

---

### Task 3: End-to-end privacy and media verification

**Files:**
- Do not modify production or test files in this verification task
- Test: focused preview, roster, media, and event-page suites
- Evidence: `.superpowers/sdd/2026-07-27-public-event-attendee-preview/task-3-report.md`

**Interfaces:**
- Consumes: public event route `/events/tambike-cafe-classico`
- Consumes: same-origin preview media URLs `/media/<mediaId>`
- Produces: verification evidence; no production interface

- [ ] **Step 1: Check for and reuse an existing dev server**

Run:

```powershell
netstat -ano -p tcp | Select-String ':3000\s|:3001\s|:3002\s|:3003\s'
```

If port 3000 is already served by this checkout, reuse it. Otherwise run
`npm run dev` from this checkout and record the chosen port.

- [ ] **Step 2: Run fresh automated gates**

Run:

```powershell
npx vitest run tests/server/event-attendee-preview-loader.test.ts tests/server/event-attendee-preview-ui.test.tsx tests/server/event-attendee-public-preview-contract.test.ts tests/server/event-detail-ui-contract.test.ts tests/server/event-roster-domain.test.ts tests/server/event-roster-ui-contract.test.ts tests/server/member-media-route-contract.test.ts
npm run lint
npm run build
npm run test:server
git diff --check
git status --short
```

Report exact counts. Keep the known future/expired fixture failures separate
from feature-caused failures; do not label a new preview/media failure as
baseline.

- [ ] **Step 3: Verify guest HTML and privacy**

Request the event without cookies:

```powershell
$eventUrl = 'http://localhost:3000/events/tambike-cafe-classico'
$eventResponse = Invoke-WebRequest -Uri $eventUrl -UseBasicParsing
$eventResponse.StatusCode
$eventResponse.Content | Select-String 'Who’s going|See who’s going|Log in to see riders'
```

Expected:

- HTTP `200`;
- public rider profile links appear when eligible profiles exist;
- “Log in to see riders” is absent;
- no email, internal ID, verification state, storage key, member-only rider,
  private rider, or anonymous rider identity appears.

- [ ] **Step 4: Verify every public portrait through its final response**

Extract unique same-origin media paths from the guest HTML and request each:

```powershell
$mediaPaths = [regex]::Matches(
  $eventResponse.Content,
  '/media/[^"'']+'
) | ForEach-Object Value | Sort-Object -Unique

foreach ($mediaPath in $mediaPaths) {
  $direct = Invoke-WebRequest `
    -Uri ("http://localhost:3000" + $mediaPath) `
    -MaximumRedirection 0 `
    -SkipHttpErrorCheck
  $location = $direct.Headers.Location
  if ($direct.StatusCode -eq 307 -and $location) {
    $final = Invoke-WebRequest -Uri $location -SkipHttpErrorCheck
    [pscustomobject]@{
      Path = $mediaPath
      AppStatus = $direct.StatusCode
      FinalStatus = $final.StatusCode
      ContentType = $final.Headers.'Content-Type'
    }
  } else {
    [pscustomobject]@{
      Path = $mediaPath
      AppStatus = $direct.StatusCode
      FinalStatus = $direct.StatusCode
      ContentType = $direct.Headers.'Content-Type'
    }
  }
}
```

Expected for every portrait: app `200 image/webp`, or app `307` followed by
final `200 image/webp`.

If any path returns `404`, gather the media ID, backend mode, route response,
and authorization result. Report `BLOCKED` when the evidence identifies an
implementation defect so the controller can route a reviewed fix. If the
record/object is absent from the local environment, document that
environmental data issue and retain the tested initial fallback.

- [ ] **Step 5: Perform the required Codex browser check**

Read and follow the full
`browser:control-in-app-browser` skill before browser actions. Using only the
Codex browser:

- open the guest event page at 390 by 844;
- confirm up to four portraits or initials appear without login;
- confirm no broken-image icon or long name paragraph appears;
- confirm no horizontal overflow;
- activate each visible public profile link and the full-roster action;
- repeat the layout check at desktop width;
- inspect current-page console errors.

If the Codex browser runtime is unavailable, record the exact blocker and do
not substitute Playwright.

- [ ] **Step 6: Write the verification report**

Create no commit in this task. The Task 3 report must contain every command,
exact test counts and failures, guest privacy evidence, one result row per
media path, browser evidence or blocker, and final Git state. Return `DONE`
only when no feature-caused defect remains; otherwise return `BLOCKED` with
the evidence needed for a scoped fix.
