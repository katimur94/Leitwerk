import { useEffect, useRef, useState } from "react";
import { Bell, BellRing, X } from "lucide-react";
import { Button, cn } from "@leitwerk/ui";
import { t } from "../../i18n/de";
import { formatAgo } from "../../lib/format";
import {
  getPushState,
  useMarkNotificationsRead,
  useNotifications,
  useSubscribePush,
} from "./queries";

/**
 * Notification-Center (Etappe 2): Glocke in der Icon-Rail mit Ungelesen-Punkt,
 * Panel mit den letzten Benachrichtigungen + Web-Push-Abo (VAPID).
 */
export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const subscribe = useSubscribePush();
  const [pushOn, setPushOn] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const unread = (notifications.data ?? []).filter((n) => !n.read_at);

  // Beim Öffnen alles als gelesen markieren (Undo-frei, rein informativ)
  useEffect(() => {
    if (open && unread.length > 0) {
      markRead.mutate(unread.map((n) => n.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (open && panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const pushState = getPushState();

  return (
    <div className="relative">
      <button
        title={t("notifications.title")}
        aria-label={t("notifications.title")}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-[var(--lw-radius-md)] text-lw-ink-faint transition-colors duration-150 hover:bg-lw-surface-2 hover:text-lw-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lw-accent"
      >
        <Bell size={20} strokeWidth={1.75} />
        {unread.length > 0 ? (
          <span
            aria-hidden
            className="absolute right-2 top-2 h-2 w-2 rounded-full"
            style={{ backgroundColor: "var(--lw-accent)" }}
          />
        ) : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          className="absolute bottom-0 left-12 z-40 w-[340px] rounded-[var(--lw-radius-lg)] border border-lw-border bg-lw-surface p-3 shadow-[var(--lw-shadow-2)]"
        >
          <div className="flex items-center justify-between px-1">
            <p className="text-[14px] font-semibold text-lw-ink">
              {t("notifications.title")}
            </p>
            <button
              aria-label={t("composer.close")}
              className="text-lw-ink-faint hover:text-lw-ink"
              onClick={() => setOpen(false)}
            >
              <X size={15} />
            </button>
          </div>

          {/* Web-Push-Abo */}
          {pushState !== "unsupported" && !pushOn ? (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-[var(--lw-radius-md)] bg-lw-surface-2 px-3 py-2">
              <span className="text-[12px] text-lw-ink-soft">
                {pushState === "denied"
                  ? t("notifications.pushDenied")
                  : t("notifications.pushHint")}
              </span>
              {pushState !== "denied" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={subscribe.isPending}
                  onClick={() =>
                    subscribe.mutate(undefined, {
                      onSuccess: (state) => setPushOn(state === "on"),
                    })
                  }
                >
                  <BellRing size={13} /> {t("notifications.pushEnable")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {subscribe.isError ? (
            <p className="mt-1 px-1 text-[12px] text-lw-danger">{subscribe.error.message}</p>
          ) : null}

          <div className="mt-2 max-h-[360px] overflow-y-auto">
            {notifications.isPending ? (
              <p className="px-1 py-4 text-[13px] text-lw-ink-faint">{t("common.loading")}</p>
            ) : notifications.isError ? (
              <p className="px-1 py-4 text-[13px] text-lw-danger">
                {t("common.error")} ({notifications.error.message})
              </p>
            ) : (notifications.data ?? []).length === 0 ? (
              <p className="px-1 py-6 text-center text-[13px] text-lw-ink-faint">
                {t("notifications.empty")}
              </p>
            ) : (
              <ul className="divide-y divide-lw-border">
                {(notifications.data ?? []).map((n) => (
                  <li key={n.id} className={cn("px-1 py-2", !n.read_at && "bg-lw-surface-2")}>
                    <p className="text-[13px] font-medium text-lw-ink">{n.title}</p>
                    {n.body ? <p className="text-[12px] text-lw-ink-soft">{n.body}</p> : null}
                    <p className="mt-0.5 text-[11px] text-lw-ink-faint">
                      {formatAgo(n.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
