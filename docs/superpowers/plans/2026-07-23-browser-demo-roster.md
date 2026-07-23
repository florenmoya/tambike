# Browser-created Demo Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create 11 visible and 2 anonymous fictional production attendees through Tambike's real browser signup, profile, media, and RSVP flows, then verify the populated roster.

**Architecture:** Use one controlled in-app browser session and deterministic fictional identities. Run one public pilot account before two public batches, then create the anonymous accounts. Keep credentials in a local DPAPI-encrypted inventory, keep generated media under the ignored `.codex/generated` tree, and stop at the first unexplained production failure.

**Tech Stack:** Next.js production application, Codex in-app Browser, Browser Playwright API, image generation, Windows PowerShell DPAPI, Vercel production deployment, private S3-backed member media.

## Global Constraints

- Keep the existing Mika sample rider.
- Create exactly 11 additional public fictional riders and 2 anonymous fictional attendees.
- Use `https://tambike.bayanko.ph` and its browser UI for every production mutation.
- Do not use direct SQL, Prisma writes, AWS object writes, or backend actions to create or repair demo records.
- Do not modify organizer settings, real user records, or existing RSVPs.
- Never print passwords, session tokens, database URLs, storage keys, signed URLs, or the decrypted credential inventory.
- Generated assets and encrypted credentials stay under ignored `.codex/` paths and must not be committed.
- Stop on unexpected validation, authentication, upload, RSVP, deployment, or console errors.
- Cleanup is a separate operation requiring explicit user authorization.

## File and state map

- Read: `docs/superpowers/specs/2026-07-23-browser-demo-roster-design.md`
- Create, ignored: `.codex/generated/browser-demo-roster/manifest.json`
- Create, ignored: `.codex/generated/browser-demo-roster/assets/<rider-key>-avatar.png`
- Create, ignored: `.codex/generated/browser-demo-roster/assets/<rider-key>-motorcycle.png`
- Create, ignored and DPAPI encrypted: `.codex/secrets/tambike-browser-demo-roster.credential.xml`
- Modify during execution, ignored: `.codex/generated/browser-demo-roster/run-state.json`
- Production mutations: rider accounts, member profiles, motorcycles, member media, Going RSVPs, and passes created only through browser forms.

---

### Task 1: Production readiness and baseline

**Files:**
- Read: `docs/superpowers/specs/2026-07-23-browser-demo-roster-design.md`
- Read: `docs/superpowers/plans/2026-07-23-browser-demo-roster.md`
- Inspect: `.codex/generated/browser-demo-roster/run-state.json`

**Interfaces:**
- Consumes: production deployment and existing sample-rider credential.
- Produces: a verified baseline `{ going: 2, visible: 1, anonymous: 1 }` and an empty or resumable run state.

- [ ] **Step 1: Confirm the checkout and published revision**

Run:

```powershell
git status --short
git rev-parse HEAD
git rev-parse origin/main
```

Expected: no uncommitted application changes and matching local/remote revisions after the plan commit is pushed.

- [ ] **Step 2: Confirm production is healthy**

Run:

```powershell
Invoke-WebRequest -UseBasicParsing https://tambike.bayanko.ph | Select-Object StatusCode
vercel ls --cwd D:\Github\personal\tambike
```

Expected: HTTP `200` and the latest production deployment reports `Ready`. If `vercel` is unavailable, record that log/deployment visibility is unavailable and do not claim it was checked.

- [ ] **Step 3: Inspect the live roster baseline**

Using the Codex in-app Browser:

1. Sign in with the existing Mika sample-rider credential without printing it.
2. Open `https://tambike.bayanko.ph/events/tambike-cafe-classico/attendees`.
3. Read only the three roster metrics and visible rider-card count.
4. Confirm `Going 2`, `Visible riders 1`, `Anonymous riders 1`, and one visible card for Mika.
5. Confirm no full anonymous explanatory card appears.

Expected: exact baseline `{ going: 2, visible: 1, anonymous: 1 }`. Stop if the baseline has drifted because the final target counts would no longer be deterministic.

- [ ] **Step 4: Inspect resumable local state**

If `.codex/generated/browser-demo-roster/run-state.json` exists, verify every completed email begins with `demo.roster.20260723.` and reconcile each completed entry against the live account/roster state. Otherwise begin with:

```json
{
  "eventId": "tambike-cafe-classico",
  "baseline": { "going": 2, "visible": 1, "anonymous": 1 },
  "completed": []
}
```

Expected: no unrecognized email or completion record. Do not delete or overwrite mismatched state.

---

### Task 2: Prepare identities, encrypted credentials, and media

**Files:**
- Create: `.codex/generated/browser-demo-roster/manifest.json`
- Create: `.codex/generated/browser-demo-roster/assets/*.png`
- Create: `.codex/secrets/tambike-browser-demo-roster.credential.xml`

**Interfaces:**
- Produces: `DemoRiderManifest` rows with `key`, `displayName`, `email`, `area`, `bio`, `visibility`, `defaultRosterIdentity`, optional `motorcycle`, optional `avatarPath`, and optional `motorcyclePath`.
- Produces: a DPAPI-encrypted `PSCredential[]` keyed by manifest email.

- [ ] **Step 1: Create the non-secret manifest**

Use this exact dataset:

| Key | Display name | Email | Area | Make | Model | Year | CC | Nickname |
|---|---|---|---|---|---|---:|---:|---|
| paolo-reyes | Paolo Reyes — Demo Rider | demo.roster.20260723.01@tambike.ph | Quezon City | Yamaha | XSR155 | 2024 | 155 | Kidlat |
| bea-navarro | Bea Navarro — Demo Rider | demo.roster.20260723.02@tambike.ph | Cebu City | Vespa | Primavera 150 | 2023 | 150 | Luna |
| carlo-mendoza | Carlo Mendoza — Demo Rider | demo.roster.20260723.03@tambike.ph | Makati City | Honda | CB650R | 2021 | 649 | Araw |
| nina-garcia | Nina Garcia — Demo Rider | demo.roster.20260723.04@tambike.ph | Baguio City | Royal Enfield | Himalayan 450 | 2024 | 452 | Amihan |
| jolo-ramos | Jolo Ramos — Demo Rider | demo.roster.20260723.05@tambike.ph | Iloilo City | Kawasaki | Z400 | 2022 | 399 | Berde |
| sam-torres | Sam Torres — Demo Rider | demo.roster.20260723.06@tambike.ph | Cagayan de Oro | KTM | 390 Duke | 2023 | 373 | Sikad |
| mara-villanueva | Mara Villanueva — Demo Rider | demo.roster.20260723.07@tambike.ph | Bacolod City | Triumph | Speed 400 | 2024 | 398 | Tala |
| enzo-lim | Enzo Lim — Demo Rider | demo.roster.20260723.08@tambike.ph | Pasig City | Husqvarna | Svartpilen 401 | 2022 | 373 | Uling |
| lia-santos | Lia Santos — Demo Rider | demo.roster.20260723.09@tambike.ph | General Santos City | Suzuki | SV650 | 2020 | 645 | Habagat |
| nico-bautista | Nico Bautista — Demo Rider | demo.roster.20260723.10@tambike.ph | Antipolo City | Honda | ADV160 | 2024 | 157 | Gala |
| aya-flores | Aya Flores — Demo Rider | demo.roster.20260723.11@tambike.ph | Dumaguete City | Yamaha | MT-03 | 2023 | 321 | Alon |
| anonymous-01 | Anonymous Demo Rider 01 | demo.roster.20260723.12@tambike.ph | Davao City | — | — | — | — | — |
| anonymous-02 | Anonymous Demo Rider 02 | demo.roster.20260723.13@tambike.ph | Davao City | — | — | — | — | — |

For visible riders use:

```text
Fictional Tambike demo profile created to test rider rosters and motorcycle cards.
```

Set `visibility: "PUBLIC"` and `defaultRosterIdentity: "VISIBLE"`. For anonymous rows set `visibility: "PRIVATE"` and `defaultRosterIdentity: "ANONYMOUS"`.

Expected: 13 unique keys and emails, 11 motorcycles, and no secrets.

- [ ] **Step 2: Generate credentials without displaying them**

Create 13 cryptographically random passwords of at least 24 bytes and export an array of `PSCredential` objects to:

```text
.codex/secrets/tambike-browser-demo-roster.credential.xml
```

Use PowerShell `RandomNumberGenerator.GetBytes(24)`, `ConvertTo-SecureString -AsPlainText -Force`, and `Export-Clixml`. Do not write the plaintext password to stdout, command history, the manifest, or `run-state.json`.

Expected: `Import-Clixml` returns 13 credentials and the file remains ignored by Git.

- [ ] **Step 3: Generate 11 avatar images**

Use the image-generation skill once per visible rider with this prompt template:

```text
Create a square photorealistic fictional Filipino motorcycle enthusiast avatar for a production UI demo. Adult, friendly natural expression, casual riding jacket, warm evening cafe lighting, uncluttered background, face centered, no helmet covering the face, no logos, no text, no watermark. This must depict a wholly fictional person and must not resemble a public figure. Rider identity: <display name>, city: <area>. Output a clean 1024x1024 PNG.
```

Save each result as:

```text
.codex/generated/browser-demo-roster/assets/<key>-avatar.png
```

Expected: 11 distinct square PNG files with no text or real-person source images.

- [ ] **Step 4: Generate 11 motorcycle hero images**

Use the image-generation skill once per visible rider with this prompt template:

```text
Create a wide photorealistic editorial motorcycle photo for a production UI demo: <year> <motorcycle>, nickname <nickname>, parked at a tasteful Philippine evening cafe meet, three-quarter side view, entire motorcycle visible, warm practical lighting, realistic proportions and mechanical details, no rider, no logos beyond normal motorcycle badging, no text overlay, no watermark. Output a clean 1536x1024 PNG.
```

Save each result as:

```text
.codex/generated/browser-demo-roster/assets/<key>-motorcycle.png
```

Expected: 11 distinct landscape PNG files suitable for the roster-card hero crop.

- [ ] **Step 5: Validate local preparation**

Run:

```powershell
git status --short
Get-ChildItem .codex\generated\browser-demo-roster\assets\*.png | Measure-Object
```

Expected: Git reports no generated asset or credential files, and the asset count is `22`.

---

### Task 3: Create and validate the public pilot rider

**Files:**
- Read: `.codex/generated/browser-demo-roster/manifest.json`
- Read securely: `.codex/secrets/tambike-browser-demo-roster.credential.xml`
- Modify: `.codex/generated/browser-demo-roster/run-state.json`

**Interfaces:**
- Consumes: the `paolo-reyes` manifest row, matching credential, avatar, and motorcycle image.
- Produces: one public rider, one motorcycle, two uploaded media items, one visible Going RSVP, one pass, and a completed pilot state entry.

- [ ] **Step 1: Sign up the pilot through production**

1. Log out any existing session.
2. Open `https://tambike.bayanko.ph/signup`.
3. Fill `Display name`, `Email`, `Password`, `Confirm password`, and `Area / city`.
4. Submit `Create rider account`.
5. Verify navigation to the rider experience and the signed-in header shows `Paolo Reyes — Demo Rider`.

Expected: a new rider session. If the email already exists, stop rather than attempting login or password reset.

- [ ] **Step 2: Publish the pilot profile**

1. Open `/profile`.
2. Fill the exact garage note.
3. Set `Profile visibility` to `Public — anyone with the link`.
4. Set `Default event roster identity` to `Visible — show my eligible rider card`.
5. Submit `Publish profile` (or `Save profile changes` if the profile was already published during a resumed run).
6. Verify the saved state remains selected after the UI refresh.

Expected: public, published profile with Visible default.

- [ ] **Step 3: Upload the pilot avatar**

1. Choose `paolo-reyes-avatar.png` in `Avatar photo`.
2. Submit `Upload avatar photo`.
3. Verify `Current avatar photo` renders and no upload error appears.

Expected: one same-origin avatar URL and a rendered square preview.

- [ ] **Step 4: Save the pilot motorcycle**

Fill and save:

```text
Make: Yamaha
Model: XSR155
Year: 2024
Displacement (cc): 155
Nickname: Kidlat
Motorcycle note: Fictional demo motorcycle prepared for Tambike roster layout testing.
```

Expected: a successful motorcycle save confirmation with the values retained.

- [ ] **Step 5: Upload the pilot motorcycle hero**

1. Choose `paolo-reyes-motorcycle.png` in `Motorcycle photo`.
2. Submit `Upload motorcycle photo`.
3. Verify `Motorcycle photo 1` renders.

Expected: one same-origin motorcycle image and no upload error.

- [ ] **Step 6: Register the pilot**

1. Open `/events/tambike-cafe-classico`.
2. Click `Going`.
3. In `Register for Tambike at Cafe Classico`, keep direct arrival and choose Visible.
4. Submit the registration.
5. Confirm a pass is created and the compact event-roster row reads `Visible`.

Expected: one Going RSVP with Visible identity and one active pass.

- [ ] **Step 7: Verify the pilot roster delta**

Open `/events/tambike-cafe-classico/attendees`.

Expected metrics:

```text
Going 3
Visible riders 2
Anonymous riders 1
```

Verify Paolo's card contains the expected name, city, avatar, motorcycle model, nickname, and hero image. Open the rider page and confirm no email appears.

- [ ] **Step 8: Record the pilot completion**

Append only this non-secret state:

```json
{
  "key": "paolo-reyes",
  "email": "demo.roster.20260723.01@tambike.ph",
  "status": "complete",
  "rosterIdentity": "VISIBLE"
}
```

Log out. Expected: the next signup starts signed out.

---

### Task 4: Create visible riders 02 through 06

**Files:**
- Read: manifest and encrypted credentials.
- Modify: ignored `run-state.json`.

**Interfaces:**
- Consumes: rows `bea-navarro` through `sam-torres` and their assets.
- Produces: five additional public visible attendees and five completion entries.

- [ ] **Step 1: Process each assigned rider through the complete browser flow**

For each row in order—Bea, Carlo, Nina, Jolo, then Sam:

1. Confirm the browser is signed out and open `/signup`.
2. Submit the exact manifest display name, email, area, and matching encrypted password.
3. Stop if signup reports an existing email or unexpected validation.
4. Open `/profile`; set the exact demo garage note, Public visibility, and Visible default; save and verify persistence.
5. Upload that rider's avatar and verify `Current avatar photo`.
6. Save the manifest motorcycle values with note `Fictional demo motorcycle prepared for Tambike roster layout testing.`
7. Upload that rider's motorcycle hero and verify `Motorcycle photo 1`.
8. Open `/events/tambike-cafe-classico`, register Going with Visible identity, and verify a pass plus compact `Visible` roster status.
9. Append the rider's non-secret completion entry only after every check succeeds.
10. Log out before the next row.

Expected: five new completed public riders with no skipped step.

- [ ] **Step 2: Verify the first public batch**

Sign in with the latest completed batch rider and open the attendee roster.

Expected metrics:

```text
Going 8
Visible riders 7
Anonymous riders 1
```

Expected: Mika, Paolo, Bea, Carlo, Nina, Jolo, and Sam each render exactly once with distinct imagery.

- [ ] **Step 3: Check browser errors**

Read current-page console errors and warnings, scoped to `tambike.bayanko.ph`.

Expected: no new application errors related to signup, upload, profile save, registration, media delivery, or roster rendering.

---

### Task 5: Create visible riders 07 through 11

**Files:**
- Read: manifest and encrypted credentials.
- Modify: ignored `run-state.json`.

**Interfaces:**
- Consumes: rows `mara-villanueva` through `aya-flores` and their assets.
- Produces: five additional public visible attendees and five completion entries.

- [ ] **Step 1: Process each assigned rider through the complete browser flow**

For each row in order—Mara, Enzo, Lia, Nico, then Aya:

1. Confirm the browser is signed out and open `/signup`.
2. Submit the exact manifest display name, email, area, and matching encrypted password.
3. Stop if signup reports an existing email or unexpected validation.
4. Open `/profile`; set the exact demo garage note, Public visibility, and Visible default; save and verify persistence.
5. Upload that rider's avatar and verify `Current avatar photo`.
6. Save the manifest motorcycle values with note `Fictional demo motorcycle prepared for Tambike roster layout testing.`
7. Upload that rider's motorcycle hero and verify `Motorcycle photo 1`.
8. Open `/events/tambike-cafe-classico`, register Going with Visible identity, and verify a pass plus compact `Visible` roster status.
9. Append the rider's non-secret completion entry only after every check succeeds.
10. Log out before the next row.

Expected: five new completed public riders with no skipped step.

- [ ] **Step 2: Verify all visible riders**

Sign in with Aya and open the attendee roster.

Expected metrics:

```text
Going 13
Visible riders 12
Anonymous riders 1
```

Expected: exactly 12 visible cards, including Mika, with no duplicate slug, name, avatar, or motorcycle hero.

- [ ] **Step 3: Verify representative public profiles**

Open the public rider pages for Paolo, Nina, Mara, and Aya.

Expected for each: public display name, area, garage note, avatar, motorcycle data, and hero image render; email, password data, internal user ID, and storage object key do not appear.

---

### Task 6: Create the two anonymous attendees

**Files:**
- Read: anonymous manifest rows and encrypted credentials.
- Modify: ignored `run-state.json`.

**Interfaces:**
- Produces: two private riders, two anonymous Going RSVPs, two active passes, and two completion entries.

- [ ] **Step 1: Create Anonymous Demo Rider 01**

1. Log out and open `/signup`.
2. Create the account with `Anonymous Demo Rider 01`, its manifest email, encrypted password, and Davao City.
3. Open `/profile` and verify Profile visibility is Private; if not, select Private and save.
4. Verify Attendance privacy is Anonymous.
5. Do not upload avatar or motorcycle media.
6. Open Cafe Classico, click Going, select Anonymous, and submit.
7. Verify the compact event-roster row reads `Anonymous`.
8. Record the non-secret completion entry and log out.

Expected: one private anonymous attendee and one pass.

- [ ] **Step 2: Create Anonymous Demo Rider 02**

1. Open `/signup`.
2. Create the account with `Anonymous Demo Rider 02`, its manifest email, encrypted password, and Davao City.
3. Open `/profile` and verify Profile visibility is Private; if not, select Private and save.
4. Verify Attendance privacy is Anonymous.
5. Do not upload avatar or motorcycle media.
6. Open Cafe Classico, click Going, select Anonymous, and submit.
7. Verify the compact event-roster row reads `Anonymous`.
8. Record the non-secret completion entry.

Expected: a second private anonymous attendee and pass.

- [ ] **Step 3: Verify privacy aggregation**

Open the attendee roster while signed in.

Expected metrics:

```text
Going 15
Visible riders 12
Anonymous riders 3
```

Expected: still exactly 12 visible cards; neither anonymous demo display name, email, avatar placeholder, nor profile link appears.

---

### Task 7: Full live roster verification and handoff

**Files:**
- Read: completed `run-state.json`.
- Read: encrypted credential inventory count only.
- Do not modify application source.

**Interfaces:**
- Consumes: 13 completion entries and final production roster.
- Produces: browser, deployment-log, and Git evidence for handoff.

- [ ] **Step 1: Verify desktop roster layout**

At the normal desktop viewport:

1. Open the attendee roster.
2. Confirm the metric row is `15 / 12 / 3`.
3. Confirm 12 visible cards form a balanced grid with consistent card heights.
4. Confirm long demo names wrap without overlapping city, avatar, or motorcycle content.
5. Confirm every hero image uses the intended crop and no broken image appears.

Expected: readable grid with no anonymous explanatory card and no empty or duplicate visible card.

- [ ] **Step 2: Verify mobile roster layout**

Use the browser viewport capability at `390 × 844`, reload the roster, and inspect the full list.

Expected: metrics remain readable, cards stack in one column, text does not overflow, and all controls remain reachable.

- [ ] **Step 3: Verify keyboard interaction**

Using keyboard navigation only:

1. Traverse Home, Explore, roster card links, and any roster continuation control.
2. Open one rider card with Enter.
3. Return to the roster.

Expected: visible focus indication, logical order, and no keyboard trap.

- [ ] **Step 4: Recheck compact event privacy**

As a visible demo rider:

1. Open the Cafe Classico event.
2. Confirm only `Event roster`, `Visible`, `Profile default`, and `Change for this event` show initially.
3. Activate `Change for this event`.
4. Confirm both identity radios and `Save event privacy` appear.
5. Close without changing the saved value.
6. Open `Profile default` and confirm `/profile#attendance-privacy` places Attendance privacy in view.

Expected: collapsed-by-default event UI and correct settings anchor.

- [ ] **Step 5: Verify run-state and encrypted inventory**

Run:

```powershell
git status --short
```

Inspect counts without decrypting passwords to output:

```text
manifest rows: 13
encrypted credentials: 13
completed run-state entries: 13
VISIBLE completion entries: 11
ANONYMOUS completion entries: 2
```

Expected: no `.codex` files in Git status and no uncommitted application changes.

- [ ] **Step 6: Check production errors**

Run:

```powershell
vercel logs https://tambike.bayanko.ph --level error --since 2h --cwd D:\Github\personal\tambike
```

Also inspect browser console errors scoped to the production origin.

Expected: no errors attributable to the demo-rider run. If Vercel CLI is unavailable, disclose that production logs were not verified.

- [ ] **Step 7: Finalize the browser and report**

Finalize browser tabs, keeping none unless the user asks to inspect the live roster. Report:

- Final metrics and visible-card count.
- Created demo-account count.
- Representative profile/media results.
- Desktop, mobile, and keyboard results.
- Any failed or skipped step.
- The encrypted inventory path and explicit statement that cleanup was not performed.

Do not include credentials or sensitive URLs.
