"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2Icon, ShieldAlertIcon } from "lucide-react";
import { Dialog } from "radix-ui";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ActionState } from "@/features/shared/action-state";
import {
  restoreUserAction,
  suspendUserAction,
} from "@/server/admin/account-actions";

import type { AdminUserAccountView } from "./account-access-types";

type AdminUserAccountsProps = {
  currentUserId: string;
  initialAccounts: AdminUserAccountView[];
};

type AccountAction = "restore" | "suspend";

type SelectedAccountAction = {
  account: AdminUserAccountView;
  action: AccountAction;
};

const idleActionState: ActionState<AdminUserAccountView> = {
  status: "idle",
  message: "",
};

const accountDateFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

export function AdminUserAccounts({
  currentUserId,
  initialAccounts,
}: AdminUserAccountsProps) {
  const [accounts, setAccounts] = React.useState(initialAccounts);
  const [selected, setSelected] = React.useState<SelectedAccountAction | null>(
    null,
  );
  const activeRequest = React.useRef<SelectedAccountAction | null>(null);
  const [pendingRequest, setPendingRequest] =
    React.useState<SelectedAccountAction | null>(null);
  const [feedback, setFeedback] =
    React.useState<ActionState<AdminUserAccountView>>(idleActionState);

  const activeAdminCount = accounts.filter(
    (account) =>
      account.role === "admin" && account.accountStatus === "ACTIVE",
  ).length;

  const openAction = React.useCallback(
    (account: AdminUserAccountView, action: AccountAction) => {
      setFeedback(idleActionState);
      setSelected({ account, action });
    },
    [],
  );

  const handleStarted = React.useCallback((origin: SelectedAccountAction) => {
    if (activeRequest.current !== null) {
      return activeRequest.current === origin;
    }
    activeRequest.current = origin;
    setPendingRequest(origin);
    return true;
  }, []);

  const handleSettled = React.useCallback((origin: SelectedAccountAction) => {
    if (activeRequest.current !== origin) return;
    activeRequest.current = null;
    setPendingRequest(null);
  }, []);

  const handleClose = React.useCallback((origin: SelectedAccountAction) => {
    if (activeRequest.current === origin) return;
    setSelected((current) => (current === origin ? null : current));
  }, []);

  const handleCommitted = React.useCallback(
    (
      origin: SelectedAccountAction,
      account: AdminUserAccountView,
      message: string,
    ) => {
      if (activeRequest.current !== origin) return;
      activeRequest.current = null;
      setPendingRequest(null);
      if (account.id !== origin.account.id) return;

      setAccounts((current) =>
        current.map((item) =>
          item.id === origin.account.id ? account : item,
        ),
      );
      setFeedback({
        status: "success",
        code: "SUCCESS",
        message,
        data: account,
      });
      setSelected((current) => (current === origin ? null : current));
    },
    [],
  );

  const columns = React.useMemo(
    () =>
      getAccountColumns({
        activeAdminCount,
        actionsDisabled: pendingRequest !== null,
        currentUserId,
        openAction,
      }),
    [activeAdminCount, currentUserId, openAction, pendingRequest],
  );

  return (
    <div className="px-4 lg:px-6">
      <Card>
        <CardHeader className="gap-2">
          <CardTitle>User accounts</CardTitle>
          <CardDescription>
            Review identity checks and account access, then suspend or restore
            one account at a time.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 px-3 sm:px-6">
          <div
            aria-live="polite"
            className={
              feedback.status === "success"
                ? "rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100"
                : "sr-only"
            }
          >
            {feedback.message}
          </div>

          <div className="grid gap-3 sm:hidden">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                activeAdminCount={activeAdminCount}
                actionsDisabled={pendingRequest !== null}
                currentUserId={currentUserId}
                onAction={openAction}
              />
            ))}
          </div>

          <div className="hidden sm:block">
            <DataTable
              columns={columns}
              data={accounts}
              filterColumn="displayName"
              filterPlaceholder="Filter accounts..."
            />
          </div>
        </CardContent>
      </Card>

      {selected ? (
        <AccountActionDialog
          key={`${selected.account.id}-${selected.action}`}
          selected={selected}
          requestPending={pendingRequest === selected}
          onCancel={handleClose}
          onCommitted={handleCommitted}
          onSettled={handleSettled}
          onStarted={handleStarted}
        />
      ) : null}
    </div>
  );
}

function AccountCard({
  account,
  activeAdminCount,
  actionsDisabled,
  currentUserId,
  onAction,
}: {
  account: AdminUserAccountView;
  activeAdminCount: number;
  actionsDisabled: boolean;
  currentUserId: string;
  onAction: (account: AdminUserAccountView, action: AccountAction) => void;
}) {
  const blockReason = getSuspendBlockReason(
    account,
    currentUserId,
    activeAdminCount,
  );

  return (
    <article className="grid min-w-0 gap-4 rounded-lg border bg-card p-4 shadow-xs">
      <div className="min-w-0">
        <h2 className="truncate font-semibold">{account.displayName}</h2>
        <p className="truncate text-sm text-muted-foreground">
          {account.email}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-4 text-sm">
        <AccountDetail label="Role">
          <RoleBadge role={account.role} />
        </AccountDetail>
        <AccountDetail label="Area">{account.area}</AccountDetail>
        <AccountDetail label="Verification">
          <VerificationBadge status={account.verificationStatus} />
        </AccountDetail>
        <AccountDetail label="Access">
          <AccessBadge status={account.accountStatus} />
        </AccountDetail>
        <AccountDetail className="col-span-2" label="Last updated">
          <LastUpdated value={account.updatedAt} />
        </AccountDetail>
      </dl>

      <AccountActionControl
        account={account}
        actionsDisabled={actionsDisabled}
        blockReason={blockReason}
        mobile
        onAction={onAction}
      />
    </article>
  );
}

function AccountDetail({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div className={className}>
      <dt className="mb-1 text-xs font-medium text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function AccountActionControl({
  account,
  actionsDisabled,
  blockReason,
  mobile = false,
  onAction,
}: {
  account: AdminUserAccountView;
  actionsDisabled: boolean;
  blockReason: string | null;
  mobile?: boolean;
  onAction: (account: AdminUserAccountView, action: AccountAction) => void;
}) {
  const isSuspended = account.accountStatus === "SUSPENDED";
  const action = isSuspended ? "restore" : "suspend";
  const label = isSuspended ? "Restore account" : "Suspend account";

  return (
    <div className={mobile ? "grid gap-2" : "min-w-40 text-right"}>
      <Button
        type="button"
        variant={isSuspended ? "outline" : "destructive"}
        disabled={actionsDisabled || Boolean(blockReason)}
        className={`min-h-11${mobile ? " w-full" : ""}`}
        onClick={() => onAction(account, action)}
      >
        {label}
      </Button>
      {blockReason ? (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {blockReason}
        </p>
      ) : null}
    </div>
  );
}

function AccountActionDialog({
  onCancel,
  onCommitted,
  onSettled,
  onStarted,
  requestPending,
  selected,
}: {
  onCancel: (origin: SelectedAccountAction) => void;
  onCommitted: (
    origin: SelectedAccountAction,
    account: AdminUserAccountView,
    message: string,
  ) => void;
  onSettled: (origin: SelectedAccountAction) => void;
  onStarted: (origin: SelectedAccountAction) => boolean;
  requestPending: boolean;
  selected: SelectedAccountAction;
}) {
  const serverAction =
    selected.action === "suspend" ? suspendUserAction : restoreUserAction;
  const submitAction = React.useCallback(
    async (
      previous: ActionState<AdminUserAccountView>,
      formData: FormData,
    ): Promise<ActionState<AdminUserAccountView>> => {
      if (!onStarted(selected)) return previous;
      try {
        const result = await serverAction(previous, formData);
        if (result.status === "success") {
          onCommitted(selected, result.data, result.message);
        } else {
          onSettled(selected);
        }
        return result;
      } catch (error) {
        onSettled(selected);
        throw error;
      }
    },
    [onCommitted, onSettled, onStarted, selected, serverAction],
  );
  const [state, formAction, pending] = React.useActionState(
    submitAction,
    idleActionState,
  );
  const isSuspension = selected.action === "suspend";
  const actionLabel = isSuspension ? "Suspend account" : "Restore account";
  const pendingLabel = isSuspension ? "Suspending..." : "Restoring...";
  const reasonLabel = isSuspension ? "Suspension reason" : "Resolution reason";
  const verificationLabel = formatEnumLabel(
    selected.account.verificationStatus,
  ).toLowerCase();

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel(selected)}>
      <Dialog.Portal>
        <Dialog.Overlay data-radix-dialog-overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100svh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-background p-5 text-foreground shadow-2xl outline-none sm:p-6"
          onEscapeKeyDown={(event) => {
            if (pending || requestPending) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (pending || requestPending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (pending || requestPending) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-lg font-semibold">
            {actionLabel.replace(" account", "")} {selected.account.displayName}’s
            account?
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
            {isSuspension
              ? `${selected.account.displayName} will be signed out and unable to sign in until this account is restored.`
              : `${selected.account.displayName} will be able to sign in again.`}{" "}
            Verification stays {verificationLabel}.
          </Dialog.Description>

          <form
            action={formAction}
            className="mt-5 grid gap-4"
            onSubmitCapture={() => onStarted(selected)}
          >
            <input type="hidden" name="userId" value={selected.account.id} />
            <input
              type="hidden"
              name="expectedUpdatedAt"
              value={selected.account.updatedAt}
            />

            <div className="grid gap-2">
              <label
                className="text-sm font-medium"
                htmlFor="account-action-reason"
              >
                {reasonLabel}
              </label>
              <textarea
                id="account-action-reason"
                name="reason"
                required
                minLength={10}
                maxLength={500}
                rows={4}
                aria-invalid={Boolean(state.status === "error" && state.fieldErrors?.reason)}
                aria-describedby="account-action-reason-help account-action-result"
                className="min-h-28 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
                placeholder={
                  isSuspension
                    ? "Explain why access must be suspended"
                    : "Explain why access can be restored"
                }
              />
              <p
                id="account-action-reason-help"
                className="text-xs text-muted-foreground"
              >
                Enter 10–500 characters. This note is saved with the account
                change.
              </p>
            </div>

            <p
              id="account-action-result"
              aria-live="polite"
              className={
                state.status === "error"
                  ? "rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  : "sr-only"
              }
            >
              {state.message}
            </p>

            <div className="grid gap-2 sm:flex sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 sm:order-first"
                disabled={pending}
                onClick={() => onCancel(selected)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant={isSuspension ? "destructive" : "default"}
                className="min-h-11"
                disabled={pending}
              >
                {pending ? pendingLabel : actionLabel}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function getAccountColumns({
  activeAdminCount,
  actionsDisabled,
  currentUserId,
  openAction,
}: {
  activeAdminCount: number;
  actionsDisabled: boolean;
  currentUserId: string;
  openAction: (account: AdminUserAccountView, action: AccountAction) => void;
}): ColumnDef<AdminUserAccountView>[] {
  return [
    {
      accessorKey: "displayName",
      header: "Account",
      cell: ({ row }) => (
        <div className="min-w-48">
          <div className="font-medium">{row.original.displayName}</div>
          <div className="text-sm text-muted-foreground">
            {row.original.email}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => <RoleBadge role={row.original.role} />,
    },
    {
      accessorKey: "verificationStatus",
      header: "Verification",
      cell: ({ row }) => (
        <VerificationBadge status={row.original.verificationStatus} />
      ),
    },
    {
      accessorKey: "accountStatus",
      header: "Access",
      cell: ({ row }) => <AccessBadge status={row.original.accountStatus} />,
    },
    {
      accessorKey: "area",
      header: "Area",
      cell: ({ row }) => <span className="min-w-32">{row.original.area}</span>,
    },
    {
      accessorKey: "updatedAt",
      header: "Last updated",
      cell: ({ row }) => <LastUpdated value={row.original.updatedAt} />,
    },
    {
      id: "actions",
      header: "Action",
      enableHiding: false,
      cell: ({ row }) => (
        <AccountActionControl
          account={row.original}
          actionsDisabled={actionsDisabled}
          blockReason={getSuspendBlockReason(
            row.original,
            currentUserId,
            activeAdminCount,
          )}
          onAction={openAction}
        />
      ),
    },
  ];
}

function LastUpdated({ value }: { value: string }) {
  const date = new Date(value);
  return (
    <time className="whitespace-nowrap text-sm text-muted-foreground" dateTime={value}>
      {Number.isNaN(date.getTime()) ? "Unknown" : accountDateFormatter.format(date)}
    </time>
  );
}

function RoleBadge({ role }: { role: AdminUserAccountView["role"] }) {
  return <Badge variant="secondary">{formatEnumLabel(role)}</Badge>;
}

function VerificationBadge({
  status,
}: {
  status: AdminUserAccountView["verificationStatus"];
}) {
  if (status === "APPROVED") {
    return (
      <Badge variant="outline" className="text-emerald-700 dark:text-emerald-300">
        <CheckCircle2Icon data-icon="inline-start" />
        Approved
      </Badge>
    );
  }

  if (status === "REJECTED") {
    return (
      <Badge variant="destructive">
        <ShieldAlertIcon data-icon="inline-start" />
        Rejected
      </Badge>
    );
  }

  return <Badge variant="secondary">{formatEnumLabel(status)}</Badge>;
}

function AccessBadge({
  status,
}: {
  status: AdminUserAccountView["accountStatus"];
}) {
  if (status === "ACTIVE") {
    return (
      <Badge variant="outline" className="text-emerald-700 dark:text-emerald-300">
        <CheckCircle2Icon data-icon="inline-start" />
        Active
      </Badge>
    );
  }

  return (
    <Badge variant="destructive">
      <ShieldAlertIcon data-icon="inline-start" />
      Suspended
    </Badge>
  );
}

function getSuspendBlockReason(
  account: AdminUserAccountView,
  currentUserId: string,
  activeAdminCount: number,
) {
  if (account.accountStatus === "SUSPENDED") return null;
  if (account.id === currentUserId) {
    return "You cannot suspend your own account.";
  }
  if (account.role === "admin" && activeAdminCount <= 1) {
    return "Keep at least one admin account active.";
  }
  return null;
}

function formatEnumLabel(value: string) {
  const normalized = value.replaceAll("_", " ").toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
