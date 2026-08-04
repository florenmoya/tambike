# Logout Feedback and Redirect Design

## Decision

Tambike will replace the desktop icon-only logout control with a clearly labeled **Log out** button and give both desktop and mobile logout controls the same visible pending and error behavior. A successful logout will perform a full-page redirect to the public homepage at `/`.

## Current behavior and root cause

Local browser verification reproduced the reported experience. On desktop, the logout button has the accessible name **Log out** but renders no visible text. After it is clicked, the same enabled icon remains unchanged while the asynchronous Server Action clears the session. The signed-in header silently changes to signed-out links only after the request completes.

The mobile navigation already renders an icon and visible **Log out** text, but it immediately closes the menu and starts the same fire-and-forget request. Neither control owns a pending state, disables repeat clicks, reports progress, handles logout failures, or deliberately navigates after success.

## Interaction behavior

Desktop and mobile will share one logout handler and one state within the application header:

1. The idle control displays the logout icon and the visible label **Log out**.
2. Clicking it clears any previous logout error, marks logout as pending, and disables both logout controls.
3. While pending, the activated control displays a spinner and **Logging out…**. The mobile menu remains open so this feedback stays visible.
4. The pending state is exposed with `aria-busy`, and repeat logout requests are prevented.
5. On success, the browser calls `window.location.replace("/")` and keeps the pending state active until the document unloads.
6. On failure, the pending state is cleared, the control returns to **Log out**, and the header displays **Could not log out. Try again.**

The error message will use an accessible alert/status treatment without exposing exception text, infrastructure details, session implementation, or backend codes.

## Visual treatment

The desktop control will use a normal compact text-button treatment that fits the existing header actions rather than the square icon-only style. The icon may remain as a supporting cue, but the visible label is always present. Mobile keeps its current menu-row layout and adopts the same idle, pending, disabled, and failure states.

The spinner will use the application's existing lightweight loading treatment where possible. The change will not add a confirmation dialog because logout is reversible by signing in again and the requested problem is unclear/invisible progress rather than accidental activation.

## State and error handling

The existing provider-level `logout()` operation remains responsible for clearing the server session and applying the returned signed-out application state. The header owns only presentation state around that promise.

Expected flow:

```text
idle -> pending -> successful full-page redirect
                -> failure message -> idle/retry
```

Pending is not reset on success before navigation. This avoids the same stuck-looking gap that was corrected in the login flow.

## Scope

This change is limited to the shared application-header logout controls and their asynchronous feedback. It does not change session duration, authentication policy, login behavior, account menus, role-specific navigation, or server-side session invalidation.

## Testing and verification

Test-first coverage will prove:

- the desktop logout control has visible **Log out** text;
- desktop and mobile use the same guarded logout handler;
- clicking logout disables repeat submission and shows **Logging out…** with a spinner;
- successful logout calls `window.location.replace("/")` and retains the busy state;
- failed logout restores the controls and shows **Could not log out. Try again.**;
- the mobile menu stays visible while logout is pending.

After targeted and full relevant automated checks pass, Codex browser verification will repeat the organizer login/logout flow at desktop and mobile dimensions. It will confirm the visible label, immediate pending feedback, disabled state, successful homepage redirect, signed-out header, and absence of horizontal overflow.
