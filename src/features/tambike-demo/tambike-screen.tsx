"use client";

import clsx from "clsx";
import {
  AlertTriangle,
  Building2,
  CalendarPlus,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  Gauge,
  LogIn,
  LogOut,
  Menu,
  Motorbike,
  QrCode,
  Route,
  ScanLine,
  Search,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Ticket,
  User,
  UserPlus,
  XCircle,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  adminApproval,
  defaultPass,
  getEvent,
  getOrganizer,
  getVenue,
  reportMetrics,
  venues,
  venueApproval,
} from "./data";
import { useDemo } from "./demo-provider";
import type { AttendanceType, Event, EventType, ReportMetric, Role, ScannerOutcome } from "./types";

export type TambikeView =
  | "discovery"
  | "events"
  | "event-detail"
  | "passes"
  | "pass-detail"
  | "login"
  | "signup"
  | "profile"
  | "organizer-apply"
  | "organizer-dashboard"
  | "organizer-create"
  | "organizer-event"
  | "organizer-attendees"
  | "organizer-scanner"
  | "organizer-report"
  | "venue-claim"
  | "venue-dashboard"
  | "venue-request"
  | "venue-checkin"
  | "venue-report"
  | "admin-dashboard"
  | "admin-organizers"
  | "admin-venue-claims"
  | "admin-event-reviews"
  | "admin-event-review";

interface TambikeScreenProps {
  view: TambikeView;
  id?: string;
  eventQuery?: EventQuery;
}

interface EventQuery {
  type?: string;
}

const roleLabels: Record<Role, string> = {
  guest: "Guest",
  rider: "Rider",
  organizer: "Organizer",
  venue: "Venue",
  admin: "Admin",
};

const primaryEventId = defaultPass.eventId;
const primaryPassId = defaultPass.id;
const featuredEventIds = [
  "tambike-cafe-classico",
  "boys-underbone-laguna-tambike",
  "ccph-upper-east-tambike",
  "ccph-cebu-official-tambike",
  "tambike-night-malabon",
  "fullprint-manila-tambike",
];
const featuredCarouselIntervalMs = 5_000;
const featuredDragActivationPx = 16;
const featuredDragCommitPx = 90;

const passIdForEvent = (eventId: string) => `pass-${eventId}`;
const eventIdFromPassId = (passId?: string) =>
  passId?.startsWith("pass-") ? passId.slice("pass-".length) : defaultPass.eventId;
const qrTokenForEvent = (eventId: string) => `TBK-${eventId.toUpperCase()}`;
const findEvent = (events: Event[], eventId?: string) =>
  events.find((event) => event.id === eventId) ?? getEvent(eventId);

const navigationByRole: Record<Role, Array<{ label: string; href: string }>> = {
  guest: [
    { label: "Home", href: "/home" },
    { label: "Explore", href: "/events" },
  ],
  rider: [
    { label: "Home", href: "/home" },
    { label: "Explore", href: "/events" },
    { label: "Passes", href: "/passes" },
    { label: "Profile", href: "/profile" },
  ],
  organizer: [
    { label: "Dashboard", href: "/organizer/dashboard" },
    { label: "My Events", href: `/organizer/events/${primaryEventId}` },
    { label: "Create Event", href: "/organizer/events/create" },
    { label: "Attendees", href: `/organizer/events/${primaryEventId}/attendees` },
    { label: "Reports", href: `/organizer/events/${primaryEventId}/report` },
  ],
  venue: [
    { label: "Dashboard", href: "/venue/dashboard" },
    { label: "Event Requests", href: `/venue/requests/${venueApproval.id}` },
    { label: "Approved Events", href: `/venue/events/${primaryEventId}/checkin` },
    { label: "Reports", href: `/venue/events/${primaryEventId}/report` },
  ],
  admin: [
    { label: "Dashboard", href: "/admin" },
    { label: "Verifications", href: "/admin/verifications/organizers" },
    { label: "Venue Claims", href: "/admin/venues/claims" },
    { label: "Event Reviews", href: "/admin/events/review" },
    { label: "Reports", href: `/organizer/events/${primaryEventId}/report` },
  ],
};

const footerLinkGroups = [
  {
    title: "Events",
    ariaLabel: "Footer event links",
    links: [
      { label: "Explore events", href: "/events" },
      { label: "Charity rides", href: "/events?type=charity-ride" },
      { label: "Track days", href: "/events?type=track-day" },
      { label: "Moto expos", href: "/events?type=moto-expo" },
    ],
  },
  {
    title: "Riders",
    ariaLabel: "Footer rider links",
    links: [
      { label: "My passes", href: "/passes" },
      { label: "Profile", href: "/profile" },
      { label: "Create rider account", href: "/signup" },
    ],
  },
  {
    title: "Organizers",
    ariaLabel: "Footer organizer links",
    links: [
      { label: "Organizer application", href: "/organizer/apply" },
      { label: "Create event", href: "/organizer/events/create" },
      { label: "Scanner", href: `/organizer/events/${primaryEventId}/scanner` },
      { label: "Reports", href: `/organizer/events/${primaryEventId}/report` },
    ],
  },
] satisfies Array<{
  title: string;
  ariaLabel: string;
  links: Array<{ label: string; href: string }>;
}>;

const eventFilters = [
  { label: "All", value: "all", href: "/events", icon: SlidersHorizontal, matches: () => true },
  { label: "Tambike", value: "tambike", href: "/events?type=tambike", icon: Motorbike, matches: (event: Event) => event.type === "Tambike" },
  { label: "Charity", value: "charity-ride", href: "/events?type=charity-ride", icon: Route, matches: (event: Event) => event.type === "Charity Ride" },
  { label: "Track Day", value: "track-day", href: "/events?type=track-day", icon: Gauge, matches: (event: Event) => event.type === "Track Day" },
  { label: "Endurance", value: "endurance-ride", href: "/events?type=endurance-ride", icon: Route, matches: (event: Event) => event.type === "Endurance Ride" },
  { label: "Race", value: "race", href: "/events?type=race", icon: Gauge, matches: (event: Event) => event.type === "Race" },
  { label: "Moto Expo", value: "moto-expo", href: "/events?type=moto-expo", icon: Building2, matches: (event: Event) => event.type === "Moto Expo" },
] satisfies Array<{
  label: string;
  value: string;
  href: string;
  icon: ComponentType;
  matches: (event: Event) => boolean;
}>;

function getEventFilter(value?: string) {
  return eventFilters.find((filter) => filter.value === value) ?? eventFilters[0];
}

function getFeaturedEvents(events: Event[]) {
  const eventById = new Map(events.map((event) => [event.id, event]));
  const featuredEvents = featuredEventIds.flatMap((eventId) => {
    const event = eventById.get(eventId);
    return event ? [event] : [];
  });

  return featuredEvents.length ? featuredEvents : events.slice(0, 6);
}

const eventVisuals: Record<
  EventType | string,
  { accent: string; poster: string }
> = {
  Tambike: { accent: "#f4b23f", poster: "#261105" },
  "Bike Night": { accent: "#ffd166", poster: "#140504" },
  "Coffee Ride": { accent: "#20b26b", poster: "#08231a" },
  "Club EB": { accent: "#9fb8ff", poster: "#10172d" },
  "Brand Event": { accent: "#e63b2e", poster: "#2c0a08" },
  "Test Ride": { accent: "#d7dee2", poster: "#151515" },
  "Charity Ride": { accent: "#20b26b", poster: "#09231d" },
  "Track Day": { accent: "#ff3b30", poster: "#190707" },
  "Endurance Ride": { accent: "#f29431", poster: "#10151f" },
  "Moto Expo": { accent: "#20bfd0", poster: "#071517" },
  Race: { accent: "#ffbe45", poster: "#09090a" },
};

const scannerCopy: Record<ScannerOutcome, { title: string; body: string; tone: string }> = {
  idle: {
    title: "Ready to scan",
    body: "Use the camera frame or manual lookup when a rider has camera or screen issues.",
    tone: "neutral",
  },
  valid: {
    title: "Checked in successfully",
    body: "Tambike Pass matched this event and the rider can claim available perks.",
    tone: "success",
  },
  already: {
    title: "Already checked in at 7:18 PM",
    body: "Duplicate scans are blocked. Staff can still view the original check-in timestamp.",
    tone: "warning",
  },
  "wrong-event": {
    title: "Pass belongs to a different event",
    body: "Ask the rider to open the correct Tambike Pass for this event.",
    tone: "danger",
  },
  cancelled: {
    title: "This pass was cancelled",
    body: "Cancelled passes cannot be checked in or used for perk redemption.",
    tone: "danger",
  },
  inactive: {
    title: "Check-in window is not active",
    body: "The scanner only accepts passes inside the configured event-day window.",
    tone: "warning",
  },
};

export function TambikeScreen({ view, id, eventQuery }: TambikeScreenProps) {
  if (view === "discovery") {
    return (
      <AppShell>
        <DiscoveryScreen compact={false} query={eventQuery} />
      </AppShell>
    );
  }

  if (view === "events") {
    return (
      <AppShell>
        <DiscoveryScreen compact query={eventQuery} />
      </AppShell>
    );
  }

  return (
    <>
      {view === "event-detail" && <EventDetail eventId={id} />}
      {view === "passes" && <PassesScreen />}
      {view === "pass-detail" && <PassDetail passId={id} />}
      {view === "login" && <LoginScreen />}
      {view === "signup" && <SignupScreen />}
      {view === "profile" && <ProfileScreen />}
      {view === "organizer-apply" && <OrganizerApplyScreen />}
      {view === "organizer-dashboard" && <OrganizerDashboard />}
      {view === "organizer-create" && <CreateEventScreen />}
      {view === "organizer-event" && <OrganizerEventStatus eventId={id} />}
      {view === "organizer-attendees" && <AttendeesScreen eventId={id} />}
      {view === "organizer-scanner" && <ScannerScreen eventId={id} owner="organizer" />}
      {view === "organizer-report" && <ReportScreen eventId={id} owner="organizer" />}
      {view === "venue-claim" && <VenueClaimScreen />}
      {view === "venue-dashboard" && <VenueDashboard />}
      {view === "venue-request" && <VenueRequestScreen requestId={id} />}
      {view === "venue-checkin" && <ScannerScreen eventId={id} owner="venue" />}
      {view === "venue-report" && <ReportScreen eventId={id} owner="venue" />}
      {view === "admin-dashboard" && <AdminDashboard />}
      {view === "admin-organizers" && <AdminQueue title="Organizer verifications" />}
      {view === "admin-venue-claims" && <AdminQueue title="Venue claim queue" />}
      {view === "admin-event-reviews" && <AdminEventReviews />}
      {view === "admin-event-review" && <AdminEventReview reviewId={id} />}
    </>
  );
}

function SpeedometerNavGauge() {
  const ticks: Array<[number, number, number, number]> = [
    [27, 47, 43, 42],
    [43, 39, 58, 36],
    [62, 32, 75, 30],
    [84, 27, 96, 25],
    [108, 23, 119, 22],
    [132, 21, 143, 21],
    [155, 21, 166, 22],
    [179, 24, 190, 26],
    [202, 29, 214, 32],
    [225, 36, 239, 40],
    [244, 43, 260, 48],
  ];

  return (
    <svg
      className="main-nav-gauge"
      viewBox="0 0 286 61"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="none"
    >
      <defs>
        <radialGradient id="main-nav-gauge-face" cx="50%" cy="112%" r="92%">
          <stop offset="0%" stopColor="#3a2818" />
          <stop offset="43%" stopColor="#151315" />
          <stop offset="100%" stopColor="#07080a" />
        </radialGradient>
        <linearGradient id="main-nav-gauge-glass" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#fff3d1" stopOpacity="0.24" />
          <stop offset="46%" stopColor="#fff3d1" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.24" />
        </linearGradient>
        <linearGradient id="main-nav-gauge-needle" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#ffb45d" />
          <stop offset="42%" stopColor="#e33c2e" />
          <stop offset="100%" stopColor="#ff4b38" />
        </linearGradient>
      </defs>
      <rect
        x="2"
        y="2"
        width="282"
        height="57"
        rx="28.5"
        fill="url(#main-nav-gauge-face)"
        stroke="#d8b46d"
        strokeOpacity="0.48"
        strokeWidth="1.5"
      />
      <path
        d="M24 49C70 18 216 18 262 49"
        fill="none"
        stroke="#f5dc9b"
        strokeOpacity="0.28"
        strokeWidth="2"
      />
      <path
        d="M31 49C82 27 204 27 255 49"
        fill="none"
        stroke="#f2cf83"
        strokeOpacity="0.38"
        strokeWidth="1"
      />
      <path
        d="M25 49C50 34 79 26 113 22"
        fill="none"
        stroke="#d63b2f"
        strokeOpacity="0.74"
        strokeWidth="6"
      />
      <g stroke="#ffe8ad" strokeLinecap="round" strokeOpacity="0.72" strokeWidth="1.5">
        {ticks.map(([x1, y1, x2, y2]) => (
          <line key={`${x1}-${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
      </g>
      <line
        x1="143"
        y1="49"
        x2="207"
        y2="27"
        stroke="url(#main-nav-gauge-needle)"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <circle cx="143" cy="49" r="7" fill="#2a1a12" stroke="#e8bd65" strokeOpacity="0.68" />
      <circle cx="143" cy="49" r="3" fill="#e33c2e" opacity="0.76" />
      <rect x="2" y="2" width="282" height="57" rx="28.5" fill="url(#main-nav-gauge-glass)" />
    </svg>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { role, currentUser, logout } = useDemo();
  const [navOpen, setNavOpen] = useState(false);
  const links = navigationByRole[role];
  const showHostCta = role === "guest" || role === "rider";

  return (
    <div className="tambike-shell">
      <header className={clsx("site-header", navOpen && "is-nav-open")} data-role={role}>
        <div className="header-leading">
          <Link className="brand" href="/" aria-label="Tambike home">
            <span className="brand-mark" aria-hidden="true">
              TB
            </span>
            <span className="brand-core">Tambike</span>
          </Link>
        </div>
        <nav className="main-nav" aria-label={`${roleLabels[role]} navigation`}>
          <SpeedometerNavGauge />
          {links.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setNavOpen(false)}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          {showHostCta && (
            <Link className="host-event-link" href="/organizer/apply" aria-label="Host an Event">
              <CalendarPlus aria-hidden="true" />
              <span>Host an Event</span>
            </Link>
          )}
          {currentUser ? (
            <>
              <Link className="account-chip" href="/profile">
                <User aria-hidden="true" />
                <span>{currentUser.displayName}</span>
                <strong>{roleLabels[role]}</strong>
              </Link>
              <button className="icon-button" type="button" aria-label="Log out" onClick={logout}>
                <LogOut aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              <Link className="auth-link" href="/login">
                <LogIn aria-hidden="true" />
                Log in
              </Link>
              <Link className="auth-link auth-link-strong" href="/signup">
                <UserPlus aria-hidden="true" />
                Sign up
              </Link>
            </>
          )}
          <button className="icon-button" type="button" aria-label="Search">
            <Search aria-hidden="true" />
          </button>
          <Link className="icon-button" href={currentUser ? "/profile" : "/login"} aria-label="Account">
            <User aria-hidden="true" />
          </Link>
          <button
            className="menu-button"
            type="button"
            aria-label={navOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <Menu aria-hidden="true" />
          </button>
        </div>
      </header>
      <main className="ambient-main">{children}</main>
      <TambikeFooter />
    </div>
  );
}

function TambikeFooter() {
  return (
    <footer className="site-footer" aria-label="Tambike footer">
      <div className="footer-shell">
        <section className="footer-brand-panel" aria-label="Footer brand">
          <Link className="brand footer-brand-link" href="/" aria-label="Tambike footer home">
            <span className="brand-mark" aria-hidden="true">
              TB
            </span>
            <span className="brand-core">Tambike</span>
          </Link>
          <div className="footer-callout">
            <span>Ride bulletin</span>
            <p>
              Built for tambike nights, charity rides, track days, and venue-hosted motorcycle
              ganaps.
            </p>
          </div>
          <div className="footer-gauge" aria-hidden="true">
            <span className="footer-gauge__needle" />
            <span className="footer-gauge__hub" />
          </div>
        </section>

        <div className="footer-link-grid">
          {footerLinkGroups.map((group) => (
            <FooterLinkGroup key={group.title} group={group} />
          ))}
        </div>

        <aside className="footer-dispatch" aria-label="Tambike dispatch status">
          <span>Next checkpoint</span>
          <strong>Pass flow, event review, scanner, and reports are ready for walkthrough.</strong>
          <div className="footer-dispatch__actions">
            <Link href={`/events/${primaryEventId}`}>
              <Route aria-hidden="true" />
              Featured ride
            </Link>
            <Link href="/login">
              <Ticket aria-hidden="true" />
              Demo login
            </Link>
          </div>
        </aside>
      </div>
      <div className="footer-legal">
        <span>© 2026 Tambike UI Demo</span>
        <div>
          <Link href="/admin/events/review">Review queue</Link>
          <Link href="/venue/claim">Claim venue</Link>
        </div>
      </div>
    </footer>
  );
}

function FooterLinkGroup({
  group,
}: {
  group: (typeof footerLinkGroups)[number];
}) {
  return (
    <nav className="footer-link-group" aria-label={group.ariaLabel}>
      <h2>{group.title}</h2>
      {group.links.map((link) => (
        <Link key={link.href} href={link.href}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

function DiscoveryScreen({ compact, query }: { compact: boolean; query?: EventQuery }) {
  const { events } = useDemo();
  const activeFilter = compact ? getEventFilter(query?.type) : eventFilters[0];
  const isFiltered = activeFilter.value !== "all";
  const visibleEvents = events.filter(activeFilter.matches);
  const featuredEvents = getFeaturedEvents(events);
  const primaryListings = isFiltered ? visibleEvents : visibleEvents.slice(0, 5);
  const secondaryListings = isFiltered ? [] : visibleEvents.slice(5).concat(visibleEvents.slice(0, 4));
  const [activeFeaturedIndex, setActiveFeaturedIndex] = useState(0);
  const [dragDirection, setDragDirection] = useState<"previous" | "next" | null>(null);
  const dragStartXRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const suppressFeatureClickRef = useRef(false);
  const manualFeatureInteractionRef = useRef(0);
  const normalizedFeaturedIndex = featuredEvents.length
    ? activeFeaturedIndex % featuredEvents.length
    : 0;
  const categoryStyle = { "--category-count": eventFilters.length } as CSSProperties;

  const moveFeature = (direction: number) => {
    if (featuredEvents.length < 2) {
      return;
    }

    manualFeatureInteractionRef.current = window.Date.now();
    setActiveFeaturedIndex((index) => (index + direction + featuredEvents.length) % featuredEvents.length);
  };

  const resetFeatureDrag = () => {
    dragStartXRef.current = null;
    dragMovedRef.current = false;
    setDragDirection(null);
  };

  const handleFeaturePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (featuredEvents.length < 2 || event.button !== 0) return;

    dragStartXRef.current = event.clientX;
    dragMovedRef.current = false;
    setDragDirection(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleFeaturePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartXRef.current === null) return;

    const deltaX = event.clientX - dragStartXRef.current;
    if (Math.abs(deltaX) < featuredDragActivationPx) return;

    dragMovedRef.current = true;
    setDragDirection(deltaX < 0 ? "next" : "previous");
  };

  const handleFeaturePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartXRef.current === null) return;

    const deltaX = event.clientX - dragStartXRef.current;
    const didDrag = Math.abs(deltaX) >= featuredDragActivationPx;
    const didCommit = Math.abs(deltaX) >= featuredDragCommitPx;

    if (didDrag) {
      suppressFeatureClickRef.current = true;
    }

    if (didCommit) {
      moveFeature(deltaX < 0 ? 1 : -1);
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    resetFeatureDrag();
  };

  const handleFeaturePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    resetFeatureDrag();
  };

  const handleFeatureClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!suppressFeatureClickRef.current) return;

    event.preventDefault();
    event.stopPropagation();
    suppressFeatureClickRef.current = false;
  };

  const handleFeatureKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveFeature(-1);
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveFeature(1);
    }
  };

  useEffect(() => {
    if (featuredEvents.length < 2) return;

    const timerId = window.setInterval(() => {
      if (window.Date.now() - manualFeatureInteractionRef.current < featuredCarouselIntervalMs) {
        return;
      }

      setActiveFeaturedIndex((index) => (index + 1) % featuredEvents.length);
    }, featuredCarouselIntervalMs);

    return () => window.clearInterval(timerId);
  }, [featuredEvents.length]);

  const markFeatureCarouselReady = (node: HTMLDivElement | null) => {
    if (node) {
      node.dataset.ready = "true";
    }
  };

  return (
    <>
      <section className={clsx("hero", compact && "hero-compact")}>
        <div className="hero-content">
          <h1 className="sr-only">Tambike events</h1>
          <div
            ref={markFeatureCarouselReady}
            className={clsx(
              "featured-carousel",
              dragDirection === "previous" && "is-dragging-previous",
              dragDirection === "next" && "is-dragging-next",
            )}
            data-ready="false"
            aria-label="Featured Tambike events"
          >
            <button
              className="slider-button wheel-button slider-prev"
              type="button"
              aria-label="Previous featured event"
              onClick={() => moveFeature(-1)}
            >
              <span className="wheel-face" aria-hidden="true">
                <span className="wheel-spoke wheel-spoke-horizontal" />
                <span className="wheel-spoke wheel-spoke-vertical" />
                <span className="wheel-spoke wheel-spoke-diagonal-a" />
                <span className="wheel-spoke wheel-spoke-diagonal-b" />
                <span className="wheel-hub" />
              </span>
            </button>
            <div
              className="hero-showcase"
              tabIndex={0}
              onPointerDown={handleFeaturePointerDown}
              onPointerMove={handleFeaturePointerMove}
              onPointerUp={handleFeaturePointerUp}
              onPointerCancel={handleFeaturePointerCancel}
              onClickCapture={handleFeatureClickCapture}
              onKeyDown={handleFeatureKeyDown}
              onDragStart={(event) => event.preventDefault()}
            >
              {featuredEvents.map((event, index) => (
                <FeatureCard
                  key={event.id}
                  event={event}
                  index={index}
                  activeIndex={normalizedFeaturedIndex}
                  total={featuredEvents.length}
                />
              ))}
            </div>
            <button
              className="slider-button wheel-button slider-next"
              type="button"
              aria-label="Next featured event"
              onClick={() => moveFeature(1)}
            >
              <span className="wheel-face" aria-hidden="true">
                <span className="wheel-spoke wheel-spoke-horizontal" />
                <span className="wheel-spoke wheel-spoke-vertical" />
                <span className="wheel-spoke wheel-spoke-diagonal-a" />
                <span className="wheel-spoke wheel-spoke-diagonal-b" />
                <span className="wheel-hub" />
              </span>
            </button>
          </div>
          <nav
            className="category-strip"
            aria-label={compact ? "Event category filters" : "Event discovery categories"}
            style={categoryStyle}
          >
            {eventFilters.map((filter) => (
              <Link
                key={filter.value}
                className={filter.value === activeFilter.value ? "is-active" : undefined}
                href={filter.href}
                aria-current={filter.value === activeFilter.value ? "page" : undefined}
              >
                <strong className="cat-icon" aria-hidden="true">
                  <filter.icon />
                </strong>
                <span>{filter.label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </section>
      <section className="listings" aria-label="Published events">
        <div className="event-grid">
          {primaryListings.map((event, index) => (
            <EventCard key={event.id} event={event} priority={index === 0} />
          ))}
        </div>
        <div className="event-grid event-grid-secondary">
          {secondaryListings.map((event, index) => (
            <EventCard key={`${event.id}-secondary-${index}`} event={event} />
          ))}
        </div>
      </section>
    </>
  );
}

function featureOffset(index: number, activeIndex: number, total: number) {
  let offset = index - activeIndex;
  const midpoint = total / 2;

  if (offset > midpoint) offset -= total;
  if (offset <= -midpoint) offset += total;

  return offset;
}

function splitFeatureTitleEndPhrase(title: string) {
  const words = title.trim().split(/\s+/);

  if (words.length < 3) {
    return null;
  }

  return {
    prefix: words.slice(0, -2).join(" "),
    keepTogether: words.slice(-2).join(" "),
  };
}

function FeatureCard({
  event,
  index,
  activeIndex,
  total,
}: {
  event: Event;
  index: number;
  activeIndex: number;
  total: number;
}) {
  const offset = featureOffset(index, activeIndex, total);
  const distance = Math.abs(offset);
  const isFeatured = offset === 0;
  const isVisible = distance <= 2;
  const isWidePeek = distance === 3;
  const visual = eventVisuals[event.type] ?? eventVisuals.Tambike;
  const titleParts = splitFeatureTitleEndPhrase(event.title);
  const featureStyle = {
    "--x": `calc(${offset} * (var(--feature-card-width) + var(--feature-gap)))`,
    "--scale": isFeatured ? "1.08" : distance === 1 ? "0.9" : distance === 2 ? "0.82" : "0.74",
    "--opacity": isFeatured ? "1" : distance === 1 ? "0.78" : distance === 2 ? "0.42" : distance === 3 ? "0.28" : "0",
    "--z": String(10 - distance),
    "--feature-tone": visual.poster,
  } as CSSProperties;

  return (
    <Link
      className={clsx(
        "feature-card",
        isFeatured && "is-featured",
        isVisible && "is-visible",
        isWidePeek && "is-wide-peek",
      )}
      href={`/events/${event.id}`}
      style={featureStyle}
      aria-hidden={!isVisible}
      tabIndex={isFeatured ? 0 : -1}
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
    >
      <div className="feature-cover">
        <Image
          src={event.poster}
          alt={`${event.title} poster`}
          fill
          draggable={false}
          loading={isFeatured ? "eager" : "lazy"}
          fetchPriority={isFeatured ? "high" : "auto"}
          sizes="(max-width: 760px) 68vw, (min-width: 1600px) 260px, 300px"
        />
      </div>
      <div className="feature-caption">
        <h2 className={event.title.length > 24 ? "feature-title-compact" : undefined}>
          {titleParts ? (
            <>
              {titleParts.prefix ? `${titleParts.prefix} ` : null}
              <span className="feature-title-keep">{titleParts.keepTogether}</span>
            </>
          ) : (
            event.title
          )}
        </h2>
        <p>
          {event.date} · {event.area}
        </p>
      </div>
    </Link>
  );
}

function EventCard({ event, priority = false }: { event: Event; priority?: boolean }) {
  const visual = eventVisuals[event.type] ?? eventVisuals.Tambike;
  const cardStyle = {
    "--accent": visual.accent,
    "--poster": visual.poster,
  } as CSSProperties;

  return (
    <Link className="event-card" href={`/events/${event.id}`} style={cardStyle}>
      <div className="poster">
        <Image
          src={event.poster}
          alt={`${event.title} poster`}
          fill
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          sizes="260px"
        />
        <span className="special-offer">{event.perkPreview}</span>
        <span className="bookmark" aria-hidden="true" />
      </div>
      <h3>{event.title}</h3>
      <p className="event-card__meta">
        {event.date} · {event.area}
      </p>
      <div className="event-card__footer">
        <div className="price">
          <strong>{event.going} Going</strong>
          <span>{event.interested} Interested</span>
        </div>
        <span className="event-card__action">Going</span>
      </div>
    </Link>
  );
}

function EventDetail({ eventId }: { eventId?: string }) {
  const { authNotice, events, requireLogin, setAuthNotice } = useDemo();
  const event = findEvent(events, eventId);
  const venue = getVenue(event.venueId);
  const organizer = getOrganizer(event.organizerId);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const visual = eventVisuals[event.type] ?? eventVisuals.Tambike;
  const detailStyle = {
    "--event-accent": visual.accent,
    "--event-poster-tone": visual.poster,
  } as CSSProperties;
  const openRegistration = () => {
    if (requireLogin("Log in to get your Tambike Pass")) {
      setIsModalOpen(true);
    }
  };

  return (
    <section className="event-detail-view" style={detailStyle}>
      <div className="event-detail-topbar">
        <Link className="brand" href="/" aria-label="Tambike home">
          <span className="brand-mark" aria-hidden="true">
            TB
          </span>
          <span className="brand-core">Tambike</span>
        </Link>
        <nav className="event-detail-nav" aria-label="Event navigation">
          <Link href="/home">Home</Link>
          <Link href="/events">Explore</Link>
          <Link href="/passes">Passes</Link>
        </nav>
      </div>
      <div className="event-detail-shell">
        <section className="event-detail-stage">
          <div className="event-detail-poster-stack">
            <span className="event-detail-route-line" />
            <figure className="event-detail-poster">
              <Image
                src={event.poster}
                alt={`${event.title} poster`}
                fill
                sizes="(max-width: 900px) 78vw, 420px"
                preload
              />
            </figure>
          </div>
          <div className="event-detail-copy">
            <span className="event-detail-type">{event.type}</span>
            <h1>{event.title}</h1>
            <p>{event.shortDescription}</p>
            <div className="event-detail-actions">
              <button className="primary-action" type="button" onClick={openRegistration}>
                Going
              </button>
              <button
                className="ghost-action"
                type="button"
                onClick={() => requireLogin("Log in to save this event")}
              >
                Interested
              </button>
              <button className="ghost-action" type="button">
                <Share2 aria-hidden="true" />
                Share
              </button>
            </div>
            <div className="event-detail-facts" aria-label="Event highlights">
              <div>
                <span>Date</span>
                <strong>{event.date}</strong>
              </div>
              <div>
                <span>Time</span>
                <strong>{event.time}</strong>
              </div>
              <div>
                <span>Venue</span>
                <strong>{venue.area}</strong>
              </div>
            </div>
          </div>
        </section>
        <div className="event-detail-layout">
          <div className="event-detail-main">
            <div className="event-detail-tags" aria-label="Event tags">
              {event.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            <InfoPanel eyebrow="What's happening" title="Reason to go">
              <p>{event.whatHappens}</p>
            </InfoPanel>
            {event.rideOut && (
              <InfoPanel eyebrow="Ride / meetup" title={event.rideOut.meetup}>
                <div className="detail-grid">
                  <Detail label="Call time" value={event.rideOut.callTime} />
                  <Detail label="Departure" value={event.rideOut.departure} />
                  <Detail label="Destination" value={event.rideOut.destination} />
                  <Detail label="Note" value={event.rideOut.notes} />
                </div>
              </InfoPanel>
            )}
            <InfoPanel eyebrow="Host" title={organizer.displayName}>
              <p>
                Verified organizer · {organizer.pastEvents} previous events · {organizer.fbLink}
              </p>
            </InfoPanel>
            <InfoPanel eyebrow="Rules" title="Safety and venue notes">
              <div className="chip-list">
                {event.rules.map((rule) => (
                  <span key={rule}>{rule}</span>
                ))}
              </div>
            </InfoPanel>
          </div>
          <aside className="event-detail-pass-panel" aria-label="Event summary">
            <div className="event-detail-pass-heading">
              <Ticket aria-hidden="true" />
              <div>
                <span>Tambike Pass</span>
                <h2>{event.perkPreview}</h2>
              </div>
            </div>
            <p>
              QR check-in unlocks the event perk and keeps the organizer headcount clean.
            </p>
            <div className="event-detail-pass-stats">
              <div>
                <span>Going</span>
                <strong>{event.going}</strong>
              </div>
              <div>
                <span>Interested</span>
                <strong>{event.interested}</strong>
              </div>
              <div>
                <span>Expected</span>
                <strong>{event.expectedRiders}</strong>
              </div>
            </div>
            <div className="event-detail-venue-card">
              <Building2 aria-hidden="true" />
              <div>
                <span>{venue.name}</span>
                <strong>{venue.area}</strong>
                <p>{venue.capacityNote}</p>
              </div>
            </div>
            {event.rideOut && (
              <div className="event-detail-venue-card">
                <Route aria-hidden="true" />
                <div>
                  <span>Route</span>
                  <strong>{event.rideOut.destination}</strong>
                  <p>{event.rideOut.notes}</p>
                </div>
              </div>
            )}
            <Link className="primary-action event-detail-map-link" href={venue.mapLink} target="_blank" rel="noreferrer">
              Open Waze
            </Link>
          </aside>
        </div>
      </div>
      {isModalOpen && <RsvpModal event={event} onClose={() => setIsModalOpen(false)} />}
      {authNotice && <AuthGateModal notice={authNotice} onClose={() => setAuthNotice("")} />}
    </section>
  );
}

function RsvpModal({ event, onClose }: { event: Event; onClose: () => void }) {
  const { registerForEvent } = useDemo();
  const [attendance, setAttendance] = useState<AttendanceType>("direct");
  const passHref = `/passes/${passIdForEvent(event.id)}`;

  const submit = () => {
    registerForEvent(attendance);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="rsvp-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Register for ${event.title}`}
        action={passHref}
        onSubmit={submit}
      >
        <div className="buy-section-title">
          <span>Register</span>
          <h2>Register for {event.title}</h2>
        </div>
        <fieldset className="attendance-options">
          <legend>How are you arriving?</legend>
          <label>
            <input
              type="radio"
              name="attendance"
              checked={attendance === "direct"}
              onChange={() => setAttendance("direct")}
            />
            <span>Go direct to venue</span>
          </label>
          <label>
            <input
              type="radio"
              name="attendance"
              checked={attendance === "ride-out"}
              onChange={() => setAttendance("ride-out")}
            />
            <span>Join the ride-out</span>
          </label>
          <label>
            <input
              type="radio"
              name="attendance"
              checked={attendance === "club"}
              onChange={() => setAttendance("club")}
            />
            <span>Not sure / join with club</span>
          </label>
        </fieldset>
        <div className="modal-actions">
          <button type="button" className="buy-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="checkout-button">
            Get Tambike Pass
          </button>
        </div>
      </form>
    </div>
  );
}

function AuthGateModal({ notice, onClose }: { notice: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="rsvp-modal auth-gate" role="dialog" aria-modal="true" aria-label={notice}>
        <div className="buy-section-title">
          <span>Account required</span>
          <h2>{notice}</h2>
        </div>
        <p>
          Use one of the sample accounts or create a rider profile to continue this MVP flow.
        </p>
        <div className="modal-actions">
          <button type="button" className="buy-secondary" onClick={onClose}>
            Cancel
          </button>
          <Link className="buy-secondary as-link" href="/signup">
            Sign up
          </Link>
          <Link className="checkout-button as-link" href="/login">
            Log in
          </Link>
        </div>
      </section>
    </div>
  );
}

function PassesScreen() {
  const { currentUser, events } = useDemo();
  const event = findEvent(events, defaultPass.eventId);

  if (!currentUser) {
    return <AuthRequired title="Log in to view passes" body="Tambike Passes are created after a rider registers for an event." />;
  }

  return (
    <LightView>
      <HeroPanel eyebrow="My Passes" title="Upcoming Tambike Passes" body="Keep QR passes, perks, Waze links, and event-day reminders in one place." />
      <div className="pass-list">
        <PassCard event={event} />
      </div>
    </LightView>
  );
}

function PassDetail({ passId }: { passId?: string }) {
  const { attendanceType, currentUser, events, passCreated } = useDemo();
  const event = findEvent(events, eventIdFromPassId(passId));
  const venue = getVenue(event.venueId);
  const passIdValue = passId ?? passIdForEvent(event.id);
  const qrToken = passIdValue === defaultPass.id ? defaultPass.qrToken : qrTokenForEvent(event.id);

  if (!currentUser) {
    return <AuthRequired title="Log in to view this pass" body="Tambike passes are tied to the logged-in rider profile." />;
  }

  return (
    <LightView>
      <section className="pass-detail">
        <div className="mobile-pass">
          <PassStrip title="Tambike Pass" body={passCreated ? "Ready for check-in" : "Demo pass preview"} />
          <h1>Tambike Pass</h1>
          <p>
            {event.title}
            <br />
            {event.date} · {event.time}
            <br />
            Venue: {venue.name}
          </p>
          <div className="qr-frame" aria-label="QR code for Tambike Pass">
            <QRCodeSVG value={qrToken} size={188} level="M" />
          </div>
          <p className="qr-token">QR token: {qrToken}</p>
          <div className="chip-list">
            <span>Attendance: {attendanceType === "ride-out" ? "Join ride-out" : "Go direct"}</span>
            <span>Pass ID: {passIdValue}</span>
          </div>
          <div className="pass-actions">
            <Link className="checkout-button as-link" href={venue.mapLink}>
              Open Waze
            </Link>
            <Link className="buy-secondary as-link" href={`/events/${event.id}`}>
              View Event
            </Link>
            <button className="buy-secondary" type="button">
              Share Pass
            </button>
          </div>
        </div>
        <aside className="order-summary">
          <div className="buy-section-title">
            <span>Benefits</span>
            <h2>Unlocked at check-in</h2>
          </div>
          {event.perks.map((perk) => (
            <PassStrip key={perk.id} title={perk.type} body={perk.description} />
          ))}
        </aside>
      </section>
    </LightView>
  );
}

function PassCard({ event }: { event: Event }) {
  return (
    <Link className="pass-card" href={`/passes/${passIdForEvent(event.id)}`}>
      <Image src={event.poster} alt={`${event.title} poster`} width={92} height={128} />
      <div>
        <span>{event.date}</span>
        <strong>{event.title}</strong>
        <p>{event.perkPreview}</p>
      </div>
      <QrCode aria-hidden="true" />
    </Link>
  );
}

function ScannerScreen({ eventId, owner }: { eventId?: string; owner: "organizer" | "venue" }) {
  const { events, scannerOutcome, setScannerOutcome, checkedInCount } = useDemo();
  const event = findEvent(events, eventId);
  const outcome = scannerCopy[scannerOutcome];
  const options: Array<{ label: string; value: ScannerOutcome }> = [
    { label: "Valid pass", value: "valid" },
    { label: "Already checked in", value: "already" },
    { label: "Wrong event", value: "wrong-event" },
    { label: "Cancelled pass", value: "cancelled" },
    { label: "Inactive window", value: "inactive" },
  ];

  return (
    <LightView>
      <section className="scanner-layout">
        <div className="scanner-frame">
          <ScanLine aria-hidden="true" />
          <h1>QR Scanner</h1>
          <p>{event.title}</p>
          <div className="scan-window">
            <span />
            <QRCodeSVG value={qrTokenForEvent(event.id)} size={156} />
          </div>
          <div className="scanner-buttons">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className="buy-secondary"
                onClick={() => setScannerOutcome(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <aside className={clsx("order-summary scanner-result", outcome.tone)}>
          <div className="buy-section-title">
            <span>{owner === "venue" ? "Venue scan" : "Organizer scan"}</span>
            <h2>{outcome.title}</h2>
          </div>
          <p>{outcome.body}</p>
          <MetricStrip
            metrics={[
              { label: "Checked in", value: String(checkedInCount), detail: "Actual arrivals" },
              { label: "Going", value: String(event.going), detail: "QR passes generated" },
            ]}
          />
          <label className="checkout-field checkout-field-wide">
            <span>Manual lookup</span>
            <input placeholder="Search attendee by name or phone" />
          </label>
          <Link className="checkout-button as-link" href={`/organizer/events/${event.id}/report`}>
            View report
          </Link>
        </aside>
      </section>
    </LightView>
  );
}

function VenueRequestScreen({ requestId }: { requestId?: string }) {
  const event = getEvent(venueApproval.eventId);
  const venue = getVenue(event.venueId);
  const { venueConditions, setVenueConditions, venueDecision, approveVenueWithConditions } =
    useDemo();

  return (
    <LightView>
      <section className="request-layout">
        <HeroPanel
          eyebrow="Event request"
          title="Venue request"
          body={`${event.title} needs venue approval before it can move to admin review or publish.`}
        />
        <aside className="order-summary">
          <div className="buy-section-title">
            <span>Request {requestId ?? venueApproval.id}</span>
            <h2>{venueDecision === "pending" ? "Pending venue decision" : "Venue approved"}</h2>
          </div>
          <p className="order-venue">
            {venue.name} · Expected riders: {event.expectedRiders}
          </p>
          {venueDecision === "pending" ? (
            <>
              <textarea
                className="condition-box"
                aria-label="Venue conditions"
                value={venueConditions}
                onChange={(event) => setVenueConditions(event.target.value)}
              />
              <button className="checkout-button" type="button" onClick={approveVenueWithConditions}>
                Approve with conditions
              </button>
            </>
          ) : (
            <PassStrip title="Approved with conditions" body={venueConditions} />
          )}
        </aside>
        <div className="buy-main">
          <InfoPanel eyebrow="Organizer" title={getOrganizer(event.organizerId).displayName}>
            <p>Approved organizer · venue receives event details, risk flags, perks, and rules.</p>
          </InfoPanel>
          <InfoPanel eyebrow="Event summary" title={event.title}>
            <div className="detail-grid">
              <Detail label="Type" value={event.type} />
              <Detail label="Date" value={`${event.date} · ${event.time}`} />
              <Detail label="Perk" value={event.perkPreview} />
              <Detail label="Ride-out" value={event.rideOut ? "Optional ride-out" : "No ride-out"} />
            </div>
          </InfoPanel>
        </div>
      </section>
    </LightView>
  );
}

function AdminEventReview({ reviewId }: { reviewId?: string }) {
  const event = getEvent(adminApproval.eventId);
  const { adminDecision, approvePublish } = useDemo();
  const markAdminReviewReady = (node: HTMLButtonElement | null) => {
    if (node) {
      node.dataset.ready = "true";
    }
  };

  return (
    <LightView>
      <section className="request-layout">
        <HeroPanel
          eyebrow="Admin review"
          title="Event review"
          body="Risky events are reviewed before publishing to protect riders, venues, and organizers."
        />
        <aside className="order-summary">
          <div className="buy-section-title">
            <span>Review {reviewId ?? adminApproval.id}</span>
            <h2>{adminDecision === "published" ? "Event live" : "Pending admin decision"}</h2>
          </div>
          <p>{adminApproval.notes}</p>
          <button
            ref={markAdminReviewReady}
            className="checkout-button"
            type="button"
            onClick={approvePublish}
          >
            Approve publish
          </button>
          {adminDecision === "published" && (
            <PassStrip title="Published" body="Audit log: Admin approved publish" />
          )}
        </aside>
        <InfoPanel eyebrow="Risk flags" title="Review signals">
          <div className="risk-list">
            {event.riskFlags.map((flag) => (
              <span key={flag}>
                <AlertTriangle aria-hidden="true" />
                {flag}
              </span>
            ))}
          </div>
        </InfoPanel>
      </section>
    </LightView>
  );
}

function ReportScreen({ eventId, owner }: { eventId?: string; owner: "organizer" | "venue" }) {
  const { events } = useDemo();
  const event = findEvent(events, eventId);
  return (
    <LightView>
      <HeroPanel
        eyebrow={owner === "venue" ? "Venue report" : "Organizer report"}
        title="Event Report"
        body={`${event.title} performance summary for RSVP, attendance, perks, and host-again decisions.`}
      />
      <MetricStrip metrics={reportMetrics} large />
      <div className="buy-main">
        <InfoPanel eyebrow="Notes" title="Post-event notes">
          <p>
            Parking flow was smooth after marshals were added. Sticker redemption ended at 8:04 PM.
            Venue marked host-again as yes with quiet-exit reminder.
          </p>
        </InfoPanel>
      </div>
    </LightView>
  );
}

function OrganizerEventStatus({ eventId }: { eventId?: string }) {
  const { events } = useDemo();
  const event = findEvent(events, eventId);
  return (
    <LightView>
      <HeroPanel
        eyebrow="Event status"
        title={event.title}
        body="Track the path from draft to venue approval, admin review, publish, check-in, and report."
      />
      <Timeline
        steps={[
          "Draft created",
          "Submitted to venue",
          "Venue approval pending",
          "Admin review pending",
          "Published",
        ]}
      />
    </LightView>
  );
}

function OrganizerDashboard() {
  return (
    <Dashboard
      title="Organizer Dashboard"
      eyebrow="Command center"
      icon={ClipboardCheck}
      action={
        <Link className="checkout-button as-link" href="/organizer/events/create">
          Create Event
        </Link>
      }
    />
  );
}

function VenueDashboard() {
  return <Dashboard title="Venue Dashboard" eyebrow="Event requests and check-ins" icon={Building2} />;
}

function AdminDashboard() {
  return <Dashboard title="Admin Dashboard" eyebrow="Platform operations" icon={ShieldCheck} />;
}

function Dashboard({
  title,
  eyebrow,
  icon: Icon,
  action,
}: {
  title: string;
  eyebrow: string;
  icon: ComponentType<{ "aria-hidden"?: boolean }>;
  action?: React.ReactNode;
}) {
  return (
    <LightView>
      <HeroPanel eyebrow={eyebrow} title={title} body="Use the logged-in sample account and navigation to inspect each operating surface." />
      {action}
      <div className="dashboard-grid">
        {[
          ["Pending approvals", "3", "Organizer, venue, and event queues"],
          ["Published events", "12", "Public ganaps visible in Explore"],
          ["Today check-ins", "68", "Event-day QR scans"],
          ["Reports ready", "4", "Post-event summaries"],
        ].map(([label, value, detail]) => (
          <div className="metric-card" key={label}>
            <Icon aria-hidden />
            <span>{label}</span>
            <strong>{value}</strong>
            <p>{detail}</p>
          </div>
        ))}
      </div>
    </LightView>
  );
}

function CreateEventScreen() {
  const { createEventDraft, currentUser } = useDemo();
  const [createdEvent, setCreatedEvent] = useState<Event | null>(null);
  const steps = ["Event Type", "Basic Details", "Venue", "Ride / Meetup", "Perks", "Rules", "Review"];

  if (!currentUser) {
    return <AuthRequired title="Log in to create events" body="Only approved organizer accounts can create event drafts in the MVP flow." />;
  }

  if (currentUser.role !== "organizer" || currentUser.verificationStatus !== "APPROVED") {
    return (
      <LightView>
        <HeroPanel
          eyebrow="Organizer required"
          title="Apply before creating events"
          body="MVP rules allow riders to browse and register, but only approved organizers can create publishable event drafts."
        />
        <Link className="checkout-button as-link" href="/organizer/apply">
          Apply as organizer
        </Link>
      </LightView>
    );
  }

  return (
    <LightView>
      {createdEvent ? (
        <>
          <HeroPanel
            eyebrow="Create Event Wizard"
            title="Draft created"
            body="Needs venue approval before it can move to admin review or public publishing."
          />
          <InfoPanel eyebrow="Event draft" title={createdEvent.title}>
            <div className="detail-grid">
              <Detail label="Status" value="Needs venue approval" />
              <Detail label="Type" value={createdEvent.type} />
              <Detail label="Date" value={`${createdEvent.date} · ${createdEvent.time}`} />
              <Detail label="Expected riders" value={String(createdEvent.expectedRiders)} />
            </div>
          </InfoPanel>
          <Link className="checkout-button as-link" href={`/organizer/events/${createdEvent.id}`}>
            View draft event
          </Link>
        </>
      ) : (
        <>
          <HeroPanel
            eyebrow="Create Event Wizard"
            title="Create a venue-approved ganap"
            body="Create an event draft with the same MVP review path: organizer draft, venue approval, then admin review when required."
          />
          <Timeline steps={steps} />
          <form
            className="prototype-form"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              const draft = createEventDraft({
                title: String(formData.get("title") ?? ""),
                type: String(formData.get("type") ?? "Tambike") as EventType,
                venueId: String(formData.get("venueId") ?? venues[0].id),
                date: String(formData.get("date") ?? ""),
                time: String(formData.get("time") ?? ""),
                area: String(formData.get("area") ?? ""),
                expectedRiders: Number(formData.get("expectedRiders") ?? 1),
                perkPreview: String(formData.get("perkPreview") ?? ""),
              });

              setCreatedEvent(draft);
            }}
          >
            <label className="checkout-field">
              <span>Event title</span>
              <input name="title" required placeholder="Tambike Night at Katipunan" />
            </label>
            <label className="checkout-field">
              <span>Event type</span>
              <select name="type" defaultValue="Bike Night">
                {Object.keys(eventVisuals).map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkout-field">
              <span>Venue</span>
              <select name="venueId" defaultValue={venues[0].id}>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkout-field">
              <span>Date label</span>
              <input name="date" required placeholder="Sat · July 18" />
            </label>
            <label className="checkout-field">
              <span>Time label</span>
              <input name="time" required placeholder="7:00 PM - 10:00 PM" />
            </label>
            <label className="checkout-field">
              <span>Area</span>
              <input name="area" required placeholder="Katipunan, Quezon City" />
            </label>
            <label className="checkout-field">
              <span>Expected riders</span>
              <input name="expectedRiders" required type="number" min="1" defaultValue="40" />
            </label>
            <label className="checkout-field">
              <span>Perk preview</span>
              <input name="perkPreview" required placeholder="Free sticker for checked-in riders" />
            </label>
            <button className="checkout-button" type="submit">
              <CalendarPlus aria-hidden="true" />
              Create draft
            </button>
          </form>
        </>
      )}
    </LightView>
  );
}

function LoginScreen() {
  const { users, loginAsUser } = useDemo();
  const router = useRouter();

  const destinationFor = (role: Role) => {
    if (role === "organizer") return "/organizer/dashboard";
    if (role === "venue") return "/venue/dashboard";
    if (role === "admin") return "/admin";
    return "/profile";
  };

  return (
    <LightView>
      <section className="auth-stage">
        <HeroPanel
          eyebrow="Account access"
          title="Choose your Tambike seat"
          body="Use a demo rider, organizer, venue, or admin account to inspect the full MVP flow without leaving this prototype."
        />
        <aside className="auth-console" aria-label="Demo account guide">
          <span>Demo cockpit</span>
          <h2>Each account opens a different operating surface.</h2>
          <div className="auth-console__grid">
            <Detail label="Rider" value="Passes, profile, RSVP" />
            <Detail label="Organizer" value="Drafts, scanner, report" />
            <Detail label="Venue" value="Requests and check-in" />
            <Detail label="Admin" value="Risk review queues" />
          </div>
          <Link className="buy-secondary as-link" href="/signup">
            Create sample rider
          </Link>
        </aside>
      </section>
      <div className="mock-account-grid">
        {users.map((user) => (
          <button
            key={user.id}
            className="mock-account-card"
            type="button"
            onClick={() => {
              const loggedInUser = loginAsUser(user.id);
              if (loggedInUser) {
                router.push(destinationFor(loggedInUser.role));
              }
            }}
          >
            <User aria-hidden="true" />
            <span>Login as {user.displayName}</span>
            <strong>
              {roleLabels[user.role]} · {user.verificationStatus}
            </strong>
            <small>{user.email}</small>
          </button>
        ))}
      </div>
    </LightView>
  );
}

function SignupScreen() {
  const { signUpRider } = useDemo();
  const router = useRouter();

  return (
    <LightView>
      <section className="auth-stage">
        <HeroPanel
          eyebrow="Rider signup"
          title="Build a rider pass profile"
          body="Create a browser-only rider profile that can RSVP, generate Tambike Passes, and update basic ride details."
        />
        <aside className="auth-console" aria-label="Signup permissions">
          <span>Default access</span>
          <h2>New riders start with browsing and pass generation only.</h2>
          <div className="auth-console__grid">
            <Detail label="Can do" value="RSVP and check passes" />
            <Detail label="Can edit" value="Area, bike, club" />
            <Detail label="Needs approval" value="Hosting events" />
            <Detail label="Stored in" value="This browser session" />
          </div>
        </aside>
      </section>
      <form
        className="prototype-form auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          signUpRider({
            displayName: String(formData.get("displayName") ?? ""),
            email: String(formData.get("email") ?? ""),
            area: String(formData.get("area") ?? ""),
            bikeModel: String(formData.get("bikeModel") ?? ""),
            clubName: String(formData.get("clubName") ?? ""),
          });
          router.push("/profile");
        }}
      >
        <label className="checkout-field">
          <span>Display name</span>
          <input name="displayName" required placeholder="Jay New Rider" />
        </label>
        <label className="checkout-field">
          <span>Email</span>
          <input name="email" required type="email" placeholder="jay.new@example.com" />
        </label>
        <label className="checkout-field">
          <span>Area / city</span>
          <input name="area" required placeholder="Quezon City" />
        </label>
        <label className="checkout-field">
          <span>Bike model</span>
          <input name="bikeModel" placeholder="Honda Click 160" />
        </label>
        <label className="checkout-field">
          <span>Club name</span>
          <input name="clubName" placeholder="QC Night Riders" />
        </label>
        <button className="checkout-button" type="submit">
          Create rider account
        </button>
      </form>
    </LightView>
  );
}

function AttendeesScreen({ eventId }: { eventId?: string }) {
  const { events } = useDemo();
  const event = findEvent(events, eventId);
  return (
    <LightView>
      <HeroPanel eyebrow="Attendees" title={event.title} body="Search and manage Interested, Going, Registered, Checked In, and No-show rider groups." />
      <MetricStrip metrics={reportMetrics.slice(0, 4)} large />
    </LightView>
  );
}

function OrganizerApplyScreen() {
  return (
    <FormPrototype
      eyebrow="Organizer verification"
      title="Apply to host events"
      fields={["Organizer type", "Display name", "Real name", "Contact number", "FB / page link", "Past event links"]}
    />
  );
}

function VenueClaimScreen() {
  return (
    <FormPrototype
      eyebrow="Venue claim"
      title="Claim a venue"
      fields={["Venue name", "Address", "Google Maps link", "Contact person", "Role", "Proof / notes"]}
    />
  );
}

function ProfileScreen() {
  const { currentUser, updateProfile } = useDemo();
  const [saved, setSaved] = useState(false);

  if (!currentUser) {
    return <AuthRequired title="Log in to view profile" body="The profile screen shows the current browser-session user and their rider/organizer permissions." />;
  }

  return (
    <LightView>
      <HeroPanel
        eyebrow={`${roleLabels[currentUser.role]} profile`}
        title={currentUser.displayName}
        body={`${currentUser.email} · ${currentUser.verificationStatus} · Joined ${currentUser.joinedAt}`}
      />
      <div className="profile-summary">
        <PassStrip title={`Area: ${currentUser.area}`} body={`Role: ${roleLabels[currentUser.role]}`} />
        {currentUser.bikeModel && <PassStrip title={`Bike: ${currentUser.bikeModel}`} body="Optional rider profile data" />}
        {currentUser.clubName && <PassStrip title={`Club: ${currentUser.clubName}`} body="Optional rider profile data" />}
      </div>
      <form
        className="prototype-form"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          updateProfile({
            displayName: String(formData.get("displayName") ?? ""),
            area: String(formData.get("area") ?? ""),
            bikeModel: String(formData.get("bikeModel") ?? ""),
            clubName: String(formData.get("clubName") ?? ""),
          });
          setSaved(true);
        }}
      >
        <label className="checkout-field">
          <span>Display name</span>
          <input name="displayName" required defaultValue={currentUser.displayName} />
        </label>
        <label className="checkout-field">
          <span>Area / city</span>
          <input name="area" required defaultValue={currentUser.area} />
        </label>
        <label className="checkout-field">
          <span>Bike model</span>
          <input name="bikeModel" defaultValue={currentUser.bikeModel ?? ""} />
        </label>
        <label className="checkout-field">
          <span>Club name</span>
          <input name="clubName" defaultValue={currentUser.clubName ?? ""} />
        </label>
        <button className="checkout-button" type="submit">
          Save profile
        </button>
        {saved && <PassStrip title="Profile saved" body="Profile details updated for this browser session." />}
      </form>
    </LightView>
  );
}

function AuthRequired({ title, body }: { title: string; body: string }) {
  return (
    <LightView>
      <HeroPanel eyebrow="Account required" title={title} body={body} />
      <div className="auth-actions">
        <Link className="checkout-button as-link" href="/login">
          Log in
        </Link>
        <Link className="buy-secondary as-link" href="/signup">
          Sign up
        </Link>
      </div>
    </LightView>
  );
}

function AdminQueue({ title }: { title: string }) {
  return (
    <LightView>
      <HeroPanel eyebrow="Admin queue" title={title} body="Manual review screens keep private notes, decisions, status, and audit trail separate from public rider pages." />
      <QueueList />
    </LightView>
  );
}

function AdminEventReviews() {
  return (
    <LightView>
      <HeroPanel eyebrow="Event reviews" title="Risky event queue" body="Events appear here when ride-out, test ride, raffle, night timing, high attendance, or new organizer signals require review." />
      <QueueList />
      <Link className="checkout-button as-link" href={`/admin/events/review/${adminApproval.id}`}>
        Open {getEvent(adminApproval.eventId).title} review
      </Link>
    </LightView>
  );
}

function QueueList() {
  const event = getEvent(adminApproval.eventId);
  const venue = getVenue(event.venueId);
  const organizer = getOrganizer(event.organizerId);

  return (
    <div className="queue-list">
      {[event.title, `${venue.name} venue request`, `${organizer.displayName} organizer`].map((item) => (
        <Link key={item} href={`/admin/events/review/${adminApproval.id}`}>
          <FileCheck2 aria-hidden="true" />
          <span>{item}</span>
          <strong>Review</strong>
        </Link>
      ))}
    </div>
  );
}

function FormPrototype({
  eyebrow,
  title,
  fields,
}: {
  eyebrow: string;
  title: string;
  fields: string[];
}) {
  return (
    <LightView>
      <HeroPanel eyebrow={eyebrow} title={title} body="UI-only form prototype with minimal data collection and no sensitive ID, license, or plate uploads." />
      <form className="prototype-form">
        {fields.map((field) => (
          <label key={field} className="checkout-field">
            <span>{field}</span>
            <input placeholder={field} />
          </label>
        ))}
        <button className="checkout-button" type="button">
          Save draft
        </button>
      </form>
    </LightView>
  );
}

function LightView({ children }: { children: React.ReactNode }) {
  return (
    <section className="buy-view">
      <div className="buy-topbar">
        <Link className="buy-back" href="/events">
          Events
        </Link>
        <Link className="brand brand-dark" href="/">
          <span className="brand-mark" aria-hidden="true">
            TB
          </span>
          <span className="brand-core">Tambike</span>
        </Link>
        <nav className="buy-nav" aria-label="Context links">
          <Link href={`/events/${primaryEventId}`}>Event</Link>
          <Link href={`/passes/${primaryPassId}`}>Pass</Link>
          <Link href={`/organizer/events/${primaryEventId}/scanner`}>Scanner</Link>
          <Link href={`/organizer/events/${primaryEventId}/report`}>Report</Link>
        </nav>
      </div>
      <div className="buy-shell">{children}</div>
    </section>
  );
}

function HeroPanel({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <section className="hero-panel">
      <span className="buy-location">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{body}</p>
    </section>
  );
}

function InfoPanel({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="buy-panel">
      <div className="buy-section-title">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PassStrip({ title, body }: { title: string; body: string }) {
  return (
    <div className="pass-strip">
      <Ticket aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
    </div>
  );
}

function MetricStrip({ metrics, large = false }: { metrics: ReportMetric[]; large?: boolean }) {
  return (
    <div className={clsx("metric-strip", large && "metric-strip-large")}>
      {metrics.map((metric) => (
        <div key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
          <p>{metric.detail}</p>
        </div>
      ))}
    </div>
  );
}

function Timeline({ steps }: { steps: string[] }) {
  return (
    <ol className="timeline">
      {steps.map((step, index) => (
        <li key={step} className={index < 2 ? "complete" : ""}>
          {index < 2 ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}
