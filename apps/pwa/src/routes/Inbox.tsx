import { useCallback, useEffect, useMemo, useState } from "react";
import { Inbox as InboxIcon, PenSquare, Search } from "lucide-react";
import { Button, EmptyState, Input, SkeletonRows, cn } from "@leitwerk/ui";
import { Composer } from "../features/mail/Composer";
import { InboxRow } from "../features/mail/InboxRow";
import { ThreadView } from "../features/mail/ThreadView";
import {
  useMailAccounts,
  useMailThreads,
  useThreadMutations,
  type InboxFilter,
} from "../features/mail/queries";
import { isRunnerOnline, useRunners } from "../features/runner/queries";
import { t } from "../i18n/de";

const FILTERS: Array<{ key: InboxFilter; labelKey: string }> = [
  { key: "inbox", labelKey: "inbox.filter.inbox" },
  { key: "archived", labelKey: "inbox.filter.archived" },
  { key: "all", labelKey: "inbox.filter.all" },
];

export function Inbox() {
  const [filter, setFilter] = useState<InboxFilter>("inbox");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composeNew, setComposeNew] = useState(false);

  const accounts = useMailAccounts();
  const threads = useMailThreads(filter, search);
  const runners = useRunners();
  const { setUnread, setArchived } = useThreadMutations();

  const list = useMemo(() => threads.data ?? [], [threads.data]);
  const selected = list.find((t) => t.id === selectedId) ?? null;
  const selectedAccount = (accounts.data ?? []).find(
    (a) => a.id === selected?.account_id,
  );
  const anyRunnerOnline = (runners.data ?? []).some(isRunnerOnline);
  const hasAccount = (accounts.data ?? []).length > 0;

  // Beim Öffnen als gelesen markieren
  const openThread = useCallback(
    (threadId: string) => {
      setSelectedId(threadId);
      setComposeNew(false);
      const thread = list.find((t) => t.id === threadId);
      if (thread?.is_unread) {
        setUnread.mutate({ threadId, unread: false });
      }
    },
    [list, setUnread],
  );

  // Tastatur: j/k Navigation, e = archivieren (DESIGN.md Interaktion)
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (target.isContentEditable) return;
      const index = list.findIndex((t) => t.id === selectedId);
      if (event.key === "j" && list.length > 0) {
        const next = list[Math.min(index + 1, list.length - 1)];
        if (next) openThread(next.id);
      } else if (event.key === "k" && list.length > 0) {
        const prev = list[Math.max(index - 1, 0)];
        if (prev) openThread(prev.id);
      } else if (event.key === "e" && selectedId) {
        setArchived.mutate({ threadId: selectedId, archived: true });
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, selectedId, openThread, setArchived]);

  return (
    <div className="flex h-full min-w-0">
      {/* Thread-Liste */}
      <section className="flex w-[380px] shrink-0 flex-col border-r border-lw-border">
        <div className="flex flex-col gap-2 border-b border-lw-border p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-lw-ink-faint"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("inbox.searchPlaceholder")}
                className="pl-8"
                aria-label={t("inbox.searchPlaceholder")}
              />
            </div>
            <Button
              size="sm"
              title={t("inbox.compose")}
              onClick={() => {
                setComposeNew(true);
                setSelectedId(null);
              }}
            >
              <PenSquare size={14} />
            </Button>
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
        </div>

        {/* Runner-offline: dezenter Hinweis nur für KI-Funktionen */}
        {runners.isSuccess && !anyRunnerOnline && hasAccount ? (
          <p className="border-b border-lw-border px-3 py-2 text-[12px]" style={{ color: "var(--lw-warning)" }}>
            {t("inbox.runnerOffline")}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {threads.isPending || accounts.isPending ? (
            <div className="p-3">
              <SkeletonRows rows={6} />
            </div>
          ) : threads.isError ? (
            <div className="flex flex-col items-start gap-2 p-4">
              <p className="text-[13px] text-lw-danger">
                {t("common.error")} ({threads.error.message})
              </p>
              <Button size="sm" variant="secondary" onClick={() => threads.refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          ) : !hasAccount ? (
            <EmptyState
              icon={<InboxIcon />}
              title={t("inbox.noAccount.title")}
              description={t("inbox.noAccount.description")}
              action={
                <Button size="sm" onClick={() => (window.location.href = "/einstellungen/postfaecher")}>
                  {t("inbox.noAccount.cta")}
                </Button>
              }
              className="py-12"
            />
          ) : list.length === 0 ? (
            <EmptyState
              icon={<InboxIcon />}
              title={search ? t("inbox.noResults.title") : t("inbox.empty.title")}
              description={search ? t("inbox.noResults.description") : t("inbox.empty.description")}
              className="py-12"
            />
          ) : (
            <ul className="divide-y divide-lw-border">
              {list.map((thread) => (
                <li key={thread.id}>
                  <InboxRow
                    thread={thread}
                    selected={thread.id === selectedId}
                    onClick={() => openThread(thread.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Detail */}
      <section className="min-w-0 flex-1">
        {composeNew && accounts.data?.[0] ? (
          <div className="mx-auto max-w-[720px] p-6">
            <Composer
              accountId={accounts.data[0].id}
              threadId={null}
              signatureHtml={accounts.data[0].signature_html}
              onClose={() => setComposeNew(false)}
            />
          </div>
        ) : selected ? (
          <ThreadView thread={selected} account={selectedAccount} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<InboxIcon />}
              title={t("inbox.select.title")}
              description={t("inbox.select.description")}
            />
          </div>
        )}
      </section>
    </div>
  );
}
