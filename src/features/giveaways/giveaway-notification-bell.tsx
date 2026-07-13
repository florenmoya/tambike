"use client";

import { Bell, LoaderCircle, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { GiveawayNotification } from "@/features/giveaways/types";
import { listGiveawayNotificationsAction } from "@/server/giveaway-actions";

import { formatGiveawayMoment, safeGiveawayNotificationHref } from "./giveaway-surface-state";

type GiveawayNotificationBellProps = {
  recipientId?: string;
};

type NotificationLoadState = "loading" | "ready" | "error";

type NotificationLoadResult = {
  recipientId: string;
  state: Exclude<NotificationLoadState, "loading">;
  notifications: GiveawayNotification[];
};

export function GiveawayNotificationBell({ recipientId }: GiveawayNotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [result, setResult] = useState<NotificationLoadResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!recipientId) {
      return () => {
        cancelled = true;
      };
    }

    void listGiveawayNotificationsAction()
      .then((nextResult) => {
        if (cancelled) return;
        setResult({
          recipientId,
          notifications: nextResult.ok ? nextResult.data : [],
          state: nextResult.ok ? "ready" : "error",
        });
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ recipientId, notifications: [], state: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [recipientId]);

  const loadState: NotificationLoadState =
    recipientId && result?.recipientId === recipientId ? result.state : "loading";
  const notifications = recipientId && result?.recipientId === recipientId ? result.notifications : [];

  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  if (!recipientId) {
    return null;
  }

  const buttonLabel =
    unreadCount > 0
      ? `Giveaway notifications, ${unreadCount} unread`
      : "Giveaway notifications";

  return (
    <div className="relative shrink-0">
      <button
        className="relative grid size-[30px] place-items-center rounded-full border border-white/15 bg-white/[0.09] text-white backdrop-blur-md transition hover:border-[#ffbe45]/50 hover:bg-[#ffbe45]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffbe45]"
        type="button"
        aria-label={buttonLabel}
        aria-controls="giveaway-notification-inbox"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => setIsOpen((open) => !open)}
      >
        <Bell className="size-4" aria-hidden="true" />
        {unreadCount > 0 ? (
          <span
            className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-[#e63b2e] px-1 text-[9px] font-black leading-4 text-white shadow-[0_2px_6px_rgba(0,0,0,0.36)]"
            aria-hidden="true"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <section
          id="giveaway-notification-inbox"
          className="absolute right-0 top-[calc(100%+0.75rem)] z-[70] grid w-[min(23rem,calc(100vw-2rem))] gap-3 rounded-xl border border-white/15 bg-[#101113]/[0.98] p-3 text-[#fff8eb] shadow-[0_24px_64px_rgba(0,0,0,0.48)] backdrop-blur-xl"
          role="dialog"
          aria-label="Giveaway notifications"
        >
          <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
            <div>
              <span className="text-[10px] font-black uppercase tracking-[0.13em] text-[#ffbe45]">
                Rider inbox
              </span>
              <h2 className="m-0 mt-1 text-base font-extrabold text-white">Giveaway updates</h2>
            </div>
            <button
              className="grid size-7 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffbe45]"
              type="button"
              aria-label="Close giveaway notifications"
              onClick={() => setIsOpen(false)}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {loadState === "loading" ? (
            <div className="flex items-center gap-2 py-3 text-sm text-white/70" role="status">
              <LoaderCircle className="size-4 animate-spin text-[#ffbe45]" aria-hidden="true" />
              Loading your updates…
            </div>
          ) : null}

          {loadState === "error" ? (
            <p className="py-3 text-sm text-white/70" role="status">
              Your giveaway updates are unavailable right now. Please try again shortly.
            </p>
          ) : null}

          {loadState === "ready" && notifications.length === 0 ? (
            <p className="py-3 text-sm text-white/70">No giveaway updates yet.</p>
          ) : null}

          {loadState === "ready" && notifications.length > 0 ? (
            <ul className="grid max-h-[min(28rem,60vh)] list-none gap-2 overflow-y-auto p-0 pr-1">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onNavigate={() => setIsOpen(false)}
                />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function NotificationItem({
  notification,
  onNavigate,
}: {
  notification: GiveawayNotification;
  onNavigate: () => void;
}) {
  const href = safeGiveawayNotificationHref(notification.href);
  const time = formatGiveawayMoment(notification.createdAt);
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <strong className="text-sm font-bold text-white">{notification.title}</strong>
        {!notification.readAt ? (
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#ffbe45]" aria-label="Unread" />
        ) : null}
      </div>
      <p className="mt-1 text-sm leading-5 text-white/70">{notification.body}</p>
      {time ? <span className="mt-2 block text-[10px] font-bold uppercase tracking-[0.08em] text-white/45">{time}</span> : null}
    </>
  );

  const className = "block rounded-lg border border-white/10 bg-white/[0.035] p-3 transition hover:border-[#ffbe45]/35 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffbe45]";

  return (
    <li>
      {href ? (
        <Link className={className} href={href} onClick={onNavigate}>
          {content}
        </Link>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  );
}
