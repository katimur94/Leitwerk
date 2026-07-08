import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckSquare,
  Cpu,
  FileText,
  FolderOpen,
  Inbox,
  LogOut,
  Mail,
  Moon,
  NotebookPen,
  Receipt,
  Search,
  Sparkles,
  Sunrise,
  User,
} from "lucide-react";
import { AiBadge, Card, cn } from "@leitwerk/ui";
import { useCombinedSearch, useSemanticSearchJob } from "../features/knowledge/queries";
import { t } from "../i18n/de";
import { supabase } from "../lib/supabase";
import { toggleTheme } from "../lib/theme";

interface Action {
  id: string;
  label: string;
  icon: React.ReactNode;
  run: () => void;
}

const RESULT_ICONS: Record<string, React.ReactNode> = {
  mail_message: <Mail size={15} />,
  case: <FolderOpen size={15} />,
  contact: <User size={15} />,
  document: <FileText size={15} />,
  note: <NotebookPen size={15} />,
  knowledge_item: <NotebookPen size={15} />,
  meeting_segment: <NotebookPen size={15} />,
};

function resultTarget(entityType: string, entityId: string): string {
  switch (entityType) {
    case "case":
      return `/vorgaenge/${entityId}`;
    case "mail_message":
      return "/posteingang";
    case "note":
    case "knowledge_item":
      return "/notizen";
    case "meeting_segment":
      return "/meetings";
    default:
      return "/";
  }
}

/** CommandBar (Cmd/Strg+K): Navigation + kombinierte Suche (Volltext sofort,
 *  semantisch auf Knopfdruck — Embedding rechnet der Runner lokal). */
export function CommandBar() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [embeddingJobId, setEmbeddingJobId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCombinedSearch(debounced, embeddingJobId);
  const semanticJob = useSemanticSearchJob();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setEmbeddingJobId(null); // neue Eingabe → altes Query-Embedding verwerfen
  }, [debounced]);

  const actions = useMemo<Action[]>(
    () => [
      { id: "today", label: t("nav.today"), icon: <Sunrise size={16} />, run: () => navigate("/") },
      { id: "inbox", label: t("nav.inbox"), icon: <Inbox size={16} />, run: () => navigate("/posteingang") },
      { id: "cases", label: t("nav.cases"), icon: <FolderOpen size={16} />, run: () => navigate("/vorgaenge") },
      { id: "tasks", label: t("nav.tasks"), icon: <CheckSquare size={16} />, run: () => navigate("/aufgaben") },
      { id: "finance", label: t("nav.finance"), icon: <Receipt size={16} />, run: () => navigate("/finanzen") },
      { id: "notes", label: t("nav.notes"), icon: <NotebookPen size={16} />, run: () => navigate("/notizen") },
      { id: "runner", label: `${t("nav.settings")}: ${t("runner.title")}`, icon: <Cpu size={16} />, run: () => navigate("/einstellungen/runner") },
      { id: "theme", label: "Design wechseln (hell/dunkel)", icon: <Moon size={16} />, run: () => toggleTheme() },
      { id: "logout", label: t("auth.logout"), icon: <LogOut size={16} />, run: () => void supabase.auth.signOut() },
    ],
    [navigate],
  );

  const filtered = actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()));
  const results = search.data ?? [];
  const searching = debounced.trim().length >= 2;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
        setEmbeddingJobId(null);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/30 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <Card
        className="h-fit w-full max-w-[560px] overflow-hidden shadow-[var(--lw-shadow-2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-lw-border px-4">
          <Search size={16} className="text-lw-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("commandbar.placeholder")}
            className="h-12 w-full bg-transparent text-[14px] text-lw-ink outline-none placeholder:text-lw-ink-faint"
            onKeyDown={(e) => {
              if (e.key === "Enter" && filtered[0] && !searching) {
                filtered[0].run();
                setOpen(false);
              }
            }}
          />
          <kbd className="rounded border border-lw-border px-1.5 py-0.5 text-[11px] text-lw-ink-faint">
            Esc
          </kbd>
        </div>
        <ul className="max-h-96 overflow-y-auto p-2">
          {searching ? (
            <>
              <li className="flex items-center justify-between px-3 py-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-lw-ink-faint">
                  {t("commandbar.results")}
                </span>
                <button
                  className="flex items-center gap-1 rounded-[var(--lw-radius-sm)] px-2 py-1 text-[12px] hover:bg-lw-surface-2 disabled:opacity-50"
                  style={{ color: "var(--lw-ai)" }}
                  disabled={semanticJob.isPending || !!embeddingJobId}
                  onClick={() =>
                    semanticJob.mutate(debounced, { onSuccess: (jobId) => setEmbeddingJobId(jobId) })
                  }
                >
                  <Sparkles size={13} />
                  {embeddingJobId
                    ? t("commandbar.semanticActive")
                    : semanticJob.isPending
                      ? t("commandbar.semanticRunning")
                      : t("commandbar.semantic")}
                </button>
              </li>
              {semanticJob.isError ? (
                <li className="px-3 py-1 text-[12px] text-lw-danger">{semanticJob.error.message}</li>
              ) : null}
              {search.isPending ? (
                <li className="px-3 py-4 text-center text-[13px] text-lw-ink-faint">
                  {t("common.loading")}
                </li>
              ) : search.isError ? (
                <li className="px-3 py-2 text-[13px] text-lw-danger">{search.error.message}</li>
              ) : results.length === 0 ? (
                <li className="px-3 py-4 text-center text-[13px] text-lw-ink-faint">
                  {t("commandbar.noResults")}
                </li>
              ) : (
                results.map((r) => (
                  <li key={`${r.entity_type}:${r.entity_id}:${r.via}`}>
                    <button
                      className="flex w-full items-center gap-3 rounded-[var(--lw-radius-sm)] px-3 py-2 text-left text-[13px] text-lw-ink hover:bg-lw-surface-2"
                      onClick={() => {
                        navigate(resultTarget(r.entity_type, r.entity_id));
                        setOpen(false);
                      }}
                    >
                      <span className="text-lw-ink-faint">
                        {RESULT_ICONS[r.entity_type] ?? <Search size={15} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{r.title}</span>
                        {r.snippet ? (
                          <span className="block truncate text-[11px] text-lw-ink-faint">
                            {r.snippet}
                          </span>
                        ) : null}
                      </span>
                      {r.via === "semantisch" ? <AiBadge label={t("commandbar.semanticBadge")} /> : null}
                    </button>
                  </li>
                ))
              )}
              <li className="mt-1 border-t border-lw-border pt-1">
                <span className="px-3 text-[11px] font-medium uppercase tracking-wide text-lw-ink-faint">
                  {t("commandbar.actions")}
                </span>
              </li>
            </>
          ) : null}
          {filtered.length === 0 && !searching ? (
            <li className="px-3 py-6 text-center text-[13px] text-lw-ink-faint">
              {t("commandbar.empty")}
            </li>
          ) : (
            filtered.map((action, index) => (
              <li key={action.id}>
                <button
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[var(--lw-radius-sm)] px-3 py-2 text-left text-[14px] text-lw-ink",
                    "hover:bg-lw-surface-2",
                    index === 0 && !searching && "bg-lw-surface-2",
                  )}
                  onClick={() => {
                    action.run();
                    setOpen(false);
                  }}
                >
                  <span className="text-lw-ink-faint">{action.icon}</span>
                  {action.label}
                </button>
              </li>
            ))
          )}
        </ul>
      </Card>
    </div>
  );
}
