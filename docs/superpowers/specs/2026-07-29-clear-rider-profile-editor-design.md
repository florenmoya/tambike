# Clear rider profile editor design

## Goal

Make `/profile` an unmistakable editing workspace. Riders should immediately know:

1. which details are required to publish;
2. which details are optional;
3. how to add profile and motorcycle photos; and
4. where to see the profile exactly as other riders see it.

The redesign removes redundant editor/preview controls and reduces the amount of interface shown before the first form field.

## Information architecture

### `/profile`

`/profile` is edit-only. It does not embed the public rider card and does not show an `Edit profile` mode button.

The header contains:

- eyebrow: `Rider profile`;
- heading: `Your rider profile`;
- description: `Add the details riders see when they open your profile.`;
- one compact publication state; and
- at most one viewing action.

The viewing action is contextual:

- Published profile: `View public profile`, linking to `/riders/[slug]`.
- Unpublished profile: `Preview profile`, linking to `/profile/preview`.

There is no second `View your rider page` action inside the publication state.

### `/profile/preview`

`/profile/preview` is authenticated and renders the same `RiderGarageView` used by the public rider page.

It contains only a compact owner notice with:

- `Preview — only you can see this`; and
- `Back to edit`.

It does not repeat Garage Studio, publication status, completion signals, or edit/preview mode controls.

### `/riders/[slug]`

The published route remains the authoritative view other riders see. It receives no owner-only editing controls so the page remains an exact public representation.

## Publication state

Replace the large status panel with a compact status treatment near the header:

- Published: `Live`.
- Complete but unpublished: `Ready to publish` with the existing publish action.
- Incomplete: `Complete your profile` with the first missing requirement named.

The existing three-signal checklist is shown only while incomplete. A completed profile does not need three large confirmation pills.

Publication requirements are:

- display name;
- area or city;
- motorcycle make;
- motorcycle model; and
- at least one motorcycle photo.

Avatar, notes, year, displacement, nickname, visibility selection, and attendance privacy are not presented as publication requirements.

## Form labels and guidance

Show a legend before the form: `* Required to publish`.

Required labels:

- `Display name *`
- `Area / city *`
- `Make *`
- `Model *`
- `Motorcycle photos *`

Optional labels explicitly include `(optional)`:

- `Garage note (optional)`
- `Profile photo (optional)`
- `Year (optional)`
- `Displacement (cc) (optional)`
- `Nickname (optional)`
- `Motorcycle note (optional)`

Required indicators must be visible text, not color alone. Existing native `required` attributes remain on required form controls.

## Photo upload experience

### Profile photo

Profile photo upload becomes one step:

1. The rider selects a JPEG, PNG, or WebP image.
2. Upload begins immediately.
3. The interface shows preparing, uploading, finishing, success, or actionable failure status.

The control is labeled `Choose profile photo`. The helper says `Optional · Square images work best · JPEG, PNG, or WebP · Up to 8 MB.`

The selected-image preview remains visible while uploading. The existing uploaded photo and Delete action remain.

### Motorcycle photos

Motorcycle photos keep automatic upload and multi-file selection.

The section always exposes capacity:

- Empty: `0 of 5 photos · Add up to 5`.
- Partially filled: `{count} of 5 photos · Add up to {remaining} more`.
- Full: `5 of 5 photos · Delete one to add another`.

When full, replace the inactive upload prompt with the explanatory full-gallery message. Do not leave a disabled `Choose photos` control as the only feedback.

The helper says `The first photo is your cover. JPEG, PNG, or WebP · Up to 8 MB each.`

Existing queue progress, retry, refresh, cover selection, move left/right, drag reorder, and Delete behavior remain.

## Layout

Desktop header:

```text
RIDER PROFILE                         [Live] [View public profile]
Your rider profile
Add the details riders see when they open your profile.
```

Mobile header stacks the compact state and action below the description. The first form card should begin without an intervening mode switch or large completed-status panel.

Form sections remain cards because they separate identity, privacy, profile photo, motorcycle details, and motorcycle photos. The redesign removes top-level duplication instead of hiding fields behind a wizard.

## Accessibility and errors

- Required indicators are part of label text.
- The legend explains the asterisk.
- Upload progress remains in an `aria-live` region.
- Upload failures say how to recover.
- Disabled/full photo state has visible explanatory text.
- Viewing and back actions are links because they navigate to separate routes.
- Existing minimum target sizes, focus treatments, and reduced-motion behavior remain.

## Data and security

No schema, storage policy, publication rule, ownership check, or public-profile DTO changes are required.

`/profile/preview` uses the authenticated editor data transformed through the existing preview adapter. It must not expose account-only fields.

## Verification

Automated coverage must prove:

- `/profile` has no edit/preview mode switch;
- published and unpublished profiles expose exactly one contextual viewing action;
- the five publication requirements are visibly marked;
- optional fields are visibly identified;
- selecting a profile photo starts upload without a second Upload click;
- motorcycle gallery capacity is explained for empty, partial, and full states; and
- `/profile/preview` uses `RiderGarageView` without the editor header/status UI.

Browser QA must cover:

- complete published profile;
- incomplete unpublished profile;
- profile-photo success and failure;
- motorcycle-photo selection, progress, full-gallery messaging, cover selection, and ordering;
- public route versus preview content;
- desktop and 390 px mobile layout;
- keyboard focus and visible required-field guidance; and
- browser errors, media loading, and horizontal overflow.

## Non-goals

- Adding additional motorcycles.
- Changing attendance privacy rules.
- Adding friends, follows, messaging, or social feeds.
- Redesigning the public rider card.
- Changing media limits or storage infrastructure.
