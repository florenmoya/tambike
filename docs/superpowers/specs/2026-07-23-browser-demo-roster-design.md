# Browser-created production demo roster

## Goal

Populate the production `Tambike at Cafe Classico` attendee roster through the same browser flows a rider uses, so the roster can be evaluated with many distinct rider cards while signup, authentication, profile editing, media upload, RSVP identity, and pass creation are exercised together.

## Scope

- Keep the existing Mika sample rider.
- Create 11 additional fictional public rider accounts, yielding 12 visible rider cards.
- Create 2 additional fictional rider accounts that attend anonymously.
- Register all 13 new accounts as Going for `tambike-cafe-classico`.
- Use the production application UI for every account, profile, upload, and RSVP mutation.
- Do not insert or update production database rows directly.
- Do not modify organizer settings, real user records, or existing RSVPs.

## Demo identities

Each visible rider has:

- A unique natural-sounding fictional display name with `— Demo Rider` appended.
- A unique namespaced email that is not displayed publicly.
- A strong generated password stored only in a local DPAPI-encrypted inventory.
- A Philippine city or area.
- A short fictional garage note that identifies the profile as demo content.
- A public, published profile with Visible as the default roster identity.
- One distinct fictional motorcycle with make, model, year, displacement, nickname, and note.
- One generated avatar and one generated motorcycle hero image uploaded through Profile Settings.

Each anonymous attendee has:

- A unique namespaced email and encrypted generated password.
- A private profile.
- A Going RSVP with Anonymous roster identity.
- No public profile media requirement.

The encrypted local inventory records only the created demo accounts and is never committed. It is the cleanup allowlist.

## Browser workflow

For each public rider:

1. Open production signup.
2. Create the rider account using the assigned fictional identity.
3. Complete or open Profile Settings.
4. Save the public profile and Visible attendance default.
5. Upload the assigned avatar through the avatar control.
6. Save motorcycle details.
7. Upload the assigned motorcycle hero through the motorcycle-photo control.
8. Open the Cafe Classico event.
9. Register as Going and Visible.
10. Confirm the pass and compact event-roster status.
11. Log out before starting the next account.

For each anonymous attendee:

1. Create the account through production signup.
2. Keep or set the profile Private.
3. Open the Cafe Classico event.
4. Register as Going and Anonymous.
5. Confirm the attendee contributes to the anonymous count without exposing a card.
6. Log out.

## Assets

Prepare 11 distinct fictional avatar and motorcycle-image pairs locally. Images must not depict real identifiable people supplied by the user. Uploads must use the production media controls so normalization, private object storage, replacement handling, and same-origin delivery are covered by the run.

One avatar and one motorcycle hero per public demo rider are sufficient for roster-density evaluation. Full five-image galleries are outside this run.

## Safety and recovery

- Use a deterministic email namespace and the encrypted inventory to distinguish demo accounts from real accounts.
- Check whether an intended demo email already exists through the signup result before proceeding; never overwrite or repurpose an existing account.
- Stop the run on unexpected validation, authentication, upload, RSVP, or deployment errors.
- Do not compensate with direct SQL or AWS object deletion.
- Preserve successful browser-created accounts if the run stops; record the last completed step so the run can resume safely.
- Cleanup is a separate, explicitly authorized operation limited to the inventory allowlist.
- Never print passwords, session tokens, database URLs, storage keys, or signed media URLs.

## Verification

After population:

- Sign in as a demo rider and open `/events/tambike-cafe-classico/attendees`.
- Confirm 12 visible cards total, including Mika.
- Confirm the anonymous count increased by 2 while no anonymous profile card appears.
- Confirm each new visible card has the expected display name, city, avatar, and motorcycle hero.
- Confirm card order, desktop wrapping, mobile stacking, and keyboard navigation.
- Open several rider pages to verify public data and ensure email or internal identifiers are absent.
- Verify the event-page roster control remains compact until `Change for this event` is opened.
- Check the live browser console and production error logs for errors generated during the run.

## Completion criteria

The run is complete when all 13 browser-created accounts have successful Going RSVPs, the roster shows 12 visible cards plus the correct anonymous aggregate, representative public profiles and media render correctly, no sensitive fields are exposed, and the encrypted cleanup inventory contains exactly the newly created demo accounts.
