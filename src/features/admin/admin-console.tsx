"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import type { Column, ColumnDef } from "@tanstack/react-table";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  ArrowUpDownIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  DownloadIcon,
  EllipsisVerticalIcon,
  FileWarningIcon,
  Maximize2Icon,
  ShieldAlertIcon,
  UploadCloudIcon,
  UserRoundCheckIcon,
  UsersIcon,
  WarehouseIcon,
  XIcon,
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
import { adminApproval, organizers, reportMetrics, venues } from "@/features/tambike-demo/data";
import { useDemo } from "@/features/tambike-demo/demo-provider";
import type { Event, UserProfile, VerificationStatus } from "@/features/tambike-demo/types";

export type AdminSection =
  | "overview"
  | "organizers"
  | "events"
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
  poster: string;
  type: string;
  status: Event["status"];
  organizer: string;
  venue: string;
  riders: number;
  risk: string;
};

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: VerificationStatus;
  area: string;
  organizerProfileId?: string;
  venueId?: string;
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

type RowActionItem = {
  label: string;
  href?: string;
  external?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  onSelect?: () => void;
};

const sectionCopy: Record<AdminSection, { title: string; description: string; status?: string }> = {
  overview: {
    title: "Admin overview",
    description: "Review organizer readiness, event approvals, validation imports, and rider operations.",
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

export function AdminConsole({
  organizerId,
  reportEventId,
  reviewId,
  section,
}: {
  section: AdminSection;
  organizerId?: string;
  reportEventId?: string;
  reviewId?: string;
}) {
  const { adminDecision, approvePublish, currentUser, events, users } = useDemo();
  const [organizerStatusOverrides, setOrganizerStatusOverrides] = React.useState<Record<string, VerificationStatus>>({});
  const [userStatusOverrides, setUserStatusOverrides] = React.useState<Record<string, VerificationStatus>>({});
  const [eventStatusOverrides, setEventStatusOverrides] = React.useState<Record<string, Event["status"]>>({});

  const setOrganizerStatus = React.useCallback((organizerId: string, status: VerificationStatus) => {
    setOrganizerStatusOverrides((current) => ({ ...current, [organizerId]: status }));
  }, []);

  const setUserStatus = React.useCallback((userId: string, status: VerificationStatus) => {
    setUserStatusOverrides((current) => ({ ...current, [userId]: status }));
  }, []);

  const setEventStatus = React.useCallback((eventId: string, status: Event["status"]) => {
    setEventStatusOverrides((current) => ({ ...current, [eventId]: status }));
  }, []);

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

  const effectiveEvents = events.map((event) => {
    const status = eventStatusOverrides[event.id];
    return status ? { ...event, status } : event;
  });
  const organizerRows = getOrganizerRows(users, effectiveEvents, organizerStatusOverrides);
  const eventRows = getEventRows(effectiveEvents);
  const userRows = getUserRows(users, userStatusOverrides);
  const validationRows = getValidationRows();
  const reportRows = getReportRows(effectiveEvents);
  const metrics = {
    pendingOrganizers: organizerRows.filter((row) => row.status !== "APPROVED").length,
    pendingEvents: eventRows.filter((row) => row.status === "PENDING_ADMIN_REVIEW").length,
  };
  const cards = getSectionCards({
    organizers: organizerRows,
    events: eventRows,
    users: userRows,
  });
  const chartData = getChartData(effectiveEvents);
  const organizerDetail = organizerId ? organizerRows.find((row) => row.id === organizerId) ?? null : null;
  const reportEvent = reportEventId ? effectiveEvents.find((event) => event.id === reportEventId) ?? null : null;
  const reviewEvent = reviewId ? findReviewEvent(effectiveEvents, reviewId) : null;
  const hasDetail = Boolean(reviewId || organizerId || reportEventId);
  const copy = reviewId
    ? {
        title: reviewEvent?.title ?? "Event review detail",
        description: "Review publish readiness, risk flags, venue assignment, and organizer context.",
        status: "Review",
      }
    : organizerId
      ? {
          title: organizerDetail?.organizer ?? "Organizer review",
          description: "Verify organizer profile quality, owner match, and event history.",
          status: "Organizer",
        }
      : reportEventId
          ? {
              title: reportEvent?.title ?? "Report detail",
              description: "Review event attendance, conversion, and operating outcomes.",
              status: "Report",
            }
    : sectionCopy[section];

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
            {reviewId ? (
              <EventReviewDetail
                adminDecision={adminDecision}
                event={reviewEvent}
                onApprove={approvePublish}
                onSetStatus={setEventStatus}
                reviewId={reviewId}
              />
            ) : null}
            {organizerId ? (
              <OrganizerVerificationDetail
                organizerId={organizerId}
                onSetStatus={setOrganizerStatus}
                row={organizerDetail}
              />
            ) : null}
            {reportEventId ? <AdminReportDetail event={reportEvent} eventId={reportEventId} /> : null}
            {!hasDetail && section === "overview" ? (
              <OverviewSection
                cards={cards}
                chartData={chartData}
                organizerRows={organizerRows}
                eventRows={eventRows}
              />
            ) : null}
            {!hasDetail && section === "organizers" ? (
              <OrganizersSection onSetStatus={setOrganizerStatus} rows={organizerRows} />
            ) : null}
            {!hasDetail && section === "events" ? <EventsSection rows={eventRows} /> : null}
            {!hasDetail && section === "reports" ? <ReportsSection rows={reportRows} /> : null}
            {!hasDetail && section === "users" ? (
              <UsersSection currentUserId={currentUser.id} onSetStatus={setUserStatus} rows={userRows} />
            ) : null}
            {!hasDetail && section === "validation" ? <ValidationSection rows={validationRows} /> : null}
            {!hasDetail && section === "moderation" ? <ModerationSection rows={eventRows} /> : null}
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
  const reviewRows = getReviewQueueRows(eventRows);

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
              columns={getOrganizerColumns()}
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
              columns={getEventColumns()}
              data={reviewRows.slice(0, 8)}
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

function OrganizersSection({
  onSetStatus,
  rows,
}: {
  onSetStatus: (organizerId: string, status: VerificationStatus) => void;
  rows: OrganizerRow[];
}) {
  const columns = React.useMemo(() => getOrganizerColumns(onSetStatus), [onSetStatus]);

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
        columns={columns}
        data={rows}
        filterColumn="organizer"
        filterPlaceholder="Filter by organizer..."
      />
    </TablePanel>
  );
}

function EventsSection({ rows }: { rows: EventReviewRow[] }) {
  const reviewRows = getReviewQueueRows(rows);

  return (
    <TablePanel
      title="Event approvals"
      description="Review only events that still need an admin publishing decision."
    >
      <DataTable columns={getEventColumns()} data={reviewRows} filterColumn="title" filterPlaceholder="Filter events..." />
    </TablePanel>
  );
}

function EventReviewDetail({
  adminDecision,
  event,
  onApprove,
  onSetStatus,
  reviewId,
}: {
  adminDecision: "pending" | "published";
  event: Event | null;
  onApprove: (eventId: string) => Promise<void>;
  onSetStatus: (eventId: string, status: Event["status"]) => void;
  reviewId: string;
}) {
  const [error, setError] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  if (!event) {
    return (
      <TablePanel
        title="Review not found"
        description="This review id does not match the current admin approval queue."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/events/review">Back to queue</Link>
          </Button>
        }
      >
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          Review id: <span className="font-mono text-foreground">{reviewId}</span>
        </div>
      </TablePanel>
    );
  }

  const organizer = organizers.find((item) => item.id === event.organizerId);
  const venue = venues.find((item) => item.id === event.venueId);
  const isClosed = event.status === "NEEDS_CHANGES" || event.status === "REJECTED" || event.status === "CANCELLED";
  const isPublished =
    !isClosed && (event.status === "PUBLISHED" || (event.id === adminApproval.eventId && adminDecision === "published"));
  const isPendingReview = event.status === "PENDING_ADMIN_REVIEW";
  const isDisabled = event.status === "CANCELLED";
  const detailItems = [
    ["Type", event.type],
    ["Date", `${event.date} · ${event.time}`],
    ["Area", event.area],
    ["Expected riders", String(event.expectedRiders)],
  ];
  const actionTitle = isDisabled
    ? "Event disabled"
    : isPublished
      ? "Published event controls"
      : event.status === "NEEDS_CHANGES"
        ? "Changes requested"
        : isPendingReview
          ? "Pending admin decision"
          : "Review controls";
  const actionDescription = isDisabled
    ? "This event is hidden from public operations until an admin restores it to review."
    : isPublished
      ? "This event is live. Approval is complete, so the available admin action is to disable the public listing."
      : event.status === "NEEDS_CHANGES"
        ? "The organizer needs to update the listing before admin approval can continue."
        : event.id === adminApproval.eventId
          ? adminApproval.notes
          : "Review risk flags, venue assignment, and organizer context before publishing.";

  return (
    <div className="grid gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:px-6">
      <div className="grid gap-4">
        <Card>
          <CardHeader className="gap-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-start">
              <div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">Admin review</Badge>
                  <EventStatusBadge status={event.status} />
                </div>
                <CardTitle className="mt-3 text-2xl">{event.title}</CardTitle>
                <CardDescription className="mt-1">{event.shortDescription}</CardDescription>
              </div>
              <EventPosterPreview poster={event.poster} title={event.title} variant="detail" />
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {detailItems.map(([label, value]) => (
                <div key={label} className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
                  <div className="mt-1 text-sm font-medium">{value}</div>
                </div>
              ))}
            </div>
            <div className="grid gap-2">
              <h2 className="text-sm font-semibold">Review signals</h2>
              <div className="flex flex-wrap gap-2">
                {event.riskFlags.map((flag) => (
                  <Badge key={flag} variant="outline" className="border-destructive/30 text-destructive">
                    <ShieldAlertIcon data-icon="inline-start" />
                    {flag}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Organizer</CardTitle>
              <CardDescription>{organizer?.type ?? "Organizer profile"}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              <div className="font-medium">{organizer?.displayName ?? "Unknown organizer"}</div>
              <div className="mt-1 text-muted-foreground">
                {organizer?.verificationStatus.toLowerCase() ?? "status unknown"} · {organizer?.pastEvents ?? 0} past events
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Venue</CardTitle>
              <CardDescription>{venue?.area ?? event.area}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              <div className="font-medium">{venue?.name ?? "Venue needed"}</div>
              <div className="mt-1 text-muted-foreground">{venue?.capacityNote ?? "No venue capacity note."}</div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="h-fit lg:sticky lg:top-24">
        <CardHeader>
          <CardTitle>{actionTitle}</CardTitle>
          <CardDescription>{actionDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {isPublished ? (
            <ActionNotice
              title="Published to riders"
              body="This record no longer needs approval. Use disable only when the listing must be removed from public operations."
              tone="success"
            />
          ) : null}
          {event.status === "NEEDS_CHANGES" ? (
            <ActionNotice
              title="Changes requested"
              body="Approval actions are paused until the organizer updates the event."
              tone="warning"
            />
          ) : null}
          {isDisabled ? (
            <ActionNotice
              title="Disabled event"
              body="Riders should not be able to register while this event is disabled."
              tone="danger"
            />
          ) : null}
          {isPendingReview ? (
            <Button
              disabled={isSubmitting}
              onClick={async () => {
                setError("");
                setIsSubmitting(true);
                try {
                  await onApprove(event.id);
                } catch (actionError) {
                  setError(getActionErrorMessage(actionError));
                } finally {
                  setIsSubmitting(false);
                }
              }}
            >
              {isSubmitting ? "Publishing..." : "Approve publish"}
            </Button>
          ) : null}
          {isPendingReview ? (
            <Button type="button" variant="outline" onClick={() => onSetStatus(event.id, "NEEDS_CHANGES")}>
              Request changes
            </Button>
          ) : null}
          {!isPendingReview && !isPublished && !isDisabled ? (
            <Button type="button" variant="outline" onClick={() => onSetStatus(event.id, "PENDING_ADMIN_REVIEW")}>
              Restore to review
            </Button>
          ) : null}
          {!isDisabled ? (
            <Button type="button" variant="destructive" onClick={() => onSetStatus(event.id, "CANCELLED")}>
              Disable event
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => onSetStatus(event.id, "PENDING_ADMIN_REVIEW")}>
              Restore to review
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/admin/events/review">Back to review queue</Link>
          </Button>
          {event.sourceUrl ? (
            <Button asChild variant="ghost">
              <Link href={event.sourceUrl} target="_blank" rel="noreferrer">
                Open source listing
              </Link>
            </Button>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function OrganizerVerificationDetail({
  organizerId,
  onSetStatus,
  row,
}: {
  organizerId: string;
  onSetStatus: (organizerId: string, status: VerificationStatus) => void;
  row: OrganizerRow | null;
}) {
  if (!row) {
    return (
      <TablePanel
        title="Organizer not found"
        description="This organizer id does not match the current verification queue."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/verifications/organizers">Back to organizers</Link>
          </Button>
        }
      >
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          Organizer id: <span className="font-mono text-foreground">{organizerId}</span>
        </div>
      </TablePanel>
    );
  }

  const items = [
    ["Owner account", row.owner],
    ["Profile type", row.type],
    ["Past events", String(row.pastEvents)],
    ["Live events", String(row.activeEvents)],
  ];
  const isApproved = row.status === "APPROVED";
  const isSuspended = row.status === "SUSPENDED";
  const isRejected = row.status === "REJECTED";
  const actionTitle = isSuspended ? "Organizer disabled" : isApproved ? "Account controls" : "Verification actions";
  const actionDescription = isSuspended
    ? "This organizer is blocked from host operations until an admin restores the record."
    : isApproved
      ? "Approval is complete. The available admin control is to disable the organizer if operations need to stop."
      : "Approve, reject, or disable the organizer after checking supporting records.";

  return (
    <div className="grid gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:px-6">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Organizer verification</Badge>
            <StatusBadge status={row.status} />
          </div>
          <CardTitle className="text-2xl">{row.organizer}</CardTitle>
          <CardDescription>Review owner match, profile source, and event history before approval.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {items.map(([label, value]) => (
            <div key={label} className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
              <div className="mt-1 text-sm font-medium">{value}</div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="h-fit lg:sticky lg:top-24">
        <CardHeader>
          <CardTitle>{actionTitle}</CardTitle>
          <CardDescription>{actionDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {isApproved ? (
            <ActionNotice
              title="Approved organizer"
              body="Owner and profile checks are complete. Approval actions are hidden for this status."
              tone="success"
            />
          ) : null}
          {isSuspended ? (
            <ActionNotice
              title="Disabled organizer"
              body="This host is blocked from creating or managing events until restored."
              tone="danger"
            />
          ) : null}
          {isRejected ? (
            <ActionNotice
              title="Rejected organizer"
              body="This profile did not pass review. Reopen it only after supporting records change."
              tone="warning"
            />
          ) : null}
          {!isApproved && !isSuspended ? (
            <>
              <Button type="button" onClick={() => onSetStatus(row.id, "APPROVED")}>
                Approve organizer
              </Button>
              <Button type="button" variant="outline" onClick={() => onSetStatus(row.id, "REJECTED")}>
                Reject organizer
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/leads">Open validation upload</Link>
              </Button>
            </>
          ) : null}
          {isSuspended ? (
            <Button type="button" variant="outline" onClick={() => onSetStatus(row.id, "APPROVED")}>
              Restore organizer
            </Button>
          ) : (
            <Button type="button" variant="destructive" onClick={() => onSetStatus(row.id, "SUSPENDED")}>
              Disable organizer
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href="/admin/verifications/organizers">Back to organizers</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function findReviewEvent(events: Event[], reviewId: string) {
  if (reviewId === adminApproval.id) {
    return events.find((event) => event.id === adminApproval.eventId) ?? null;
  }

  return events.find((event) => event.id === reviewId) ?? null;
}

function getActionErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "The admin action could not be completed.";
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

function AdminReportDetail({ event, eventId }: { event: Event | null; eventId: string }) {
  if (!event) {
    return (
      <TablePanel
        title="Report not found"
        description="This event id does not match the current report dataset."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/reports">Back to reports</Link>
          </Button>
        }
      >
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          Event id: <span className="font-mono text-foreground">{eventId}</span>
        </div>
      </TablePanel>
    );
  }

  const organizer = organizers.find((item) => item.id === event.organizerId);
  const checkIns = Math.floor(event.going * 0.82);
  const noShow = event.going > 0 ? `${Math.max(0, Math.round(((event.going - checkIns) / event.going) * 100))}%` : "0%";
  const metrics = [
    ["Going", String(event.going), "QR passes generated"],
    ["Interested", String(event.interested), "Saved or shared"],
    ["Check-ins", String(checkIns), "Scanned or manually marked"],
    ["No-show", noShow, "Going vs actual check-ins"],
  ];

  return (
    <div className="grid gap-4 px-4 lg:px-6">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Admin report</Badge>
            <EventStatusBadge status={event.status} />
          </div>
          <CardTitle className="text-2xl">{event.title}</CardTitle>
          <CardDescription>{organizer?.displayName ?? "Unknown organizer"} · {event.area}</CardDescription>
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
          <CardDescription>Admin-facing summary for post-event review and export.</CardDescription>
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

function UsersSection({
  currentUserId,
  onSetStatus,
  rows,
}: {
  currentUserId: string;
  onSetStatus: (userId: string, status: VerificationStatus) => void;
  rows: UserRow[];
}) {
  const columns = React.useMemo(
    () => getUserColumns(onSetStatus, currentUserId),
    [currentUserId, onSetStatus],
  );

  return (
    <TablePanel
      title="User accounts"
      description="Role, status, and area overview for rider, organizer, venue, and ops accounts."
    >
      <DataTable columns={columns} data={rows} filterColumn="name" filterPlaceholder="Filter users..." />
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
        columns={getEventColumns()}
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

function ActionNotice({
  body,
  title,
  tone = "neutral",
}: {
  body: string;
  title: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClasses = {
    neutral: "border-border bg-muted/30 text-muted-foreground",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100",
    warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  } satisfies Record<"neutral" | "success" | "warning" | "danger", string>;

  return (
    <div className={`rounded-lg border p-3 text-sm ${toneClasses[tone]}`}>
      <div className="flex items-center gap-2 font-medium">
        {tone === "success" ? <CheckCircle2Icon className="size-4" /> : <ShieldAlertIcon className="size-4" />}
        {title}
      </div>
      <p className="mt-1">{body}</p>
    </div>
  );
}

function EventPosterPreview({
  poster,
  title,
  variant,
}: {
  poster: string;
  title: string;
  variant: "detail" | "thumbnail";
}) {
  const isDetail = variant === "detail";

  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className={
            isDetail
              ? "group relative block overflow-hidden rounded-lg border bg-muted/30 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              : "group relative block h-16 w-11 shrink-0 overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          }
        >
          <Image
            src={poster}
            alt={`${title} poster`}
            width={1024}
            height={1536}
            sizes={isDetail ? "(max-width: 640px) 100vw, 160px" : "44px"}
            loading={isDetail ? "eager" : "lazy"}
            className={isDetail ? "h-auto w-full object-contain" : "h-full w-full object-cover"}
          />
          <span className="absolute inset-0 grid place-items-center bg-black/0 text-white transition-colors group-hover:bg-black/45 group-focus-visible:bg-black/45">
            <Maximize2Icon className="size-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </span>
          <span className="sr-only">Open enlarged poster</span>
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100svh-2rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 outline-none">
          <DialogPrimitive.Title className="sr-only">{title} poster</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Enlarged event poster preview. Click outside, press Escape, or use Close to return to the review.
          </DialogPrimitive.Description>
          <Image
            src={poster}
            alt={`${title} poster`}
            width={1024}
            height={1536}
            sizes="(max-width: 768px) 92vw, 70vw"
            loading="eager"
            className="max-h-[calc(100svh-2rem)] max-w-[calc(100vw-2rem)] rounded-lg object-contain shadow-2xl"
          />
          <DialogPrimitive.Close asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="absolute right-3 top-3 shadow-lg"
            >
              <XIcon />
              <span className="sr-only">Close poster preview</span>
            </Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function getOrganizerColumns(
  onSetStatus?: (organizerId: string, status: VerificationStatus) => void,
): ColumnDef<OrganizerRow>[] {
  return [
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
    actionsColumn<OrganizerRow>((row) => {
      const items: RowActionItem[] = [
        { label: "Open organizer record", href: `/admin/verifications/organizers/${row.id}` },
        { label: "Open source profile", href: `https://${row.fbLink}`, external: true },
      ];

      if (onSetStatus) {
        items.push(
          row.status === "SUSPENDED"
            ? {
                label: "Restore organizer",
                onSelect: () => onSetStatus(row.id, "APPROVED"),
              }
            : {
                label: "Disable organizer",
                destructive: true,
                onSelect: () => onSetStatus(row.id, "SUSPENDED"),
              },
        );
      }

      return items;
    }),
  ];
}

function getEventColumns(): ColumnDef<EventReviewRow>[] {
  return [
    selectColumn<EventReviewRow>(),
    {
      accessorKey: "title",
      header: ({ column }) => <SortableHeader column={column}>Event</SortableHeader>,
      cell: ({ row }) => (
        <div className="flex min-w-64 items-center gap-3">
          <EventPosterPreview poster={row.original.poster} title={row.original.title} variant="thumbnail" />
          <div>
          <div className="font-medium">{row.original.title}</div>
          <div className="text-sm text-muted-foreground">
            {row.original.organizer} · {row.original.venue}
          </div>
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
      { label: "Open admin record", href: `/admin/events/review/${row.id}` },
      {
        label: "Open public event",
        href: `/events/${row.id}`,
        disabled: !isPublicEventStatus(row.status),
      },
      {
        label: "Open report",
        href: `/admin/reports/${row.id}`,
        disabled: !isReportableEventStatus(row.status),
      },
    ]),
  ];
}

function getUserColumns(
  onSetStatus: (userId: string, status: VerificationStatus) => void,
  currentUserId: string,
): ColumnDef<UserRow>[] {
  return [
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
    actionsColumn<UserRow>((row) => {
      const items: RowActionItem[] = [];

      if (row.organizerProfileId) {
        items.push({
          label: "Open organizer record",
          href: `/admin/verifications/organizers/${row.organizerProfileId}`,
        });
      }

      if (row.status === "SUSPENDED") {
        items.push({
          label: "Restore account",
          onSelect: () => onSetStatus(row.id, "APPROVED"),
        });
      } else {
        items.push({
          label: "Disable account",
          destructive: true,
          disabled: row.id === currentUserId,
          onSelect: () => onSetStatus(row.id, "SUSPENDED"),
        });
      }

      return items;
    }),
  ];
}

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
  getItems: (row: TData) => RowActionItem[],
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
              {index === 2 || item.destructive ? <DropdownMenuSeparator /> : null}
              {item.href && !item.disabled ? (
                <DropdownMenuItem asChild variant={item.destructive ? "destructive" : "default"}>
                  <Link href={item.href} target={item.external ? "_blank" : undefined} rel={item.external ? "noreferrer" : undefined}>
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  disabled={item.disabled}
                  onSelect={item.onSelect}
                  variant={item.destructive ? "destructive" : "default"}
                >
                  {item.label}
                </DropdownMenuItem>
              )}
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
    return (
      <Badge variant="outline" className="text-emerald-700 dark:text-emerald-300">
        <CheckCircle2Icon data-icon="inline-start" />
        {label}
      </Badge>
    );
  }

  if (status === "PENDING_ADMIN_REVIEW" || status === "PENDING_VENUE_APPROVAL") {
    return <Badge variant="secondary">{label}</Badge>;
  }

  if (status === "NEEDS_CHANGES" || status === "REJECTED" || status === "CANCELLED") {
    return (
      <Badge variant="destructive">
        <ShieldAlertIcon data-icon="inline-start" />
        {label}
      </Badge>
    );
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

function isPublicEventStatus(status: Event["status"]) {
  return status === "PUBLISHED" || status === "ONGOING" || status === "COMPLETED";
}

function isReportableEventStatus(status: Event["status"]) {
  return isPublicEventStatus(status);
}

function getReviewQueueRows(rows: EventReviewRow[]) {
  return rows.filter((row) => row.status === "PENDING_ADMIN_REVIEW");
}

function getOrganizerRows(
  users: UserProfile[],
  events: Event[],
  statusOverrides: Record<string, VerificationStatus>,
): OrganizerRow[] {
  return organizers.map((organizer) => {
    const owner = users.find((user) => user.organizerProfileId === organizer.id);
    const activeEvents = events.filter((event) => event.organizerId === organizer.id).length;
    return {
      id: organizer.id,
      organizer: organizer.displayName,
      type: organizer.type,
      owner: owner?.displayName ?? "Owner match needed",
      status: statusOverrides[organizer.id] ?? organizer.verificationStatus,
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
    poster: event.poster,
    type: event.type,
    status: event.status,
    organizer: organizers.find((organizer) => organizer.id === event.organizerId)?.displayName ?? "Unknown organizer",
    venue: venues.find((venue) => venue.id === event.venueId)?.name ?? "Venue needed",
    riders: event.going + event.interested,
    risk: event.riskFlags[0] ?? "Standard review",
  }));
}

function getUserRows(
  users: UserProfile[],
  statusOverrides: Record<string, VerificationStatus>,
): UserRow[] {
  return users.map((user) => ({
    id: user.id,
    name: user.displayName,
    email: user.email,
    role: user.role,
    status: statusOverrides[user.id] ?? user.verificationStatus,
    area: user.area,
    organizerProfileId: user.organizerProfileId,
    venueId: user.venueId,
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
      id: "venue-directory-checks",
      file: "venue-directory-checks.xlsx",
      area: "Venue directory",
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
  return events.filter((event) => isReportableEventStatus(event.status)).map((event) => {
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
  users,
}: {
  organizers: OrganizerRow[];
  events: EventReviewRow[];
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
      value: String(venues.length),
      detail: `${venues.filter((venue) => venue.status === "APPROVED").length} venues approved for organizer requests`,
      trend: "Directory",
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
