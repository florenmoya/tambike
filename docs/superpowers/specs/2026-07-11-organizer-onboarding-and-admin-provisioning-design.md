# Organizer Onboarding and Admin Provisioning Design

## Goal

Complete organizer verification so a signed-in rider can apply to host events, an admin can approve or reject the application, and an admin can directly create an approved organizer account.

## Scope

- Preserve rider-first public signup. Public registration never creates an organizer directly.
- Require an authenticated user for the organizer application route.
- Store organizer application fields in `OrganizerProfile`: organizer type, display name, real name, contact number, Facebook/page link, and past-event links.
- A submitted self-service application changes the user role to `organizer` and keeps both user and profile verification statuses `PENDING`.
- Pending and rejected organizers cannot create event drafts. An approved organizer can create drafts using the existing flow.
- Let an authenticated admin approve or reject an organizer application and supply an optional private decision note.
- Let an authenticated admin create an organizer with account identity, organizer profile details, and a password. The created account and profile are immediately `APPROVED`.
- Record application submission, review decisions, and admin-created organizers in the existing audit mechanism.

## Non-goals

- Email invitations, password-reset emails, or delivery of temporary-password messages.
- Uploading or storing government IDs, driver licenses, or other sensitive verification documents.
- Allowing pending organizers to create event drafts.
- Changing venue verification or event publishing behavior.

## Architecture

The backend contract gains dedicated organizer inputs and methods. Both `TambikeBackend` (in-memory) and `PrismaTambikeBackend` implement the same behavior, so development and deployed database modes remain consistent. Server actions enforce the cookie-backed session boundary and return refreshed `DemoState` for the client provider.

The organizer application page becomes a real client form. It submits through `DemoProvider`, gives clear pending/duplicate/error feedback, and redirects approved organizers to their dashboard only after an admin decision. The admin organizer-verification screens stop using local-only status overrides and instead call the server-backed approval/rejection and creation actions.

## Data and State Rules

| Path | User role/status | Organizer profile status | Event creation |
| --- | --- | --- | --- |
| Public signup | `rider` / `UNVERIFIED` | none | blocked |
| Organizer application submitted | `organizer` / `PENDING` | `PENDING` | blocked |
| Admin approval | `organizer` / `APPROVED` | `APPROVED` | allowed |
| Admin rejection | `organizer` / `REJECTED` | `REJECTED` | blocked |
| Admin-created organizer | `organizer` / `APPROVED` | `APPROVED` | allowed |

An applicant may not submit another application once they have an organizer profile. Duplicate email addresses are rejected for admin-created accounts. Only admins may review or create organizers. Admin notes stay private and are not returned on public organizer data.

## UI Flow

1. A rider logs in and opens `/organizer/apply`.
2. The page shows the required application fields. On successful submission, it confirms that review is pending and links to the user profile.
3. An admin opens the organizer verification queue, reviews the complete application, and chooses Approve or Reject. The outcome is saved server-side.
4. An admin can choose Create organizer, enter account/profile details, and create an immediately approved host account.
5. An approved organizer can open `/organizer/events/create`; pending/rejected organizers receive an honest access message instead.

## Error Handling

- Unauthenticated application, review, and admin-create actions return `UNAUTHENTICATED`.
- Non-admin review/create attempts return `FORBIDDEN`.
- Missing required fields, duplicate email, duplicate organizer application, or an invalid password return `INVALID_INPUT`.
- An application that targets a missing user/profile returns `NOT_FOUND`.
- UI messages use these errors to explain the next action without exposing admin notes or account existence beyond the acting admin.

## Verification

- Domain tests prove rider application enters `PENDING`, pending organizers cannot create events, admin approval unlocks event creation, non-admin review/create is rejected, and admin-created organizers are immediately approved.
- The same domain contract is exercised in the in-memory backend; Prisma implementation is covered through type-compatible behavior and existing database integration setup where configured.
- UI tests cover application validation/submission, pending status feedback, admin review, and direct admin organizer creation.
- Run focused server tests, UI test coverage, lint, build, and a browser check against the existing dev server if it is available.
