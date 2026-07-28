# Per-Event RSVP Roster Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let riders choose per event whether their eligible name and motorcycle appear in “Who’s going,” with Sample Rider defaulting to visible and opted-in riders filling the public preview slots.

**Architecture:** Use the existing `RSVP.rosterIdentity` column as the event-specific source of truth. Extend registration and a narrow current-rider read action, make both backends classify rosters from the RSVP value, and add a checkbox to the existing Going modal without changing the database schema or public attendee DTO.

**Tech Stack:** Next.js 16.2.11 App Router and Server Actions, React 19.2.4, TypeScript, Prisma/PostgreSQL, in-memory backend, Vitest, Codex Browser.

## Global Constraints

- Work directly in the current checkout; do not create a branch or worktree.
- Preserve all unrelated poster, raffle, and demo worktree edits.
- Extend existing tests; do not create a new test file.
- Use test-driven development: write each focused assertion first, run it red, then implement the minimum change.
- Do not change the Prisma schema or create a migration; `RSVP.rosterIdentity` already exists.
- Show the checkbox only in the Going modal with exact copy: `Show my name and bike in Who’s going.`
- Default a new event choice from the rider’s current `defaultRosterIdentity`; Sample Rider therefore starts checked.
- Preserve an existing RSVP’s saved choice when registration omits `rosterIdentity`.
- Changing the global profile preference later must not rewrite existing event choices.
- Interested registration must not change an existing RSVP visibility choice.
- Organizer-disabled, anonymous, private, unpublished, Interested, and photo-less riders must not expose identity in the public preview.
- Filter eligible RSVP-level `VISIBLE` riders before applying the four-bike preview limit.
- Preserve stable ordering by `goingAt`, then RSVP ID.
- Keep pass creation, attendance type, club name, timestamps, audit behavior, raffle eligibility, check-in behavior, aggregate counts, attendee pagination, and the public DTO unchanged.
- Do not run `npm run build`.
- Before any browser check, inspect `localhost:3000`; if Tambike is already running, reuse it and do not run `npm run dev`.
- Use only the Codex Browser for browser verification.
- Do not deploy or push.

---

## File Structure

- `src/server/backend.ts`
  - Extends `RegistrationInput`, persists explicit RSVP choices in memory, exposes the current rider’s saved-or-default event choice, and classifies memory rosters from RSVP identity.
- `src/server/prisma-backend.ts`
  - Mirrors persistence, lookup, count, roster, and public-preview behavior against Prisma.
- `src/server/actions.ts`
  - Accepts the optional registration choice and exposes the authenticated narrow read action.
- `src/features/tambike-demo/demo-provider.tsx`
  - Carries the choice between the modal and server actions.
- `src/features/tambike-demo/tambike-screen.tsx`
  - Loads the current event choice and renders the Going-only checkbox.
- `tests/server/event-roster-domain.test.ts`
  - Proves per-event persistence, global-default isolation, Interested preservation, counts, and roster output through the real memory backend.
- `tests/server/event-attendee-public-preview-domain.test.ts`
  - Proves RSVP-level opt-in priority and public privacy exclusions.
- `tests/server/event-attendee-public-preview-contract.test.ts`
  - Keeps the Prisma public query anchored to RSVP identity rather than the user default.
- `tests/server/event-roster-ui-contract.test.ts`
  - Updates the existing UI/action/provider contract from “no event control” to the approved per-event control.

### Task 1: Per-event registration persistence and lookup

**Files:**
- Modify: `src/server/backend.ts`
- Modify: `src/server/prisma-backend.ts`
- Modify: `src/server/actions.ts`
- Modify: `tests/server/event-roster-domain.test.ts`

**Interfaces:**
- Produces `RegistrationInput.rosterIdentity?: RosterIdentity`.
- Produces `TambikeBackend.getEventRegistrationRosterIdentity(sessionToken, eventId): Promise<RosterIdentity>`.
- Produces `PrismaTambikeBackend.getEventRegistrationRosterIdentity(sessionToken, eventId): Promise<RosterIdentity>`.
- Produces `getEventRegistrationRosterIdentityAction(eventId): Promise<RosterIdentity>`.
- Preserves all existing `registerForEvent` callers because the new input is optional.

- [ ] **Step 1: Read the installed Next.js Server Action guidance**

Read:

```powershell
Get-Content node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md
```

Confirm the existing server-action boundary remains valid; do not add a route handler.

- [ ] **Step 2: Write failing memory-backend persistence tests**

Replace the old live-global-preference test in `tests/server/event-roster-domain.test.ts` with a per-event contract that:

```ts
const first = await backend.registerForEvent(actors.rider.sessionToken, event.id, {
  status: "going",
  attendanceType: "direct",
  rosterIdentity: "VISIBLE",
});
expect(first.rsvp.rosterIdentity).toBe("VISIBLE");
await expect(
  backend.getEventRegistrationRosterIdentity(actors.rider.sessionToken, event.id),
).resolves.toBe("VISIBLE");

await backend.updateMemberProfile(actors.rider.sessionToken, {
  ...visibleProfile,
  defaultRosterIdentity: "ANONYMOUS",
});
await expect(
  backend.getEventRegistrationRosterIdentity(actors.rider.sessionToken, event.id),
).resolves.toBe("VISIBLE");

const preserved = await backend.registerForEvent(actors.rider.sessionToken, event.id, {
  status: "going",
  attendanceType: "direct",
});
expect(preserved.rsvp.rosterIdentity).toBe("VISIBLE");

const hidden = await backend.registerForEvent(actors.rider.sessionToken, event.id, {
  status: "going",
  attendanceType: "direct",
  rosterIdentity: "ANONYMOUS",
});
expect(hidden.rsvp.rosterIdentity).toBe("ANONYMOUS");

const interested = await backend.registerForEvent(actors.rider.sessionToken, event.id, {
  status: "interested",
  attendanceType: "direct",
  rosterIdentity: "VISIBLE",
});
expect(interested.rsvp.rosterIdentity).toBe("ANONYMOUS");
```

Add a second event and prove its initial lookup comes from the rider’s current global default without changing the first event:

```ts
const secondEvent = await createPublishedTestEvent(backend, actors, {
  title: "Second Per-Event Choice",
  date: "Fri · December 31, 2099",
});
await expect(
  backend.getEventRegistrationRosterIdentity(actors.rider.sessionToken, secondEvent.id),
).resolves.toBe("ANONYMOUS");
await expect(
  backend.getEventRegistrationRosterIdentity(actors.rider.sessionToken, event.id),
).resolves.toBe("ANONYMOUS");
```

The first event’s final expectation is `ANONYMOUS` because the rider explicitly changed that RSVP before the second event was checked.

- [ ] **Step 3: Run Task 1 test to verify RED**

Run:

```powershell
npx vitest run tests/server/event-roster-domain.test.ts --maxWorkers=1
```

Expected: type/runtime failures because `RegistrationInput.rosterIdentity` and `getEventRegistrationRosterIdentity` do not exist.

- [ ] **Step 4: Extend the registration contract and memory backend**

In `src/server/backend.ts`, extend the type:

```ts
export type RegistrationInput = {
  status: "interested" | "going";
  attendanceType: AttendanceType;
  clubName?: string;
  rosterIdentity?: RosterIdentity;
};
```

Inside `TambikeBackend.registerForEvent`, compute the saved value before building the RSVP:

```ts
const defaultIdentity = user.defaultRosterIdentity ?? "ANONYMOUS";
const previousIdentity = previousRsvp?.rosterIdentity ?? defaultIdentity;
if (
  input.rosterIdentity !== undefined &&
  input.rosterIdentity !== "VISIBLE" &&
  input.rosterIdentity !== "ANONYMOUS"
) {
  throw new BackendError("INVALID_INPUT", "INVALID_INPUT");
}
const rosterIdentity =
  input.status === "going" && input.rosterIdentity !== undefined
    ? input.rosterIdentity
    : previousIdentity;
```

Assign `rosterIdentity` on the RSVP. Add the authenticated lookup:

```ts
async getEventRegistrationRosterIdentity(
  sessionToken: string,
  eventId: string,
): Promise<RosterIdentity> {
  const user = this.requireUser(sessionToken);
  this.requireEvent(eventId);
  return (
    this.rsvps.get(`${eventId}:${user.id}`)?.rosterIdentity ??
    user.defaultRosterIdentity ??
    "ANONYMOUS"
  );
}
```

- [ ] **Step 5: Mirror persistence and lookup in Prisma**

In `PrismaTambikeBackend.registerForEvent`, select the previous RSVP’s `rosterIdentity` together with status and `goingAt`. Validate the optional input exactly as in memory. Compute:

```ts
const previousIdentity =
  previousRsvp?.rosterIdentity ?? user.defaultRosterIdentity;
const rosterIdentity =
  input.status === "going" && input.rosterIdentity !== undefined
    ? input.rosterIdentity
    : previousIdentity;
```

Use `rosterIdentity` in `create`. Include it in `update` so an explicit Going choice is persisted and an omitted or Interested update preserves the previous value.

Add:

```ts
async getEventRegistrationRosterIdentity(
  sessionToken: string,
  eventId: string,
): Promise<RosterIdentity> {
  const user = await this.requireUser(sessionToken);
  await this.requireEvent(eventId);
  const rsvp = await this.prisma.rSVP.findUnique({
    where: { eventId_userId: { eventId, userId: user.id } },
    select: { rosterIdentity: true },
  });
  return rsvp?.rosterIdentity ?? user.defaultRosterIdentity;
}
```

- [ ] **Step 6: Expose the narrow authenticated read action**

In `src/server/actions.ts`, import `RosterIdentity` if required by inference and extend the registration action input with:

```ts
rosterIdentity?: RosterIdentity;
```

Add:

```ts
export async function getEventRegistrationRosterIdentityAction(eventId: string) {
  const backend = await getTambikeBackend();
  const token = await readRequiredSessionToken();
  return backend.getEventRegistrationRosterIdentity(token, eventId);
}
```

- [ ] **Step 7: Verify Task 1 GREEN**

Run:

```powershell
npx vitest run tests/server/event-roster-domain.test.ts --maxWorkers=1
npx tsc --noEmit
```

Expected: the domain test and TypeScript pass.

- [ ] **Step 8: Commit Task 1**

```powershell
git add -- src/server/backend.ts src/server/prisma-backend.ts src/server/actions.ts tests/server/event-roster-domain.test.ts
git commit -m "feat: persist per-event RSVP visibility"
```

### Task 2: RSVP-level roster and public-preview priority

**Files:**
- Modify: `src/server/backend.ts`
- Modify: `src/server/prisma-backend.ts`
- Modify: `tests/server/event-roster-domain.test.ts`
- Modify: `tests/server/event-attendee-public-preview-domain.test.ts`
- Modify: `tests/server/event-attendee-public-preview-contract.test.ts`

**Interfaces:**
- Consumes `RSVP.rosterIdentity` persisted by Task 1.
- Produces attendee summaries, full rosters, and public previews that classify the event-specific RSVP choice.
- Keeps the existing public preview DTO and pagination cursor unchanged.

- [ ] **Step 1: Write failing RSVP-level roster tests**

In `tests/server/event-roster-domain.test.ts`, prove that changing the global profile default after registration does not change the saved event roster:

```ts
await backend.registerForEvent(actors.rider.sessionToken, event.id, {
  status: "going",
  attendanceType: "direct",
  rosterIdentity: "VISIBLE",
});
await backend.configureEventRoster(actors.organizer.sessionToken, event.id, {
  enabled: true,
});
await backend.updateMemberProfile(actors.rider.sessionToken, {
  ...visibleProfile,
  defaultRosterIdentity: "ANONYMOUS",
});
await expect(
  backend.listEventAttendees(actors.outsider.sessionToken, event.id, {}),
).resolves.toMatchObject({
  summary: { visibleCount: 1, anonymousCount: 0 },
  attendees: [{ slug: "visible-rider" }],
});
```

Then explicitly change that RSVP to `ANONYMOUS` and require `visibleCount: 0`, `anonymousCount: 1`, and no attendee card.

- [ ] **Step 2: Write failing public-preview priority tests**

In `tests/server/event-attendee-public-preview-domain.test.ts`, update the helper so it passes its `identity` into `registerForEvent` as `rosterIdentity`, rather than relying on the profile default.

Create more than four Going riders where early anonymous/photo-less riders precede five explicit visible riders. Require:

```ts
for (let index = 0; index < 7; index += 1) {
  const rider = await backend.signUpRider({
    displayName:
      index === 0 ? "Anonymous Rider" :
      index === 1 ? "Photo-less Rider" :
      `Visible Rider ${index - 1}`,
    email: `per-event-preview-${index}@example.test`,
    password: "password123",
    area: "Manila",
  });
  await backend.updateMemberProfile(rider.sessionToken, {
    ...visibleProfile,
    displayName:
      index === 0 ? "Anonymous Rider" :
      index === 1 ? "Photo-less Rider" :
      `Visible Rider ${index - 1}`,
    visibility: "PUBLIC",
  });
  await backend.registerForEvent(rider.sessionToken, event.id, {
    status: "going",
    attendanceType: "direct",
    rosterIdentity: index === 0 ? "ANONYMOUS" : "VISIBLE",
  });
  if (index !== 1) {
    await addBikePhoto(rider, `per-event-preview-${index}`);
  }
}

expect(preview.attendees.map(({ displayName }) => displayName)).toEqual([
  "Visible Rider 1",
  "Visible Rider 2",
  "Visible Rider 3",
  "Visible Rider 4",
]);
```

After registration, change `Visible Rider 1`’s global default to `ANONYMOUS` and prove the preview still includes it. Explicitly update its event RSVP to `ANONYMOUS` and prove `Visible Rider 5` fills the fourth slot.

Keep the existing exclusions for private, unpublished, Interested, organizer-disabled, and photo-less riders.

- [ ] **Step 3: Update the Prisma source contract and verify RED**

In `tests/server/event-attendee-public-preview-contract.test.ts`, replace:

```ts
expect(prisma).toContain('defaultRosterIdentity: "VISIBLE"');
```

with:

```ts
expect(prisma).toContain('rosterIdentity: "VISIBLE"');
expect(prisma).not.toMatch(
  /getPublicEventAttendeePreview[\s\S]{0,1200}defaultRosterIdentity:\s*"VISIBLE"/,
);
```

Run:

```powershell
npx vitest run tests/server/event-roster-domain.test.ts tests/server/event-attendee-public-preview-domain.test.ts tests/server/event-attendee-public-preview-contract.test.ts --maxWorkers=1
```

Expected: failures show that full roster, summary, and public preview still read `user.defaultRosterIdentity`.

- [ ] **Step 4: Use RSVP identity in the memory roster**

In `src/server/backend.ts`:

- In `listEventAttendees`, pass `entry.rsvp.rosterIdentity ?? "ANONYMOUS"` to `classifyRosterEntry`.
- In `getPublicEventAttendeePreview`, require `entry.rsvp.rosterIdentity === "VISIBLE"` while retaining public slug, `PUBLIC` profile visibility, Going status, `goingAt`, bike-photo filtering, stable sorting, and the post-filter four-item limit.
- In `buildMemoryRosterSummary`, classify from `rsvp.rosterIdentity ?? "ANONYMOUS"`.

Do not read `user.defaultRosterIdentity` in any of those three event-specific paths.

- [ ] **Step 5: Use RSVP identity in Prisma queries**

In `src/server/prisma-backend.ts`:

- Change the full-roster `visibleWhere` to include top-level `rosterIdentity: "VISIBLE"` and remove `user.defaultRosterIdentity`.
- Change the public-preview RSVP `where` similarly.
- Change `buildPrismaRosterSummary` visible-count query similarly.
- Retain user slug/profile visibility/photo safeguards and existing order/limit clauses.

- [ ] **Step 6: Verify Task 2 GREEN**

Run:

```powershell
npx vitest run tests/server/event-roster-domain.test.ts tests/server/event-attendee-public-preview-domain.test.ts tests/server/event-attendee-public-preview-contract.test.ts --maxWorkers=1
npx tsc --noEmit
```

Expected: all focused domain/contract tests and TypeScript pass.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- src/server/backend.ts src/server/prisma-backend.ts tests/server/event-roster-domain.test.ts tests/server/event-attendee-public-preview-domain.test.ts tests/server/event-attendee-public-preview-contract.test.ts
git commit -m "fix: honor RSVP visibility in attendee rosters"
```

### Task 3: Going-modal visibility control and live verification

**Files:**
- Modify: `src/features/tambike-demo/demo-provider.tsx`
- Modify: `src/features/tambike-demo/tambike-screen.tsx`
- Modify: `src/server/actions.ts`
- Modify: `tests/server/event-roster-ui-contract.test.ts`

**Interfaces:**
- Consumes `getEventRegistrationRosterIdentityAction(eventId)` from Task 1.
- Extends provider `registerForEvent(eventId, attendanceType, status?, rosterIdentity?)`.
- Produces a Going-only checkbox that sends `VISIBLE` or `ANONYMOUS`.

- [ ] **Step 1: Read installed Next.js and React client guidance**

Read:

```powershell
Get-Content node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
Get-Content node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md
```

Keep server actions behind the existing client provider; do not fetch through a new HTTP route.

- [ ] **Step 2: Replace the obsolete UI contract with the approved control**

In `tests/server/event-roster-ui-contract.test.ts`, replace the test that says event-specific privacy controls are removed. Require:

```ts
expect(screen).toContain("Show my name and bike in Who’s going.");
expect(screen).toContain('type="checkbox"');
expect(screen).toContain('rosterIdentity === "VISIBLE"');
expect(screen).toMatch(
  /registerForEvent\(\s*event\.id,\s*attendance,\s*"going",\s*rosterIdentity\s*\)/,
);
expect(provider).toContain("getEventRegistrationRosterIdentityAction");
expect(provider).toContain("rosterIdentity?: RosterIdentity");
expect(actions).toContain("getEventRegistrationRosterIdentityAction");
```

Keep existing assertions that the organizer toggle and protected roster route remain intact. Reject any new public exposure of email, user ID, verification state, or media storage details.

- [ ] **Step 3: Run the UI contract to verify RED**

Run:

```powershell
npx vitest run tests/server/event-roster-ui-contract.test.ts --maxWorkers=1
```

Expected: failure because the checkbox, provider parameter, and narrow read action wiring are absent.

- [ ] **Step 4: Carry visibility through the provider**

In `src/features/tambike-demo/demo-provider.tsx`:

- Import `RosterIdentity`.
- Import `getEventRegistrationRosterIdentityAction`.
- Add to `DemoContextValue`:

```ts
getEventRegistrationRosterIdentity: (
  eventId: string,
) => Promise<RosterIdentity>;
```

- Extend `registerForEvent`:

```ts
registerForEvent: (
  eventId: string,
  attendanceType: AttendanceType,
  status?: "interested" | "going",
  rosterIdentity?: RosterIdentity,
) => Promise<string | null>;
```

- Forward `rosterIdentity` only when it is defined:

```ts
const result = await registerForEventAction(eventId, {
  status,
  attendanceType: nextAttendanceType,
  clubName: currentUser.clubName,
  ...(rosterIdentity ? { rosterIdentity } : {}),
});
```

- Add a memoized provider callback that calls `getEventRegistrationRosterIdentityAction(eventId)`.

- [ ] **Step 5: Add the Going-only checkbox**

In `RsvpModal` within `src/features/tambike-demo/tambike-screen.tsx`:

- Import `RosterIdentity`.
- Read `getEventRegistrationRosterIdentity` from `useDemo()`.
- Add state:

```ts
const [rosterIdentity, setRosterIdentity] =
  useState<RosterIdentity | null>(null);
```

- On modal mount or event change, load the existing RSVP choice or profile default. Guard against setting state after unmount. On failure, retain the existing modal and show the existing inline error.
- Implement that load with:

```ts
useEffect(() => {
  let active = true;
  setRosterIdentity(null);
  setError("");
  void getEventRegistrationRosterIdentity(event.id)
    .then((identity) => {
      if (active) setRosterIdentity(identity);
    })
    .catch((loadError) => {
      if (active) setError(actionErrorMessage(loadError));
    });
  return () => {
    active = false;
  };
}, [event.id, getEventRegistrationRosterIdentity]);
```

- Render a second `fieldset` using the existing `attendance-options` styles:

```tsx
<fieldset className="attendance-options">
  <legend>Who’s going</legend>
  <label>
    <input
      type="checkbox"
      checked={rosterIdentity === "VISIBLE"}
      disabled={rosterIdentity === null || isSubmitting}
      onChange={(event) =>
        setRosterIdentity(event.currentTarget.checked ? "VISIBLE" : "ANONYMOUS")
      }
    />
    <span>Show my name and bike in Who’s going.</span>
  </label>
</fieldset>
```

- Prevent submission until the preference has loaded.
- At the top of `submit`, use:

```ts
if (rosterIdentity === null) {
  setError("Your attendance privacy choice is still loading.");
  return;
}
```

- Submit:

```ts
const passId = await registerForEvent(
  event.id,
  attendance,
  "going",
  rosterIdentity,
);
```

- Keep the modal open and preserve attendance/visibility state when submission fails.
- Do not add the option to the Interested button flow.
- Reuse existing CSS; do not edit dirty `src/app/globals.css`.

- [ ] **Step 6: Verify Task 3 GREEN**

Run:

```powershell
npx vitest run tests/server/event-roster-ui-contract.test.ts tests/server/event-roster-domain.test.ts tests/server/event-attendee-public-preview-domain.test.ts --maxWorkers=1
npx tsc --noEmit
npm run lint
```

Expected: focused tests, TypeScript, and lint pass.

- [ ] **Step 7: Reuse the running local server**

Inspect port 3000 and its owning process. If the process command belongs to this Tambike checkout, reuse it:

```powershell
netstat -ano -p tcp | Select-String ":3000"
```

Do not run `npm run dev` when that Tambike process is already listening. Do not run `npm run build`.

- [ ] **Step 8: Verify Sample Rider in the Codex Browser**

Using only the Codex Browser on `http://localhost:3000/events/tambike-cafe-classico`:

1. Sign in as the existing Sample Rider through the supported local login flow.
2. Click Going.
3. Verify `Show my name and bike in Who’s going.` is initially checked.
4. Uncheck it, submit, and verify Sample Rider remains in the Going count but disappears from the public bike preview.
5. Reopen Going and verify that event’s saved value is unchecked.
6. Check it, submit, and verify Sample Rider becomes eligible for the public preview again.
7. Verify the four-bike limit, mobile two-column layout, desktop four-column layout, no horizontal overflow, and no console errors.

If the browser or authenticated Sample Rider session is unavailable, record the exact boundary and do not substitute Playwright or another browser.

- [ ] **Step 9: Run final server verification**

Run:

```powershell
npx vitest run tests/server --maxWorkers=1
git diff --check
git status --short
```

Expected: all server tests pass serially; the diff check is clean; unrelated dirty files remain preserved.

- [ ] **Step 10: Commit Task 3**

```powershell
git add -- src/features/tambike-demo/demo-provider.tsx src/features/tambike-demo/tambike-screen.tsx src/server/actions.ts tests/server/event-roster-ui-contract.test.ts
git commit -m "feat: add per-event attendee visibility choice"
```
