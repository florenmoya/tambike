"use client";

import clsx from "clsx";
import {
  Building2,
  ChevronDown,
  Coffee,
  Gauge,
  LoaderCircle,
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
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
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
import { EventBrief } from "./event-brief";
import { GiveawayNotificationBell } from "@/features/giveaways/giveaway-notification-bell";
import { PublicGiveawayPanel } from "@/features/giveaways/public-giveaway-panel";
import { RiderGiveawayStatusPanel } from "@/features/giveaways/rider-giveaway-status-panel";
import { ProfilePreview } from "@/features/member-profiles/profile-preview";
import { ProfileSettings } from "@/features/member-profiles/profile-settings";
import { EventAttendeePreview } from "@/features/member-profiles/event-attendee-preview";
import {
  eventPublicSummary,
  filterEventsByQuery,
  getEventCtaState,
  type EventQueryInput,
} from "./event-state";
import { sortEventsBySchedule } from "./event-schedule";
import { resolveEventPoster } from "./event-poster-assets";
import type {
  AttendanceType,
  Event,
  EventType,
  LoginFailureCode,
  Pass,
  Role,
} from "./types";
import type {
  EventAttendeePreviewData,
  RosterIdentity,
} from "@/features/member-profiles/types";

export type TambikeView =
  | "discovery"
  | "events"
  | "event-detail"
  | "passes"
  | "pass-detail"
  | "login"
  | "signup"
  | "profile"
  | "profile-preview"
  | "event-register"
  | "event-test-ride";

interface TambikeScreenProps {
  view: TambikeView;
  id?: string;
  eventQuery?: EventQueryInput;
  nextHref?: string;
  attendeePreview?: EventAttendeePreviewData;
}

const roleLabels: Record<Role, string> = {
  guest: "Guest",
  rider: "Member",
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
const largeCarouselQuery = "(min-width: 1920px)";
type FeaturedWheelDirection = "previous" | "next";

function subscribeToLargeCarousel(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(largeCarouselQuery);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getLargeCarouselSnapshot() {
  return window.matchMedia(largeCarouselQuery).matches;
}

function getLargeCarouselServerSnapshot() {
  return false;
}

function useLargeCarousel() {
  return useSyncExternalStore(
    subscribeToLargeCarousel,
    getLargeCarouselSnapshot,
    getLargeCarouselServerSnapshot,
  );
}

const findEvent = (events: Event[], eventId?: string) =>
  events.find((event) => event.id === eventId) ?? getEvent(eventId);

function actionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UNAUTHENTICATED")) return "Log in to continue.";
  if (message.includes("FORBIDDEN")) return "Your account does not have access to that action.";
  if (message.includes("INVALID_INPUT")) return "Check the details and try again.";
  return "Something went wrong. Try again.";
}

function loginErrorMessage(code: LoginFailureCode) {
  switch (code) {
    case "INVALID_CREDENTIALS":
      return "Email or password is incorrect.";
    case "ACCOUNT_SUSPENDED":
      return "This account is suspended. Contact Tambike support.";
  }
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
    title: "Account",
    ariaLabel: "Footer account links",
    links: [
      { label: "My passes", href: "/passes" },
      { label: "Profile", href: "/profile" },
      { label: "Create account", href: "/signup" },
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

export function TambikeScreen({
  view,
  id,
  eventQuery,
  nextHref,
  attendeePreview,
}: TambikeScreenProps) {
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
      {view === "event-detail" && (
        <EventDetail eventId={id} attendeePreview={attendeePreview} />
      )}
      {view === "event-register" && <EventRegisterScreen eventId={id} />}
      {view === "event-test-ride" && <TestRideLeadScreen eventId={id} />}
      {view === "passes" && <PassesScreen />}
      {view === "pass-detail" && <PassDetail passId={id} />}
      {view === "login" && <LoginScreen nextHref={nextHref} />}
      {view === "signup" && <SignupScreen />}
      {view === "profile" && <ProfileScreen />}
      {view === "profile-preview" && <ProfilePreviewScreen />}
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

interface TambikeAppShellProps {
  children: React.ReactNode;
  navigate?: (href: string) => void;
}

function LogoutButtonContent({ pending }: { pending: boolean }) {
  return pending ? (
    <>
      <LoaderCircle className="logout-button__spinner" aria-hidden="true" />
      <span>Logging out…</span>
    </>
  ) : (
    <>
      <LogOut aria-hidden="true" />
      <span>Log out</span>
    </>
  );
}

export function TambikeAppShell({ children, navigate }: TambikeAppShellProps) {
  const { role, currentUser, logout } = useDemo();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const panelLink = panelLinkByRole[role];
  const PanelIcon = panelLink?.icon;
  const openSearch = () => {
    setNavOpen(false);
    setSearchOpen(true);
  };
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedQuery = searchQuery.trim();
    setSearchOpen(false);
    router.push(normalizedQuery ? `/events?q=${encodeURIComponent(normalizedQuery)}` : "/events");
  };
  const handleLogout = async () => {
    if (logoutPending) return;

    setLogoutError("");
    setLogoutPending(true);

    try {
      await logout();
      if (navigate) navigate("/");
      else window.location.replace("/");
    } catch {
      setLogoutPending(false);
      setLogoutError("Could not log out. Try again.");
    }
  };

  useEffect(() => {
    if (!accountMenuOpen) return;

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (
        event.target instanceof Node &&
        !accountMenuRef.current?.contains(event.target)
      ) {
        setAccountMenuOpen(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;

      setAccountMenuOpen(false);
      accountTriggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);

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
          <div className="mobile-nav-session">
            <button aria-label="Open event search" type="button" onClick={openSearch}>
              <Search aria-hidden="true" />
              Search events
            </button>
            {currentUser ? (
              <>
                <Link href="/profile" onClick={() => setNavOpen(false)}>
                  Profile
                </Link>
                {panelLink ? (
                  <Link href={panelLink.href} onClick={() => setNavOpen(false)}>
                    {panelLink.label}
                  </Link>
                ) : null}
                <button
                  className="mobile-logout-button"
                  aria-label="Mobile log out"
                  type="button"
                  aria-busy={logoutPending}
                  disabled={logoutPending}
                  onClick={() => {
                    void handleLogout();
                  }}
                >
                  <LogoutButtonContent pending={logoutPending} />
                </button>
              </>
            ) : (
              <>
                <Link href="/login" onClick={() => setNavOpen(false)}>
                  Log in
                </Link>
                <Link href="/signup" onClick={() => setNavOpen(false)}>
                  Sign up
                </Link>
              </>
            )}
          </div>
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
              <div className="account-menu" ref={accountMenuRef}>
                <button
                  ref={accountTriggerRef}
                  className="account-chip"
                  type="button"
                  aria-label="Account menu"
                  aria-controls="desktop-account-options"
                  aria-expanded={accountMenuOpen}
                  onClick={() => setAccountMenuOpen((open) => !open)}
                >
                  <User aria-hidden="true" />
                  <span>{currentUser.displayName}</span>
                  <strong>{roleLabels[role]}</strong>
                  <ChevronDown className="account-menu__chevron" aria-hidden="true" />
                </button>
                {accountMenuOpen ? (
                  <div
                    id="desktop-account-options"
                    className="account-menu__panel"
                    role="group"
                    aria-label="Account options"
                  >
                    <Link
                      className="account-menu__item"
                      href="/profile"
                      onClick={() => setAccountMenuOpen(false)}
                    >
                      <User aria-hidden="true" />
                      <span>View profile</span>
                    </Link>
                    <button
                      className="account-menu__item account-menu__logout"
                      type="button"
                      aria-label="Log out"
                      aria-busy={logoutPending}
                      disabled={logoutPending}
                      onClick={() => {
                        void handleLogout();
                      }}
                    >
                      <LogoutButtonContent pending={logoutPending} />
                    </button>
                    {logoutError ? (
                      <p className="account-menu__error" role="alert">
                        {logoutError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
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
          <button
            className="icon-button"
            type="button"
            aria-label="Search events"
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((open) => !open)}
          >
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
        {logoutError && !accountMenuOpen ? (
          <p className="logout-error" role="alert">
            {logoutError}
          </p>
        ) : null}
        {searchOpen ? (
          <form className="header-search-popover" role="search" onSubmit={submitSearch}>
            <label>
              <span>Search events</span>
              <input
                aria-label="Search events"
                autoFocus
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Event, venue, or city"
                type="search"
                value={searchQuery}
              />
            </label>
            <button type="submit">Search</button>
          </form>
        ) : null}
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
  const publicEvents = sortEventsBySchedule(
    events.filter((event) =>
      ["PUBLISHED", "ONGOING", "COMPLETED"].includes(event.status),
    ),
  );
  const visibleEvents = filterEventsByQuery(publicEvents, query).filter(activeFilter.matches);
  const featuredEvents = getFeaturedEvents(publicEvents);
  const [activeFeaturedIndex, setActiveFeaturedIndex] = useState(0);
  const [dragDirection, setDragDirection] = useState<"previous" | "next" | null>(null);
  const [wheelDirection, setWheelDirection] = useState<FeaturedWheelDirection>("next");
  const [isWheelBursting, setIsWheelBursting] = useState(false);
  const showWideCarousel = useLargeCarousel();
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
  };

  const handleFeaturePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartXRef.current === null) return;

    const deltaX = event.clientX - dragStartXRef.current;
    if (Math.abs(deltaX) < featuredDragActivationPx) return;

    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

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
      window.setTimeout(() => {
        suppressFeatureClickRef.current = false;
      }, 0);
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
                  showWidePeek={showWideCarousel}
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
  showWidePeek,
}: {
  event: Event;
  index: number;
  activeIndex: number;
  total: number;
  showWidePeek: boolean;
}) {
  const offset = featureOffset(index, activeIndex, total);
  const distance = Math.abs(offset);
  const isFeatured = offset === 0;
  const isWidePeek = distance === 3;
  const isVisible = distance <= 2 || (showWidePeek && isWidePeek);
  const visual = eventVisuals[event.type] ?? eventVisuals.Tambike;
  const titleParts = splitFeatureTitleEndPhrase(event.title);
  const poster = resolveEventPoster(event.poster);
  const direction = Math.sign(offset);
  const xPercent = distance === 0 ? 0 : distance === 1 ? 95 : distance === 2 ? 158 : 220;
  const rotation = distance === 0 ? 0 : distance === 1 ? 14 : distance === 2 ? 80 : 86;
  const featureStyle = {
    "--x": `${direction * xPercent}%`,
    "--scale": isFeatured ? "1.08" : distance === 1 ? "0.9" : distance === 2 ? "0.82" : "0.74",
    "--opacity": isFeatured
      ? "1"
      : distance === 1
        ? "0.86"
        : distance === 2
          ? "0.62"
          : showWidePeek && isWidePeek
            ? "0.28"
            : "0",
    "--depth": isFeatured ? "0px" : distance === 1 ? "-38px" : distance === 2 ? "-104px" : "-160px",
    "--rotate-y": `${direction * rotation * -1}deg`,
    "--z": String(10 - distance),
    "--feature-tone": visual.poster,
  } as CSSProperties;

  return (
    <Link
      className={clsx(
        "feature-card",
        isFeatured && "is-featured",
        isWidePeek && "is-wide-peek",
        isVisible && "is-visible",
      )}
      href={`/events/${event.id}`}
      style={featureStyle}
      aria-hidden={!isVisible}
      tabIndex={isFeatured ? 0 : -1}
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
    >
      <FeaturePoster event={event} poster={poster} isFeatured={isFeatured} />
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

function FeaturePoster({
  event,
  poster,
  isFeatured,
}: {
  event: Event;
  poster: ReturnType<typeof resolveEventPoster>;
  isFeatured: boolean;
}) {
  const { pending } = useLinkStatus();

  return (
    <div className={clsx("feature-cover", pending && "is-opening")} aria-busy={pending || undefined}>
      <Image
        src={poster}
        alt={`${event.title} poster`}
        fill
        placeholder={typeof poster === "string" ? "empty" : "blur"}
        draggable={false}
        loading={isFeatured ? "eager" : "lazy"}
        fetchPriority={isFeatured ? "high" : "auto"}
        sizes="(max-width: 760px) 68vw, (min-width: 2400px) 460px, (min-width: 1600px) 400px, 300px"
      />
      {pending ? (
        <span className="feature-opening" role="status">
          <span className="feature-opening-ring" aria-hidden="true" />
          <span>Opening event…</span>
        </span>
      ) : null}
    </div>
  );
}

function EventCard({ event, priority = false }: { event: Event; priority?: boolean }) {
  const visual = eventVisuals[event.type] ?? eventVisuals.Tambike;
  const cta = getEventCtaState(event);
  const poster = resolveEventPoster(event.poster);
  const cardStyle = {
    "--accent": visual.accent,
    "--poster": visual.poster,
  } as CSSProperties;

  return (
    <Link className="event-card" href={`/events/${event.id}`} style={cardStyle}>
      <div className="poster">
        <Image
          src={poster}
          alt={`${event.title} poster`}
          fill
          placeholder={typeof poster === "string" ? "empty" : "blur"}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          sizes="(max-width: 560px) calc(100vw - 40px), 260px"
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

function EventDetail({
  eventId,
  attendeePreview,
}: {
  eventId?: string;
  attendeePreview?: EventAttendeePreviewData;
}) {
  const { authNotice, currentUser, events, registerForEvent, requireLogin, setAuthNotice } = useDemo();
  const event = findEvent(events, eventId);
  const organizer = getOrganizer(event.organizerId);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [shareFeedback, setShareFeedback] = useState("");
  const [actionError, setActionError] = useState("");
  const cta = getEventCtaState(event);
  const publicSummary = eventPublicSummary(event);
  const visual = eventVisuals[event.type] ?? eventVisuals.Tambike;
  const poster = resolveEventPoster(event.poster);
  const detailStyle = {
    "--event-accent": visual.accent,
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
      text: publicSummary,
      url: `${window.location.origin}/events/${event.id}`,
    });
    setShareFeedback(mode === "shared" ? "Shared" : "Link copied");
  };

  return (
    <section className="event-detail-view" style={detailStyle}>
      <div className="event-detail-shell">
        <section className="event-detail-stage">
          <div className="event-detail-copy">
            <span className="event-detail-type">
              {event.type} · {event.date}
            </span>
            <h1>{event.title}</h1>
            <p>{publicSummary}</p>

            <div className="event-detail-essentials" aria-label="Event essentials">
              <span>{event.time}</span>
              <span>{event.locationName}</span>
              <span>{event.area}</span>
            </div>
          </div>

          <section
            className="event-detail-decision"
            aria-labelledby="event-rsvp-title"
          >
            <div className="event-detail-decision-heading">
              <span>RSVP</span>
              <h2 id="event-rsvp-title">Are you joining?</h2>
            </div>

            <div className="event-detail-actions">
              {cta.canRegister ? (
                <>
                  <button className="primary-action" type="button" onClick={openRegistration}>
                    I’m going
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

            {shareFeedback ? (
              <p className="inline-feedback" aria-live="polite">{shareFeedback}</p>
            ) : null}
            {actionError ? (
              <p className="inline-error" aria-live="polite">{actionError}</p>
            ) : null}
            <EventAttendeePreview
              eventId={event.id}
              fallbackGoing={event.going}
              interested={event.interested}
              expected={event.expectedRiders}
              preview={attendeePreview}
            />
          </section>

          <div className="event-detail-poster-wrap">
            <figure className="event-detail-poster">
              <Image
                src={poster}
                alt={`${event.title} poster`}
                fill
                placeholder={typeof poster === "string" ? "empty" : "blur"}
                sizes="(max-width: 640px) 72px, (max-width: 1024px) 140px, 200px"
                preload
              />
            </figure>
            <a
              className="event-detail-poster-link"
              href={event.poster}
              target="_blank"
              rel="noreferrer"
            >
              View full poster{" "}
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </section>

        <div className="event-detail-sections">
          <EventBrief
            eventType={event.type}
            description={event.whatHappens}
            rules={event.rules}
          />

          <aside className="event-detail-perk" aria-label="Event perk">
            <Coffee aria-hidden="true" />
            <span>Perk</span>
            <strong>{event.perkPreview}</strong>
          </aside>

          <InfoPanel eyebrow="Venue" title={event.locationName}>
            <p>{event.locationAddress}</p>
            <strong>{event.area}</strong>
            {event.locationMapLink ? (
              <Link
                className="primary-action event-detail-map-link"
                href={event.locationMapLink}
                target="_blank"
                rel="noreferrer"
              >
                Open map
              </Link>
            ) : null}
          </InfoPanel>

          {event.rideOut ? (
            <InfoPanel eyebrow="Ride / meetup" title={event.rideOut.meetup}>
              <div className="detail-grid">
                <Detail label="Call time" value={event.rideOut.callTime} />
                <Detail label="Departure" value={event.rideOut.departure} />
                <Detail label="Destination" value={event.rideOut.destination} />
                <Detail label="Note" value={event.rideOut.notes} />
              </div>
            </InfoPanel>
          ) : null}

          <InfoPanel eyebrow="Organizer" title={organizer.displayName}>
            <p>
              Verified organizer · {organizer.pastEvents} previous events · {organizer.fbLink}
            </p>
          </InfoPanel>

          <PublicGiveawayPanel
            eventId={event.id}
            viewerRole={currentUser?.role ?? "guest"}
          />
        </div>
      </div>
      {isModalOpen && <RsvpModal event={event} onClose={() => setIsModalOpen(false)} />}
      {authNotice && <AuthGateModal notice={authNotice} onClose={() => setAuthNotice("")} />}
    </section>
  );
}

function RsvpModal({ event, onClose }: { event: Event; onClose: () => void }) {
  const { getEventRegistrationRosterIdentity, registerForEvent } = useDemo();
  const router = useRouter();
  const [attendance, setAttendance] = useState<AttendanceType>("direct");
  const [rosterIdentity, setRosterIdentity] =
    useState<RosterIdentity | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Event changes must re-enter loading state.
    setRosterIdentity(null);
    setError("");
    void getEventRegistrationRosterIdentity(event.id)
      .then((identity) => {
        if (active) setRosterIdentity(identity);
      })
      .catch((loadError) => {
        if (active) setError(actionErrorMessage(loadError));
      });
    return () => {
      active = false;
    };
  }, [event.id, getEventRegistrationRosterIdentity]);

  const submit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (rosterIdentity === null) {
      setError("Your attendance privacy choice is still loading.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      const passId = await registerForEvent(event.id, attendance, "going", rosterIdentity);
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
        <fieldset className="attendance-options">
          <legend>Who’s going</legend>
          <label>
            <input
              type="checkbox"
              checked={rosterIdentity === "VISIBLE"}
              disabled={rosterIdentity === null || isSubmitting}
              onChange={(event) =>
                setRosterIdentity(event.currentTarget.checked ? "VISIBLE" : "ANONYMOUS")
              }
            />
            <span>Show my name and bike in Who’s going.</span>
          </label>
        </fieldset>
        {error && <p className="inline-error" aria-live="polite">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="buy-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="checkout-button"
            disabled={rosterIdentity === null || isSubmitting}
          >
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
          Log in with an approved account or create a profile to continue.
        </p>
        <div className="modal-actions">
          <Link className="checkout-button as-link" href="/login">
            Log in
          </Link>
          <Link className="buy-secondary as-link" href="/signup">
            Sign up
          </Link>
          <button type="button" className="buy-secondary" onClick={onClose}>
            Cancel
          </button>
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
    return <AuthRequired title="Log in to view passes" body="Tambike Passes are created after you register for an event." />;
  }

  if (passes.length === 0) {
    return (
      <LightView>
        <HeroPanel eyebrow="My Passes" title="No Tambike Passes yet" body="Register as going for an upcoming event to create your pass." />
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
    return <AuthRequired title="Log in to view this pass" body="Tambike Passes are tied to your signed-in account." />;
  }

  const pass = passId ? passes.find((candidate) => candidate.id === passId) : passes[0];
  if (!pass) {
    return (
      <LightView>
        <HeroPanel eyebrow="Tambike Pass" title="Pass not found" body="This pass is not available for the current account." />
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

const replaceLocation = (href: string) => window.location.replace(href);

export function LoginScreen({
  nextHref,
  navigate = replaceLocation,
}: {
  nextHref?: string;
  navigate?: (href: string) => void;
}) {
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
          aria-busy={pending}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!isHydrated) {
              return;
            }

            setError("");
            setPending(true);
            const formData = new FormData(event.currentTarget);

            try {
              const result = await loginWithPassword(
                String(formData.get("email") ?? ""),
                String(formData.get("password") ?? ""),
              );
              if (!result.ok) {
                setError(loginErrorMessage(result.code));
                setPending(false);
                return;
              }

              navigate(nextHref ?? destinationFor(result.user.role));
            } catch (actionError) {
              setError(actionErrorMessage(actionError));
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
            {pending ? (
              <LoaderCircle className="login-submit__spinner" aria-hidden="true" />
            ) : (
              <LogIn aria-hidden="true" />
            )}
            {pending ? "Signing you in…" : "Log in"}
          </button>
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {pending ? "Signing you in and opening your account." : ""}
          </span>

          <div className="login-card__footer">
            <span>New here?</span>
            <Link href="/signup">Create account</Link>
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
              Join Tambike
            </span>
            <h1 id="signup-title">Create account</h1>
            <p>Start with RSVPs and passes, then keep your ride details up to date.</p>
          </div>

          <div className="signup-role-note" aria-label="Account type">
            <ShieldCheck aria-hidden="true" />
            <div>
              <span>Account type</span>
              <strong>Member</strong>
            </div>
          </div>

          <div className="signup-grid">
            <label className="login-field">
              <span>Display name</span>
              <input name="displayName" required placeholder="Your name" />
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
            {pending ? "Creating account..." : "Create account"}
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

function ProfilePreviewScreen() {
  const { currentUser } = useDemo();

  if (!currentUser) {
    return (
      <AuthRequired
        title="Log in to preview profile"
        body="Your preview is only available from your account."
      />
    );
  }

  return (
    <LightView>
      <ProfilePreview />
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
