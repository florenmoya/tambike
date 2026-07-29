# Event Detail 4K Responsive Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the RSVP-first event detail visually coherent from 4K displays through mobile screens.

**Architecture:** Use one 1200px rail at every width. Keep the event introduction and poster together in the first grid row, then let the RSVP decision card span the entire second row on desktop, tablet, and mobile so the poster never reserves empty space beside it.

**Tech Stack:** Next.js 16.2, React 19, TypeScript, CSS, Vitest

## Global Constraints

- Preserve existing RSVP, Interested, Share, privacy, roster, pass, and lower-section behavior.
- Preserve unrelated dirty carousel/poster work in shared files.
- Preserve existing accessibility behavior.
- Do not add dependencies, routes, assets, test files, or a dev server.
- Do not run a production build or Playwright.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/app/globals.css` | Shared rail, desktop grid, tablet grid, and poster dimensions |
| `src/features/tambike-demo/tambike-screen.tsx` | Responsive `next/image` poster `sizes` value only |
| `tests/server/event-detail-ui-contract.test.ts` | Wide/tablet/mobile layout contract |
| `tests/server/event-poster-assets-contract.test.ts` | Poster `sizes` contract |

### Task 1: Unify the Responsive Event-Detail Rail

**Files:**

- Modify: `tests/server/event-detail-ui-contract.test.ts`
- Modify: `tests/server/event-poster-assets-contract.test.ts`
- Modify: `src/app/globals.css`
- Modify: `src/features/tambike-demo/tambike-screen.tsx`

**Interfaces:**

- Consumes: existing `EventDetail` markup and event-detail CSS selectors.
- Produces: no new TypeScript interface; only responsive layout behavior.

- [ ] **Step 1: Write the failing layout contract**

Assert:

```ts
expect(shell).toContain(
  "width: min(1200px, calc(100% - clamp(24px, 5vw, 72px)))",
);
expect(stage).toContain("minmax(180px, 200px)");
expect(posterWrap).toContain("max-width: 200px");
expect(sections).toContain("width: 100%");
expect(tabletStage).toContain('"decision decision"');
expect(tabletStage).toContain("140px");
expect(tabletPoster).toContain("max-width: 140px");
expect(mobilePoster).toContain("width: 72px");
```

Update the poster source contract to require:

```ts
'sizes="(max-width: 640px) 72px, (max-width: 1024px) 140px, 200px"'
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npx vitest run tests/server/event-detail-ui-contract.test.ts tests/server/event-poster-assets-contract.test.ts
```

Expected: failures reference the old 1480px rail, 220px poster, mismatched
1120px lower rail, missing tablet full-width decision row, and old sizes value.

- [ ] **Step 3: Implement the minimal responsive CSS**

Use:

```css
.event-detail-shell {
  width: min(1200px, calc(100% - clamp(24px, 5vw, 72px)));
}

.event-detail-stage {
  grid-template-columns: minmax(0, 1fr) minmax(180px, 200px);
}

.event-detail-poster-wrap {
  max-width: 200px;
}

.event-detail-sections {
  width: 100%;
}

@media (max-width: 1024px) {
  .event-detail-stage {
    grid-template-areas:
      "copy poster"
      "decision decision";
    grid-template-columns: minmax(0, 1fr) 140px;
    gap: 1rem 1.5rem;
  }

  .event-detail-poster-wrap {
    width: 140px;
    max-width: 140px;
  }
}
```

Keep the existing 640px rule as the final override.

- [ ] **Step 4: Update the Image sizes value**

Use:

```tsx
sizes="(max-width: 640px) 72px, (max-width: 1024px) 140px, 200px"
```

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
npx vitest run tests/server/event-detail-ui-contract.test.ts tests/server/event-poster-assets-contract.test.ts tests/server/event-attendee-preview-ui.test.tsx tests/server/event-roster-ui-contract.test.ts
```

Expected: all focused files pass.

- [ ] **Step 6: Verify the scoped diff and runtime when available**

Run:

```powershell
git diff --check
```

If localhost:3000 already exists, use Codex Browser at 3840px, 1440px,
1024px, 768px, and 430px. Confirm no horizontal overflow and one common
content alignment. Do not start a duplicate server.

### Task 2: Remove the Empty Desktop Poster Column

**Files:**

- Modify: `tests/server/event-detail-ui-contract.test.ts`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: existing `.event-detail-stage`, `.event-detail-decision`, and
  `.event-detail-poster-wrap` grid areas.
- Produces: no new interface; desktop RSVP spans both grid columns.

- [ ] **Step 1: Write the failing desktop layout contract**

Change the desktop assertion to:

```ts
expect(stage).toContain('"copy poster"');
expect(stage).toContain('"decision decision"');
expect(stage).not.toContain('"decision poster"');
```

This catches the regression where the poster spans the tall RSVP row and
creates a blank desktop column.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/server/event-detail-ui-contract.test.ts
```

Expected: FAIL because the desktop rule still contains
`"decision poster"`.

- [ ] **Step 3: Implement the minimal CSS change**

Use:

```css
.event-detail-stage {
  grid-template-areas:
    "copy poster"
    "decision decision";
}
```

Do not change poster dimensions, breakpoints, markup, or RSVP behavior.

- [ ] **Step 4: Run focused verification**

Run:

```powershell
npx vitest run tests/server/event-detail-ui-contract.test.ts tests/server/event-attendee-preview-ui.test.tsx tests/server/event-roster-ui-contract.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 5: Verify the live layout**

Reuse localhost:3000 and check 3840px, 1440px, 1024px, 768px, and 430px.
Confirm the desktop RSVP width matches the 1200px shell, the poster remains in
the first row, and horizontal overflow is zero.

- [ ] **Step 6: Commit the scoped fix**

Stage only the event-detail CSS hunk and its contract test, preserving unrelated
dirty carousel work:

```powershell
git commit -m "fix: use full event detail decision row"
```
