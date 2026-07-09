"use client";

import * as React from "react";
import Link from "next/link";
import type { Column, ColumnDef } from "@tanstack/react-table";
import {
  ArrowUpDownIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  DownloadIcon,
  EllipsisVerticalIcon,
  FileWarningIcon,
  ShieldAlertIcon,
  UploadCloudIcon,
  UserRoundCheckIcon,
  UsersIcon,
  WarehouseIcon,
} from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import { ChartAreaInteractive, type AdminChartPoint } from "@/components/chart-area-interactive";
import { DataTable } from "@/components/data-table";
import FileUpload06 from "@/components/file-upload-06";
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
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { adminApproval, organizers, reportMetrics, venueApproval, venues } from "@/features/tambike-demo/data";
import { useDemo } from "@/features/tambike-demo/demo-provider";
import type { Event, UserProfile, VerificationStatus } from "@/features/tambike-demo/types";

export type AdminSection =
  | "overview"
  | "organizers"
  | "events"
  | "venues"
  | "reports"
  | "users"
  | "validation"
  | "moderation";

type OrganizerRow = {
  id: string;
  organizer: string;
  type: string;
  owner: string;
  status: VerificationStatus;
  pastEvents: number;
  activeEvents: number;
  fbLink: string;
};

type EventReviewRow = {
  id: string;
  title: string;
  type: string;
  status: Event["status"];
  organizer: string;
  venue: string;
  riders: number;
  risk: string;
};

type VenueClaimRow = {
  id: string;
  venue: string;
  area: string;
  status: VerificationStatus;
  capacity: string;
  rules: number;
};

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: VerificationStatus;
  area: string;
};

type ValidationRow = {
  id: string;
  file: string;
  area: string;
  rows: number;
  result: "Validating" | "Ready" | "Needs fixes";
  owner: string;
};

type ReportRow = {
  id: string;
  event: string;
  organizer: string;
  status: Event["status"];
  going: number;
  checkIns: number;
  noShow: string;
};

const sectionCopy: Record<AdminSection, { title: string; description: string; status?: string }> = {
  overview: {
    title: "Admin overview",
    description: "Review organizer readiness, event approvals, venue claims, validation imports, and rider operations.",
    status: "Ops",
  },
  organizers: {
    title: "Organizer verification",
    description: "Approve organizer identities, match owner accounts, and inspect organizer event history.",
    status: "Organizer",
  },
  events: {
    title: "Event review",
    description: "Screen events that need admin review before publishing to riders.",
    status: "Publishing",
  },
  venues: {
    title: "Venue claims",
    description: "Validate venue ownership, house rules, and staff assignment before event approval.",
    status: "Venue",
  },
  reports: {
    title: "Reports",
    description: "Scan attendance, no-show, and perk activity across published Tambike events.",
    status: "Analytics",
  },
  users: {
    title: "Users",
    description: "Review rider, organizer, venue, and ops accounts in one operational list.",
    status: "Accounts",
  },
  validation: {
    title: "Leads & validation",
    description: "Batch-check organizer, venue, and lead files before promoting rows into the live workflow.",
    status: "Upload",
  },
  moderation: {
    title: "Moderation",
    description: "Inspect content risk, event flags, and records that need admin attention.",
    status: "Risk",
  },
};

export function AdminConsole({ section }: { section: AdminSection }) {
  const { currentUser, events, users } = useDemo();

  if (!currentUser) {
    return (
      <AdminAccessState
        title="Admin login required"
        body="Use a Tambike ops account to open the admin console."
      />
    );
  }

  if (currentUser.role !== "admin") {
    return (
      <AdminAccessState
        title="Ops access needed"
        body="This console is limited to Tambike admin accounts."
      />
    );
  }

  const organizerRows = getOrganizerRows(users, events);
  const eventRows = getEventRows(events);
  const venueRows = getVenueRows();
  const userRows = getUserRows(users);
  const validationRows = getValidationRows();
  const reportRows = getReportRows(events);
  const metrics = {
    pendingOrganizers: organizerRows.filter((row) => row.status !== "APPROVED").length,
    pendingEvents: eventRows.filter((row) => row.status === "PENDING_ADMIN_REVIEW").length,
    venueClaims: venueRows.filter((row) => row.status !== "APPROVED").length,
  };
  const cards = getSectionCards({
    organizers: organizerRows,
    events: eventRows,
    venues: venueRows,
    users: userRows,
  });
  const chartData = getChartData(events);
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
      <AppSidebar currentSection={section} metrics={metrics} user={currentUser} variant="inset" />
      <SidebarInset>
        <SiteHeader title={copy.title} description={copy.description} status={copy.status} />
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            {section === "overview" ? (
              <OverviewSection
                cards={cards}
                chartData={chartData}
                organizerRows={organizerRows}
                eventRows={eventRows}
              />
            ) : null}
            {section === "organizers" ? <OrganizersSection rows={organizerRows} /> : null}
            {section === "events" ? <EventsSection rows={eventRows} /> : null}
            {section === "venues" ? <VenuesSection rows={venueRows} /> : null}
            {section === "reports" ? <ReportsSection rows={reportRows} /> : null}
            {section === "users" ? <UsersSection rows={userRows} /> : null}
            {section === "validation" ? <ValidationSection rows={validationRows} /> : null}
            {section === "moderation" ? <ModerationSection rows={eventRows} /> : null}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AdminAccessState({ title, body }: { title: string; body: string }) {
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
  organizerRows,
  eventRows,
}: {
  cards: SectionCard[];
  chartData: AdminChartPoint[];
  organizerRows: OrganizerRow[];
  eventRows: EventReviewRow[];
}) {
  return (
    <>
      <SectionCards cards={cards} />
      <div className="px-4 lg:px-6">
        <ChartAreaInteractive data={chartData} />
      </div>
      <div className="grid gap-4 px-4 lg:grid-cols-2 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Organizer queue</CardTitle>
            <CardDescription>Approved hosts and profiles that need review.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={organizerColumns}
              data={organizerRows.slice(0, 8)}
              filterColumn="organizer"
              filterPlaceholder="Filter organizers..."
              pageSize={5}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Event review queue</CardTitle>
            <CardDescription>Events that need venue/admin action before publishing.</CardDescription>
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
      </div>
    </>
  );
}

function OrganizersSection({ rows }: { rows: OrganizerRow[] }) {
  return (
    <TablePanel
      title="Organizer management"
      description="CSC-style review list for organizer identity, owner match, event history, and profile quality."
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/leads">
            <UploadCloudIcon data-icon="inline-start" />
            Batch validate
          </Link>
        </Button>
      }
    >
      <DataTable
        columns={organizerColumns}
        data={rows}
        filterColumn="organizer"
        filterPlaceholder="Filter by organizer..."
      />
    </TablePanel>
  );
}

function EventsSection({ rows }: { rows: EventReviewRow[] }) {
  return (
    <TablePanel
      title="Event approvals"
      description="Review risk flags, expected rider count, venue assignment, and publish readiness."
    >
      <DataTable columns={eventColumns} data={rows} filterColumn="title" filterPlaceholder="Filter events..." />
    </TablePanel>
  );
}

function VenuesSection({ rows }: { rows: VenueClaimRow[] }) {
  return (
    <TablePanel
      title="Venue claims"
      description="Verify venue ownership and house rules before organizers can request approvals."
    >
      <DataTable columns={venueColumns} data={rows} filterColumn="venue" filterPlaceholder="Filter venues..." />
    </TablePanel>
  );
}

function ReportsSection({ rows }: { rows: ReportRow[] }) {
  return (
    <TablePanel
      title="Operational reports"
      description="Event-level attendance and conversion checks for admin, organizer, and venue reporting."
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/api/admin/exports/leads">
            <DownloadIcon data-icon="inline-start" />
            Export leads
          </Link>
        </Button>
      }
    >
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        {reportMetrics.slice(0, 6).map((metric) => (
          <div key={metric.label} className="rounded-lg border bg-muted/30 p-3">
            <div className="text-sm text-muted-foreground">{metric.label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{metric.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{metric.detail}</div>
          </div>
        ))}
      </div>
      <DataTable columns={reportColumns} data={rows} filterColumn="event" filterPlaceholder="Filter reports..." />
    </TablePanel>
  );
}

function UsersSection({ rows }: { rows: UserRow[] }) {
  return (
    <TablePanel
      title="User accounts"
      description="Role, status, and area overview for rider, organizer, venue, and ops accounts."
    >
      <DataTable columns={userColumns} data={rows} filterColumn="name" filterPlaceholder="Filter users..." />
    </TablePanel>
  );
}

function ValidationSection({ rows }: { rows: ValidationRow[] }) {
  return (
    <div className="grid gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,480px)] lg:px-6">
      <TablePanel
        title="Uploaded data checks"
        description="Files stay in validation until schema, duplicate, owner, and venue checks are clean."
      >
        <DataTable
          columns={validationColumns}
          data={rows}
          filterColumn="file"
          filterPlaceholder="Filter uploads..."
        />
      </TablePanel>
      <Card>
        <CardHeader>
          <CardTitle>Batch upload</CardTitle>
          <CardDescription>Drop organizer, venue, or lead files for review before import.</CardDescription>
        </CardHeader>
        <CardContent>
          <FileUpload06 />
        </CardContent>
      </Card>
    </div>
  );
}

function ModerationSection({ rows }: { rows: EventReviewRow[] }) {
  const flaggedRows = rows.filter((row) => row.risk !== "Standard review");
  return (
    <TablePanel
      title="Moderation queue"
      description="Risk-heavy events, ride-outs, and race/track submissions that need policy review."
    >
      <DataTable
        columns={eventColumns}
        data={flaggedRows}
        filterColumn="title"
        filterPlaceholder="Filter flagged events..."
      />
    </TablePanel>
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

const organizerColumns: ColumnDef<OrganizerRow>[] = [
  selectColumn<OrganizerRow>(),
  {
    accessorKey: "organizer",
    header: ({ column }) => <SortableHeader column={column}>Organizer</SortableHeader>,
    cell: ({ row }) => (
      <div className="min-w-56">
        <div className="font-medium">{row.original.organizer}</div>
        <div className="text-sm text-muted-foreground">{row.original.type}</div>
      </div>
    ),
  },
  {
    accessorKey: "owner",
    header: "Owner",
    cell: ({ row }) => row.original.owner,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "pastEvents",
    header: ({ column }) => <SortableHeader column={column}>Past events</SortableHeader>,
    cell: ({ row }) => <span className="tabular-nums">{row.original.pastEvents}</span>,
  },
  {
    accessorKey: "activeEvents",
    header: "Live",
    cell: ({ row }) => <span className="tabular-nums">{row.original.activeEvents}</span>,
  },
  actionsColumn<OrganizerRow>((row) => [
    { label: "Open organizer review", href: `/admin/verifications/organizers/${row.id}` },
    { label: "View public events", href: "/events" },
    { label: "Open source profile", href: `https://${row.fbLink}`, external: true },
  ]),
];

const eventColumns: ColumnDef<EventReviewRow>[] = [
  selectColumn<EventReviewRow>(),
  {
    accessorKey: "title",
    header: ({ column }) => <SortableHeader column={column}>Event</SortableHeader>,
    cell: ({ row }) => (
      <div className="min-w-64">
        <div className="font-medium">{row.original.title}</div>
        <div className="text-sm text-muted-foreground">
          {row.original.organizer} · {row.original.venue}
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
    accessorKey: "risk",
    header: "Risk",
    cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.risk}</span>,
  },
  actionsColumn<EventReviewRow>((row) => [
    { label: "Review event", href: `/admin/events/review/${adminApproval.id}` },
    { label: "Open public event", href: `/events/${row.id}` },
    { label: "Open report", href: `/admin/reports/${row.id}` },
  ]),
];

const venueColumns: ColumnDef<VenueClaimRow>[] = [
  selectColumn<VenueClaimRow>(),
  {
    accessorKey: "venue",
    header: ({ column }) => <SortableHeader column={column}>Venue</SortableHeader>,
    cell: ({ row }) => (
      <div className="min-w-56">
        <div className="font-medium">{row.original.venue}</div>
        <div className="text-sm text-muted-foreground">{row.original.area}</div>
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "capacity",
    header: "Capacity note",
    cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.capacity}</span>,
  },
  {
    accessorKey: "rules",
    header: "Rules",
    cell: ({ row }) => <span className="tabular-nums">{row.original.rules}</span>,
  },
  actionsColumn<VenueClaimRow>(() => [
    { label: "Open claim", href: `/admin/venues/claims/${venueApproval.id}` },
    { label: "View related requests", href: "/venue/requests" },
  ]),
];

const userColumns: ColumnDef<UserRow>[] = [
  selectColumn<UserRow>(),
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader column={column}>Name</SortableHeader>,
    cell: ({ row }) => (
      <div className="min-w-48">
        <div className="font-medium">{row.original.name}</div>
        <div className="text-sm text-muted-foreground">{row.original.email}</div>
      </div>
    ),
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => <Badge variant="secondary">{row.original.role}</Badge>,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "area",
    header: "Area",
  },
  actionsColumn<UserRow>(() => [
    { label: "Open profile", href: "/profile" },
    { label: "View users", href: "/admin/users" },
  ]),
];

const validationColumns: ColumnDef<ValidationRow>[] = [
  selectColumn<ValidationRow>(),
  {
    accessorKey: "file",
    header: ({ column }) => <SortableHeader column={column}>File</SortableHeader>,
    cell: ({ row }) => (
      <div className="min-w-56">
        <div className="font-medium">{row.original.file}</div>
        <div className="text-sm text-muted-foreground">{row.original.area}</div>
      </div>
    ),
  },
  {
    accessorKey: "rows",
    header: "Rows",
    cell: ({ row }) => <span className="tabular-nums">{row.original.rows}</span>,
  },
  {
    accessorKey: "result",
    header: "Result",
    cell: ({ row }) => <ValidationBadge result={row.original.result} />,
  },
  {
    accessorKey: "owner",
    header: "Owner",
  },
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
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <EventStatusBadge status={row.original.status} />,
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
    { label: "Open report", href: `/admin/reports/${row.id}` },
    { label: "Export attendees", href: `/api/admin/exports/attendees/${row.id}` },
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
    <Button variant="ghost" size="sm" className="-ml-2" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
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
  getItems: (row: TData) => Array<{ label: string; href: string; external?: boolean }>,
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
                <Link href={item.href} target={item.external ? "_blank" : undefined} rel={item.external ? "noreferrer" : undefined}>
                  {item.label}
                </Link>
              </DropdownMenuItem>
            </React.Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  };
}

function StatusBadge({ status }: { status: VerificationStatus }) {
  if (status === "APPROVED") {
    return (
      <Badge variant="outline" className="text-emerald-700 dark:text-emerald-300">
        <CheckCircle2Icon data-icon="inline-start" />
        Approved
      </Badge>
    );
  }

  if (status === "SUSPENDED" || status === "REJECTED") {
    return (
      <Badge variant="destructive">
        <ShieldAlertIcon data-icon="inline-start" />
        {status.toLowerCase()}
      </Badge>
    );
  }

  return <Badge variant="secondary">{status.toLowerCase()}</Badge>;
}

function EventStatusBadge({ status }: { status: Event["status"] }) {
  const label = status.replaceAll("_", " ").toLowerCase();
  if (status === "PUBLISHED" || status === "COMPLETED") {
    return <Badge variant="outline">{label}</Badge>;
  }

  if (status === "PENDING_ADMIN_REVIEW" || status === "PENDING_VENUE_APPROVAL") {
    return <Badge variant="secondary">{label}</Badge>;
  }

  return <Badge variant="outline">{label}</Badge>;
}

function ValidationBadge({ result }: { result: ValidationRow["result"] }) {
  if (result === "Ready") {
    return (
      <Badge variant="outline" className="text-emerald-700 dark:text-emerald-300">
        <CheckCircle2Icon data-icon="inline-start" />
        Ready
      </Badge>
    );
  }

  if (result === "Needs fixes") {
    return (
      <Badge variant="destructive">
        <FileWarningIcon data-icon="inline-start" />
        Needs fixes
      </Badge>
    );
  }

  return <Badge variant="secondary">Validating</Badge>;
}

function getOrganizerRows(users: UserProfile[], events: Event[]): OrganizerRow[] {
  return organizers.map((organizer) => {
    const owner = users.find((user) => user.organizerProfileId === organizer.id);
    const activeEvents = events.filter((event) => event.organizerId === organizer.id).length;
    return {
      id: organizer.id,
      organizer: organizer.displayName,
      type: organizer.type,
      owner: owner?.displayName ?? "Owner match needed",
      status: organizer.verificationStatus,
      pastEvents: organizer.pastEvents,
      activeEvents,
      fbLink: organizer.fbLink,
    };
  });
}

function getEventRows(events: Event[]): EventReviewRow[] {
  return events.map((event) => ({
    id: event.id,
    title: event.title,
    type: event.type,
    status: event.status,
    organizer: organizers.find((organizer) => organizer.id === event.organizerId)?.displayName ?? "Unknown organizer",
    venue: venues.find((venue) => venue.id === event.venueId)?.name ?? "Venue needed",
    riders: event.going + event.interested,
    risk: event.riskFlags[0] ?? "Standard review",
  }));
}

function getVenueRows(): VenueClaimRow[] {
  return venues.map((venue) => ({
    id: venue.id,
    venue: venue.name,
    area: venue.area,
    status: venue.status,
    capacity: venue.capacityNote,
    rules: venue.houseRules.length,
  }));
}

function getUserRows(users: UserProfile[]): UserRow[] {
  return users.map((user) => ({
    id: user.id,
    name: user.displayName,
    email: user.email,
    role: user.role,
    status: user.verificationStatus,
    area: user.area,
  }));
}

function getValidationRows(): ValidationRow[] {
  return [
    {
      id: "organizer-verification-july",
      file: "organizer-verification-july.csv",
      area: "Organizer verification",
      rows: 42,
      result: "Validating",
      owner: "Tambike Ops",
    },
    {
      id: "venue-owner-matching",
      file: "venue-owner-matching.xlsx",
      area: "Venue claims",
      rows: 18,
      result: "Ready",
      owner: "Tambike Ops",
    },
    {
      id: "event-risk-flags",
      file: "event-risk-flags.csv",
      area: "Event review",
      rows: 27,
      result: "Needs fixes",
      owner: "Tambike Ops",
    },
  ];
}

function getReportRows(events: Event[]): ReportRow[] {
  return events.map((event) => {
    const checkIns = Math.floor(event.going * 0.82);
    const noShow = event.going > 0 ? `${Math.max(0, Math.round(((event.going - checkIns) / event.going) * 100))}%` : "0%";
    return {
      id: event.id,
      event: event.title,
      organizer: organizers.find((organizer) => organizer.id === event.organizerId)?.displayName ?? "Unknown organizer",
      status: event.status,
      going: event.going,
      checkIns,
      noShow,
    };
  });
}

function getSectionCards({
  organizers: organizerRows,
  events,
  venues: venueRows,
  users,
}: {
  organizers: OrganizerRow[];
  events: EventReviewRow[];
  venues: VenueClaimRow[];
  users: UserRow[];
}): SectionCard[] {
  const pendingReview = events.filter((event) => event.status === "PENDING_ADMIN_REVIEW").length;
  const published = events.filter((event) => event.status === "PUBLISHED").length;
  return [
    {
      label: "Organizer profiles",
      value: String(organizerRows.length),
      detail: `${organizerRows.filter((row) => row.status === "APPROVED").length} approved hosts in the directory`,
      trend: "Managed",
      icon: <UserRoundCheckIcon data-icon="inline-start" />,
    },
    {
      label: "Pending event review",
      value: String(pendingReview),
      detail: `${published} published events are currently visible to riders`,
      trend: "Queue",
      icon: <CalendarClockIcon data-icon="inline-start" />,
    },
    {
      label: "Venue records",
      value: String(venueRows.length),
      detail: `${venueRows.filter((row) => row.status === "APPROVED").length} venues approved for organizer requests`,
      trend: "Claims",
      icon: <WarehouseIcon data-icon="inline-start" />,
    },
    {
      label: "Accounts",
      value: String(users.length),
      detail: "Rider, organizer, venue, and ops accounts in the current backend state",
      trend: "RBAC",
      icon: <UsersIcon data-icon="inline-start" />,
    },
  ];
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
