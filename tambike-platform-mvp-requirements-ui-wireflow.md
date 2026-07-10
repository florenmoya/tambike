# Tambike Platform

## MVP Requirements + UI Wireflow Specification

**Version:** 0.1  
**Status:** Draft for product, design, frontend, backend, and admin planning  
**Prepared:** July 1, 2026

| Decision | Current Requirement |
| --- | --- |
| Product model | Mobile-first responsive web app / PWA. Event-first. Not a generic map or venue directory. |
| Initial pricing | Free for riders, organizers, and basic venue listings during MVP. |
| Monetization | Manual/off-app B2B deals first: dealer leads, brand sponsorship, venue partnerships. In-app monetization later. |
| Core control | Only verified organizers can create publishable events. Venue approval required before public publishing. Admin review for risky events. |
| Main value | Help riders find ganaps, RSVP, get a QR Tambike Pass, check in, claim perks, and help organizers/venues prove attendance. |

## Document Contents

- [1. Product Context and Principles](#1-product-context-and-principles)
- [2. MVP Scope and Non-Goals](#2-mvp-scope-and-non-goals)
- [3. Roles, Permissions, and Verification](#3-roles-permissions-and-verification)
- [4. Event Lifecycle and Approval Rules](#4-event-lifecycle-and-approval-rules)
- [5. Functional Requirements](#5-functional-requirements)
- [6. UI Information Architecture](#6-ui-information-architecture)
- [7. UI Wireflows by Role](#7-ui-wireflows-by-role)
- [8. Screen-Level UI Requirements](#8-screen-level-ui-requirements)
- [9. Detailed UI Behavior and Content Requirements](#9-detailed-ui-behavior-and-content-requirements)
- [10. Data Requirements and High-Level Entities](#10-data-requirements-and-high-level-entities)
- [11. Admin, Trust, Safety, and Moderation](#11-admin-trust-safety-and-moderation)
- [12. Monetization Requirements](#12-monetization-requirements)
- [13. Analytics, Reporting, and Success Metrics](#13-analytics-reporting-and-success-metrics)
- [14. Non-Functional Requirements](#14-non-functional-requirements)
- [15. MVP Build Priority and Release Plan](#15-mvp-build-priority-and-release-plan)
- [16. Out of Scope and Open Questions](#16-out-of-scope-and-open-questions)
- [Appendix A: Complete Screen Inventory](#appendix-a-complete-screen-inventory)
- [Appendix B: Sample Event Card Copy](#appendix-b-sample-event-card-copy)
- [Appendix C: Sample QR Pass Copy](#appendix-c-sample-qr-pass-copy)
- [Appendix D: Final MVP Summary](#appendix-d-final-mvp-summary)

## 1. Product Context and Principles

Tambike is treated as a real-world rider gathering behavior, not simply a place search problem. The platform should help users find and join motorcycle ganaps: tambike nights, coffee rides, bike nights, club EBs, brand/dealer events, and controlled test ride events.

The product must respect existing Philippine rider behavior: Facebook and Messenger already handle discovery and group coordination, while Waze and Google Maps already handle navigation. The platform should complement these tools through shareable event pages, controlled RSVP, QR passes, check-ins, and post-event reporting.

### 1.1 Core Product Statement

Users do not search places first.  
Users join ganaps.

The app is an event/ticket/pass system for tambike culture, not a filter-heavy venue directory.

### 1.2 Product Principles

| Principle | Meaning for the Product |
| --- | --- |
| Event-first discovery | Home and Explore prioritize ganaps: what is happening, who is going, what riders get, and why it is worth attending. |
| Controlled publishing | Events cannot instantly go public. Organizer verification, venue approval, and conditional admin review protect trust and reduce liability. |
| No Facebook replacement | Use sharing to Messenger/Facebook instead of building chat, comments, or a social feed during MVP. |
| No navigation replacement | Use Waze / Google Maps deep links. Do not build custom GPS, routing, or live convoy tracking during MVP. |
| Free user experience | Do not charge riders or block event discovery. Monetization starts through manual B2B deals. |
| Minimal data collection | Avoid IDs, plate numbers, license images, emergency contacts, and sensitive data unless absolutely required later. |
| Physical attendance proof | QR check-in is the bridge between online RSVP and real-world business value. |

### 1.3 Product Goal

- Help riders answer: "Ano ganap?", "Sino pupunta?", "Worth ba puntahan?", and "Paano ako sasali?"
- Help organizers publish legitimate, venue-approved events and track RSVP vs actual attendance.
- Help venues control events happening at their location and understand attendance impact.
- Help brands/dealers capture high-intent, event-based leads later, initially through manual/off-app deals.

## 2. MVP Scope and Non-Goals

### 2.1 MVP Product Scope

| Area | In MVP |
| --- | --- |
| Rider discovery | Home feed, Explore events, event detail pages, public event viewing without login. |
| RSVP and pass | Interested, Going/Register, QR Tambike Pass, My Passes. |
| Organizer flow | Organizer verification application, create event wizard, my events, event status tracking. |
| Venue flow | Review event requests, approve/reject/approve with conditions, event day check-in support. |
| Admin flow | Manual organizer verification, venue directory oversight, event reviews, moderation queue, basic user management. |
| Check-in | QR scanning by organizer/venue/admin, manual check-in fallback, attendance count. |
| Perks | Basic perk declaration and check-in unlock. Redemption can be manual in MVP. |
| Reports | Basic post-event report: RSVP count, check-ins, no-show rate, perk redemptions, notes. |
| Brand/dealer | Basic brand event and test ride interest form. Export leads manually. |

### 2.2 MVP Non-Goals

| Do Not Build Yet | Reason |
| --- | --- |
| In-app payments / ticketing | Adds refund, fraud, payment, and operational complexity before traction. |
| Full social feed / comments / chat | Messenger and Facebook already own communication. |
| Custom navigation / live GPS / convoy tracking | High technical and liability risk; users already prefer Waze/Google Maps. |
| Open public convoy creation | High safety and compliance risk. Require verification and admin review if ride-out exists. |
| Automated raffle system | Promo and raffle compliance risk. MVP should only display organizer-provided promo details and warnings. |
| Government ID / license image upload | Data privacy and security burden. Manual verification can use FB/page links and admin review first. |
| Club dues / wallet / GCash ledger | Useful later, but too complex for initial MVP. |
| Full cycling/padyak product | Can be a later category. MVP stays motorcycle-first to avoid fragmented positioning. |

## 3. Roles, Permissions, and Verification

### 3.1 User Roles

| Role | Description | MVP Permissions |
| --- | --- | --- |
| Guest | Logged-out visitor. | Browse landing page, Home/Explore, and public event detail pages. Cannot RSVP or create events. |
| Rider | Logged-in end user. | Interested, Going/Register, view QR pass, share events, check in, claim perks/badges. |
| Organizer | Verified user who can host events. | Create drafts, submit events to venues, manage RSVPs, scan check-ins, view reports. |
| Venue Owner/Staff | Verified venue representative. | Approve/reject event requests, set conditions, scan passes, view venue reports. |
| Brand/Dealer | Verified business partner. | Create/host brand events or test ride campaigns; export leads manually in MVP. |
| Admin | Platform operator. | Verify users/venues, review events, moderate reports, manage platform data and statuses. |

### 3.2 Verification Statuses

| Status | Meaning | Allowed Actions |
| --- | --- | --- |
| UNVERIFIED | Default state after sign-up. | Can browse and RSVP as rider. Cannot publish events or approve venue requests. |
| PENDING | Submitted application under admin review. | Can create event drafts, but cannot submit/publish. |
| APPROVED | Manually approved by admin. | Can perform role-specific actions. |
| REJECTED | Application rejected. | Can remain rider; cannot perform elevated actions. |
| SUSPENDED | Temporarily or permanently blocked from elevated role actions. | Cannot create/manage events or venue approvals. |

### 3.3 Permission Matrix

| Action | Guest | Rider | Organizer | Venue | Brand/Dealer | Admin |
| --- | --- | --- | --- | --- | --- | --- |
| Browse public events | Yes | Yes | Yes | Yes | Yes | Yes |
| Mark Interested / Going | No | Yes | Yes | Yes | Yes | Yes |
| Create event draft | No | No | Yes if approved | Yes if venue approved | Yes if approved | Yes |
| Submit event for approval | No | No | Yes if approved | Yes for own venue events | Yes if approved | Yes |
| Approve venue event request | No | No | No | Yes for own venue | No unless venue-owned | Yes |
| Admin review risky event | No | No | No | No | No | Yes |
| Scan QR check-in | No | No | Yes for own event | Yes for own venue/event | Yes for own event | Yes |
| Export leads | No | No | No | No | Manual request only | Yes |
| Suspend user/event | No | No | No | No | No | Yes |

## 4. Event Lifecycle and Approval Rules

### 4.1 Event State Machine

```text
DRAFT
-> PENDING_ORGANIZER_VERIFICATION
-> PENDING_VENUE_APPROVAL
-> PENDING_ADMIN_REVIEW (conditional)
-> NEEDS_CHANGES (optional loop)
-> PUBLISHED
-> ONGOING
-> COMPLETED
-> ARCHIVED

Other terminal/status states:
REJECTED, CANCELLED, SUSPENDED
```

### 4.2 Event Type Rules

| Event Type | Venue Approval | Admin Review | Notes |
| --- | --- | --- | --- |
| Tambike | Required | Optional | Static venue meetup. Admin review if high attendance, new organizer, or flagged content. |
| Bike Night | Required | Optional | Higher noise/crowd sensitivity, especially at night. |
| Coffee Ride | Required if destination venue is promoted | Optional | If ride-out is included, review based on size and route risk. |
| Club EB | Required | Optional | Admin review if large crowd or convoy. |
| Brand Event | Required | Yes | May involve leads, sponsor obligations, or promotions. |
| Test Ride | Required | Yes | High-risk. MVP should capture interest only, not manage liability waivers. |
| Grand Opening | Required | Optional/Yes if promo-heavy | Review if raffle/freebies/sponsors are present. |
| Charity Ride | Required | Yes | Road-impacting risk. MVP should be conservative. |
| Destination Ride | Required if venue/lodging promoted | Yes if organized ride-out | Later-stage product. |

### 4.3 Admin Review Triggers

- Expected attendance above configurable threshold, e.g., 50 riders for new organizers or 100 riders for established organizers.
- Event includes ride-out, convoy, motorcade-like gathering, charity ride, or road-impacting movement.
- Event includes test ride, product demo, raffle, giveaway, contest, or sponsor prize.
- Event uses risky language: race, time attack, top speed, stunt, banking challenge, loud pipe competition, illegal lottery terms.
- Organizer or venue is newly verified, has prior flags, or has recent incident reports.
- Venue has conditional approval only or requires special rules.
- Event is at night, near residential areas, or has high noise/crowd risk.

## 5. Functional Requirements

### 5.1 Authentication and Onboarding

| ID | Requirement | Acceptance Criteria |
| --- | --- | --- |
| AUTH-001 | Guests can browse public event pages without login. | Given a logged-out user, when they open Home/Explore or a public event link, then they can view event details but cannot RSVP. |
| AUTH-002 | Users can sign up and become Riders by default. | After sign-up, the user receives Rider permissions and can RSVP/register for events. |
| AUTH-003 | Login is required only for high-intent actions. | Interested, Going, Register, QR Pass, Create Event, and Test Ride Interest require login. |
| AUTH-004 | Profile should collect minimal optional rider data. | Name/display name required; bike model, city/area, and club name optional. No ID/license/plate in MVP. |

### 5.2 Organizer Verification

| ID | Requirement | Acceptance Criteria |
| --- | --- | --- |
| ORG-001 | User can apply to become an Organizer. | Application captures organizer type, display name, real name, contact number, FB/page link, club/page name, reason, and sample past events. |
| ORG-002 | Admin manually reviews organizer applications. | Admin can approve, reject, request more info, or suspend. Decision is recorded with internal notes. |
| ORG-003 | Unverified users cannot submit publishable events. | If user taps Create Event, show verification prompt or pending status. Draft-only may be allowed while pending. |
| ORG-004 | Approved organizer can create and submit event drafts. | Organizer dashboard shows Create Event and My Events after approval. |

### 5.3 Venue Verification and Venue Requests

| ID | Requirement | Acceptance Criteria |
| --- | --- | --- |
| VEN-001 | Verified venue can review event requests. | Venue dashboard shows pending requests with organizer, date, expected riders, event type, perks, rules, ride-out flag. |
| VEN-002 | Venue can approve, reject, or approve with conditions. | Conditions may include max capacity, allowed time, required rules, parking/staffing notes, and organizer instructions. |
| VEN-003 | Admin maintains venue records. | Venue names, addresses, maps, capacity notes, and operating rules are available for event review. |

### 5.4 Event Creation

| ID | Requirement | Acceptance Criteria |
| --- | --- | --- |
| EVT-001 | Verified organizer can create event draft through wizard. | Wizard includes event type, details, venue, ride/meetup, perks, rules/safety, and review submit. |
| EVT-002 | Event type selection controls risk logic. | Selecting Test Ride, Charity Ride, Destination Ride, or large Ride-out shows admin review warning. |
| EVT-003 | Venue selection is required for public venue events. | Organizer can select existing verified venue or request new venue. New venue blocks publish until approved. |
| EVT-004 | Ride-out details are optional but must trigger risk classification. | If ride-out = yes, capture meetup point, map link, call time, departure time, destination, and notes. |
| EVT-005 | Perks can be declared. | Organizer can select no perk, free sticker, discount, free food/coffee, raffle entry, merch, test ride slot, sponsor booth, photo wall, best build feature. |
| EVT-006 | Raffle/promo selections show compliance warning. | Platform states organizer is responsible; MVP does not operate raffle. Admin review may be required. |
| EVT-007 | Default safety rules are included. | Helmet required, no racing, no stunts, no revving, respect venue staff, follow traffic laws. Organizer can add more. |

### 5.5 Event Publishing and Discovery

| ID | Requirement | Acceptance Criteria |
| --- | --- | --- |
| DISC-001 | Published events appear in Home and Explore. | Events show in relevant sections based on date, event type, popularity, and location. |
| DISC-002 | Event cards prioritize reason-to-go. | Card displays poster, title, date/time, venue/area, going/interested count, host, and perk preview. |
| DISC-003 | Explore uses event filters, not amenity-first filters. | Filters: date, area, event type, free perks, ride-out, test ride, club event, venue-only. |
| DISC-004 | Users can share event links externally. | Share actions include Messenger, Facebook, Copy Link, and device-native share if available. |

### 5.6 RSVP, Registration, and QR Pass

| ID | Requirement | Acceptance Criteria |
| --- | --- | --- |
| RSVP-001 | Rider can mark Interested. | Event saved; interested count increments; no QR pass generated. |
| RSVP-002 | Rider can mark Going or Register. | Attendance option is collected: go direct, join ride-out, not sure/join with club. |
| RSVP-003 | QR Tambike Pass is generated after Going/Register. | Pass contains event name, date/time, venue, QR code, pass status, and benefit list. |
| RSVP-004 | Rider can view passes. | My Passes screen shows Upcoming, Past, and Perks tabs. |
| RSVP-005 | Capacity rules apply. | If capacity reached, Going/Register may be disabled or set to waitlist based on event settings. |

### 5.7 Check-in and Perk Redemption

| ID | Requirement | Acceptance Criteria |
| --- | --- | --- |
| CHK-001 | Organizer/venue/admin can scan QR passes. | Scanner validates event, pass status, duplicate check-in, cancellation, and active event window. |
| CHK-002 | Manual check-in fallback exists. | Authorized staff can search attendee by name/phone and mark checked in. |
| CHK-003 | Successful check-in unlocks perks. | Rider sees checked-in status, raffle entry number if enabled, and available perks. |
| CHK-004 | Perk redemption can be marked manually. | Venue/organizer can mark perk as redeemed; MVP can keep this lightweight. |
| CHK-005 | Duplicate check-ins are blocked. | Second scan returns Already Checked In with timestamp. |

### 5.8 Post-event Reporting

| ID | Requirement | Acceptance Criteria |
| --- | --- | --- |
| RPT-001 | Organizer can view event performance. | Report shows interested, going, registered, actual check-ins, no-show rate, and perk redemptions. |
| RPT-002 | Venue can view event report. | Venue report shows attendance, peak arrival time, perk redemptions, issues, host-again decision, and notes. |
| RPT-003 | Admin can export basic event data. | Admin can export CSV for attendees, check-ins, and test ride leads. |
| RPT-004 | Brand/dealer lead reports are manual first. | MVP supports admin export and off-app sales/reporting, not automated paid dashboards yet. |

### 5.9 Notifications

| ID | Requirement | Acceptance Criteria |
| --- | --- | --- |
| NOTIF-001 | Rider receives event reminders. | Send reminder when event is tomorrow and on event day. Email/push/SMS depends on available implementation. |
| NOTIF-002 | Organizer receives approval updates. | Notify organizer when venue approves/rejects/conditions or admin requests changes. |
| NOTIF-003 | Venue receives event requests. | Notify venue owner/staff when new request is submitted. |
| NOTIF-004 | Admin receives risky event queue items. | Notify admin or show dashboard badge for pending reviews. |

## 6. UI Information Architecture

### 6.1 Recommended Platform

Use a mobile-first responsive web application / PWA for MVP. This minimizes app-install friction, makes links shareable in Messenger/Facebook, and allows event pages to work as lightweight tickets.

### 6.2 Main Navigation by Role

| Role | Navigation |
| --- | --- |
| Rider | Home \| Explore \| My Passes \| Create \| Profile |
| Organizer | Dashboard \| My Events \| Create Event \| Attendees \| Reports \| Profile |
| Venue | Dashboard \| Event Requests \| Approved Events \| Check-ins \| Venue Profile \| Reports |
| Admin | Dashboard \| Verifications \| Event Reviews \| Users \| Reports \| Settings |

### 6.3 Route Map

```text
/
/login
/signup
/onboarding

/home
/events
/events/:eventId
/events/:eventId/register
/events/:eventId/test-ride

/passes
/passes/:passId
/passes/past/:eventId

/profile
/create
/organizer/apply

/organizer/dashboard
/organizer/events
/organizer/events/create
/organizer/events/:eventId
/organizer/events/:eventId/attendees
/organizer/events/:eventId/scanner
/organizer/events/:eventId/report

/venue/dashboard
/venue/requests
/venue/requests/:requestId
/venue/events
/venue/events/:eventId
/venue/events/:eventId/checkin
/venue/events/:eventId/report

/admin
/admin/verifications/organizers
/admin/verifications/organizers/:id
/admin/events/review
/admin/events/review/:id
/admin/moderation
/admin/users
```

## 7. UI Wireflows by Role

### 7.1 Rider Primary Flow

```text
Landing / Home
-> Browse ganaps
-> Open event detail
-> Check vibe, perks, who is going
-> Tap Interested / Going / Register
-> Get QR Tambike Pass
-> Share to Messenger / Facebook
-> Receive reminder
-> Open Waze / Google Maps
-> Arrive at event
-> Scan QR
-> Claim perk / raffle entry
-> See recap / badge
-> Follow host
-> Join next event
```

### 7.2 Organizer Primary Flow

```text
Profile / Create
-> Apply for verification
-> Wait for admin approval
-> Create event draft
-> Select venue
-> Add event details
-> Add ride-out / perks / rules
-> Submit to venue
-> Venue approves / conditions / rejects
-> Admin reviews if risky
-> Event published
-> Monitor RSVPs
-> Scan check-ins
-> Complete event
-> View report
```

### 7.3 Venue Primary Flow

```text
Receive event request
-> Review organizer + event details
-> Approve / reject / set conditions
-> Event published
-> Prepare venue and staff
-> Scan check-ins / mark perk redemption
-> View event report
-> Decide whether to host again
```

### 7.4 Admin Primary Flow

```text
Admin dashboard
-> Review organizer applications
-> Review risky events
-> Approve / reject / request changes
-> Monitor published events
-> Handle flags and reports
-> Suspend users/events if needed
-> Archive completed events
```

## 8. Screen-Level UI Requirements

### 8.1 Public / Rider Screens

| Screen | Primary Purpose | Key UI Requirements / Acceptance Criteria |
| --- | --- | --- |
| Landing Page | Explain product and drive exploration. | Hero: "Find tambike events, bike nights, coffee rides, and rider meetups near you." CTAs: Explore Events, Create Event. Show upcoming ganaps without requiring login. |
| Login / Sign Up | Authenticate only when needed. | Support email/phone/social login if available. Redirect back to triggering action after login. |
| Onboarding | Minimal rider profile. | Collect display name, area/city, optional bike model, optional club. Keep skippable where possible. |
| Home | Primary ganap discovery. | Top bar, location selector, "Ano ganap this week?", quick chips, sections: Tonight, This Weekend, Popular Now, Brand/Dealer, Friends/Clubs Going, New Events. |
| Explore Events | Browse and search all ganaps. | Search events/clubs/hosts/venues. Event chips: Tambike, Coffee Ride, Bike Night, Club EB, Brand, Test Ride, Grand Opening. Filters are event-focused, not amenities-first. |
| Event Detail | Convert interest into RSVP. | Hero poster, title, host, date/time, venue, going/interested count, social proof, what's happening, ride/meetup info, rules, CTAs. |
| RSVP/Register Modal | Collect attendance intent. | Attendance options: go directly, join ride-out, not sure/join with club. Optional bike model, companions, club/group. |
| QR Tambike Pass | Proof of registration and check-in token. | Show event info, QR code, pass status, benefits/perks, Waze/Maps, Share, View Event. |
| My Passes | Manage upcoming and past participation. | Tabs: Upcoming, Past, Perks. Cards show event, date, status, View QR, Open Waze, Share. |
| Past Event / Badge | Post-event retention. | Show attended event, check-in timestamp, badge, photos/recap placeholder, follow organizer/venue, similar events. |
| Profile | User identity and role upgrades. | Rider info, followed hosts/venues, organizer application status, settings. |

### 8.2 Organizer Screens

| Screen | Primary Purpose | Key UI Requirements / Acceptance Criteria |
| --- | --- | --- |
| Organizer Application | Apply for elevated permissions. | Form: organizer type, display name, real name, contact, FB/page link, club/page, reason, sample events. Submit creates Pending status. |
| Organizer Dashboard | Organizer command center. | Cards: My Events, Pending Approval, Published, Upcoming, Total RSVPs, Total Check-ins. CTA: Create Event. |
| My Events | Track event pipeline. | Tabs: Drafts, Pending Venue, Pending Admin, Published, Ongoing, Completed, Rejected. Event cards show status and actions. |
| Create Event Wizard | Structured event creation. | Steps: Event Type, Basic Details, Venue, Ride/Meetup, Perks, Rules/Safety, Review & Submit. |
| Event Status Detail | Make approval process clear. | Show timeline: Draft -> Submitted to Venue -> Venue Approved -> Admin Review -> Published. Display rejection/changes notes. |
| Attendee List | Manage RSVPs. | View Interested, Going, Registered, Checked In, No-show after event. Search and export available to admin/organizer depending on permissions. |
| QR Scanner | Event day check-in. | Camera scan, manual lookup, validation states: valid, invalid, already checked in, wrong event, cancelled pass, inactive event. |
| Event Report | Post-event performance. | RSVP vs attendance, no-show rate, perk redemption, peak arrival, notes, export if allowed. |

### 8.3 Venue Screens

| Screen | Primary Purpose | Key UI Requirements / Acceptance Criteria |
| --- | --- | --- |
| Venue Dashboard | Venue command center. | Cards: Pending Requests, Upcoming Approved Events, Today's Check-ins, Past Reports. |
| Event Request Detail | Approve or reject proposed events. | Show event title, organizer, verification status, date/time, expected riders, event type, ride-out, perks, rules. Actions: Approve, Approve with Conditions, Reject. |
| Approved Events | Track venue calendar. | Tabs: Upcoming, Ongoing, Completed, Cancelled. Show RSVP and expected riders. Actions: View, Scanner, Report Issue. |
| Venue Scanner | Check in riders at venue. | Scan QR, manual lookup, checked-in count, perk redeemed count. |
| Venue Report | Measure event impact. | RSVP count, check-ins, no-show rate, peak arrival, perk redemptions, repeat riders, manual notes: sales impact, parking/noise issue, host again. |

### 8.4 Admin Screens

| Screen | Primary Purpose | Key UI Requirements / Acceptance Criteria |
| --- | --- | --- |
| Admin Dashboard | Platform operations summary. | Cards: Pending Organizer Verifications, Event Reviews, Published Events, Flagged Events, Recent Check-ins. |
| Organizer Verification Queue | Review role applications. | Columns: name, type, FB link, submitted date, status, risk level. Actions: View, Approve, Reject, Request More Info, Suspend. |
| Organizer Verification Detail | Decide application. | Applicant info, links, past events, internal notes, risk rating, decision buttons. |
| Event Review Queue | Review risky events. | Show events requiring review due to type, ride-out, raffle/promo, high attendance, new organizer, flags. |
| Event Review Detail | Approve or block event. | Event summary, organizer, venue approval status, risk flags, perks, ride-out info, rules. Actions: Approve Publish, Reject, Request Changes, Escalate. |
| Moderation / Flagged Events | Handle safety and trust issues. | Flag reasons: racing language, stunt language, illegal raffle, no venue approval, fake event, report, noise complaint, unsafe behavior. |
| User Management | Operational user control. | Search users, view roles/statuses, suspend/restore, view event history and admin notes. |

### 8.5 Brand / Dealer MVP Screens

| Screen | Primary Purpose | Key UI Requirements / Acceptance Criteria |
| --- | --- | --- |
| Brand Event Page | Promote brand/dealer activation. | Same as event detail but with stronger CTA: Reserve Test Ride Slot / Submit Interest. |
| Test Ride Interest Form | Capture minimal lead. | Fields: name, phone, current motorcycle, interested model, preferred time slot, consent checkbox. Avoid license images/ID in MVP. |
| Lead Export View | Manual monetization support. | Admin can export CSV of opt-in leads for off-app dealer campaign reporting. |

## 9. Detailed UI Behavior and Content Requirements

### 9.1 Event Card Requirements

| Element | Requirement |
| --- | --- |
| Poster image | Required for published events if available; fallback gradient/card if missing. |
| Title | Clear event name: e.g., Bike Night at Kape Moto. |
| Date/time | Show day and time upfront. |
| Location | Show city/area and venue. |
| Host | Show verified host/organizer name. |
| Social proof | Show Going and Interested counts. |
| Perk preview | Show one strongest reason to attend, e.g., free sticker / raffle / test ride. |
| CTA | Going + Share, or Register/Reserve Slot for structured events. |

### 9.2 Event Detail Page Structure

- Hero poster
- Event title + type badge
- Date / time
- Venue / area
- Host + verification badge
- Going / interested count
- Primary CTA row
- What's happening
- Who's going
- Ride / meetup info, if applicable
- Venue info / good to know
- Rules and safety notes
- Organizer profile
- Share actions

### 9.3 Create Event Wizard Detailed Steps

| Step | Fields / UI | Validation |
| --- | --- | --- |
| 1. Event Type | Tambike, Bike Night, Coffee Ride, Club EB, Brand Event, Test Ride, Grand Opening, Charity Ride, Destination Ride. | Required. Risk warning for high-risk types. |
| 2. Basic Details | Title, short description, poster, start date, start time, end time, visibility. | Title/date/time required. End time optional but recommended. |
| 3. Venue | Search existing venue, request new venue, no fixed venue/meetup only. | Public venue event requires verified venue or venue request. |
| 4. Ride / Meetup | Ride-out yes/no. If yes: meetup name, address, map link, call time, departure time, destination, notes. | Ride-out triggers risk classification. |
| 5. Perks | No perk, sticker, discount, food/coffee, raffle, merch, test ride, sponsor booth, photo wall, best build. | Raffle/test ride triggers warning/admin review. |
| 6. Rules & Safety | House rules, allowed bikes, capacity estimate, max attendees, default safety toggles. | Default rules included; capacity required for venue approval. |
| 7. Review & Submit | Summary of all inputs plus risk flags. | Submit creates Pending Venue Approval or Pending Admin Review based on flow. |

## 10. Data Requirements and High-Level Entities

### 10.1 Data Collection Principles

- Collect only what is necessary for event discovery, RSVP, verification, check-in, and manual B2B reporting.
- Avoid sensitive data in MVP: government IDs, driver license images, plate numbers, emergency contacts, full address, health data.
- For test ride interest, collect minimal lead data and explicit consent: name, phone, current motorcycle, interested model, preferred time slot.
- Keep admin notes private and never visible to riders or public profiles.

### 10.2 Core Entities

| Entity | Purpose | Key Fields |
| --- | --- | --- |
| User | Account identity. | id, name, email/phone, role, verification_status, city/area, bike_model_optional, created_at. |
| OrganizerProfile | Elevated organizer data. | user_id, organizer_type, display_name, real_name, contact, fb_link, past_event_links, status, admin_notes. |
| Venue | Location and venue owner control. | id, name, address, map_link, owner_user_id, status, capacity_notes, house_rules, contact. |
| Event | Core product object. | id, title, type, status, organizer_id, venue_id, datetime, capacity, description, poster, risk_flags. |
| EventApproval | Tracks venue/admin approval. | event_id, approval_type, reviewer_id, decision, conditions, notes, decided_at. |
| RSVP | Rider intent. | event_id, user_id, status, attendance_type, companions, club_name, created_at. |
| Pass | QR attendance token. | id, event_id, user_id, qr_token, status, generated_at, checked_in_at. |
| CheckIn | Physical attendance proof. | event_id, pass_id, user_id, scanned_by, timestamp, method. |
| Perk | Event benefits. | event_id, type, description, quantity, redemption_rules. |
| PerkRedemption | Tracks claims. | perk_id, user_id, status, redeemed_by, redeemed_at. |
| Lead | Brand/dealer interest. | event_id, user_id/name, phone, current_motorcycle, interested_model, preferred_time, consent_at, exported_at. |
| Flag/Report | Moderation and safety. | target_type, target_id, reason, reporter_id, status, admin_notes. |

## 11. Admin, Trust, Safety, and Moderation

### 11.1 Required Admin Capabilities

| ID | Requirement | Acceptance Criteria |
| --- | --- | --- |
| ADM-001 | Admin can approve/reject organizer applications. | All decisions are logged with admin, timestamp, status, and notes. |
| ADM-002 | Admin can maintain venue records. | Venue status and operating notes are visible to event reviewers. |
| ADM-003 | Admin can review risky events before publishing. | Review queue displays risk flags and event data needed for decision. |
| ADM-004 | Admin can request changes. | Event moves to Needs Changes and organizer receives reason. |
| ADM-005 | Admin can suspend event or user. | Suspended events are hidden from public listings; suspended organizers cannot create/submit. |
| ADM-006 | Admin can manage moderation flags. | Flags can be resolved, dismissed, escalated, or used for suspension. |

### 11.2 Safety Copy Requirements

| Location | Required Copy |
| --- | --- |
| Event creation - Ride-out | Large ride-outs may require additional coordination. Organizer is responsible for safe conduct and applicable local requirements. |
| Event creation - Raffle/Promo | Platform does not operate raffles or promotions. Organizer/brand is responsible for required permits and mechanics. |
| Event detail - Rules | Ride safely. No racing, stunts, or revving. Follow traffic laws and venue staff. |
| Test ride form | This submits interest only. Dealer/brand will confirm requirements and eligibility outside the app. |

### 11.3 Rejected / Blocked Event Rules

- Events promoting racing, speed contests, stunts, time attack, or illegal road behavior.
- Events without verified organizer and venue approval for public venue-based gatherings.
- Events claiming official road closure, police escort, or road privilege without admin-reviewed proof.
- Promo-heavy events with unclear sponsor/raffle mechanics when organizer refuses to clarify.
- Events with repeated complaints, fake host identity, or unsafe venue/organizer history.

## 12. Monetization Requirements

### 12.1 MVP Monetization Rule

MVP site remains free.

Riders do not pay.  
Basic venue listings do not pay.  
Verified organizer creation is free during MVP.

Revenue is handled manually/off-app first through B2B deals.

### 12.2 Manual Revenue Streams for MVP

| Revenue Stream | Who Pays | MVP Handling |
| --- | --- | --- |
| Dealer/test ride leads | Dealer or brand | Manual campaign deal. App collects opt-in leads; admin exports CSV and reports results off-app. |
| Sponsored event | Brand/dealer/venue | Manual sponsorship package. App displays event and CTA, but payment is outside app. |
| Venue promotion | Venue | Manual featured placement or event boost after pilot proves foot traffic. |
| QR perks sponsorship | Venue/brand | Perk is created in event; redemption data is used for manual reporting. |

### 12.3 Later In-App Monetization

- Featured events and boosted placements.
- Venue subscription with analytics and event management tools.
- Brand/dealer campaign dashboard and cost-per-lead billing.
- Ticketing only after trust, refunds, legal, and payment operations are ready.
- Club tools only after repeated organizer demand is proven.

## 13. Analytics, Reporting, and Success Metrics

### 13.1 MVP Product Metrics

| Metric | Why It Matters |
| --- | --- |
| Published events per week | Measures event supply. |
| Event detail views | Measures demand/discovery. |
| Interested rate | Early social intent. |
| Going/Register rate | High-intent conversion. |
| QR pass generation count | Direct event commitment. |
| Check-in rate | Physical attendance proof. |
| RSVP-to-check-in ratio | Measures no-show and planning reliability. |
| Share clicks | Validates Messenger/Facebook distribution loop. |
| Perk redemption rate | Proves offline conversion. |
| Repeat attendee rate | Retention and community value. |
| Venue host-again rate | Supply-side satisfaction. |
| Lead opt-in count | Brand/dealer monetization signal. |

### 13.2 Event Report Metrics

| Report Field | Visible To |
| --- | --- |
| Interested count | Organizer, Venue, Admin |
| Going/Register count | Organizer, Venue, Admin |
| Actual check-ins | Organizer, Venue, Admin |
| No-show rate | Organizer, Venue, Admin |
| Peak arrival time | Venue, Admin |
| Perk redemptions | Organizer, Venue, Brand/Admin |
| Lead signups | Admin, Brand/Dealer if approved |
| Issues: parking/noise/safety | Venue, Admin |
| Would host again | Venue, Admin |

## 14. Non-Functional Requirements

| ID | Requirement | Acceptance Criteria |
| --- | --- | --- |
| NFR-001 | Mobile-first performance. | Core pages should load quickly on budget Android devices and mobile data. Avoid heavy assets. |
| NFR-002 | Responsive design. | Support mobile first, then tablet/desktop admin dashboards. |
| NFR-003 | Secure QR tokens. | QR codes must be non-guessable and tied to event/pass/user. |
| NFR-004 | Role-based access control. | Every protected action validates role and ownership server-side. |
| NFR-005 | Audit logging. | Admin decisions, approvals, check-ins, exports, and suspensions must be logged. |
| NFR-006 | Data minimization. | Avoid unnecessary sensitive fields. Support deletion/anonymization later. |
| NFR-007 | Graceful no-camera fallback. | Scanner must support manual lookup for devices with camera issues. |
| NFR-008 | Shareability. | Public event pages must have meaningful metadata for Facebook/Messenger previews. |
| NFR-009 | Accessibility basics. | Readable contrast, large touch targets, semantic headings, labels on forms, alt text for posters. |
| NFR-010 | Operational reliability. | Event day scanner and pass screen should work with minimal friction and clear error states. |

## 15. MVP Build Priority and Release Plan

| Priority | Build Area | Screens / Features |
| --- | --- | --- |
| P0 | Foundation | Auth, user roles, public routing, base layout, event model, status model. |
| P1 | Rider event flow | Home, Explore, Event Detail, RSVP, QR Pass, My Passes, Share. |
| P2 | Organizer flow | Organizer Application, Dashboard, Create Event Wizard, My Events, Event Status, Attendees. |
| P3 | Venue flow | Venue Dashboard, Event Request Detail, Approve/Reject/Conditions, Venue Scanner. |
| P4 | Admin flow | Admin Dashboard, Organizer Verification, Event Review, Moderation, User Management. |
| P5 | Check-in and reporting | QR scanner, manual check-in, event report, venue report, export. |
| P6 | Brand/dealer minimal | Brand Event Page, Test Ride Interest Form, Admin Lead Export. |

### 15.1 Suggested First Working Demo

- Admin creates or approves one venue.
- Admin approves one organizer.
- Organizer creates one Bike Night event and submits to venue.
- Venue approves with rules/conditions.
- Admin publishes event.
- Rider browses event, taps Going, gets QR Pass.
- Organizer scans QR at event day.
- Report shows RSVP and check-in count.

## 16. Out of Scope and Open Questions

### 16.1 Out of Scope for MVP

- In-app payments, paid tickets, wallet, club dues, refunds.
- Live GPS, convoy tracking, custom routing, road closure management.
- Automated raffle drawing, prize tax, promo permit validation automation.
- User-generated public events without verification.
- Long-form social feed, public comments, direct messaging, chat replacement.
- Full brand CRM integration and automated billing.
- Full cyclist/padyak vertical. Keep optional category/tag only if needed.

### 16.2 Open Questions

| Question | Why It Matters |
| --- | --- |
| Should organizer verification allow drafts while pending? | Improves onboarding but could create confusion if drafts cannot move forward. |
| What is the initial attendance threshold for admin review? | Controls risk without slowing small events. Suggested: 50 for new organizers, 100 for trusted. |
| Should venue approval be required for every venue event? | Recommended yes, but admin-created events may bypass with consent already confirmed. |
| How will check-in be scanned? | Decide whether scanner is web camera, mobile browser camera, or admin-only manual. |
| Will notifications be email, SMS, push, or in-app only? | Affects cost and implementation. MVP can start with email/in-app. |
| Should brand/dealer have their own dashboard in MVP? | Recommendation: no. Admin exports leads manually first. |
| What exact data can be collected for test ride interest? | Keep minimal until legal/privacy review. |
| Will the product name be Tambike, Tambike Radar, or another brand? | Affects UI copy and marketing but not core architecture. |

## Appendix A: Complete Screen Inventory

| ID | Screen | Role | Priority |
| --- | --- | --- | --- |
| S01 | Landing Page | Public | P1 |
| S02 | Login / Sign Up | Public | P0 |
| S03 | Onboarding | Rider | P1 |
| S04 | Home | Rider | P1 |
| S05 | Explore Events | Rider | P1 |
| S06 | Event Detail | Rider | P1 |
| S07 | RSVP / Register Modal | Rider | P1 |
| S08 | QR Tambike Pass | Rider | P1 |
| S09 | My Passes | Rider | P1 |
| S10 | Past Event / Badge | Rider | P2 |
| S11 | Profile | Rider | P1 |
| S12 | Organizer Application | Organizer | P2 |
| S13 | Organizer Dashboard | Organizer | P2 |
| S14 | My Events | Organizer | P2 |
| S15 | Create Event Wizard | Organizer | P2 |
| S16 | Event Status Detail | Organizer | P2 |
| S17 | Attendee List | Organizer | P3 |
| S18 | QR Scanner | Organizer/Venue | P3 |
| S19 | Event Report | Organizer | P5 |
| S21 | Venue Dashboard | Venue | P3 |
| S22 | Event Request Detail | Venue | P3 |
| S23 | Approved Events | Venue | P3 |
| S24 | Venue QR Scanner | Venue | P3 |
| S25 | Venue Report | Venue | P5 |
| S26 | Admin Dashboard | Admin | P4 |
| S27 | Organizer Verification Queue | Admin | P4 |
| S28 | Organizer Verification Detail | Admin | P4 |
| S31 | Event Review Queue | Admin | P4 |
| S32 | Event Review Detail | Admin | P4 |
| S33 | Moderation / Flagged Events | Admin | P4 |
| S34 | User Management | Admin | P4 |
| S35 | Brand Event Page | Brand/Dealer | P6 |
| S36 | Test Ride Interest Form | Brand/Dealer | P6 |
| S37 | Lead Export View | Admin | P6 |

## Appendix B: Sample Event Card Copy

```text
[Poster Image]

BIKE NIGHT AT KAPE MOTO
Fri - July 10 - 7:00 PM onwards
Tagaytay

82 Going - 237 Interested
Hosted by Kape Moto + Yamaha Cavite

Free sticker for first 50 check-ins

[Going] [Share]
```

## Appendix C: Sample QR Pass Copy

```text
Tambike Pass

Bike Night at Kape Moto
Friday - July 10 - 7:00 PM
Venue: Kape Moto Tagaytay

[QR CODE]

Benefits:
- Raffle entry
- Free sticker if within first 50 check-ins
- Coffee discount

[Open Waze] [Share Pass] [View Event]
```

## Appendix D: Final MVP Summary

```text
RIDER:
Home -> Event Detail -> Going/Register -> QR Pass -> Check-in -> Badge/Recap

ORGANIZER:
Apply Verification -> Create Event -> Venue Approval -> Admin Review if needed -> Published -> Check-ins -> Report

VENUE:
Review Event Request -> Approve/Reject/Conditions -> Event Day Check-in -> Report

ADMIN:
Verify Organizer -> Review Risky Events -> Moderate -> Archive/Report
```

## Document Status

| Item | Status |
| --- | --- |
| Current version | v0.1 |
| Scope | MVP requirements + UI wireflow |
| Ready for | Frontend planning, backend/API planning, database schema, and design mockups |
| Not yet ready for | Final legal/privacy policy, payment processing, ticketing, or automated brand billing. |
