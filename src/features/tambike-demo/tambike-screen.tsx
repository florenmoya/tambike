"use client";

import clsx from "clsx";
import {
  Building2,
  Gauge,
  LockKeyhole,
  LogIn,
  LogOut,
  Menu,
  Motorbike,
  QrCode,
  Route,
  Search,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Ticket,
  User,
  UserPlus,
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
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  getEvent,
  getOrganizer,
} from "./data";
import { useDemo } from "./demo-provider";
import { GiveawayNotificationBell } from "@/features/giveaways/giveaway-notification-bell";
import { PublicGiveawayPanel } from "@/features/giveaways/public-giveaway-panel";
import { RiderGiveawayStatusPanel } from "@/features/giveaways/rider-giveaway-status-panel";
import { ProfileSettings } from "@/features/member-profiles/profile-settings";
import {
  filterEventsByQuery,
  getEventCtaState,
  type EventQueryInput,
} from "./event-state";
import type {
  AttendanceType,
  Event,
  EventType,
  Pass,
  Role,
} from "./types";

export type TambikeView =
  | "discovery"
  | "events"
  | "event-detail"
  | "passes"
  | "pass-detail"
  | "login"
  | "signup"
  | "profile"
  | "event-register"
  | "event-test-ride";

interface TambikeScreenProps {
  view: TambikeView;
  id?: string;
  eventQuery?: EventQueryInput;
  nextHref?: string;
}

const roleLabels: Record<Role, string> = {
  guest: "Guest",
  rider: "Rider",
  organizer: "Organizer",
  admin: "Admin",
};

const featuredEventIds = [
  "tambike-cafe-classico",
  "boys-underbone-laguna-tambike",
  "ccph-upper-east-tambike",
  "ccph-cebu-official-tambike",
  "tambike-night-malabon",
  "fullprint-manila-tambike",
  "boys-garage-crossmeet-tambike",
  "swabz-classic-bike-tambike",
  "yloco-bandits-classic-tambike",
  "kape-mo-to-tagaytay-tambike",
];
const featuredCarouselIntervalMs = 5_000;
const featuredWheelBurstDurationMs = 2_800;
const featuredDragActivationPx = 16;
const featuredDragCommitPx = 90;
type FeaturedWheelDirection = "previous" | "next";

const findEvent = (events: Event[], eventId?: string) =>
  events.find((event) => event.id === eventId) ?? getEvent(eventId);

function actionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UNAUTHENTICATED")) return "Log in to continue.";
  if (message.includes("FORBIDDEN")) return "Your account does not have access to that action.";
  if (message.includes("INVALID_INPUT")) return "Check the details and try again.";
  return "Something went wrong. Try again.";
}

async function shareOrCopy({ title, text, url }: { title: string; text: string; url: string }) {
  const shareData = { title, text, url };
  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await navigator.share(shareData);
      return "shared" as const;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "shared" as const;
      }
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Feedback still matters when the browser blocks clipboard permissions.
    }
  }

  return "copied" as const;
}

const publicNavigationLinks = [
  { label: "Home", href: "/home" },
  { label: "Explore", href: "/events" },
];

type PanelLink = {
  label: string;
  href: string;
  icon: ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
};

const panelLinkByRole: Partial<Record<Role, PanelLink>> = {
  organizer: {
    label: "Organizer console",
    href: "/organizer/dashboard",
    icon: Gauge,
  },
  admin: {
    label: "Admin console",
    href: "/admin",
    icon: ShieldCheck,
  },
};

const footerLinkGroups: Array<{
  title: string;
  ariaLabel: string;
  links: Array<{ label: string; href: string; roles?: Role[] }>;
}> = [
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
    title: "Workspaces",
    ariaLabel: "Footer workspace links",
    links: [
      { label: "Organizer console", href: "/organizer/dashboard", roles: ["organizer"] },
      { label: "Admin console", href: "/admin", roles: ["admin"] },
    ],
  },
];

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

  return featuredEvents.length ? featuredEvents : events.slice(0, featuredEventIds.length);
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

export function TambikeScreen({ view, id, eventQuery, nextHref }: TambikeScreenProps) {
  if (view === "discovery") {
    return (
      <TambikeAppShell>
        <DiscoveryScreen compact={false} query={eventQuery} />
      </TambikeAppShell>
    );
  }

  if (view === "events") {
    return (
      <TambikeAppShell>
        <DiscoveryScreen compact query={eventQuery} />
      </TambikeAppShell>
    );
  }

  const content = (
    <>
      {view === "event-detail" && <EventDetail eventId={id} />}
      {view === "event-register" && <EventRegisterScreen eventId={id} />}
      {view === "event-test-ride" && <TestRideLeadScreen eventId={id} />}
      {view === "passes" && <PassesScreen />}
      {view === "pass-detail" && <PassDetail passId={id} />}
      {view === "login" && <LoginScreen nextHref={nextHref} />}
      {view === "signup" && <SignupScreen />}
      {view === "profile" && <ProfileScreen />}
    </>
  );
  return <TambikeAppShell>{content}</TambikeAppShell>;
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

export function TambikeAppShell({ children }: { children: React.ReactNode }) {
  const { role, currentUser, logout } = useDemo();
  const [navOpen, setNavOpen] = useState(false);
  const panelLink = panelLinkByRole[role];
  const PanelIcon = panelLink?.icon;

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
        <nav className="main-nav" aria-label="Public navigation">
          <SpeedometerNavGauge />
          {publicNavigationLinks.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setNavOpen(false)}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          {currentUser ? (
            <>
              <GiveawayNotificationBell recipientId={currentUser.id} />
              {panelLink && PanelIcon ? (
                <Link className="panel-link" href={panelLink.href}>
                  <PanelIcon aria-hidden={true} />
                  <span>{panelLink.label}</span>
                </Link>
              ) : null}
              <Link className="account-chip" href="/profile">
                <User aria-hidden="true" />
                <span>{currentUser.displayName}</span>
                <strong>{roleLabels[role]}</strong>
              </Link>
              <button
                className="icon-button"
                type="button"
                aria-label="Log out"
                onClick={() => {
                  void logout();
                }}
              >
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
  const { role } = useDemo();

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
              Built for tambike nights, charity rides, track days, and location-based motorcycle
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
            <FooterLinkGroup key={group.title} group={group} role={role} />
          ))}
        </div>

      </div>
      <div className="footer-legal">
        <span>© 2026 Tambike</span>
        <div>
          {role === "admin" && <Link href="/admin/events/review">Review queue</Link>}
        </div>
      </div>
    </footer>
  );
}

function FooterLinkGroup({
  group,
  role,
}: {
  group: (typeof footerLinkGroups)[number];
  role: Role;
}) {
  const links = group.links.filter((link) => !link.roles || link.roles.includes(role));

  return (
    <nav className="footer-link-group" aria-label={group.ariaLabel}>
      <h2>{group.title}</h2>
      {links.map((link) => (
        <Link key={link.href} href={link.href}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

function DiscoveryScreen({ compact, query }: { compact: boolean; query?: EventQueryInput }) {
  const { events } = useDemo();
  const activeFilter = compact ? getEventFilter(query?.type) : eventFilters[0];
  const searchTerm = query?.q?.trim() ?? "";
  const publicEvents = events.filter((event) =>
    ["PUBLISHED", "ONGOING", "COMPLETED"].includes(event.status),
  );
  const visibleEvents = filterEventsByQuery(publicEvents, query).filter(activeFilter.matches);
  const featuredEvents = getFeaturedEvents(publicEvents);
  const [activeFeaturedIndex, setActiveFeaturedIndex] = useState(0);
  const [dragDirection, setDragDirection] = useState<"previous" | "next" | null>(null);
  const [wheelDirection, setWheelDirection] = useState<FeaturedWheelDirection>("next");
  const [isWheelBursting, setIsWheelBursting] = useState(false);
  const dragStartXRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const suppressFeatureClickRef = useRef(false);
  const manualFeatureInteractionRef = useRef(0);
  const wheelBurstTimerRef = useRef<number | null>(null);
  const normalizedFeaturedIndex = featuredEvents.length
    ? activeFeaturedIndex % featuredEvents.length
    : 0;
  const categoryStyle = { "--category-count": eventFilters.length } as CSSProperties;

  const moveFeature = (direction: number) => {
    if (featuredEvents.length < 2) {
      return;
    }

    manualFeatureInteractionRef.current = window.Date.now();
    setWheelDirection(direction < 0 ? "previous" : "next");
    setIsWheelBursting(true);
    if (wheelBurstTimerRef.current !== null) {
      window.clearTimeout(wheelBurstTimerRef.current);
    }
    wheelBurstTimerRef.current = window.setTimeout(() => {
      setWheelDirection("next");
      setIsWheelBursting(false);
      wheelBurstTimerRef.current = null;
    }, featuredWheelBurstDurationMs);
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

  useEffect(() => {
    return () => {
      if (wheelBurstTimerRef.current !== null) {
        window.clearTimeout(wheelBurstTimerRef.current);
      }
    };
  }, []);

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
              isWheelBursting && "is-wheel-bursting",
            )}
            data-ready="false"
            data-wheel-direction={wheelDirection}
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
          {compact && (
            <form className="event-search" action="/events" role="search">
              {activeFilter.value !== "all" && <input type="hidden" name="type" value={activeFilter.value} />}
              <label className="sr-only" htmlFor="event-search-input">
                Search events
              </label>
              <Search aria-hidden="true" />
              <input
                id="event-search-input"
                name="q"
                type="search"
                aria-label="Search events"
                defaultValue={searchTerm}
                placeholder="Event, city, or perk"
              />
              <button type="submit">Search</button>
            </form>
          )}
        </div>
      </section>
      <section className="listings" aria-label="Published events">
        <div className="event-grid">
          {visibleEvents.map((event, index) => (
            <EventCard key={event.id} event={event} priority={index === 0} />
          ))}
        </div>
        {visibleEvents.length === 0 && (
          <div className="empty-state">
            <h2>No events matched</h2>
            <p>Try another search term or clear the filters.</p>
          </div>
        )}
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
  const visual = eventVisuals[event.type] ?? eventVisuals.Tambike;
  const titleParts = splitFeatureTitleEndPhrase(event.title);
  const featureStyle = {
    "--x": `calc(${offset} * (var(--feature-card-width) + var(--feature-gap)))`,
    "--scale": isFeatured ? "1.08" : distance === 1 ? "0.9" : distance === 2 ? "0.82" : "0.74",
    "--opacity": isFeatured ? "1" : distance === 1 ? "0.78" : distance === 2 ? "0.42" : "0",
    "--z": String(10 - distance),
    "--feature-tone": visual.poster,
  } as CSSProperties;

  return (
    <Link
      className={clsx(
        "feature-card",
        isFeatured && "is-featured",
        isVisible && "is-visible",
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
          sizes="(max-width: 760px) 68vw, (min-width: 2400px) 460px, (min-width: 1600px) 400px, 300px"
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
  const cta = getEventCtaState(event);
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
        </div>
        <span className="event-card__action">{cta.label}</span>
      </div>
    </Link>
  );
}

function EventDetail({ eventId }: { eventId?: string }) {
  const { authNotice, currentUser, events, registerForEvent, requireLogin, setAuthNotice } = useDemo();
  const event = findEvent(events, eventId);
  const organizer = getOrganizer(event.organizerId);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [shareFeedback, setShareFeedback] = useState("");
  const [actionError, setActionError] = useState("");
  const cta = getEventCtaState(event);
  const visual = eventVisuals[event.type] ?? eventVisuals.Tambike;
  const detailStyle = {
    "--event-accent": visual.accent,
    "--event-poster-tone": visual.poster,
  } as CSSProperties;
  const openRegistration = () => {
    setActionError("");
    if (!cta.canRegister) {
      return;
    }
    if (requireLogin("Log in to get your Tambike Pass")) {
      setIsModalOpen(true);
    }
  };
  const shareEvent = async () => {
    const mode = await shareOrCopy({
      title: event.title,
      text: event.shortDescription,
      url: `${window.location.origin}/events/${event.id}`,
    });
    setShareFeedback(mode === "shared" ? "Shared" : "Link copied");
  };

  return (
    <section className="event-detail-view" style={detailStyle}>
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
              {cta.canRegister ? (
                <>
                  <button className="primary-action" type="button" onClick={openRegistration}>
                    Going
                  </button>
                  <button
                    className="ghost-action"
                    type="button"
                    onClick={async () => {
                      setActionError("");
                      if (requireLogin("Log in to save this event")) {
                        try {
                          await registerForEvent(event.id, "direct", "interested");
                        } catch (error) {
                          setActionError(actionErrorMessage(error));
                        }
                      }
                    }}
                  >
                    Interested
                  </button>
                </>
              ) : (
                <span className="status-pill">{cta.label}</span>
              )}
              <button className="ghost-action" type="button" onClick={() => void shareEvent()}>
                <Share2 aria-hidden="true" />
                Share
              </button>
            </div>
            {shareFeedback && <p className="inline-feedback" aria-live="polite">{shareFeedback}</p>}
            {actionError && <p className="inline-error" aria-live="polite">{actionError}</p>}
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
                <span>Location</span>
                <strong>{event.locationName}</strong>
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
            <InfoPanel eyebrow="Rules" title="Safety and location notes">
              <div className="chip-list">
                {event.rules.map((rule) => (
                  <span key={rule}>{rule}</span>
                ))}
              </div>
            </InfoPanel>
            <PublicGiveawayPanel eventId={event.id} viewerRole={currentUser?.role ?? "guest"} />
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
              {cta.canRegister
                ? "QR check-in unlocks the event perk and keeps the organizer headcount clean."
                : cta.body}
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
            <div className="event-detail-location-card">
              <Building2 aria-hidden="true" />
              <div>
                <span>{event.locationName}</span>
                <strong>{event.area}</strong>
                <p>{event.locationAddress}</p>
              </div>
            </div>
            {event.rideOut && (
              <div className="event-detail-location-card">
                <Route aria-hidden="true" />
                <div>
                  <span>Route</span>
                  <strong>{event.rideOut.destination}</strong>
                  <p>{event.rideOut.notes}</p>
                </div>
              </div>
            )}
            {event.locationMapLink ? (
              <Link className="primary-action event-detail-map-link" href={event.locationMapLink} target="_blank" rel="noreferrer">
                Open map
              </Link>
            ) : null}
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
  const router = useRouter();
  const [attendance, setAttendance] = useState<AttendanceType>("direct");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const passId = await registerForEvent(event.id, attendance, "going");
      if (passId) {
        onClose();
        router.push(`/passes/${passId}`);
      }
    } catch (actionError) {
      setError(actionErrorMessage(actionError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="rsvp-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Register for ${event.title}`}
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
            <span>Go directly to the event location</span>
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
        {error && <p className="inline-error" aria-live="polite">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="buy-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="checkout-button" disabled={isSubmitting}>
            {isSubmitting ? "Creating pass..." : "Get Tambike Pass"}
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
          Log in with an approved account or create a rider profile to continue.
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

function EventRegisterScreen({ eventId }: { eventId?: string }) {
  const { currentUser, events } = useDemo();
  const event = findEvent(events, eventId);
  const cta = getEventCtaState(event);
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <LightView>
      <HeroPanel
        eyebrow="Register"
        title={`Register for ${event.title}`}
        body={cta.canRegister ? "Choose how you will arrive and generate a Tambike Pass." : cta.body}
      />
      <InfoPanel eyebrow="Event" title={event.title}>
        <div className="detail-grid">
          <Detail label="Date" value={`${event.date} · ${event.time}`} />
          <Detail label="Area" value={event.area} />
          <Detail label="Status" value={cta.label} />
          <Detail label="Perk" value={event.perkPreview} />
        </div>
      </InfoPanel>
      {cta.canRegister ? (
        <div className="auth-actions">
          {currentUser ? (
            <button className="checkout-button" type="button" onClick={() => setIsModalOpen(true)}>
              Get Tambike Pass
            </button>
          ) : (
            <Link className="checkout-button as-link" href="/login">
              Log in to register
            </Link>
          )}
          <Link className="buy-secondary as-link" href={`/events/${event.id}`}>
            View event
          </Link>
        </div>
      ) : (
        <PassStrip title={cta.title} body={cta.body} />
      )}
      {isModalOpen && <RsvpModal event={event} onClose={() => setIsModalOpen(false)} />}
    </LightView>
  );
}

function TestRideLeadScreen({ eventId }: { eventId?: string }) {
  const { events } = useDemo();
  const event = findEvent(events, eventId);
  const [saved, setSaved] = useState(false);

  return (
    <LightView>
      <HeroPanel
        eyebrow="Test ride"
        title="Request a test ride"
        body={`Tell ${event.title} what you ride now and when you want to try the bike.`}
      />
      <form
        className="prototype-form"
        onSubmit={(formEvent) => {
          formEvent.preventDefault();
          setSaved(true);
        }}
      >
        <label className="checkout-field">
          <span>Name</span>
          <input required name="name" placeholder="Mina Rider" />
        </label>
        <label className="checkout-field">
          <span>Phone</span>
          <input required name="phone" placeholder="+63 900 000 0000" />
        </label>
        <label className="checkout-field">
          <span>Current motorcycle</span>
          <input required name="currentMotorcycle" placeholder="Yamaha Mio Gear" />
        </label>
        <label className="checkout-field">
          <span>Interested model</span>
          <input required name="interestedModel" placeholder="Ducati Scrambler" />
        </label>
        <label className="checkout-field">
          <span>Preferred time</span>
          <input required name="preferredTime" placeholder="Saturday morning" />
        </label>
        <label className="checkbox-line">
          <input required type="checkbox" name="consent" />
          <span>I agree to be contacted about this test ride.</span>
        </label>
        <button className="checkout-button" type="submit">
          Save lead
        </button>
        {saved && <PassStrip title="Request saved" body="The Tambike team can follow up from here." />}
      </form>
    </LightView>
  );
}

function PassesScreen() {
  const { currentUser, events, passes } = useDemo();

  if (!currentUser) {
    return <AuthRequired title="Log in to view passes" body="Tambike Passes are created after a rider registers for an event." />;
  }

  if (passes.length === 0) {
    return (
      <LightView>
        <HeroPanel eyebrow="My Passes" title="No Tambike Passes yet" body="Register as going for an upcoming event to create your rider pass." />
      </LightView>
    );
  }

  return (
    <LightView>
      <HeroPanel eyebrow="My Passes" title="Upcoming Tambike Passes" body="Keep QR passes, perks, Waze links, and event-day reminders in one place." />
      <div className="pass-list">
        {passes.map((pass) => (
          <PassCard key={pass.id} event={findEvent(events, pass.eventId)} pass={pass} />
        ))}
      </div>
    </LightView>
  );
}

function PassDetail({ passId }: { passId?: string }) {
  const { attendanceType, currentUser, events, passes } = useDemo();
  const [shareFeedback, setShareFeedback] = useState("");

  if (!currentUser) {
    return <AuthRequired title="Log in to view this pass" body="Tambike passes are tied to the logged-in rider profile." />;
  }

  const pass = passId ? passes.find((candidate) => candidate.id === passId) : passes[0];
  if (!pass) {
    return (
      <LightView>
        <HeroPanel eyebrow="Tambike Pass" title="Pass not found" body="This pass is not available for the current rider account." />
      </LightView>
    );
  }

  const event = findEvent(events, pass.eventId);
  const passIdValue = pass.id;

  return (
    <LightView>
      <section className="pass-detail">
        <div className="mobile-pass">
          <PassStrip
            title="Tambike Pass"
            body={pass.status === "checked_in" ? "Attendance confirmed" : "Ready for check-in"}
          />
          <h1>Tambike Pass</h1>
          <p>
            {event.title}
            <br />
            {event.date} · {event.time}
            <br />
            Location: {event.locationName}
          </p>
          <div className="qr-frame" aria-label="QR code for Tambike Pass">
            <QRCodeSVG value={pass.qrToken} size={188} level="M" />
          </div>
          <div className="chip-list">
            <span>Attendance: {attendanceType === "ride-out" ? "Join ride-out" : "Go direct"}</span>
            <span>Pass ID: {passIdValue}</span>
          </div>
          <div className="pass-actions">
            {event.locationMapLink ? (
              <Link className="checkout-button as-link" href={event.locationMapLink}>
                Open map
              </Link>
            ) : null}
            <Link className="buy-secondary as-link" href={`/events/${event.id}`}>
              View Event
            </Link>
            <button
              className="buy-secondary"
              type="button"
              onClick={async () => {
                const mode = await shareOrCopy({
                  title: `${event.title} Tambike Pass`,
                  text: "Tambike pass link",
                  url: `${window.location.origin}/passes/${passIdValue}`,
                });
                setShareFeedback(mode === "shared" ? "Pass shared" : "Pass link copied");
              }}
            >
              Share Pass
            </button>
          </div>
          {shareFeedback && <p className="inline-feedback" aria-live="polite">{shareFeedback}</p>}
        </div>
        <aside className="order-summary">
          <div className="buy-section-title">
            <span>Benefits</span>
            <h2>Unlocked at check-in</h2>
          </div>
          {event.perks.map((perk) => (
            <PassStrip key={perk.id} title={perk.type} body={perk.description} />
          ))}
          <RiderGiveawayStatusPanel eventId={event.id} enabled={currentUser.role === "rider"} />
        </aside>
      </section>
    </LightView>
  );
}

function PassCard({ event, pass }: { event: Event; pass: Pass }) {
  return (
    <Link className="pass-card" href={`/passes/${pass.id}`}>
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

function LoginScreen({ nextHref }: { nextHref?: string }) {
  const { loginWithPassword } = useDemo();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const hydrationMarkedRef = useRef(false);

  const markLoginReady = (node: HTMLButtonElement | null) => {
    if (!node || hydrationMarkedRef.current) {
      return;
    }

    hydrationMarkedRef.current = true;
    setIsHydrated(true);
  };

  const destinationFor = (role: Role) => {
    if (role === "organizer") return "/organizer/dashboard";
    if (role === "admin") return "/admin";
    return "/profile";
  };

  return (
    <LightView>
      <section className="login-portal" aria-labelledby="login-title">
        <div className="login-media" aria-hidden="true">
          <div className="login-media__caption">
            <span>Tambike nights</span>
            <strong>Find the next meet. Keep your pass ready.</strong>
          </div>
        </div>

        <form
          className="login-card"
          method="post"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!isHydrated) {
              return;
            }

            setError("");
            setPending(true);
            const formData = new FormData(event.currentTarget);

            try {
              const user = await loginWithPassword(
                String(formData.get("email") ?? ""),
                String(formData.get("password") ?? ""),
              );
              if (user) {
                window.location.replace(nextHref ?? destinationFor(user.role));
              }
            } catch (actionError) {
              setError(actionErrorMessage(actionError));
            } finally {
              setPending(false);
            }
          }}
        >
          <Link className="login-brand" href="/">
            <span className="brand-mark" aria-hidden="true">
              TB
            </span>
            <span>Tambike</span>
          </Link>

          <div className="login-card__header">
            <span>
              <LockKeyhole aria-hidden="true" />
              Sign in
            </span>
            <h1 id="login-title">Welcome back</h1>
            <p>Continue with your Tambike account.</p>
          </div>

          <label className="login-field">
            <span>Email</span>
            <input name="email" required type="email" placeholder="name@example.com" />
          </label>
          <label className="login-field">
            <span>Password</span>
            <input name="password" required type="password" autoComplete="current-password" />
          </label>

          {error && <p className="inline-error" aria-live="polite">{error}</p>}

          <button
            ref={markLoginReady}
            className="login-submit"
            type="submit"
            disabled={pending || !isHydrated}
          >
            <LogIn aria-hidden="true" />
            {pending ? "Logging in..." : "Log in"}
          </button>

          <div className="login-card__footer">
            <span>New rider?</span>
            <Link href="/signup">Create rider account</Link>
          </div>
        </form>
      </section>
    </LightView>
  );
}

function SignupScreen() {
  const { signUpRider } = useDemo();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <LightView>
      <form
        className="signup-portal"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          const formData = new FormData(event.currentTarget);
          const password = String(formData.get("password") ?? "");
          const confirmPassword = String(formData.get("confirmPassword") ?? "");
          if (password !== confirmPassword) {
            setError("Passwords must match.");
            return;
          }

          setPending(true);
          try {
            await signUpRider({
              displayName: String(formData.get("displayName") ?? ""),
              email: String(formData.get("email") ?? ""),
              password,
              area: String(formData.get("area") ?? ""),
            });
            router.push("/profile");
          } catch (actionError) {
            setError(actionErrorMessage(actionError));
          } finally {
            setPending(false);
          }
        }}
      >
        <section className="signup-card" aria-labelledby="signup-title">
          <Link className="login-brand" href="/">
            <span className="brand-mark" aria-hidden="true">
              TB
            </span>
            <span>Tambike</span>
          </Link>

          <div className="login-card__header">
            <span>
              <UserPlus aria-hidden="true" />
              Rider signup
            </span>
            <h1 id="signup-title">Create rider account</h1>
            <p>Start with RSVPs and passes, then keep your ride details up to date.</p>
          </div>

          <div className="signup-role-note" aria-label="Account type">
            <ShieldCheck aria-hidden="true" />
            <div>
              <span>Account type</span>
              <strong>Rider</strong>
            </div>
          </div>

          <div className="signup-grid">
            <label className="login-field">
              <span>Display name</span>
              <input name="displayName" required placeholder="Jay New Rider" />
            </label>
            <label className="login-field">
              <span>Email</span>
              <input name="email" required type="email" placeholder="jay.new@example.com" />
            </label>
            <label className="login-field">
              <span>Password</span>
              <input name="password" required type="password" minLength={8} autoComplete="new-password" />
            </label>
            <label className="login-field">
              <span>Confirm password</span>
              <input name="confirmPassword" required type="password" minLength={8} autoComplete="new-password" />
            </label>
            <label className="login-field signup-wide">
              <span>Area / city</span>
              <input name="area" required placeholder="Quezon City" />
            </label>
          </div>

          {error && <p className="inline-error" aria-live="polite">{error}</p>}

          <button className="login-submit" type="submit" disabled={pending}>
            <UserPlus aria-hidden="true" />
            {pending ? "Creating rider account..." : "Create rider account"}
          </button>

          <div className="login-card__footer">
            <span>Already have an account?</span>
            <Link href="/login">Log in</Link>
          </div>
        </section>
        <section className="signup-media" aria-hidden="true">
          <span>Tambike</span>
          <strong>Meet up, ride out, check in.</strong>
        </section>
      </form>
    </LightView>
  );
}

function ProfileScreen() {
  const { currentUser } = useDemo();

  if (!currentUser) {
    return <AuthRequired title="Log in to view profile" body="Your account keeps ride details and passes together." />;
  }

  return <LightView><ProfileSettings /></LightView>;
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

function LightView({ children }: { children: React.ReactNode }) {
  return (
    <section className="buy-view">
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
