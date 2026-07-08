import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { FolderOpen, Plus } from "lucide-react";
import { AiBadge, Badge, Button, Card, EmptyState, Input, SkeletonRows, cn } from "@leitwerk/ui";
import { useCases, useCreateCase, type CaseFilter } from "../features/cases/queries";
import { t } from "../i18n/de";
import { formatAgo } from "../lib/format";

const STATUS_META: Record<string, { label: string; tone: "success" | "neutral" | "warning" }> = {
  open: { label: "Offen", tone: "success" },
  waiting: { label: "Wartet", tone: "warning" },
  done: { label: "Erledigt", tone: "neutral" },
  archived: { label: "Archiviert", tone: "neutral" },
};

const FILTERS: Array<{ key: CaseFilter; labelKey: string }> = [
  { key: "active", labelKey: "cases.filter.active" },
  { key: "done", labelKey: "cases.filter.done" },
  { key: "all", labelKey: "cases.filter.all" },
];

export function CasesList() {
  const [filter, setFilter] = useState<CaseFilter>("active");
  const [newTitle, setNewTitle] = useState("");
  const cases = useCases(filter);
  const createCase = useCreateCase();

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    createCase.mutate(newTitle.trim(), { onSuccess: () => setNewTitle("") });
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-8">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold text-lw-ink">{t("cases.title")}</h1>
          <p className="mt-1 text-[14px] text-lw-ink-soft">{t("cases.subtitle")}</p>
        </div>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
                filter === f.key
                  ? "bg-lw-surface-2 text-lw-ink"
                  : "text-lw-ink-faint hover:text-lw-ink-soft",
              )}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      </header>

      <Card className="p-0">
        {cases.isPending ? (
          <div className="p-4">
            <SkeletonRows rows={4} />
          </div>
        ) : cases.isError ? (
          <div className="flex flex-col items-start gap-2 p-4">
            <p className="text-[13px] text-lw-danger">
              {t("common.error")} ({cases.error.message})
            </p>
            <Button size="sm" variant="secondary" onClick={() => cases.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : (cases.data ?? []).length === 0 ? (
          <EmptyState
            icon={<FolderOpen />}
            title={t("cases.empty.title")}
            description={t("cases.empty.description")}
            className="py-12"
          />
        ) : (
          <ul className="divide-y divide-lw-border">
            {(cases.data ?? []).map((c) => {
              const status = STATUS_META[c.status] ?? { label: c.status, tone: "neutral" as const };
              return (
                <li key={c.id}>
                  <Link
                    to={`/vorgaenge/${c.id}`}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-lw-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lw-accent"
                  >
                    <span className="w-[100px] shrink-0 font-mono text-[12px] text-lw-ink-faint">
                      {c.case_number}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-lw-ink">
                      {c.title}
                    </span>
                    {c.source === "ai_auto" ? <AiBadge label={t("cases.aiCreated")} /> : null}
                    {c.companies?.name ? (
                      <span className="hidden max-w-[160px] truncate text-[12px] text-lw-ink-soft sm:block">
                        {c.companies.name}
                      </span>
                    ) : null}
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <span className="w-[70px] shrink-0 text-right text-[11px] tabular-nums text-lw-ink-faint">
                      {formatAgo(c.last_activity_at)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <form onSubmit={onCreate} className="flex items-center gap-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t("cases.newPlaceholder")}
            aria-label={t("cases.newPlaceholder")}
          />
          <Button type="submit" disabled={createCase.isPending || !newTitle.trim()}>
            <Plus size={15} /> {t("cases.create")}
          </Button>
        </form>
        {createCase.isError ? (
          <p className="mt-2 text-[12px] text-lw-danger">{createCase.error.message}</p>
        ) : null}
      </Card>
    </div>
  );
}
