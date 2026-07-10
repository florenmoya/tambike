"use client";

import * as React from "react";
import Link from "next/link";
import type { Column, ColumnDef } from "@tanstack/react-table";
import {
  ArrowUpDownIcon,
  BarChart3Icon,
  Building2Icon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  EllipsisVerticalIcon,
  FileCheck2Icon,
  GaugeIcon,
  QrCodeIcon,
  ScanLineIcon,
  ShieldAlertIcon,
} from "lucide-react";

import { ChartAreaInteractive, type AdminChartPoint } from "@/components/chart-area-interactive";
import { DataTable } from "@/components/data-table";
import { SectionCards, type SectionCard } from "@/components/section-cards";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { QrScannerPanel } from "@/features/check-in/qr-scanner-panel";
import {
  getOrganizer,
  getVenue,
  reportMetrics,
  venueApproval,
} from "@/features/tambike-demo/data";
import { useDemo } from "@/features/tambike-demo/demo-provider";
import type {
  Event,
  EventStatus,
  ScanMethod,
  ScanPassResult,
  UserProfile,
} from "@/features/tambike-demo/types";

export type VenueSection =
  | "overview"
  | "requests"
  | "request"
  | "events"
  | "event"
  | "checkin"
  | "reports"
  | "report";

type VenueEventRow = {
  id: string;
  event: string;
  organizer: string;
  status: EventStatus;
  riders: number;
  checkIns: number;
  date: string;
};

type RequestRow = {
  id: string;
  eventId: string;
  event: string;
  organizer: string;
  status: EventStatus;
  risk: string;
  riders: number;
};

type ReportRow = {
  id: string;
  event: string;
  organizer: string;
  going: number;
  checkIns: number;
  noShow: string;
};

type SidebarMetrics = {
  pendingRequests: number;
  approvedEvents: number;
  reportsReady: number;
};

const sectionCopy: Record<VenueSection, { title: string; description: string; status?: string }> = {
  overview: {
    title: "Venue overview",
    description: "Track event requests, approved events, check-in readiness, and venue reports.",
    status: "Venue",
  },
  requests: {
    title: "Event requests",
    description: "Review organizer requests, staging notes, risk flags, and venue conditions.",
    status: "Requests",
  },
  request: {
    title: "Request review",
    description: "Approve venue-side conditions before an event moves to admin publishing.",
    status: "Request",
  },
  events: {
    title: "Approved events",
    description: "Manage events assigned to this venue for check-in and reporting.",
    status: "Events",
  },
  event: {
    title: "Venue event",
    description: "Review event-day readiness, rules, expected riders, and venue notes.",
    status: "Event",
  },
  checkin: {
    title: "Check-in",
    description: "Operate venue-side QR checks and rider arrivals for the selected event.",
    status: "Check-in",
  },
  reports: {
    title: "Venue reports",
    description: "Compare attendance, no-show, and venue outcomes across hosted events.",
    status: "Reports",
  },
  report: {
    title: "Venue report detail",
    description: "Post-event attendance, check-in, and venue operations summary.",
    status: "Report",
  },
};

export function VenueConsole({ section, eventId, requestId }: {
  section: VenueSection;
  eventId?: string;
  requestId?: string;
}) {
  const {
    approveVenueWithConditions,
    checkedInCount,
    currentUser,
    events,
    scanPass,
    venueDecision,
  } = useDemo();

  if (!currentUser) {
    return (
      <VenueAccessState
        title="Venue login required"
        body="Use an approved venue account to open the venue console."
      />
    );
  }

  if (currentUser.role !== "venue" && currentUser.role !== "admin") {
    return (
      <VenueAccessState
        title="Venue access needed"
        body="Venue tools are limited to approved venue staff and Tambike ops."
      />
    );
  }

  const venueEvents = getVenueEvents(currentUser, events);
  const requestRows = getRequestRows(venueEvents);
  const selectedEvent = getSelectedEvent(venueEvents, eventId);
  const selectedRequest = requestId ? findRequestEvent(venueEvents, requestId) : null;
  const activeEvent = selectedEvent ?? selectedRequest ?? venueEvents[0] ?? null;
  const activeEventId = activeEvent?.id ?? null;
  const eventRows = getVenueEventRows(venueEvents);
  const reportRows = getReportRows(venueEvents);
  const cards = getSectionCards(venueEvents, requestRows, checkedInCount);
  const chartData = getChartData(venueEvents);
  const metrics = getSidebarMetrics(venueEvents, requestRows);
  const copy = sectionCopy[section];

  if ((section === "event" || section === "checkin" || section === "report") && !selectedEvent) {
    return (
      <VenueAccessState
        title="Event access needed"
        body="This event is not attached to the current venue workspace."
      />
    );
  }

  if (section === "request" && !selectedRequest) {
    return (
      <VenueAccessState
        title="Request not found"
        body="This request is not attached to the current venue queue."
      />
    );
  }

  return (
    <SidebarProvider
      className="bg-background text-foreground"
      style={
        {
          "--sidebar-width": "18rem",
          "--header-height": "4.25rem",
        } as React.CSSProperties
      }
    >
      <VenueSidebar
        activeEventId={activeEventId}
        currentSection={section}
        metrics={metrics}
        user={currentUser}
        variant="inset"
      />
      <SidebarInset className="min-w-0 overflow-x-hidden md:w-0">
        <SiteHeader title={copy.title} description={copy.description} status={copy.status} />
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            {section === "overview" ? (
              <OverviewSection
                activeEventId={activeEventId}
                cards={cards}
                chartData={chartData}
                requestRows={requestRows}
              />
            ) : null}
            {section === "requests" ? <RequestsSection rows={requestRows} /> : null}
            {section === "request" && selectedRequest ? (
              <RequestDetailSection
                event={selectedRequest}
                onApprove={approveVenueWithConditions}
                venueDecision={venueDecision}
              />
            ) : null}
            {section === "events" ? <EventsSection rows={eventRows} /> : null}
            {section === "event" && selectedEvent ? <EventDetailSection event={selectedEvent} /> : null}
            {section === "checkin" && selectedEvent ? (
              <CheckInSection
                checkedInCount={checkedInCount}
                event={selectedEvent}
                scanPass={scanPass}
              />
            ) : null}
            {section === "reports" ? <ReportsSection rows={reportRows} /> : null}
            {section === "report" && selectedEvent ? <ReportDetailSection event={selectedEvent} /> : null}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function VenueSidebar({
  activeEventId,
  currentSection,
  metrics,
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  activeEventId: string | null;
  currentSection: VenueSection;
  metrics: SidebarMetrics;
  user: UserProfile;
}) {
  const primaryNav: Array<{
    title: string;
    href: string;
    section: VenueSection;
    icon: React.ReactNode;
    badge?: keyof SidebarMetrics;
  }> = [
    {
      title: "Overview",
      href: "/venue/dashboard",
      section: "overview",
      icon: <GaugeIcon />,
    },
    {
      title: "Event requests",
      href: "/venue/requests",
      section: "requests",
      icon: <ClipboardCheckIcon />,
      badge: "pendingRequests",
    },
    {
      title: "Approved events",
      href: "/venue/events",
      section: "events",
      icon: <CalendarClockIcon />,
      badge: "approvedEvents",
    },
    {
      title: "Reports",
      href: "/venue/reports",
      section: "reports",
      icon: <BarChart3Icon />,
      badge: "reportsReady",
    },
  ];
  const eventNav: Array<{
    title: string;
    href: string;
    section: VenueSection;
    icon: React.ReactNode;
  }> = activeEventId
    ? [
        {
          title: "Event workspace",
          href: `/venue/events/${activeEventId}`,
          section: "event",
          icon: <FileCheck2Icon />,
        },
        {
          title: "Check-in",
          href: `/venue/events/${activeEventId}/checkin`,
          section: "checkin",
          icon: <ScanLineIcon />,
        },
        {
          title: "Event report",
          href: `/venue/events/${activeEventId}/report`,
          section: "report",
          icon: <BarChart3Icon />,
        },
      ]
    : [];

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href="/venue/dashboard">
                <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                  <Building2Icon className="size-4" />
                </div>
                <div className="grid text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Tambike Venue</span>
                  <span className="truncate text-xs text-sidebar-foreground/70">Venue console</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Venue operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {primaryNav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={currentSection === item.section} tooltip={item.title}>
                    <Link href={item.href}>
                      {item.icon}
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.badge && metrics[item.badge] > 0 ? (
                    <SidebarMenuBadge>{metrics[item.badge]}</SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {eventNav.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupLabel>Current event</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {eventNav.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={currentSection === item.section} tooltip={item.title}>
                      <Link href={item.href}>
                        {item.icon}
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href="/venue/dashboard">
                <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
                  {initialsFor(user.displayName)}
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.displayName}</span>
                  <span className="truncate text-xs text-sidebar-foreground/70">{user.email}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function VenueAccessState({ title, body }: { title: string; body: string }) {
  return (
    <main className="min-h-svh bg-background p-6 text-foreground">
      <Card className="mx-auto mt-24 max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button asChild>
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Back to Tambike</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function OverviewSection({
  activeEventId,
  cards,
  chartData,
  requestRows,
}: {
  activeEventId: string | null;
  cards: SectionCard[];
  chartData: AdminChartPoint[];
  requestRows: RequestRow[];
}) {
  return (
    <>
      <SectionCards cards={cards} />
      <div className="px-4 lg:px-6">
        <ChartAreaInteractive data={chartData} />
      </div>
      <div className="grid gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Venue request queue</CardTitle>
            <CardDescription>Requests that need venue approval before publishing.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable columns={requestColumns} data={requestRows} filterColumn="event" filterPlaceholder="Filter requests..." pageSize={5} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Today operations</CardTitle>
            <CardDescription>Jump into the active event check-in workspace.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {activeEventId ? (
              <>
                <Button asChild>
                  <Link href={`/venue/events/${activeEventId}/checkin`}>
                    <QrCodeIcon data-icon="inline-start" />
                    Open check-in
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href={`/venue/events/${activeEventId}/report`}>Open report</Link>
                </Button>
              </>
            ) : (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                Approved venue events will appear here once assigned.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function RequestsSection({ rows }: { rows: RequestRow[] }) {
  return (
    <TablePanel
      title="Venue requests"
      description="Approve staging conditions, parking notes, and operating constraints for organizer requests."
    >
      <DataTable columns={requestColumns} data={rows} filterColumn="event" filterPlaceholder="Filter requests..." />
    </TablePanel>
  );
}

function RequestDetailSection({
  event,
  onApprove,
  venueDecision,
}: {
  event: Event;
  onApprove: () => Promise<void>;
  venueDecision: "pending" | "approved_with_conditions";
}) {
  const [error, setError] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const venue = getVenue(event.venueId);
  const organizer = getOrganizer(event.organizerId);
  const approved = venueDecision === "approved_with_conditions" || event.status !== "PENDING_VENUE_APPROVAL";

  return (
    <div className="grid gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:px-6">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Venue request</Badge>
            <EventStatusBadge status={event.status} />
          </div>
          <CardTitle className="text-2xl">{event.title}</CardTitle>
          <CardDescription>{event.shortDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Fact label="Venue" value={venue.name} />
            <Fact label="Organizer" value={organizer.displayName} />
            <Fact label="Date" value={`${event.date} · ${event.time}`} />
            <Fact label="Expected riders" value={String(event.expectedRiders)} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Risk flags</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {event.riskFlags.map((flag) => (
                <Badge key={flag} variant="outline">
                  {flag}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="h-fit lg:sticky lg:top-24">
        <CardHeader>
          <CardTitle>{approved ? "Venue conditions approved" : "Pending venue decision"}</CardTitle>
          <CardDescription>{venueApproval.notes}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Button
            disabled={approved || isSubmitting}
            onClick={async () => {
              setError("");
              setIsSubmitting(true);
              try {
                await onApprove();
              } catch (actionError) {
                setError(getActionErrorMessage(actionError));
              } finally {
                setIsSubmitting(false);
              }
            }}
          >
            {approved ? "Approved" : isSubmitting ? "Approving..." : "Approve with conditions"}
          </Button>
          <Button asChild variant="outline">
            <Link href="/venue/requests">Back to requests</Link>
          </Button>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function EventsSection({ rows }: { rows: VenueEventRow[] }) {
  return (
    <TablePanel
      title="Approved venue events"
      description="Events assigned to this venue for check-in, venue rules, and post-event reporting."
    >
      <DataTable columns={eventColumns} data={rows} filterColumn="event" filterPlaceholder="Filter events..." />
    </TablePanel>
  );
}

function EventDetailSection({ event }: { event: Event }) {
  const venue = getVenue(event.venueId);
  const organizer = getOrganizer(event.organizerId);

  return (
    <div className="grid gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:px-6">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Venue event</Badge>
            <EventStatusBadge status={event.status} />
          </div>
          <CardTitle className="text-2xl">{event.title}</CardTitle>
          <CardDescription>{event.whatHappens}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Fact label="Venue" value={venue.name} />
          <Fact label="Organizer" value={organizer.displayName} />
          <Fact label="Schedule" value={`${event.date} · ${event.time}`} />
          <Fact label="Expected riders" value={String(event.expectedRiders)} />
        </CardContent>
      </Card>
      <Card className="h-fit lg:sticky lg:top-24">
        <CardHeader>
          <CardTitle>Venue actions</CardTitle>
          <CardDescription>Open check-in or reporting for this event.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Button asChild>
            <Link href={`/venue/events/${event.id}/checkin`}>Open check-in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/venue/events/${event.id}/report`}>Open report</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function CheckInSection({
  checkedInCount,
  event,
  scanPass,
}: {
  checkedInCount: number;
  event: Event;
  scanPass: (eventId: string, qrToken: string, method: ScanMethod) => Promise<ScanPassResult>;
}) {
  return (
    <QrScannerPanel
      event={event}
      checkedInCount={checkedInCount}
      reportHref={`/venue/events/${event.id}/report`}
      scanPass={scanPass}
      scannerLabel="Venue scanner"
    />
  );
}

function ReportsSection({ rows }: { rows: ReportRow[] }) {
  return (
    <TablePanel
      title="Venue reports"
      description="Post-event attendance, no-show, and venue operations summaries."
    >
      <DataTable columns={reportColumns} data={rows} filterColumn="event" filterPlaceholder="Filter reports..." />
    </TablePanel>
  );
}

function ReportDetailSection({ event }: { event: Event }) {
  const checkIns = getCheckIns(event);
  const noShow = getNoShow(event, checkIns);
  const metrics = [
    ["Going", String(event.going), "QR passes generated"],
    ["Interested", String(event.interested), "Saved or shared"],
    ["Check-ins", String(checkIns), "Venue scans and manual marks"],
    ["No-show", noShow, "Going vs actual check-ins"],
  ];

  return (
    <div className="grid gap-4 px-4 lg:px-6">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Venue report</Badge>
            <EventStatusBadge status={event.status} />
          </div>
          <CardTitle className="text-2xl">{event.title}</CardTitle>
          <CardDescription>{getVenue(event.venueId).name} · {event.area}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map(([label, value, detail]) => (
            <div key={label} className="rounded-lg border bg-muted/30 p-3">
              <div className="text-sm text-muted-foreground">{label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Report notes</CardTitle>
          <CardDescription>Venue-side outcomes for operations review.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {reportMetrics.slice(0, 3).map((metric) => (
            <div key={metric.label} className="rounded-lg border bg-muted/30 p-3">
              <div className="text-sm text-muted-foreground">{metric.label}</div>
              <div className="mt-1 text-xl font-semibold">{metric.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{metric.detail}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function TablePanel({
  actions,
  children,
  description,
  title,
}: {
  actions?: React.ReactNode;
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader className="gap-2 md:grid-cols-[1fr_auto]">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

const requestColumns: ColumnDef<RequestRow>[] = [
  selectColumn<RequestRow>(),
  {
    accessorKey: "event",
    header: ({ column }) => <SortableHeader column={column}>Event</SortableHeader>,
    cell: ({ row }) => (
      <div className="min-w-64">
        <div className="font-medium">{row.original.event}</div>
        <div className="text-sm text-muted-foreground">{row.original.organizer}</div>
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <EventStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "riders",
    header: ({ column }) => <SortableHeader column={column}>Riders</SortableHeader>,
    cell: ({ row }) => <span className="tabular-nums">{row.original.riders}</span>,
  },
  {
    accessorKey: "risk",
    header: "Risk",
    cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.risk}</span>,
  },
  actionsColumn<RequestRow>((row) => [
    { label: "Open request", href: `/venue/requests/${row.id}` },
    { label: "Open event", href: `/venue/events/${row.eventId}` },
  ]),
];

const eventColumns: ColumnDef<VenueEventRow>[] = [
  selectColumn<VenueEventRow>(),
  {
    accessorKey: "event",
    header: ({ column }) => <SortableHeader column={column}>Event</SortableHeader>,
    cell: ({ row }) => (
      <div className="min-w-64">
        <div className="font-medium">{row.original.event}</div>
        <div className="text-sm text-muted-foreground">
          {row.original.organizer} · {row.original.date}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <EventStatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "riders",
    header: ({ column }) => <SortableHeader column={column}>Riders</SortableHeader>,
    cell: ({ row }) => <span className="tabular-nums">{row.original.riders}</span>,
  },
  {
    accessorKey: "checkIns",
    header: "Check-ins",
    cell: ({ row }) => <span className="tabular-nums">{row.original.checkIns}</span>,
  },
  actionsColumn<VenueEventRow>((row) => [
    { label: "Open workspace", href: `/venue/events/${row.id}` },
    { label: "Check-in", href: `/venue/events/${row.id}/checkin` },
    { label: "Report", href: `/venue/events/${row.id}/report` },
  ]),
];

const reportColumns: ColumnDef<ReportRow>[] = [
  {
    accessorKey: "event",
    header: ({ column }) => <SortableHeader column={column}>Event</SortableHeader>,
    cell: ({ row }) => (
      <div className="min-w-64">
        <div className="font-medium">{row.original.event}</div>
        <div className="text-sm text-muted-foreground">{row.original.organizer}</div>
      </div>
    ),
  },
  {
    accessorKey: "going",
    header: "Going",
    cell: ({ row }) => <span className="tabular-nums">{row.original.going}</span>,
  },
  {
    accessorKey: "checkIns",
    header: "Check-ins",
    cell: ({ row }) => <span className="tabular-nums">{row.original.checkIns}</span>,
  },
  {
    accessorKey: "noShow",
    header: "No-show",
  },
  actionsColumn<ReportRow>((row) => [
    { label: "Open report", href: `/venue/events/${row.id}/report` },
    { label: "Open check-in", href: `/venue/events/${row.id}/checkin` },
  ]),
];

function SortableHeader<TData>({
  column,
  children,
}: {
  column: Column<TData, unknown>;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {children}
      <ArrowUpDownIcon data-icon="inline-end" />
    </Button>
  );
}

function selectColumn<TData>(): ColumnDef<TData> {
  return {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  };
}

function actionsColumn<TData>(
  getItems: (row: TData) => Array<{ label: string; href: string }>,
): ColumnDef<TData> {
  return {
    id: "actions",
    enableHiding: false,
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm">
            <EllipsisVerticalIcon />
            <span className="sr-only">Open row actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {getItems(row.original).map((item, index) => (
            <React.Fragment key={item.label}>
              {index === 2 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem asChild>
                <Link href={item.href}>{item.label}</Link>
              </DropdownMenuItem>
            </React.Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  };
}

function EventStatusBadge({ status }: { status: EventStatus }) {
  if (status === "PUBLISHED" || status === "COMPLETED") {
    return (
      <Badge variant="outline">
        <CheckCircle2Icon data-icon="inline-start" />
        {formatStatus(status)}
      </Badge>
    );
  }

  if (status === "PENDING_ADMIN_REVIEW" || status === "PENDING_VENUE_APPROVAL") {
    return <Badge variant="secondary">{formatStatus(status)}</Badge>;
  }

  if (status === "NEEDS_CHANGES") {
    return (
      <Badge variant="destructive">
        <ShieldAlertIcon data-icon="inline-start" />
        Needs changes
      </Badge>
    );
  }

  return <Badge variant="outline">{formatStatus(status)}</Badge>;
}

function getVenueEvents(currentUser: UserProfile, events: Event[]) {
  if (currentUser.role === "admin") {
    return events;
  }

  return events.filter((event) => event.venueId === currentUser.venueId);
}

function getSelectedEvent(events: Event[], eventId?: string) {
  return events.find((event) => event.id === eventId) ?? events[0] ?? null;
}

function getRequestRows(events: Event[]): RequestRow[] {
  return events
    .filter((event) => event.status === "PENDING_VENUE_APPROVAL" || event.id === venueApproval.eventId)
    .map((event) => ({
      id: event.id === venueApproval.eventId ? venueApproval.id : `req-${event.id}`,
      eventId: event.id,
      event: event.title,
      organizer: getOrganizer(event.organizerId).displayName,
      status: event.status,
      risk: event.riskFlags[0] ?? "Standard request",
      riders: event.going + event.interested,
    }));
}

function findRequestEvent(events: Event[], requestId: string) {
  if (requestId === venueApproval.id) {
    return events.find((event) => event.id === venueApproval.eventId) ?? null;
  }

  const eventId = requestId.startsWith("req-") ? requestId.slice(4) : requestId;
  return events.find((event) => event.id === eventId) ?? null;
}

function getVenueEventRows(events: Event[]): VenueEventRow[] {
  return events.map((event) => ({
    id: event.id,
    event: event.title,
    organizer: getOrganizer(event.organizerId).displayName,
    status: event.status,
    riders: event.going + event.interested,
    checkIns: getCheckIns(event),
    date: event.date,
  }));
}

function getReportRows(events: Event[]): ReportRow[] {
  return events.map((event) => {
    const checkIns = getCheckIns(event);
    return {
      id: event.id,
      event: event.title,
      organizer: getOrganizer(event.organizerId).displayName,
      going: event.going,
      checkIns,
      noShow: getNoShow(event, checkIns),
    };
  });
}

function getSectionCards(events: Event[], requests: RequestRow[], checkedInCount: number): SectionCard[] {
  return [
    {
      label: "Pending requests",
      value: String(requests.length),
      detail: "Organizer requests needing venue decision",
      trend: "Queue",
      icon: <ClipboardCheckIcon data-icon="inline-start" />,
    },
    {
      label: "Hosted events",
      value: String(events.length),
      detail: `${events.filter((event) => event.status === "PUBLISHED").length} visible to riders`,
      trend: "Venue",
      icon: <CalendarClockIcon data-icon="inline-start" />,
    },
    {
      label: "Today check-ins",
      value: String(checkedInCount),
      detail: "QR scans and manual arrival marks",
      trend: "Live",
      icon: <ScanLineIcon data-icon="inline-start" />,
    },
    {
      label: "Reports",
      value: String(events.length),
      detail: "Attendance and host-again summaries",
      trend: "Ready",
      icon: <BarChart3Icon data-icon="inline-start" />,
    },
  ];
}

function getSidebarMetrics(events: Event[], requests: RequestRow[]): SidebarMetrics {
  return {
    pendingRequests: requests.length,
    approvedEvents: events.filter((event) => event.status === "PUBLISHED" || event.status === "ONGOING").length,
    reportsReady: events.length,
  };
}

function getChartData(events: Event[]): AdminChartPoint[] {
  return events.slice(0, 18).map((event, index) => {
    const day = String(index + 3).padStart(2, "0");
    return {
      date: `2026-07-${day}`,
      published: event.status === "PUBLISHED" ? index + 2 : Math.max(1, Math.floor(index / 3)),
      registrations: event.going + event.interested,
    };
  });
}

function getCheckIns(event: Event) {
  return Math.floor(event.going * 0.82);
}

function getNoShow(event: Event, checkIns: number) {
  return event.going > 0 ? `${Math.max(0, Math.round(((event.going - checkIns) / event.going) * 100))}%` : "0%";
}

function formatStatus(status: EventStatus) {
  return status.replaceAll("_", " ").toLowerCase();
}

function initialsFor(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

function getActionErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "The venue action could not be completed.";
}
