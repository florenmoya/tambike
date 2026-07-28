# Public Raffle Status Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate active raffle entry cards from past winner results while supporting any number of open raffles and no-winner events.

**Architecture:** Keep the existing public giveaway data contract and card components. Derive three presentation collections in `PublicGiveawayPanel`: open campaigns, completed campaigns with published public results, and other public campaign states; render each in a clearly titled group and omit empty groups.

**Tech Stack:** React 19, TypeScript, CSS Modules, Vitest with jsdom, existing Codex in-app browser against `http://localhost:3000`.

## Global Constraints

- The section eyebrow is `Raffles` and the heading is `Event raffles`.
- All open campaigns render under `Open raffles` with the status `Open now`.
- Completed campaigns render under `Recent winners` only when they contain a published public result.
- The newest winner uses `Latest winner`; additional winner cards use `Winner`.
- Empty groups are omitted.
- Basic raffle information remains visible without opening a disclosure.
- Do not run `npm run build`.
- Reuse the existing `localhost:3000` development server; do not start `npm run dev`.
- Preserve unrelated working-tree changes and stage only files named in this plan.

---

### Task 1: Dynamic raffle and winner groups

**Files:**
- Modify: `tests/server/public-giveaway-spotlight.test.ts`
- Modify: `src/features/giveaways/public-giveaway-panel.tsx`
- Modify: `src/features/giveaways/public-giveaway-panel.module.css`

**Interfaces:**
- Consumes: `groupPublicGiveawaysForSpotlight(campaigns)` and `PublicEventGiveaway.results`.
- Produces: public group headings `Open raffles` and `Recent winners`, plus the status labels `Open now`, `Latest winner`, and `Winner`.

- [ ] **Step 1: Write failing component tests**

Add a test that supplies two open campaigns and no completed campaign:

```tsx
test("shows every open raffle without implying that a winner exists", async () => {
  const firstOpen = campaign("Helmet raffle", "open");
  const secondOpen = campaign("Gear raffle", "open");
  vi.mocked(listPublicGiveawaysForEventAction).mockResolvedValue({
    ok: true,
    code: "OK",
    data: [firstOpen, secondOpen],
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(createElement(PublicGiveawayPanel, { eventId: "event-1" }));
  });
  await vi.waitFor(() => expect(container.textContent).toContain("Event raffles"));

  expect(container.textContent).toContain("Open raffles");
  expect(container.textContent).toContain("Helmet raffle");
  expect(container.textContent).toContain("Gear raffle");
  expect(container.textContent).not.toContain("Recent winners");
  expect(container.textContent).not.toContain("Latest winner");
});
```

Update the existing mixed-campaign test to assert:

```tsx
expect(container.querySelector("header h2")?.textContent).toBe("Event raffles");
expect(text).toContain("Open raffles");
expect(text).toContain("Recent winners");
expect(text).toContain("Open now");
expect(text).toContain("Latest winner");
expect(text).not.toContain("Ongoing");
expect(text).not.toContain("Completed");
```

Ensure its completed campaign without results is absent from the rendered
article headings.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/server/public-giveaway-spotlight.test.ts
```

Expected: FAIL because the current UI still renders the sentence heading,
uses `Ongoing` and `Completed`, and has no explicit group headings.

- [ ] **Step 3: Implement the minimal grouping and copy**

In `PublicGiveawayPanel`, derive collections without changing the server
contract:

```tsx
const openCampaigns = [
  ...(groups.primaryOpen ? [groups.primaryOpen] : []),
  ...groups.additional.filter(({ giveaway }) => giveaway.state === "open"),
];
const winnerCampaigns = groups.completed.filter(
  ({ results }) => results.length > 0,
);
const otherCampaigns = groups.additional.filter(
  ({ giveaway }) => giveaway.state !== "open",
);
```

Change the section heading to:

```tsx
<header className={styles.heading}>
  <span>Raffles</span>
  <h2 id={`event-giveaways-${eventId}`}>Event raffles</h2>
</header>
```

Render non-empty campaign groups with their own headings:

```tsx
{openCampaigns.length > 0 ? (
  <section className={styles.campaignGroup} aria-labelledby={`open-raffles-${eventId}`}>
    <h3 className={styles.groupHeading} id={`open-raffles-${eventId}`}>
      Open raffles
    </h3>
    {/* primary open card followed by compact open cards */}
  </section>
) : null}

{winnerCampaigns.length > 0 ? (
  <section className={styles.campaignGroup} aria-labelledby={`recent-winners-${eventId}`}>
    <h3 className={styles.groupHeading} id={`recent-winners-${eventId}`}>
      Recent winners
    </h3>
    {/* latest winner card followed by compact winner cards */}
  </section>
) : null}
```

Change card status text:

```tsx
// OpenGiveawaySpotlight
Open now

// CompletedGiveawayResult
Latest winner

// CompactGiveawayCard
{isOpen ? "Open now" : isCompleted ? "Winner" : giveawayStateLabel(giveaway.state)}
```

Add restrained group styling:

```css
.campaignGroup {
  display: grid;
  min-width: 0;
  gap: 0.7rem;
}

.groupHeading {
  margin: 0;
  color: rgba(255, 255, 255, 0.78);
  font-size: 0.8rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
```

Keep the existing responsive grids so desktop may use columns and mobile stays
one card per row.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run tests/server/public-giveaway-spotlight.test.ts
```

Expected: all tests in the file PASS with no warnings.

- [ ] **Step 5: Run the related giveaway regression tests**

Run:

```powershell
npx vitest run tests/server/public-giveaway-spotlight.test.ts tests/server/giveaway-presentation-ui.test.ts tests/server/giveaway-presentation-browser.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 6: Verify the existing local event page**

Confirm that port 3000 is already listening. Use the Codex in-app browser to
open:

```text
http://localhost:3000/events/tambike-cafe-classico
```

At desktop and 390-by-844 mobile dimensions verify:

- `Event raffles` is the section heading.
- `Open raffles` contains every open campaign.
- `Recent winners` appears separately only when a public result exists.
- No `Ongoing`, `Completed`, or old sentence heading remains in the raffle region.
- Prize images load and the page has no horizontal overflow.

- [ ] **Step 7: Commit the scoped implementation**

```powershell
git add -- tests/server/public-giveaway-spotlight.test.ts `
  src/features/giveaways/public-giveaway-panel.tsx `
  src/features/giveaways/public-giveaway-panel.module.css
git diff --cached --check
git commit -m "fix: clarify public raffle status groups"
```
