# Login Failure and Redirect Feedback Design

## Decision

Tambike will make password-login failures understandable without exposing whether an email address is registered. Expected authentication failures will cross the Server Action boundary as a typed, serializable result instead of a thrown exception. A successful login will keep a prominent busy state visible until the browser leaves the login page.

The user-facing invalid-credentials message is **“Email or password is incorrect.”** Unexpected infrastructure or application failures retain **“Something went wrong. Try again.”**

## Current behavior and root cause

Production browser verification reproduces the reported behavior: an invalid login renders the generic fallback, and a successful login can remain on the login page long enough to appear stuck before reaching the destination.

The backend correctly distinguishes invalid credentials from other failures, but the expected `UNAUTHENTICATED` exception currently escapes through a Server Action. Next.js removes production exception details at that boundary, so the client cannot identify the expected failure and renders its generic fallback.

The login button already changes its text while the authentication request is pending. The feedback is easy to miss because it has no spinner or accompanying status, and the component clears `pending` in `finally` immediately after calling `window.location.replace()`. That allows the login form to look idle again while document navigation is still starting.

## Server Action contract

The password-login Server Action will return this discriminated result:

```ts
type LoginActionResult =
  | { ok: true; state: DemoState }
  | { ok: false; code: "INVALID_CREDENTIALS" | "ACCOUNT_SUSPENDED" };
```

The cases are:

- success: the authenticated application state needed by the existing provider;
- invalid credentials: a stable `INVALID_CREDENTIALS` code;
- suspended account: a stable `ACCOUNT_SUSPENDED` code;
- unexpected failures: continue to throw so they are not mislabeled as credential mistakes.

Only known backend authentication errors are converted to typed results. Invalid email and invalid password share the same code and copy. Suspension remains distinguishable only after the backend has verified the correct password, preserving the existing account-disclosure boundary.

The provider will consume the typed result, apply authenticated state only on success, and return `{ ok: true, user }` or the unchanged `{ ok: false, code }` result to the login screen. The screen therefore handles expected failures without depending on production exception messages.

## Login screen behavior

Submitting valid-looking credentials will:

1. clear any prior inline error;
2. mark the form busy and disable repeat submission;
3. show a visible spinner and **“Signing you in…”** inside the submit button;
4. expose the busy state through `aria-busy` and an accessible live status;
5. on an expected failure, show the mapped inline message and restore the enabled form;
6. on success, call `window.location.replace()` and keep the busy state active until the document unloads.

The successful path will not reset the pending state in `finally`. Pending is cleared only when the action returns a failure or throws before navigation. Inputs keep their values after a failed login so the user can correct only the wrong field.

## Error messages

| Result | Message |
| --- | --- |
| Invalid email or password | Email or password is incorrect. |
| Correct credentials for a suspended account | This account is suspended. Contact Tambike support. |
| Unexpected failure | Something went wrong. Try again. |

The public UI will not display backend error codes, stack details, provider details, or whether an email exists.

## Scope

This change is limited to password login feedback and its redirect transition. It does not change password rules, session lifetime, destination selection, account recovery, signup, backend credential verification, or account-suspension policy.

## Testing and verification

Test-first coverage will prove:

- invalid credentials return the serializable `INVALID_CREDENTIALS` result rather than throwing;
- suspended accounts return `ACCOUNT_SUSPENDED` only after valid password verification;
- unexpected failures are not converted to invalid-credential responses;
- the login UI maps each expected result to its approved copy;
- failed login restores the enabled form;
- successful login calls `window.location.replace()` while retaining the busy state;
- the button exposes a spinner and **“Signing you in…”** during authentication and navigation.

After targeted and full relevant automated checks pass, Codex browser verification will repeat the wrong-password and successful-login flows on the local application. Production verification requires a later deployment and is not claimed by the local change.
