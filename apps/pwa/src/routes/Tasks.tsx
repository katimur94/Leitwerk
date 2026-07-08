import { useMemo, useState, type FormEvent } from "react";
import { CheckSquare, ChevronDown, ChevronRight, Clock, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { TaskRow } from "@leitwerk/shared";
import { AiBadge, Badge, Button, Card, EmptyState, Input, SkeletonRows, cn } from "@leitwerk/ui";
import { t } from "../i18n/de";
import { formatDateTime } from "../lib/format";
import { supabase } from "../lib/supabase";
import { useSessionStore } from "../stores/session";
import {
  useSnoozes,
  useTaskChecklist,
  useTaskMutations,
  useTasks,
  type TaskFilter,
} from "../features/tasks/queries";

const FILTERS: Array<{ key: TaskFilter; labelKey: string }> = [
  { key: "open", labelKey: "tasks.filter.open" },
  { key: "done", labelKey: "tasks.filter.done" },
  { key: "all", labelKey: "tasks.filter.all" },
];

const SOURCE_LABELS: Record<string, string> = {
  mail_extract: "aus Mail",
  meeting: "aus Meeting",
  watcher: "vom Wächter",
  automation: "aus Regel",
};

/** automation_runs ohne Outcome für sichtbare KI-Aufgaben (Annahme-UI). */
function usePendingSuggestions(tasks: TaskRow[]) {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const suggested = tasks.filter((task) => task.source === "mail_extract").map((task) => task.id);
  return useQuery({
    queryKey: ["task_suggestions", orgId, suggested.join(",")],
    enabled: !!orgId && suggested.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_runs")
        .select("id, entity_id, outcome")
        .eq("org_id", orgId!)
        .eq("entity_type", "task")
        .in("entity_id", suggested);
      if (error) throw new Error(error.message);
      return new Map(
        (data ?? [])
          .filter((run) => run.outcome === null)
          .map((run) => [run.entity_id as string, run.id as string]),
      );
    },
  });
}

function TaskDetail({ task }: { task: TaskRow }) {
  const checklist = useTaskChecklist(task.id);
  const { addChecklistItem, toggleChecklistItem, updateTask, snoozeTask } = useTaskMutations();
  const [newItem, setNewItem] = useState("");
  const [dueInput, setDueInput] = useState(task.due_at ? task.due_at.slice(0, 10) : "");
  const [recurrenceDays, setRecurrenceDays] = useState(
    String((task.recurrence as { every_days?: number } | null)?.every_days ?? ""),
  );

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-[var(--lw-radius-md)] border border-lw-border bg-lw-surface-2 p-4">
      {task.description ? (
        <p className="text-[13px] text-lw-ink-soft">{task.description}</p>
      ) : null}

      {/* Checkliste */}
      <div>
        <p className="text-[13px] font-medium text-lw-ink">{t("tasks.checklist")}</p>
        {checklist.isPending ? (
          <SkeletonRows rows={2} />
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {(checklist.data ?? []).map((item) => (
              <li key={item.id}>
                <label className="flex items-center gap-2 text-[13px] text-lw-ink">
                  <input
                    type="checkbox"
                    checked={item.is_done}
                    onChange={() => toggleChecklistItem.mutate(item)}
                    className="h-4 w-4 accent-[var(--lw-accent)]"
                  />
                  <span className={cn(item.is_done && "text-lw-ink-faint line-through")}>
                    {item.title}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!newItem.trim()) return;
            addChecklistItem.mutate({
              taskId: task.id,
              title: newItem.trim(),
              position: (checklist.data ?? []).length,
            });
            setNewItem("");
          }}
        >
          <Input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            placeholder={t("tasks.checklistPlaceholder")}
            className="h-8 text-[13px]"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!newItem.trim()}>
            <Plus size={14} />
          </Button>
        </form>
      </div>

      {/* Fälligkeit / Wiederholung / Snooze */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-lw-ink">
          {t("tasks.due")}
          <Input
            type="date"
            value={dueInput}
            onChange={(e) => setDueInput(e.target.value)}
            onBlur={() =>
              updateTask.mutate({
                id: task.id,
                patch: { due_at: dueInput ? `${dueInput}T09:00:00Z` : null },
              })
            }
            className="h-8 w-40 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-lw-ink">
          {t("tasks.recurrence")}
          <Input
            type="number"
            min={0}
            value={recurrenceDays}
            onChange={(e) => setRecurrenceDays(e.target.value)}
            onBlur={() =>
              updateTask.mutate({
                id: task.id,
                patch: {
                  recurrence: Number(recurrenceDays) > 0
                    ? { every_days: Number(recurrenceDays) }
                    : null,
                },
              })
            }
            className="h-8 w-40 text-[13px]"
          />
        </label>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            snoozeTask.mutate({
              taskId: task.id,
              until: new Date(Date.now() + 3 * 86_400_000).toISOString(),
            })
          }
        >
          <Clock size={14} /> {t("tasks.snooze3d")}
        </Button>
      </div>
    </div>
  );
}

export function Tasks() {
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const tasks = useTasks(filter);
  const snoozes = useSnoozes();
  const { createTask, toggleDone, dismissSuggestion } = useTaskMutations();

  const snoozedIds = useMemo(
    () =>
      new Set(
        (snoozes.data ?? [])
          .filter((s) => s.entity_type === "task")
          .map((s) => s.entity_id as string),
      ),
    [snoozes.data],
  );
  const list = (tasks.data ?? []).filter(
    (task) => filter !== "open" || !snoozedIds.has(task.id),
  );
  const suggestions = usePendingSuggestions(tasks.data ?? []);

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    createTask.mutate({ title: newTitle.trim() }, { onSuccess: () => setNewTitle("") });
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-8">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold text-lw-ink">{t("tasks.title")}</h1>
          <p className="mt-1 text-[14px] text-lw-ink-soft">{t("tasks.subtitle")}</p>
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

      <Card className="p-4">
        <form onSubmit={onCreate} className="flex items-center gap-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t("tasks.newPlaceholder")}
            aria-label={t("tasks.newPlaceholder")}
          />
          <Button type="submit" disabled={createTask.isPending || !newTitle.trim()}>
            <Plus size={15} /> {t("tasks.create")}
          </Button>
        </form>
      </Card>

      <Card className="p-0">
        {tasks.isPending ? (
          <div className="p-4">
            <SkeletonRows rows={5} />
          </div>
        ) : tasks.isError ? (
          <div className="flex flex-col items-start gap-2 p-4">
            <p className="text-[13px] text-lw-danger">
              {t("common.error")} ({tasks.error.message})
            </p>
            <Button size="sm" variant="secondary" onClick={() => tasks.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<CheckSquare />}
            title={t("tasks.empty.title")}
            description={t("tasks.empty.description")}
            className="py-12"
          />
        ) : (
          <ul className="divide-y divide-lw-border">
            {list.map((task) => {
              const pendingRun = suggestions.data?.get(task.id);
              const overdue =
                task.due_at && task.status !== "done" && task.due_at < new Date().toISOString();
              return (
                <li key={task.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      aria-label={t("tasks.toggle")}
                      checked={task.status === "done"}
                      onChange={() => toggleDone.mutate(task)}
                      className="h-4 w-4 accent-[var(--lw-accent)]"
                    />
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => setExpanded(expanded === task.id ? null : task.id)}
                    >
                      {expanded === task.id ? (
                        <ChevronDown size={14} className="shrink-0 text-lw-ink-faint" />
                      ) : (
                        <ChevronRight size={14} className="shrink-0 text-lw-ink-faint" />
                      )}
                      <span
                        className={cn(
                          "min-w-0 truncate text-[14px] text-lw-ink",
                          task.status === "done" && "text-lw-ink-faint line-through",
                          task.status === "cancelled" && "text-lw-ink-faint line-through",
                        )}
                      >
                        {task.title}
                      </span>
                    </button>
                    {task.source !== "manual" ? (
                      <AiBadge label={SOURCE_LABELS[task.source] ?? task.source} />
                    ) : null}
                    {task.due_at ? (
                      <Badge tone={overdue ? "danger" : "neutral"}>
                        {formatDateTime(task.due_at).split(",")[0]}
                      </Badge>
                    ) : null}
                    {pendingRun ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => dismissSuggestion.mutate(task)}
                        title={t("tasks.dismissSuggestion")}
                      >
                        {t("tasks.dismiss")}
                      </Button>
                    ) : null}
                  </div>
                  {expanded === task.id ? <TaskDetail task={task} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
