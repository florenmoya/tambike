# Event Detail Readability and Global Roster Privacy Design

**Date:** July 24, 2026
**Status:** Approved direction

## Context

The production event detail page is visually difficult to scan, especially on phones. The current hero uses a very large all-caps title and forces a square 1080 × 1080 poster into a portrait frame. On the audited page, the optimized poster rendered at roughly 395 × 549 pixels, which cropped the artwork and let it dominate the viewport before the explanatory content.

The event summary also exposes an existing-RSVP privacy editor containing `Event roster`, the current identity, `Profile default`, and `Change for this event`. Attendance privacy should be a global profile preference for now, not an event-page decision.

Production posters currently use Next.js Image Optimization on Vercel. The audited 333 KB source poster was delivered as an approximately 60 KB optimized image, and repeat requests were Vercel cache hits. The configured AWS account contains Tambike's private member-media S3 bucket, but it has no Tambike CloudFront distribution. The account's existing CloudFront distribution belongs to a separate heatmap project and must not be reused.

## Goals

- Make the event purpose, schedule, location, and available actions understandable within the first mobile viewport.
- Preserve the Tambike charcoal, burgundy, and amber identity while reducing visual noise and improving text readability.
- Display posters at their correct aspect ratio in a compact, responsive frame.
- Improve perceived and repeat image loading without adding a new CDN.
- Make the Profile attendance-privacy setting control all existing and future roster appearances.
- Preserve organizer roster enablement, privacy precedence, attendee counts, attendee pages, RSVP, passes, giveaways, and check-in behavior.

## Non-goals

- No new CloudFront distribution or public S3 event-poster bucket.
- No migration or deletion of the existing `RSVP.rosterIdentity` column in this pass.
- No redesign of the event discovery grid, rider profiles, attendee roster page, organizer console, giveaways, or pass screens.
- No change to who can enable an event roster or who can view member-only rider cards.
- No new event fields or content-management workflow.

## Experience Design

### Visual direction

Use a decision-first event brief rather than a poster-led campaign page.

- **Canvas:** near-black and deep burgundy surfaces already associated with Tambike.
- **Accent:** amber is reserved for event type, primary action, and important labels.
- **Typography:** use the existing application sans-serif in title case. The event title uses a readable `clamp()` scale of approximately 32–56 pixels with a line height near 1.05 instead of oversized `Arial Black` uppercase text.
- **Surfaces:** use quiet solid or lightly translucent panels with one-pixel borders. Remove the stacked rotated poster, route-line decoration, excessive shadows, and repeated glossy control treatment from this page.
- **Signature element:** a compact event brief band groups date, time, and location as the first structured information after the title.

### Responsive header

Desktop uses a two-column header:

- A square poster preview at approximately 280–360 pixels wide.
- The event type, title, short description, RSVP actions, and event brief band in the wider column.

Mobile uses a single-column header:

1. Event type
2. Title and short description
3. Date, time, and location
4. Going, Interested, and Share actions
5. Compact square poster preview, capped near 280 pixels and centered

The poster must never use a forced portrait ratio. It uses a square frame and `object-fit: contain` so the source composition is not cropped. A small `View full poster` link opens the original asset in a new tab only when the rider asks for it; this avoids a second image request during normal page load.

### Information order

After the header:

1. **What to expect** — the existing `whatHappens` copy.
2. **Ride or meetup details** — only when the event has ride-out data.
3. **Venue and map** — location name, area, address, and map action.
4. **Perk and attendance** — perk explanation plus Going, Interested, and Expected counts.
5. **Rules** — concise readable list or chips.
6. **Organizer** — organizer name and verification context.
7. **Giveaways** — existing public giveaway panel.

The attendee-roster link remains available when the roster surface is available. Only the inline per-event privacy editor is removed.

## Global Attendance Privacy

### User-facing behavior

Profile contains one attendance-privacy setting:

- `Anonymous — count me without my card`
- `Visible — show my eligible rider card`

Its copy must state that the setting applies to all current and future events. Changing the setting takes effect across all roster views after the save succeeds.

Privacy precedence remains:

1. Disabled organizer roster: counts only.
2. Private or unpublished rider profile: anonymous.
3. Global profile setting `ANONYMOUS`: anonymous.
4. Global profile setting `VISIBLE` plus an eligible published profile: rider card.

### Application behavior

- Remove `ExistingRsvpIdentityEditor` and `ExistingRsvpIdentityForm` from the event detail page.
- Remove the roster-identity field from registration. Registration no longer asks for an event-specific identity.
- Remove the event-specific roster identity methods from the demo provider and server actions when they have no remaining callers.
- Registration may continue writing the current profile default into `RSVP.rosterIdentity` for backward-compatible storage, but roster classification and visibility queries must use the user's current `defaultRosterIdentity`.
- Existing `RSVP.rosterIdentity` values become compatibility data and must not override the global preference.
- Do not drop or rewrite the database column in this pass.

### Data flow

1. A rider saves attendance privacy in Profile.
2. The existing profile update action validates and stores `User.defaultRosterIdentity`.
3. Event attendee summary and roster queries join the current user/profile state.
4. Roster classification applies organizer enablement, publication/visibility, and the current global identity.
5. Event pages show counts and the attendee link without loading or rendering a rider-specific privacy editor.

## Poster Loading and Caching

### Current finding

The production poster request is already optimized by Next.js and served through Vercel, not CloudFront. A warm request is an edge-cache hit. The visible loading problem is therefore addressed first through correct sizing, immutable asset identity, and a placeholder rather than new infrastructure.

### Implementation direction

- Add a focused event-poster asset resolver that maps bundled demo poster paths or event IDs to static imports.
- Keep the event data's string poster field for compatibility; components resolve known bundled posters to `StaticImageData` and fall back to the string for unknown future sources.
- Use the static import metadata for intrinsic dimensions and a generated blur placeholder.
- Give the detail poster an accurate `sizes` value matching its capped responsive width.
- Preload only the single above-the-fold event-detail poster. Discovery cards keep selective priority for the actual leading image and lazy-load the rest.
- Rely on static imports to content-hash bundled files and give them immutable caching, as documented by the repository's installed Next.js 16.2.9 image implementation. Do not raise the global optimizer TTL for unknown future sources.
- Verify generated `srcset`, selected resource width, response size, cache headers, and repeat-request cache behavior in the built application and production deployment.

CloudFront remains out of scope. If later measurements show Vercel image delivery is insufficient, Tambike would require its own public-assets distribution and bucket boundary rather than reusing the private member-media bucket or the unrelated heatmap distribution.

## Component and File Boundaries

- `src/features/tambike-demo/tambike-screen.tsx`
  - Restructure `EventDetail`.
  - Simplify `RsvpModal`.
  - Remove the existing-RSVP privacy editor.
- `src/features/tambike-demo/event-poster-assets.ts`
  - New static poster imports and resolver.
- `src/features/tambike-demo/demo-provider.tsx`
  - Remove event-specific roster identity client methods and registration argument.
- `src/features/member-profiles/profile-settings.tsx`
  - Update attendance-privacy copy to describe global behavior.
- `src/server/actions.ts`
  - Remove event-specific roster identity actions if unused.
- `src/server/backend.ts`
  - Use current global profile identity for in-memory roster classification.
- `src/server/prisma-backend.ts`
  - Use `User.defaultRosterIdentity` in roster visibility/count queries.
  - Keep compatibility writes to `RSVP.rosterIdentity`.
- `src/app/globals.css`
  - Replace the event-detail hero and responsive rules with the decision-first layout.
  - Remove obsolete existing-RSVP editor styles.
- Existing roster, profile, event-page, and responsive tests
  - Update contracts and add regressions for the new global behavior and layout.

## Error Handling

- Profile privacy saves retain the existing pending, success, and failure feedback.
- Failed profile saves do not optimistically alter roster behavior.
- Unknown or non-bundled poster paths fall back to the existing string source and do not break rendering.
- Image layout reserves its final dimensions to avoid layout shift.
- A missing poster continues to use Next/Image failure behavior in this pass; no unrelated upload or fallback-image workflow is added.
- Existing RSVP, authentication, map, giveaway, and attendee-page errors remain unchanged.

## Accessibility

- Maintain one page-level `h1` in title case.
- Preserve descriptive poster alt text.
- Ensure body text and muted text meet WCAG AA contrast against the simplified surfaces.
- Keep actions at least 44 pixels high on touch devices.
- Maintain visible focus states and semantic buttons/links.
- Do not encode date, time, location, or RSVP state through color alone.
- The `View full poster` link must clearly communicate that it opens a new tab.

## Testing and Verification

### Automated

- Unit/contract tests prove the global profile setting, not `RSVP.rosterIdentity`, determines existing and future roster visibility.
- Tests preserve private/unpublished-profile anonymity and organizer roster-off count-only behavior.
- Registration tests prove no event-specific privacy choice is required.
- UI contracts prove the event page no longer contains `Event roster`, `Profile default`, or `Change for this event`.
- Profile tests prove the global copy and both identity options remain present.
- Responsive regression tests cover 360, 390, 768, 1024, and 1440 pixel widths with no horizontal overflow.
- Image tests or source contracts prove known posters resolve to static imports, use accurate `sizes`, and reserve a square layout.
- Run targeted server tests, Prisma roster integration tests, lint, production build, and `git diff --check`.

### Browser

Use the Codex browser against the local built or development app and production deployment:

- First viewport shows event purpose, schedule, location, and actions clearly.
- Mobile poster is compact, square, uncropped, and does not consume a full viewport.
- Desktop poster and text remain balanced.
- Roster privacy editor is absent from event details.
- Profile global privacy control saves and changes existing roster output.
- RSVP, attendee link, map, share, and giveaway surfaces still work.
- Inspect the selected poster request, decoded dimensions, transfer size, cache headers, and warm-cache behavior.
- Confirm no new console errors.

## Acceptance Criteria

- At 390 × 844, the title, short description, date, time, location, and primary RSVP action are available before or near the first scroll boundary.
- The Cafe Classico poster renders square without clipping its source artwork and is capped near 280 pixels on mobile.
- `View full poster` opens the original asset in a new tab without preloading a second copy.
- Event detail text is readable without oversized uppercase display typography.
- The inline existing-RSVP privacy block is removed.
- Registration has no per-event roster identity choice.
- Saving Profile attendance privacy changes all eligible existing and future roster appearances.
- Organizer roster disablement and private/unpublished profile anonymity still override visibility.
- Known bundled posters use static import metadata, responsive selection, and blur placeholders.
- No Tambike CloudFront resource is created or the unrelated distribution reused.
- Required automated and browser checks pass before publication.
