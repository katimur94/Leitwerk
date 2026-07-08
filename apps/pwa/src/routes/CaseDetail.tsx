import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  FolderOpen,
  Mail,
  MailPlus,
  StickyNote,
} from "lucide-react";
import type { CaseEventRow } from "@leitwerk/shared";
import {
  AiBadge,
  Badge,
  Button,
  Card,
  CaseTimeline,
  EmptyState,
  SkeletonRows,
} from "@leitwerk/ui";
import {
  useCase,
  useCaseEvents,
  useCaseThreads,
  useUpdateCase,
} from "../features/cases/queries";
import { t } from "../i18n/de";
import { formatAgo, formatDateTime } from "../lib/format";

const EVENT_ICONS: Record<string, JSX.Element> = {
  mail_in: <Mail />,
  mail_out: <MailPlus />,
  mail_linked: <Mail />,
  note_added: <StickyNote />,
  status_changed: <CheckCircle2 />,
  created: <FolderOpen />,
};

function timelineItem(event: CaseEventRow) {
  return {
    id: event.id,
    title: event.title,
    meta: formatDateTime(event.occurred_at),
    icon: EVENT_ICONS[event.event_type] ?? <FolderOpen />,
    aiOrigin: event.actor_type === "runner",
  };
}

const STATUS_ORDER: Array<{ value: "open" | "waiting" | "done" | "archived"; labelKey: string }> = [
  { value: "open", labelKey: "cases.status.open" },
  { value: "waiting", labelKey: "cases.status.waiting" },
  { value: "done", labelKey: "cases.status.done" },
  { value: "archived", labelKey: "cases.status.archived" },
];

export function CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const caseQuery = useCase(caseId);
  const events = useCaseEvents(caseId);
  const threads = useCaseThreads(caseId);
  const updateCase = useUpdateCase();

  if (caseQuery.isPending) {
    return (
      <div className="mx-auto max-w-4xl p-8">
        <SkeletonRows rows={6} />
      </div>
    );
  }
  if (caseQuery.isError) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-3 p-8">
        <p className="text-[13px] text-lw-danger">
          {t("common.error")} ({caseQuery.error.message})
        </p>
        <Button size="sm" variant="secondary" onClick={() => caseQuery.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }
  const c = caseQuery.data;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-8">
      <div>
        <Link
          to="/vorgaenge"
          className="inline-flex items-center gap-1 text-[13px] text-lw-ink-soft hover:text-lw-ink"
        >
          <ArrowLeft size={14} /> {t("cases.back")}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="font-mono text-[13px] text-lw-ink-faint">{c.case_number}</span>
          <h1 className="min-w-0 flex-1 truncate text-[24px] font-semibold text-lw-ink">
            {c.title}
          </h1>
          {c.source === "ai_auto" ? <AiBadge label={t("cases.aiCreated")} /> : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {STATUS_ORDER.map((status) => (
            <Button
              key={status.value}
              size="sm"
              variant={c.status === status.value ? "primary" : "secondary"}
              disabled={updateCase.isPending}
              onClick={() =>
                updateCase.mutate({ caseId: c.id, patch: { status: status.value } })
              }
            >
              {t(status.labelKey)}
            </Button>
          ))}
          {c.companies?.name ? <Badge tone="neutral">{c.companies.name}</Badge> : null}
        </div>
        {updateCase.isError ? (
          <p className="mt-2 text-[12px] text-lw-danger">{updateCase.error.message}</p>
        ) : null}
      </div>

      {c.ai_summary ? (
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <AiBadge label={t("cases.summaryBadge")} />
            <span className="text-[11px] text-lw-ink-faint">
              {c.ai_summary_at ? formatAgo(c.ai_summary_at) : ""}
            </span>
          </div>
          <p className="mt-2 text-[14px] leading-relaxed text-lw-ink">{c.ai_summary}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Timeline */}
        <Card className="p-5">
          <h3 className="text-[16px] font-semibold text-lw-ink">{t("cases.timeline")}</h3>
          <div className="mt-4">
            {events.isPending ? (
              <SkeletonRows rows={4} />
            ) : events.isError ? (
              <p className="text-[13px] text-lw-danger">
                {t("common.error")} ({events.error.message})
              </p>
            ) : (events.data ?? []).length === 0 ? (
              <EmptyState title={t("cases.timelineEmpty")} className="py-8" />
            ) : (
              <CaseTimeline items={(events.data ?? []).map(timelineItem)} />
            )}
          </div>
        </Card>

        {/* Verknüpfte Mail-Threads */}
        <Card className="p-5">
          <h3 className="text-[16px] font-semibold text-lw-ink">{t("cases.threads")}</h3>
          <div className="mt-4">
            {threads.isPending ? (
              <SkeletonRows rows={3} />
            ) : threads.isError ? (
              <p className="text-[13px] text-lw-danger">
                {t("common.error")} ({threads.error.message})
              </p>
            ) : (threads.data ?? []).length === 0 ? (
              <EmptyState
                icon={<Mail />}
                title={t("cases.threadsEmpty")}
                description={t("cases.threadsEmptyHint")}
                className="py-8"
              />
            ) : (
              <ul className="divide-y divide-lw-border">
                {(threads.data ?? []).map((thread) => (
                  <li key={thread.id} className="py-2">
                    <p className="truncate text-[14px] font-medium text-lw-ink">
                      {thread.subject || "(kein Betreff)"}
                    </p>
                    <p className="text-[12px] text-lw-ink-faint">
                      {thread.message_count} Nachricht(en) · {formatAgo(thread.last_message_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
