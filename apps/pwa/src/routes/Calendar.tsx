import { CalendarClock, Download, FolderOpen, Repeat } from "lucide-react";
import { Link } from "react-router-dom";
import { AiBadge, Badge, Button, Card, EmptyState, SkeletonRows } from "@leitwerk/ui";
import {
  useCalendarEvents,
  useExportOrg,
  useRecurringTasks,
} from "../features/team/queries";
import { t } from "../i18n/de";
import { formatDateTime } from "../lib/format";

function EventList() {
  const events = useCalendarEvents();
  if (events.isPending) return <SkeletonRows rows={4} />;
  if (events.isError) {
    return (
      <p className="text-[13px] text-lw-danger">
        {t("common.error")} ({events.error.message})
      </p>
    );
  }
  if ((events.data ?? []).length === 0) {
    return (
      <EmptyState
        icon={<CalendarClock />}
        title={t("calendar.empty.title")}
        description={t("calendar.empty.description")}
        className="py-10"
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {(events.data ?? []).map((event) => (
        <Card key={event.id} className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-lw-ink">{event.title}</p>
              <p className="text-[12px] text-lw-ink-faint">
                {formatDateTime(event.starts_at)}
                {event.location ? ` · ${event.location}` : ""}
                {event.attendees.length > 0
                  ? ` · ${event.attendees.map((a) => a.email).join(", ")}`
                  : ""}
              </p>
            </div>
            {event.case_id ? (
              <Link
                to={`/vorgaenge/${event.case_id}`}
                className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium"
                style={{ color: "var(--lw-accent)" }}
              >
                <FolderOpen size={13} /> {t("calendar.openCase")}
              </Link>
            ) : null}
          </div>
          {event.ai_briefing ? (
            <div
              className="mt-2 rounded-[var(--lw-radius-sm)] px-2.5 py-2 text-[13px] text-lw-ink-soft"
              style={{ backgroundColor: "color-mix(in srgb, var(--lw-ai) 8%, transparent)" }}
            >
              <AiBadge label={t("calendar.briefingBadge")} className="mr-1.5" />
              <span className="whitespace-pre-wrap">{event.ai_briefing}</span>
            </div>
          ) : null}
        </Card>
      ))}
    </ul>
  );
}

function DeadlineList() {
  const tasks = useRecurringTasks();
  if (tasks.isPending) return <SkeletonRows rows={2} />;
  if ((tasks.data ?? []).length === 0) {
    return (
      <EmptyState
        icon={<Repeat />}
        title={t("deadlines.empty.title")}
        description={t("deadlines.empty.description")}
        className="py-8"
      />
    );
  }
  return (
    <ul className="divide-y divide-lw-border">
      {(tasks.data ?? []).map((task) => {
        const every = (task.recurrence as { every_days?: number } | null)?.every_days;
        return (
          <li key={task.id} className="flex items-center gap-3 py-2">
            <Repeat size={14} className="text-lw-ink-faint" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-lw-ink">{task.title}</span>
            {every ? <Badge tone="neutral">{t("deadlines.every").replace("{n}", String(every))}</Badge> : null}
            <span className="text-[12px] text-lw-ink-faint">
              {task.due_at ? formatDateTime(task.due_at) : "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Kalender, Fristenkalender und Datenexport (Etappe 5). */
export function Calendar() {
  const exportOrg = useExportOrg();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-8">
      <header>
        <h1 className="text-[24px] font-semibold text-lw-ink">{t("calendar.title")}</h1>
        <p className="mt-1 text-[14px] text-lw-ink-soft">{t("calendar.subtitle")}</p>
      </header>

      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-lw-ink-faint">
          {t("calendar.upcoming")}
        </h2>
        <EventList />
      </section>

      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-lw-ink-faint">
          {t("deadlines.title")}
        </h2>
        <Card className="p-4">
          <DeadlineList />
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-lw-ink-faint">
          {t("export.title")}
        </h2>
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <p className="min-w-0 flex-1 text-[13px] text-lw-ink-soft">{t("export.description")}</p>
          <Button
            size="sm"
            disabled={exportOrg.isPending}
            onClick={() =>
              exportOrg.mutate(undefined, {
                onSuccess: (data) => {
                  if (data.signedUrl) window.open(data.signedUrl, "_blank");
                },
              })
            }
          >
            <Download size={14} /> {exportOrg.isPending ? t("export.running") : t("export.button")}
          </Button>
          {exportOrg.isSuccess ? (
            <span className="text-[12px]" style={{ color: "var(--lw-success)" }}>
              {t("export.done")}
            </span>
          ) : null}
          {exportOrg.isError ? (
            <span className="text-[12px] text-lw-danger">{exportOrg.error.message}</span>
          ) : null}
        </Card>
      </section>
    </div>
  );
}
