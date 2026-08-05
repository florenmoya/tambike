# Profile Account Menu Design

## Decision

Tambike will replace the separate desktop profile link and logout button with one Facebook-style account control. Clicking the existing profile chip opens a compact menu containing **View profile** and **Log out**. Mobile keeps its current **Profile** and **Log out** rows inside the hamburger navigation.

## Current behavior

The authenticated desktop header currently renders the user's profile chip as a direct link to `/profile` and places a separate labeled **Log out** button beside it. Although the logout control now provides clear progress, these two adjacent account actions consume header space and do not match the requested consolidated account-menu pattern.

The mobile navigation already presents the two actions clearly as separate rows. Nesting another menu inside the mobile hamburger would add an unnecessary interaction level, so mobile remains unchanged except for retaining the existing shared logout progress and error behavior.

## Desktop interaction

The current name-and-role profile chip becomes a button and remains the single desktop account trigger. It preserves the visible user name, role, and user icon, and adds a small disclosure indicator.

The trigger will:

- expose the controlled panel through `aria-controls` and its open state with `aria-expanded`;
- open or close the account menu when clicked;
- remain visually consistent with the current profile chip;
- receive a clear open/focus treatment without introducing a separate avatar-only control.

The disclosure panel is anchored beneath the trigger, uses an accessible **Account options** group label, and contains exactly two actions:

1. **View profile** — a link to `/profile` with a supporting user icon.
2. **Log out** — a button using the existing logout handler and progress treatment.

The menu closes when the user clicks outside it, presses Escape, clicks the trigger again, or selects **View profile**. Keyboard focus remains on normal interactive controls, and Escape returns focus to the account trigger.

## Logout behavior

The existing shared logout contract remains unchanged:

- selecting **Log out** keeps the menu open;
- the menu item becomes disabled and displays a spinner with **Logging out…**;
- both the desktop menu action and mobile logout row share the pending state, preventing repeat requests;
- success performs `window.location.replace("/")` and retains the busy state until unload;
- failure restores **Log out** and displays **Could not log out. Try again.** inside the open account menu on desktop;
- the mobile failure continues to use the existing accessible header-level error surface.

The UI never displays exception text, backend codes, session details, or infrastructure information.

## Responsive behavior

At desktop and tablet header widths where the profile chip is visible, the separate `.logout-button` is removed and the account-menu trigger is shown.

At mobile widths, the desktop account trigger/menu remains hidden through the existing responsive header rules. The hamburger navigation continues to show **Profile**, the relevant role workspace link, and **Log out** as direct rows. No nested mobile account menu is added.

The menu must remain within the viewport at supported desktop/tablet widths and must not introduce horizontal overflow.

## Component and state boundaries

`TambikeAppShell` continues to own header state. It adds `accountMenuOpen` and a trigger/container ref for click-outside and Escape handling. The existing `logoutPending`, `logoutError`, and `handleLogout()` state is reused rather than duplicated.

The account trigger and menu markup remain close to the header actions because they share the current user, role label, logout state, and responsive visibility. No new provider contract, server action, route, dependency, or account settings surface is introduced.

## Accessibility

- The trigger is a real button with an accessible account-menu name, `aria-controls`, and `aria-expanded`.
- The popup is a disclosure panel with `role="group"` and the accessible label **Account options**, preserving the native link/button semantics of its actions.
- Escape closes the menu and returns focus to the trigger.
- Clicking outside closes the menu without changing navigation.
- The logout action continues to expose `aria-busy` and a disabled state while pending.
- The failure message uses one accessible alert and is not duplicated for assistive technology.
- Reduced-motion behavior for the spinner remains unchanged.

## Scope

This change is limited to authenticated header account navigation. It does not add account settings, switch accounts, notifications inside the menu, profile editing, confirmation dialogs, mobile nesting, session-policy changes, or backend changes.

## Testing and verification

The existing auth component test file will be extended test-first to prove:

- the desktop header has one account-menu trigger and no standalone logout button;
- clicking the trigger opens a menu containing **View profile** and **Log out**;
- trigger click, outside click, Escape, and **View profile** selection close the menu correctly;
- Escape returns focus to the trigger;
- desktop logout keeps the menu open and shows the shared **Logging out…** state;
- logout failure stays retryable and shows safe copy inside the open menu;
- the existing mobile direct **Profile** and **Log out** rows remain available.

After targeted and full automated checks pass, Codex browser verification will repeat authenticated desktop and mobile flows. Desktop verification will open and close the menu through its supported paths, follow **View profile**, and confirm logout progress and homepage completion. Mobile verification will confirm the direct rows remain, logout feedback still works, and `scrollWidth === clientWidth`. Browser console errors must remain empty.
