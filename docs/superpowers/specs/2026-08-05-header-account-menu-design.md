# Header Account Menu Design

## Decision

Tambike will replace the authenticated desktop header's separate **Log out**, search, and account-icon controls with one compact menu icon. The signed-in member pill remains visible as identity-only information. The new account menu is the single desktop location for **Profile** and **Log out**.

Header search will be removed from both desktop and mobile navigation. Event discovery and filtering on the events page remain unchanged.

## Desktop behavior

The authenticated desktop action group will contain, in order:

1. notification bell;
2. role-specific workspace link when applicable;
3. non-interactive member identity pill;
4. one menu-icon button.

The menu button opens a right-aligned dropdown containing:

- **Profile**, linking to `/profile`;
- **Log out**, using the existing guarded asynchronous logout behavior.

The separate desktop logout button, header search icon and popover, and icon-only account link will be removed. The menu uses the existing Radix-backed dropdown component so keyboard navigation, focus movement, outside-click dismissal, and Escape dismissal follow the application's established accessible pattern.

Selecting **Profile** closes the menu and navigates normally. Selecting **Log out** keeps the menu open while pending, disables repeat activation, and displays the existing spinner with **Logging out…**. Successful logout redirects to `/`; failed logout restores **Log out** and shows **Could not log out. Try again.** without exposing internal error details.

## Mobile behavior

Mobile keeps the existing primary hamburger navigation. Its authenticated session section retains separate **Profile** and **Log out** rows because the hamburger already acts as the combined menu at that width. The **Search events** row is removed.

The mobile menu remains open while logout is pending so its progress remains visible. Existing public navigation and role-specific workspace links are unchanged.

## Visual treatment

The new desktop menu trigger uses the same compact glass-and-metal control language as the existing header icon buttons. Its touch target remains at least 40 by 40 CSS pixels, it has a visible focus treatment, and its accessible label changes between **Open account menu** and **Close account menu**.

The dropdown is visually compact, right-aligned to the trigger, and uses plain labels with Profile and Log out icons. The identity pill keeps the member name and role treatment but no longer has link hover or active behavior.

## Scope

This change is limited to shared header controls. It does not change notification behavior, role-specific workspaces, event-page search and filtering, profile routing, logout server behavior, session policy, or signed-out header actions.

## Testing and verification

Test-first coverage will prove:

- the authenticated desktop header renders one account-menu trigger;
- the member identity pill is not a link;
- the desktop menu contains Profile and Log out;
- the old desktop logout, search, and account-icon controls are absent;
- header search state, handlers, popover, and mobile search row are absent;
- Profile closes the dropdown and links to `/profile`;
- logout remains guarded, shows **Logging out…**, prevents repeat activation, redirects on success, and restores safe feedback on failure;
- mobile retains Profile and Log out rows and stays open during logout;
- desktop and mobile layouts do not overflow.

After focused and full relevant automated checks pass, Codex browser verification will inspect the authenticated header at desktop and mobile widths, exercise menu open/close behavior and Profile navigation without saving data, and verify logout only with an approved disposable/local session.
