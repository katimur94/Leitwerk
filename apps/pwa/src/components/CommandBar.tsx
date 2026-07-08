import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckSquare,
  Cpu,
  FolderOpen,
  Inbox,
  LogOut,
  Moon,
  Receipt,
  Search,
  Sunrise,
} from "lucide-react";
import { Card, cn } from "@leitwerk/ui";
import { t } from "../i18n/de";
import { supabase } from "../lib/supabase";
import { toggleTheme } from "../lib/theme";

interface Action {
  id: string;
  label: string;
  icon: React.ReactNode;
  run: () => void;
}

/** CommandBar-Skeleton (Cmd/Strg+K) — globale Suche folgt in Phase 4. */
export function CommandBar() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const actions = useMemo<Action[]>(
    () => [
      { id: "today", label: t("nav.today"), icon: <Sunrise size={16} />, run: () => navigate("/") },
      { id: "inbox", label: t("nav.inbox"), icon: <Inbox size={16} />, run: () => navigate("/posteingang") },
      { id: "cases", label: t("nav.cases"), icon: <FolderOpen size={16} />, run: () => navigate("/vorgaenge") },
      { id: "tasks", label: t("nav.tasks"), icon: <CheckSquare size={16} />, run: () => navigate("/aufgaben") },
      { id: "finance", label: t("nav.finance"), icon: <Receipt size={16} />, run: () => navigate("/finanzen") },
      { id: "runner", label: `${t("nav.settings")}: ${t("runner.title")}`, icon: <Cpu size={16} />, run: () => navigate("/einstellungen/runner") },
      { id: "theme", label: "Design wechseln (hell/dunkel)", icon: <Moon size={16} />, run: () => toggleTheme() },
      { id: "logout", label: t("auth.logout"), icon: <LogOut size={16} />, run: () => void supabase.auth.signOut() },
    ],
    [navigate],
  );

  const filtered = actions.filter((a) =>
    a.label.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
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
              if (e.key === "Enter" && filtered[0]) {
                filtered[0].run();
                setOpen(false);
              }
            }}
          />
          <kbd className="rounded border border-lw-border px-1.5 py-0.5 text-[11px] text-lw-ink-faint">
            Esc
          </kbd>
        </div>
        <ul className="max-h-72 overflow-y-auto p-2">
          {filtered.length === 0 ? (
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
                    index === 0 && "bg-lw-surface-2",
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
