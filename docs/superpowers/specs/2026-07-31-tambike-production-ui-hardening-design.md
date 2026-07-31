# Tambike Production UI Hardening Design

**Date:** 2026-07-31  
**Status:** Approved design  
**Primary requirements:** `tambike-platform-mvp-requirements-ui-wireflow.md`

## 1. Objective

Bring every Tambike route to a production-ready standard: visible controls must represent real, authorized, persisted behavior; displayed data must come from stored records; content must sound intentionally written for riders and operators; and all supported pages must work without layout, accessibility, or navigation defects across mobile and desktop.

This work is a production hardening pass over the existing Tambike product, not a visual rebrand. Existing working RSVP, rider profile, check-in, giveaway, roster privacy, and media behavior remains in place unless verification exposes a specific defect.

## 2. Confirmed product decisions

The following decisions were explicitly approved:

1. Complete the repair as production vertical slices rather than a UI-first pass or a single backend-first rewrite.
2. Remove the batch-upload and validation-import feature completely. Do not invent an import format or preserve a simulated upload surface.
3. Make account suspension reversible, audited, immediately session-revoking, and history-preserving. Prevent self-suspension and suspension of the last active admin.
4. Use this event-review lifecycle:
   - Request changes requires a reason and returns the submission to the organizer for editing and resubmission.
   - Reject requires a reason and is final for that submission; the organizer may duplicate it into a new draft.
   - Disable requires a reason, hides a published event, and blocks new registrations without destroying existing records.
   - Restore sends the event back to admin review rather than republishing it directly.
5. Allow organizers to manage leads only for events they own. Allow admins to manage all leads.
6. Accept guest and authenticated lead submissions. Link authenticated submissions to the rider account.
7. Replace all synthetic analytics with aggregates derived from stored records.
8. Retain lead contact data for 90 days by default, with the period configurable.

## 3. Chosen delivery approach

Each production vertical slice includes its database changes, domain rules, authorization, server actions/loaders, UI, automated checks, and browser verification. A slice is not complete while any of its visible behavior remains local-only, simulated, or unverified after reload.

The slice order is:

1. Account suspension and restoration
2. Event review lifecycle
3. Test-ride lead capture and management
4. Record-backed reporting and exports
5. Site-wide UI, content, responsive, metadata, and accessibility hardening
6. Exhaustive role, route, device, and persistence regression

This order resolves deceptive high-impact controls first, then replaces fabricated operational data, then performs the cross-site presentation pass against truthful behavior.

### Alternatives considered

- **Backend-first rebuild:** architecturally orderly, but it keeps misleading UI active for too long and defers integration failures.
- **Page-by-page UI cleanup:** produces visible changes quickly, but allows fake operations to survive and encourages duplicate backend wiring.

## 4. Production architecture

The request path is:

```text
Role-scoped UI
  -> server action or server loader
  -> authentication and authorization
  -> domain service
  -> Prisma transaction
  -> Postgres and audit record
```

### Runtime rules

- Production requires valid Postgres configuration. Missing production database configuration must fail clearly instead of silently switching to the in-memory backend.
- The in-memory backend remains available only through an explicit local/test configuration.
- The in-memory and Prisma implementations expose the same domain contract so tests exercise the same transitions and authorization semantics as production.
- Public pages receive public view models only. Admin, lead contact, audit, and other restricted fields must not enter public client state.
- Organizer view models are owner-scoped. Admin view models are role-scoped and should contain only fields required by the screen.
- Existing global demo snapshots should be reduced or bypassed for sensitive operational pages in favor of focused server loaders.

### Mutation rules

- Every mutation validates input on the server and checks authorization inside the domain operation.
- Operational mutations use transactions and conditional status updates so stale tabs cannot overwrite a newer decision.
- The UI reports success only after the transaction commits.
- Mutation responses use a consistent, structured success/error envelope.
- Affected routes and view models are refreshed from persisted state after success.
- Audit metadata never stores passwords, session tokens, phone numbers, or other sensitive payloads.

## 5. Persisted state design

### 5.1 Account access

Verification and account access are separate concepts.

- `verificationStatus`: `UNVERIFIED`, `PENDING`, `APPROVED`, `REJECTED`
- `accountStatus`: `ACTIVE`, `SUSPENDED`

Existing suspended users are safely backfilled into the new account-access state. A suspension records:

- suspended user
- admin actor
- required reason
- suspension timestamp

Suspension and session deletion occur in the same transaction. Restore changes `accountStatus` back to `ACTIVE`; it does not alter verification state. The service rejects attempts to suspend the acting admin or the last active admin.

Account suspension and restoration create audit entries. Historical RSVPs, events, check-ins, giveaway records, and other authored data remain intact.

### 5.2 Event review

Add a distinct `DISABLED` event state. `CANCELLED` remains an organizer/event lifecycle state and is not reused for admin enforcement.

Event review history is append-only and records:

- event and submission version
- reviewer
- decision
- reason or conditions where applicable
- submitted and decided timestamps

Allowed transitions are enforced server-side:

```text
PENDING_ADMIN_REVIEW -> PUBLISHED
PENDING_ADMIN_REVIEW -> NEEDS_CHANGES
PENDING_ADMIN_REVIEW -> REJECTED
NEEDS_CHANGES -> PENDING_ADMIN_REVIEW
PUBLISHED -> DISABLED
DISABLED -> PENDING_ADMIN_REVIEW
```

Request changes, rejection, disablement, restoration, resubmission, and approval all create traceable records. Conditional updates reject duplicate or stale decisions.

### 5.3 Test-ride leads

The lead record supports:

- event and optional authenticated rider
- name and normalized phone
- current motorcycle, interested model, and preferred time
- consent version and timestamp
- workflow status: `NEW`, `CONTACTED`, `COMPLETED`, or `CLOSED`
- created and updated timestamps
- retention expiry and optional purge timestamp

Repeated active submissions for the same event and normalized phone update the existing request safely instead of creating uncontrolled duplicates. The event must support test-ride lead collection and must be publicly eligible for submissions.

Lead contact data is retained for 90 days by default. The retention period is configurable without a schema change. An idempotent cleanup process anonymizes the existing row after expiry: it clears the user link, phone and deduplication fingerprint, name, consent metadata, and all rider-entered free text, then records `purgedAt`. The event reference, workflow status, creation time, and purge time remain for anonymous aggregate counts. This keeps the design on the operational database without introducing a second analytics store.

Lead access rules:

- Event owners may list, reveal, update, and export leads for owned events.
- Admins may do the same across the platform.
- Other organizers and riders cannot access lead records.
- List views mask phone numbers.
- Contact reveal, status changes, and exports are audited without copying contact data into audit metadata.

### 5.4 Reporting data

Initial reporting derives directly from indexed operational records:

- event creation and approval timestamps
- RSVP creation/status timestamps
- confirmed check-in timestamps
- perk redemption timestamps
- lead creation timestamps

No separate analytics store is introduced in this hardening pass. Add or verify indexes needed for event ownership, status, date range, and timestamp queries.

Admin reporting covers the platform. Organizer reporting is limited to owned events. Supported periods are 7, 30, and 90 days. Aggregation uses the event timezone, with Asia/Manila as the fallback.

Summary cards, charts, detailed rows, and CSV exports must share reporting queries or a shared reporting service so totals cannot diverge.

## 6. User interface and content design

### 6.1 Site-wide rules

- Preserve the current Tambike visual identity.
- Add route-specific metadata. Dynamic event routes use the event name in the document title.
- Every page has one meaningful primary heading.
- Add a keyboard-accessible skip link and visible focus treatment.
- Ensure controls use correct button, link, input, label, dialog, and heading semantics.
- Do not autofocus mobile search.
- Provide consistent loading, empty, validation, success, and failure states.
- Remove empty footer/navigation groups and controls with no working outcome.
- Avoid internal implementation and policy language in public UI.
- No page-level horizontal overflow at widths of 320px and above.

### 6.2 Public and rider surfaces

- Rewrite awkward footer, perk, event, and status copy in normal rider language.
- Keep “Going,” “Interested,” and estimated attendance distinct. “Who’s going” must not imply that interested or estimated riders are confirmed attendees.
- Preserve roster and profile privacy behavior while keeping compact attendee social proof near RSVP decisions.
- Simplify the signed-in mobile header. Keep the brand and essential actions visible; move workspace and account controls into the menu.
- Give invalid check-in, unavailable claim, and unavailable draw states semantic headings and a relevant next-step link.
- Success messages must describe the committed outcome, not a future or simulated action.

### 6.3 Organizer surfaces

- Render organizer social URLs as clearly labelled external links.
- Shorten giveaway instructions while retaining required safety and authorization information.
- Add lead management to owned test-ride event workspaces.
- Replace generated charts with owner-scoped reporting data.
- Use honest empty states when the selected period has no activity.

### 6.4 Admin surfaces

- Replace client-only user and event status overrides with server-backed actions.
- Require confirmation and a reason for suspension, request changes, rejection, disablement, and other high-impact operations.
- Remove the validation section, upload component, fabricated upload rows, and all related navigation/copy.
- Rebuild `/admin/leads` as a responsive lead-management view with masked contacts, ownership/event filters, status filters/actions, audited reveal, and export.
- Use column priority and mobile cards for operational tables rather than horizontal page scrolling.
- Label report periods in user terms such as “Last 30 days”; do not expose internal terms such as RBAC, sanitized audit trail, or validation imports.

## 7. Action behavior and failure handling

- Client validation improves feedback but never replaces server validation.
- Pending controls block accidental double submission.
- Public lead submission uses an idempotency key, a honeypot, normalized phone validation, and database-backed rate limiting.
- High-impact actions use confirmation dialogs and require meaningful reasons.
- Access is checked inside each backend operation regardless of whether the UI displayed the control.
- Missing, inaccessible, invalid, expired, and conflicting states use distinct privacy-safe messages.
- Public errors do not reveal account existence, protected identifiers, stack traces, or internal policy details.
- Lead and event actions use conditional transactions to detect stale views.
- Retention cleanup is retry-safe and reports aggregate counts.
- CSV output is protected against spreadsheet formula injection and follows the same authorization and filtering rules as the visible report.

## 8. Removal and cleanup inventory

Remove:

- `FileUpload06` from all active application surfaces
- the admin validation/import section and navigation item
- hard-coded upload progress and fabricated upload history
- client-only user and event status overrides
- synthetic chart dates and pseudo-series
- seeded lead rows in runtime exports
- generic global-only metadata
- empty footer/workspace sections
- public/internal copy identified in the UI QA

Production seed data must not create QA artifacts. Existing remote/live records that appear to be test artifacts are not deleted automatically. A cleanup utility must support dry-run identification, and actual deletion requires explicit environment approval.

## 9. Verification strategy

### 9.1 Automated checks

Each slice must pass:

- Prisma client generation
- migration validation on a disposable database
- type checking
- linting
- production build
- the existing relevant test suite
- focused domain and integration tests added to existing appropriate test locations

Required behavioral coverage includes:

- account suspension/restoration and last-admin protection
- immediate session invalidation
- the complete event transition matrix
- stale and duplicate decision rejection
- lead creation, deduplication, ownership, masking, reveal, status, export, retention, and rate limits
- reporting range and timezone aggregation
- agreement among cards, charts, detail views, and CSVs
- audit and export sensitive-data protections

### 9.2 Browser verification

Browser acceptance uses only the Codex browser surface.

- Recheck all 41 discovered route patterns.
- Cover guest, rider, organizer, and admin roles where applicable.
- Exercise genuine success and failure flows with disposable local data.
- Reload after every operational mutation to prove persistence.
- Verify a second session observes the same committed result.
- Test 320px, 390x844, tablet, and desktop layouts.
- Check headings, keyboard navigation, focus order, dialogs, labels, touch targets, metadata, empty states, and console output.
- Confirm direct URLs cannot bypass role or ownership restrictions.
- Confirm no supported page produces page-level horizontal overflow.

## 10. Delivery and release safeguards

- Preserve all existing dirty worktree changes. Stage and commit only intentional files.
- Use small, reviewable checkpoints aligned with the vertical slices.
- Prefer additive and backward-compatible database migrations, with a documented rollback path.
- Do not run migrations, cleanup, or mutation-based QA against a remote/live database without separate explicit approval for that environment.
- Produce a route-by-route final QA report with evidence, known limitations, and any unexercised state.

## 11. Definition of done

The hardening effort is complete only when:

- no visible control is simulated or local-only
- no displayed operational data is fabricated
- every successful mutation persists after reload
- role and ownership rules hold under direct-route and server-action access
- no unresolved high-severity UI or data-integrity issue remains
- all supported routes have meaningful metadata, headings, and states
- responsive browser QA has no page-level overflow
- automated gates and the production build pass
- lead contact handling follows the approved access and retention rules
- the final QA report documents objective evidence for every route family
