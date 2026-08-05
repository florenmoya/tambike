# Header Account Trigger Correction Design

## Decision

Tambike will correct the desktop account menu so the far-right user icon is the only account trigger. The large name-and-role account chip will be removed. Clicking the user icon opens a compact, right-aligned menu containing exactly **View profile** and **Log out**.

Search will also be removed from the shared header. This removes the desktop search icon and its popover trigger as well as the mobile **Search events** row. Event-page search and filtering remain outside this change.

## Root cause

The previous implementation converted the large name-and-role profile chip into the account-menu trigger but left the existing far-right profile link in place. The rendered desktop header therefore exposed two account controls: a 260-pixel menu trigger and a separate 30-pixel profile icon. This contradicted the requested Facebook-style pattern, where one compact account control owns the profile and logout actions.

## Desktop behavior

- The large `.account-chip` name-and-role control is removed from the authenticated header.
- The existing far-right user icon becomes a real button and the sole desktop account trigger.
- The trigger retains the accessible name **Account menu**, `aria-controls`, and `aria-expanded`.
- The compact menu is anchored to the trigger's right edge and contains exactly **View profile** and **Log out**.
- The menu closes on trigger click, outside interaction, Escape, or **View profile** selection. Escape returns focus to the icon trigger.
- The separate desktop search button is removed, so no search icon appears next to the account trigger.

The organizer, venue, or admin workspace link remains unchanged. It already communicates the signed-in role, so duplicating the user's name and role in the header is unnecessary.

## Logout behavior

The existing shared logout contract remains unchanged:

- **Log out** stays inside the open account menu while the request is pending;
- it becomes disabled and displays the spinner with **Logging out…**;
- success redirects to `/` while retaining the busy state until unload;
- failure restores **Log out** and shows **Could not log out. Try again.** inside the menu;
- no backend or exception details are shown.

## Mobile behavior

The mobile hamburger continues to expose direct **Profile** and **Log out** rows. It does not gain a nested account menu. The **Search events** row is removed from the mobile navigation, while the remaining navigation and workspace rows stay unchanged.

## Search scope

Only shared-header search entry points are removed:

- the desktop **Search events** icon button;
- the mobile **Search events** navigation row;
- the header-owned search popover rendered from those controls.

Search or filtering that belongs to event discovery pages is not removed. No search route, server behavior, or event-query contract changes in this correction.

## Accessibility and responsive behavior

- The icon trigger is a native button with a visible focus treatment and an accessible **Account menu** name.
- The menu preserves native link and button semantics and the **Account options** accessible group label.
- The trigger and menu remain hidden at the existing mobile breakpoint, where direct mobile account rows are used.
- The compact menu must stay inside the viewport and must not introduce horizontal overflow.
- Reduced-motion and logout busy-state behavior remain unchanged.

## Testing and verification

Regression coverage will be updated test-first to prove:

- the authenticated desktop header renders one account trigger and no `.account-chip`;
- there is no separate `/profile` icon link outside the menu;
- opening the icon trigger shows **View profile** and **Log out**;
- dismissal, focus restoration, pending logout, and failure behavior continue to work;
- desktop and mobile shared-header search controls are absent;
- mobile direct **Profile** and **Log out** rows remain available.

Browser verification will confirm the corrected authenticated desktop layout, menu positioning and actions, the mobile navigation rows, logout progress, no horizontal overflow, and no browser console errors.

## Scope

This correction does not redesign workspace links, event-page search, account settings, profile editing, authentication policy, session behavior, or backend APIs.
