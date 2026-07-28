# Event Attendee Preview Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the repetitive attendee-preview wording with the approved compact copy while preserving all existing behavior.

**Architecture:** Keep the existing `EventAttendeePreview` component and data contract unchanged. Update only its rendered count, supporting line, and roster-link label, with the existing rendered-component test acting as the copy contract.

**Tech Stack:** Next.js 16.2.11 App Router, React 19.2.4, TypeScript, Vitest, Codex Browser.

## Global Constraints

- Work directly in the current checkout; do not create a branch or worktree.
- Preserve unrelated poster, raffle, and demo worktree changes.
- Modify only the attendee-preview component and its existing rendered-component test.
- Keep the approved copy exactly: `Who’s going`, live `N rider(s)`, `N interested · ~N expected`, and `See more`.
- Keep singular grammar for `1 rider` and plural grammar for all other counts.
- Preserve bike tiles, profile links, empty state, roster enablement, attendee route, aggregate values, ordering, RSVP behavior, and privacy filtering.
- Use the existing development server when browser verification is needed.
- Use only the Codex Browser for browser verification.
- Do not deploy or push.

---

## File Structure

- `tests/server/event-attendee-preview-ui.test.tsx`
  - Defines the rendered public-copy and roster-navigation contract.
- `src/features/member-profiles/event-attendee-preview.tsx`
  - Renders the approved compact copy from the existing live count values.

### Task 1: Compact attendee-preview copy

**Files:**
- Modify: `tests/server/event-attendee-preview-ui.test.tsx`
- Modify: `src/features/member-profiles/event-attendee-preview.tsx`

**Interfaces:**
- Consumes: existing `EventAttendeePreviewProps` and `EventAttendeePreviewData`.
- Produces: unchanged component API with the approved compact visible copy.

- [ ] **Step 1: Read the installed Next.js guidance**

Read:

```powershell
Get-Content node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md
Get-Content node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md
```

Confirm that the existing `Link` and Vitest patterns remain valid; no framework API change is required.

- [ ] **Step 2: Write the failing rendered-copy test**

In `tests/server/event-attendee-preview-ui.test.tsx`, update the real rendered-component assertions so the existing scenarios require:

```ts
expect(markup).toContain("15 riders");
expect(markup).toContain("15 interested · ~55 expected");
expect(markup).toContain("See more");
expect(markup).not.toContain("15 riders are going");
expect(markup).not.toContain("See who’s going");
expect(markup).not.toContain("Around 55 expected");
```

Update the roster-disabled scenario to require `15 riders` while rejecting `See more`. Update the preview-outage and empty-state scenarios to require `See more`. Change the grammar table to:

```ts
test.each([
  [0, "0 riders"],
  [1, "1 rider"],
  [2, "2 riders"],
])("uses correct turnout grammar for %i attendees", (going, copy) => {
  expect(render(undefined, going)).toContain(copy);
});
```

Update the live-count scenario to expect `15 riders` and then `13 riders`, while rejecting the stale `15 riders` value after rerender.

- [ ] **Step 3: Run the focused test to verify RED**

Run:

```powershell
npx vitest run tests/server/event-attendee-preview-ui.test.tsx --maxWorkers=1
```

Expected: FAIL because the component still renders `riders are going`, `Around N expected`, and `See who’s going`.

- [ ] **Step 4: Implement the minimum component copy change**

In `src/features/member-profiles/event-attendee-preview.tsx`, change the count formatter to:

```ts
const goingCopy = going === 1 ? "1 rider" : `${going} riders`;
```

Keep the existing `Who’s going` eyebrow and render the supporting line as:

```tsx
<p>{interested} interested · ~{expected} expected</p>
```

Change only the roster link text:

```tsx
<Link className={styles.action} href={`/events/${eventId}/attendees`}>
  See more
</Link>
```

- [ ] **Step 5: Run focused tests to verify GREEN**

Run:

```powershell
npx vitest run tests/server/event-attendee-preview-ui.test.tsx tests/server/event-detail-ui-contract.test.ts --maxWorkers=1
```

Expected: both files pass; bike-photo links, privacy exclusions, roster-disabled behavior, outage fallback, empty state, and live-count updates remain covered.

- [ ] **Step 6: Verify the live card in the Codex Browser**

First confirm whether `localhost:3000` is already owned by this Tambike checkout and reuse it. Open:

```text
http://localhost:3000/events/tambike-cafe-classico
```

Verify at mobile and desktop sizes:

- The card reads `Who’s going`, `16 riders`, `16 interested · ~55 expected`, and `See more`.
- `See more` links to `/events/tambike-cafe-classico/attendees`.
- Four bike tiles remain visible in two mobile columns and four desktop columns.
- There is no horizontal overflow and no browser-console error.

- [ ] **Step 7: Run static verification**

Run:

```powershell
npm run lint
git diff --check -- src/features/member-profiles/event-attendee-preview.tsx tests/server/event-attendee-preview-ui.test.tsx
git diff --name-only
```

Expected: lint and diff checks pass; the implementation diff contains only the component and its existing test, alongside any unrelated pre-existing worktree files that remain untouched.

- [ ] **Step 8: Commit the scoped implementation**

```powershell
git add -- src/features/member-profiles/event-attendee-preview.tsx tests/server/event-attendee-preview-ui.test.tsx
git commit -m "refactor: simplify attendee preview copy"
```
