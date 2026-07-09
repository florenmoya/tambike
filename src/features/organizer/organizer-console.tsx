"use client";

import * as React from "react";
import Link from "next/link";
import type { Column, ColumnDef } from "@tanstack/react-table";
import {
  ArrowUpDownIcon,
  BarChart3Icon,
  CalendarClockIcon,
  CalendarPlusIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  EllipsisVerticalIcon,
  FileCheck2Icon,
  GaugeIcon,
  QrCodeIcon,
  ScanLineIcon,
  ShieldAlertIcon,
  TicketCheckIcon,
  UsersIcon,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { defaultPass, demoEvents, getVenue, mockUsers, venues } from "@/features/tambike-demo/data";
import { useDemo } from "@/features/tambike-demo/demo-provider";
import type {
  CreateEventInput,
  Event,
  EventStatus,
  EventType,
  ScannerOutcome,
  UserProfile,
} from "@/features/tambike-demo/types";

export type OrganizerSection =
  | "overview"
  | "events"
  | "create"
  | "event"
  | "attendees"
  | "scanner"
  | "reports"
  | "report";

type OrganizerEventRow = {
  id: string;
  title: string;
  type: EventType;
  status: EventStatus;
  venue: string;
  riders: number;
  checkIns: number;
  date: string;
};

type AttendeeRow = {
  id: string;
  name: string;
  pass: string;
  status: "Going" | "Interested" | "Checked in" | "No-show";
  checkIn: string;
  club: string;
};

type ReportRow = {
  id: string;
  event: string;
  status: EventStatus;
  going: number;
  interested: number;
  checkIns: number;
  conversion: string;
};

type SidebarMetrics = {
  reviewEvents: number;
  liveEvents: number;
  reportsReady: number;
};

const sectionCopy: Record<OrganizerSection, { title: string; description: string; status?: string }> = {
  overview: {
    title: "Organizer overview",
    description: "Track event drafts, venue approvals, registrations, scanner activity, and reports.",
    status: "Host",
  },
  events: {
    title: "My events",
    description: "Manage organizer-owned Tambike events from draft to post-event report.",
    status: "Events",
  },
  create: {
    title: "Create event",
    description: "Prepare a draft for venue and admin review before riders see it.",
    status: "Draft",
  },
  event: {
    title: "Event workspace",
    description: "Review event readiness, venue assignment, risk flags, and next actions.",
    status: "Event",
  },
  attendees: {
    title: "Attendees",
    description: "Scan rider intent, QR pass readiness, and check-in groups for the selected event.",
    status: "Riders",
  },
  scanner: {
    title: "Scanner",
    description: "Run event-day QR checks and manual pass outcomes for assigned riders.",
    status: "Check-in",
  },
  reports: {
    title: "Organizer reports",
    description: "Compare RSVP, check-in, no-show, and perk activity across your events.",
    status: "Reports",
  },
  report: {
    title: "Event report",
    description: "Post-event attendance, conversion, no-show, and risk summary.",
    status: "Report",
  },
};

const eventTypes: EventType[] = [
  "Tambike",
  "Bike Night",
  "Coffee Ride",
  "Club EB",
  "Brand Event",
  "Test Ride",
  "Charity Ride",
  "Track Day",
  "Endurance Ride",
  "Moto Expo",
  "Race",
];

export function OrganizerConsole({
  section,
  eventId,
}: {
  section: OrganizerSection;
  eventId?: string;
}) {
  const {
    currentUser,
    events,
    createEventDraft,
    scannerOutcome,
    setScannerOutcome,
    checkedInCount,
  } = useDemo();

  if (!currentUser) {
    return (
      <OrganizerAccessState
        title="Organizer login required"
        body="Use an approved organizer account to open the host console."
      />
    );
  }

  if (currentUser.role !== "organizer" && currentUser.role !== "admin") {
    return (
      <OrganizerAccessState
        title="Host access needed"
        body="Organizer tools are limited to approved event hosts and Tambike ops."
      />
    );
  }

  const organizerEvents = getOrganizerEvents(currentUser, events);
  const selectedEvent = getSelectedEvent(organizerEvents, eventId);

  if ((section === "event" || section === "attendees" || section === "scanner" || section === "report") && !selectedEvent) {
    return (
      <OrganizerAccessState
        title="Event access needed"
        body="This event is not attached to the current organizer workspace."
      />
    );
  }

  const eventRows = getOrganizerEventRows(organizerEvents);
  const reportRows = getReportRows(organizerEvents);
  const metrics = getSidebarMetrics(organizerEvents);
  const cards = getSectionCards(organizerEvents, checkedInCount);
  const chartData = getChartData(organizerEvents);
  const activeEventId = selectedEvent?.id ?? organizerEvents[0]?.id ?? defaultPass.eventId;
  const copy = sectionCopy[section];

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
      <OrganizerSidebar
        currentSection={section}
        metrics={metrics}
        activeEventId={activeEventId}
        user={currentUser}
        variant="inset"
      />
      <SidebarInset className="min-w-0 overflow-x-hidden md:w-0">
        <SiteHeader title={copy.title} description={copy.description} status={copy.status} />
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            {section === "overview" ? (
              <OverviewSection
                cards={cards}
                chartData={chartData}
                eventRows={eventRows}
                activeEventId={activeEventId}
              />
            ) : null}
            {section === "events" ? <EventsSection rows={eventRows} /> : null}
            {section === "create" ? (
              <CreateEventSection
                canCreate={currentUser.role === "organizer" && currentUser.verificationStatus === "APPROVED"}
                createEventDraft={createEventDraft}
              />
            ) : null}
            {section === "event" && selectedEvent ? <EventDetailSection event={selectedEvent} /> : null}
            {section === "attendees" && selectedEvent ? <AttendeesSection event={selectedEvent} /> : null}
            {section === "scanner" && selectedEvent ? (
              <ScannerSection
                event={selectedEvent}
                scannerOutcome={scannerOutcome}
                setScannerOutcome={setScannerOutcome}
                checkedInCount={checkedInCount}
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

function OrganizerSidebar({
  currentSection,
  metrics,
  activeEventId,
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  currentSection: OrganizerSection;
  metrics: SidebarMetrics;
  activeEventId: string;
  user: UserProfile;
}) {
  const primaryNav: Array<{
    title: string;
    href: string;
    section: OrganizerSection;
    icon: React.ReactNode;
    badge?: keyof SidebarMetrics;
  }> = [
    {
      title: "Overview",
      href: "/organizer/dashboard",
      section: "overview",
      icon: <GaugeIcon />,
    },
    {
      title: "My events",
      href: "/organizer/events",
      section: "events",
      icon: <CalendarClockIcon />,
      badge: "reviewEvents",
    },
    {
      title: "Create event",
      href: "/organizer/events/create",
      section: "create",
      icon: <CalendarPlusIcon />,
    },
    {
      title: "Reports",
      href: "/organizer/reports",
      section: "reports",
      icon: <BarChart3Icon />,
      badge: "reportsReady",
    },
  ];

  const eventNav: Array<{
    title: string;
    href: string;
    section: OrganizerSection;
    icon: React.ReactNode;
  }> = [
    {
      title: "Event workspace",
      href: `/organizer/events/${activeEventId}`,
      section: "event",
      icon: <ClipboardCheckIcon />,
    },
    {
      title: "Attendees",
      href: `/organizer/events/${activeEventId}/attendees`,
      section: "attendees",
      icon: <UsersIcon />,
    },
    {
      title: "Scanner",
      href: `/organizer/events/${activeEventId}/scanner`,
      section: "scanner",
      icon: <ScanLineIcon />,
    },
    {
      title: "Event report",
      href: `/organizer/events/${activeEventId}/report`,
      section: "report",
      icon: <FileCheck2Icon />,
    },
  ];

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href="/organizer/dashboard">
                <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                  <TicketCheckIcon className="size-4" />
                </div>
                <div className="grid text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Tambike Host</span>
                  <span className="truncate text-xs text-sidebar-foreground/70">Organizer console</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Host operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {primaryNav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={currentSection === item.section}
                    tooltip={item.title}
                  >
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

        <SidebarGroup>
          <SidebarGroupLabel>Current event</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {eventNav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={currentSection === item.section}
                    tooltip={item.title}
                  >
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
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href="/profile">
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

function OrganizerAccessState({ title, body }: { title: string; body: string }) {
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
  cards,
  chartData,
  eventRows,
  activeEventId,
}: {
  cards: SectionCard[];
  chartData: AdminChartPoint[];
  eventRows: OrganizerEventRow[];
  activeEventId: string;
}) {
  return (
    <>
      <SectionCards cards={cards} />
      <div className="px-4 lg:px-6">
        <ChartAreaInteractive data={chartData} />
      </div>
      <div className="grid gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Event queue</CardTitle>
            <CardDescription>Organizer events that still need venue, admin, or rider-day attention.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={eventColumns}
              data={eventRows.slice(0, 8)}
              filterColumn="title"
              filterPlaceholder="Filter events..."
              pageSize={5}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Next event actions</CardTitle>
            <CardDescription>Fast paths for the active event workspace.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button asChild>
              <Link href={`/organizer/events/${activeEventId}/attendees`}>
                <UsersIcon data-icon="inline-start" />
                Open attendees
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/organizer/events/${activeEventId}/scanner`}>
                <QrCodeIcon data-icon="inline-start" />
                Open scanner
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/organizer/events/${activeEventId}/report`}>
                <FileCheck2Icon data-icon="inline-start" />
                Open report
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function EventsSection({ rows }: { rows: OrganizerEventRow[] }) {
  return (
    <TablePanel
      title="Organizer event pipeline"
      description="Sort, filter, and open event workspaces without leaving the host console."
      actions={
        <Button asChild size="sm">
          <Link href="/organizer/events/create">
            <CalendarPlusIcon data-icon="inline-start" />
            Create event
          </Link>
        </Button>
      }
    >
      <DataTable columns={eventColumns} data={rows} filterColumn="title" filterPlaceholder="Filter events..." />
    </TablePanel>
  );
}

function CreateEventSection({
  canCreate,
  createEventDraft,
}: {
  canCreate: boolean;
  createEventDraft: (input: CreateEventInput) => Promise<Event | null>;
}) {
  const [createdEvent, setCreatedEvent] = React.useState<Event | null>(null);
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(false);

  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Event draft</CardTitle>
          <CardDescription>
            Drafts enter venue and admin review before they appear on public event discovery.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!canCreate) {
                setError("Approved organizer access is required to create event drafts.");
                return;
              }

              setError("");
              setPending(true);
              const formData = new FormData(event.currentTarget);
              const draft = await createEventDraft({
                title: String(formData.get("title") ?? ""),
                type: String(formData.get("type") ?? "Tambike") as EventType,
                venueId: String(formData.get("venueId") ?? ""),
                date: String(formData.get("date") ?? ""),
                time: String(formData.get("time") ?? ""),
                area: String(formData.get("area") ?? ""),
                expectedRiders: Number(formData.get("expectedRiders") ?? 1),
                perkPreview: String(formData.get("perkPreview") ?? ""),
              });
              setPending(false);

              if (!draft) {
                setError("Draft was not created. Check organizer approval and required fields.");
                return;
              }

              setCreatedEvent(draft);
            }}
          >
            <Field label="Event title">
              <Input name="title" required placeholder="Katipunan Bike Night" />
            </Field>
            <Field label="Event type">
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                name="type"
                required
                defaultValue="Tambike"
              >
                {eventTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Venue">
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                name="venueId"
                required
                defaultValue={venues[0]?.id}
              >
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name} - {venue.area}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Area">
              <Input name="area" required placeholder="Katipunan, Quezon City" />
            </Field>
            <Field label="Date label">
              <Input name="date" required placeholder="Sat - July 18" />
            </Field>
            <Field label="Time label">
              <Input name="time" required placeholder="7:00 PM - 10:00 PM" />
            </Field>
            <Field label="Expected riders">
              <Input name="expectedRiders" required type="number" min="1" defaultValue="40" />
            </Field>
            <Field label="Perk preview">
              <Input name="perkPreview" required placeholder="Free sticker for checked-in riders" />
            </Field>
            <div className="md:col-span-2 flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={pending || !canCreate}>
                <CalendarPlusIcon data-icon="inline-start" />
                {pending ? "Creating..." : "Create draft"}
              </Button>
              <Button asChild variant="outline">
                <Link href="/organizer/events">Back to events</Link>
              </Button>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              {createdEvent ? (
                <Button asChild variant="secondary">
                  <Link href={`/organizer/events/${createdEvent.id}`}>Open {createdEvent.title}</Link>
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function EventDetailSection({ event }: { event: Event }) {
  const venue = getVenue(event.venueId);
  return (
    <div className="grid gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>{event.title}</CardTitle>
          <CardDescription>
            {event.type} at {venue.name} in {event.area}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-3">
            <MetricBlock label="Status" value={formatStatus(event.status)} />
            <MetricBlock label="Going" value={String(event.going)} />
            <MetricBlock label="Interested" value={String(event.interested)} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            {event.whatHappens}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <InfoList title="Risk flags" items={event.riskFlags} />
            <InfoList title="Rules" items={event.rules} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Event actions</CardTitle>
          <CardDescription>Move from setup to event-day operations.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Button asChild>
            <Link href={`/organizer/events/${event.id}/attendees`}>Open attendees</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/organizer/events/${event.id}/scanner`}>Open scanner</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/organizer/events/${event.id}/report`}>Open report</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/events/${event.id}`}>View public page</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function AttendeesSection({ event }: { event: Event }) {
  const rows = getAttendeeRows(event);
  return (
    <TablePanel
      title={`${event.title} attendees`}
      description="Mock rider groups for going, interested, checked-in, and no-show review."
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href={`/organizer/events/${event.id}/scanner`}>
            <ScanLineIcon data-icon="inline-start" />
            Open scanner
          </Link>
        </Button>
      }
    >
      <DataTable columns={attendeeColumns} data={rows} filterColumn="name" filterPlaceholder="Filter riders..." />
    </TablePanel>
  );
}

function ScannerSection({
  event,
  scannerOutcome,
  setScannerOutcome,
  checkedInCount,
}: {
  event: Event;
  scannerOutcome: ScannerOutcome;
  setScannerOutcome: (outcome: ScannerOutcome) => void;
  checkedInCount: number;
}) {
  const outcomeCopy = {
    idle: "Ready to scan",
    valid: "Valid Tambike Pass",
    already: "Already checked in",
    "wrong-event": "Pass belongs to another event",
    cancelled: "Pass was cancelled",
    inactive: "Pass is inactive",
  } satisfies Record<ScannerOutcome, string>;

  return (
    <div className="grid gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>{event.title}</CardTitle>
          <CardDescription>Event-day QR scanner simulation for the organizer console.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex min-h-72 items-center justify-center rounded-lg border bg-muted/30">
            <div className="grid place-items-center gap-4 text-center">
              <div className="grid size-40 place-items-center rounded-xl border bg-background">
                <QrCodeIcon className="size-24 text-muted-foreground" />
              </div>
              <div>
                <div className="text-lg font-semibold">{outcomeCopy[scannerOutcome]}</div>
                <div className="text-sm text-muted-foreground">Checked in: {checkedInCount}</div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setScannerOutcome("valid")}>
              Valid pass
            </Button>
            <Button type="button" variant="outline" onClick={() => setScannerOutcome("already")}>
              Already used
            </Button>
            <Button type="button" variant="outline" onClick={() => setScannerOutcome("wrong-event")}>
              Wrong event
            </Button>
            <Button type="button" variant="outline" onClick={() => setScannerOutcome("inactive")}>
              Inactive
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Scanner rules</CardTitle>
          <CardDescription>Staff checks before admitting a rider.</CardDescription>
        </CardHeader>
        <CardContent>
          <InfoList
            title="Checks"
            items={[
              "Match QR pass to this event.",
              "Reject cancelled or inactive passes.",
              "Mark duplicate scans as already checked in.",
              "Use manual lookup when camera scan fails.",
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ReportsSection({ rows }: { rows: ReportRow[] }) {
  return (
    <TablePanel
      title="Organizer reports"
      description="Event-level report rows for RSVP conversion, check-in completion, and post-event review."
    >
      <DataTable columns={reportColumns} data={rows} filterColumn="event" filterPlaceholder="Filter reports..." />
    </TablePanel>
  );
}

function ReportDetailSection({ event }: { event: Event }) {
  const checkIns = getCheckIns(event);
  const conversion = getConversion(event);
  return (
    <div className="grid gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>{event.title} report</CardTitle>
          <CardDescription>Attendance and event-day summary for organizer review.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-4">
            <MetricBlock label="Going" value={String(event.going)} />
            <MetricBlock label="Interested" value={String(event.interested)} />
            <MetricBlock label="Check-ins" value={String(checkIns)} />
            <MetricBlock label="Conversion" value={conversion} />
          </div>
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            {event.perkPreview} is the current perk preview. Keep report exports aligned with actual redeemed perks once backend exports are connected.
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Post-event checklist</CardTitle>
          <CardDescription>Close out the event after check-in.</CardDescription>
        </CardHeader>
        <CardContent>
          <InfoList
            title="Close-out"
            items={[
              "Confirm venue issue notes.",
              "Review no-show rate.",
              "Export attendee list.",
              "Archive event assets.",
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function TablePanel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function InfoList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-sm font-medium">{title}</div>
      <ul className="mt-3 grid gap-2 text-sm text-muted-foreground">
        {items.map((item) => (
          <li className="flex gap-2" key={item}>
            <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const eventColumns: ColumnDef<OrganizerEventRow>[] = [
  selectColumn<OrganizerEventRow>(),
  {
    accessorKey: "title",
    header: ({ column }) => <SortableHeader column={column}>Event</SortableHeader>,
    cell: ({ row }) => (
      <div className="min-w-64">
        <div className="font-medium">{row.original.title}</div>
        <div className="text-sm text-muted-foreground">
          {row.original.venue} · {row.original.date}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => <Badge variant="outline">{row.original.type}</Badge>,
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
  actionsColumn<OrganizerEventRow>((row) => [
    { label: "Open workspace", href: `/organizer/events/${row.id}` },
    { label: "Attendees", href: `/organizer/events/${row.id}/attendees` },
    { label: "Scanner", href: `/organizer/events/${row.id}/scanner` },
    { label: "Report", href: `/organizer/events/${row.id}/report` },
  ]),
];

const attendeeColumns: ColumnDef<AttendeeRow>[] = [
  selectColumn<AttendeeRow>(),
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader column={column}>Rider</SortableHeader>,
    cell: ({ row }) => (
      <div className="min-w-48">
        <div className="font-medium">{row.original.name}</div>
        <div className="text-sm text-muted-foreground">{row.original.club}</div>
      </div>
    ),
  },
  {
    accessorKey: "pass",
    header: "Pass",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Badge variant={row.original.status === "Checked in" ? "outline" : "secondary"}>{row.original.status}</Badge>,
  },
  {
    accessorKey: "checkIn",
    header: "Check-in",
  },
];

const reportColumns: ColumnDef<ReportRow>[] = [
  {
    accessorKey: "event",
    header: ({ column }) => <SortableHeader column={column}>Event</SortableHeader>,
    cell: ({ row }) => (
      <div className="min-w-64">
        <div className="font-medium">{row.original.event}</div>
        <div className="text-sm text-muted-foreground">{formatStatus(row.original.status)}</div>
      </div>
    ),
  },
  {
    accessorKey: "going",
    header: "Going",
    cell: ({ row }) => <span className="tabular-nums">{row.original.going}</span>,
  },
  {
    accessorKey: "interested",
    header: "Interested",
    cell: ({ row }) => <span className="tabular-nums">{row.original.interested}</span>,
  },
  {
    accessorKey: "checkIns",
    header: "Check-ins",
    cell: ({ row }) => <span className="tabular-nums">{row.original.checkIns}</span>,
  },
  {
    accessorKey: "conversion",
    header: "Conversion",
  },
  actionsColumn<ReportRow>((row) => [
    { label: "Open report", href: `/organizer/events/${row.id}/report` },
    { label: "Open attendees", href: `/organizer/events/${row.id}/attendees` },
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

function getOrganizerEvents(currentUser: UserProfile, events: Event[]) {
  if (currentUser.role === "admin") {
    return events;
  }

  const demoProfileId = mockUsers.find((user) => user.id === currentUser.id)?.organizerProfileId;
  const organizerProfileIds = [currentUser.organizerProfileId, demoProfileId].filter(Boolean);

  if (!organizerProfileIds.length) {
    return [];
  }

  return events.filter((event) => organizerProfileIds.includes(event.organizerId));
}

function getSelectedEvent(events: Event[], eventId?: string) {
  if (eventId) {
    return events.find((event) => event.id === eventId) ?? null;
  }

  return events[0] ?? null;
}

function getOrganizerEventRows(events: Event[]): OrganizerEventRow[] {
  return events.map((event) => ({
    id: event.id,
    title: event.title,
    type: event.type,
    status: event.status,
    venue: getVenue(event.venueId).name,
    riders: event.going + event.interested,
    checkIns: getCheckIns(event),
    date: event.date,
  }));
}

function getReportRows(events: Event[]): ReportRow[] {
  return events.map((event) => ({
    id: event.id,
    event: event.title,
    status: event.status,
    going: event.going,
    interested: event.interested,
    checkIns: getCheckIns(event),
    conversion: getConversion(event),
  }));
}

function getAttendeeRows(event: Event): AttendeeRow[] {
  const names = [
    "Mina Rider",
    "RJ Santos",
    "Kara Moto",
    "Luis Tambay",
    "Bea Cruz",
    "Nico Reyes",
    "Iya Navarro",
    "Paolo Gear",
  ];
  const statuses: AttendeeRow["status"][] = ["Checked in", "Going", "Interested", "No-show"];
  return names.map((name, index) => ({
    id: `${event.id}-${index}`,
    name,
    pass: `TB-${event.id.slice(0, 4).toUpperCase()}-${String(index + 11).padStart(2, "0")}`,
    status: statuses[index % statuses.length],
    checkIn: index % 4 === 0 ? "6:42 PM" : index % 4 === 1 ? "Pending" : "Not due",
    club: index % 2 === 0 ? "Weekend Tambike Crew" : "Direct rider",
  }));
}

function getSectionCards(events: Event[], checkedInCount: number): SectionCard[] {
  const published = events.filter((event) => event.status === "PUBLISHED").length;
  const inReview = events.filter((event) => event.status.includes("PENDING")).length;
  const riders = events.reduce((total, event) => total + event.going + event.interested, 0);
  return [
    {
      label: "Owned events",
      value: String(events.length),
      detail: `${published} currently visible to riders`,
      trend: "Pipeline",
      icon: <CalendarClockIcon data-icon="inline-start" />,
    },
    {
      label: "In review",
      value: String(inReview),
      detail: "Venue or admin checks before publishing",
      trend: "Approvals",
      icon: <ClipboardCheckIcon data-icon="inline-start" />,
    },
    {
      label: "Rider interest",
      value: String(riders),
      detail: "Going and interested riders across host events",
      trend: "Demand",
      icon: <UsersIcon data-icon="inline-start" />,
    },
    {
      label: "Today check-ins",
      value: String(checkedInCount),
      detail: "Scanner total from the current demo event",
      trend: "Live",
      icon: <ScanLineIcon data-icon="inline-start" />,
    },
  ];
}

function getSidebarMetrics(events: Event[]): SidebarMetrics {
  return {
    reviewEvents: events.filter((event) => event.status.includes("PENDING")).length,
    liveEvents: events.filter((event) => event.status === "PUBLISHED").length,
    reportsReady: events.length,
  };
}

function getChartData(events: Event[]): AdminChartPoint[] {
  const source = events.length > 0 ? events : demoEvents.slice(0, 6);
  return source.map((event, index) => {
    const day = String(index + 3).padStart(2, "0");
    return {
      date: `2026-07-${day}`,
      published: event.status === "PUBLISHED" ? index + 1 : Math.max(1, Math.floor(index / 2)),
      registrations: event.going + event.interested,
    };
  });
}

function getCheckIns(event: Event) {
  return Math.floor(event.going * 0.82);
}

function getConversion(event: Event) {
  const total = event.going + event.interested;
  if (!total) {
    return "0%";
  }

  return `${Math.round((event.going / total) * 100)}%`;
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
