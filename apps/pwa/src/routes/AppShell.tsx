import {
  CheckSquare,
  Cpu,
  FolderOpen,
  Gauge,
  Inbox,
  ListChecks,
  LogOut,
  Mail,
  Moon,
  Receipt,
  Settings,
  Sunrise,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { cn } from "@leitwerk/ui";
import { CommandBar } from "../components/CommandBar";
import { OfflineBanner } from "../components/OfflineBanner";
import { NotificationCenter } from "../features/notifications/NotificationCenter";
import { t } from "../i18n/de";
import { supabase } from "../lib/supabase";
import { toggleTheme } from "../lib/theme";
import { useSessionStore } from "../stores/session";

const railItems = [
  { to: "/", end: true, icon: Sunrise, labelKey: "nav.today" },
  { to: "/posteingang", end: false, icon: Inbox, labelKey: "nav.inbox" },
  { to: "/vorgaenge", end: false, icon: FolderOpen, labelKey: "nav.cases" },
  { to: "/aufgaben", end: false, icon: CheckSquare, labelKey: "nav.tasks" },
  { to: "/finanzen", end: false, icon: Receipt, labelKey: "nav.finance" },
] as const;

function RailLink({
  to,
  end,
  icon: Icon,
  label,
}: {
  to: string;
  end: boolean;
  icon: typeof Sunrise;
  label: string;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      aria-label={label}
      className={({ isActive }) =>
        cn(
          "flex h-10 w-10 items-center justify-center rounded-[var(--lw-radius-md)] transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lw-accent",
          isActive
            ? "bg-lw-surface-2 text-lw-ink"
            : "text-lw-ink-faint hover:bg-lw-surface-2 hover:text-lw-ink-soft",
        )
      }
    >
      <Icon size={20} strokeWidth={1.75} />
    </NavLink>
  );
}

export function AppShell() {
  const activeOrg = useSessionStore((s) => s.activeOrg);
  const profile = useSessionStore((s) => s.profile);
  const location = useLocation();
  const inSettings = location.pathname.startsWith("/einstellungen");

  return (
    <div className="flex h-full flex-col">
      <OfflineBanner />
      <div className="flex min-h-0 flex-1">
        {/* Icon-Rail (56px, DESIGN.md Layout) */}
        <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-lw-border bg-lw-surface py-3">
          <img src="/logo.svg" alt="Leitwerk" className="mb-2 h-8 w-8 rounded-[8px]" />
          {railItems.map((item) => (
            <RailLink
              key={item.to}
              to={item.to}
              end={item.end}
              icon={item.icon}
              label={t(item.labelKey)}
            />
          ))}
          <div className="mt-auto flex flex-col items-center gap-1">
            <NotificationCenter />
            <RailLink
              to="/einstellungen/runner"
              end={false}
              icon={Settings}
              label={t("nav.settings")}
            />
            <button
              title="Design wechseln"
              aria-label="Design wechseln"
              onClick={() => toggleTheme()}
              className="flex h-10 w-10 items-center justify-center rounded-[var(--lw-radius-md)] text-lw-ink-faint transition-colors duration-150 hover:bg-lw-surface-2 hover:text-lw-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lw-accent"
            >
              <Moon size={20} strokeWidth={1.75} />
            </button>
            <button
              title={t("auth.logout")}
              aria-label={t("auth.logout")}
              onClick={() => void supabase.auth.signOut()}
              className="flex h-10 w-10 items-center justify-center rounded-[var(--lw-radius-md)] text-lw-ink-faint transition-colors duration-150 hover:bg-lw-surface-2 hover:text-lw-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lw-accent"
            >
              <LogOut size={20} strokeWidth={1.75} />
            </button>
          </div>
        </nav>

        {/* Kontext-Sidebar */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-lw-border bg-lw-surface-2 p-4 md:flex">
          <p className="truncate text-[13px] font-semibold text-lw-ink">
            {activeOrg?.name ?? "—"}
          </p>
          <p className="truncate text-[12px] text-lw-ink-faint">
            {profile?.display_name ?? ""}
          </p>
          <div className="mt-6 flex flex-col gap-0.5">
            {inSettings ? (
              <>
                <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-lw-ink-faint">
                  {t("nav.settings")}
                </p>
                <NavLink
                  to="/einstellungen/runner"
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-[var(--lw-radius-sm)] px-2 py-1.5 text-[13px]",
                      isActive
                        ? "bg-lw-surface font-medium text-lw-ink"
                        : "text-lw-ink-soft hover:bg-lw-surface",
                    )
                  }
                >
                  <Cpu size={15} /> {t("runner.title")}
                </NavLink>
                <NavLink
                  to="/einstellungen/postfaecher"
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-[var(--lw-radius-sm)] px-2 py-1.5 text-[13px]",
                      isActive
                        ? "bg-lw-surface font-medium text-lw-ink"
                        : "text-lw-ink-soft hover:bg-lw-surface",
                    )
                  }
                >
                  <Mail size={15} /> {t("mail.title")}
                </NavLink>
                <NavLink
                  to="/einstellungen/regeln"
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-[var(--lw-radius-sm)] px-2 py-1.5 text-[13px]",
                      isActive
                        ? "bg-lw-surface font-medium text-lw-ink"
                        : "text-lw-ink-soft hover:bg-lw-surface",
                    )
                  }
                >
                  <ListChecks size={15} /> {t("rules.title")}
                </NavLink>
                <NavLink
                  to="/einstellungen/automationen"
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-[var(--lw-radius-sm)] px-2 py-1.5 text-[13px]",
                      isActive
                        ? "bg-lw-surface font-medium text-lw-ink"
                        : "text-lw-ink-soft hover:bg-lw-surface",
                    )
                  }
                >
                  <Gauge size={15} /> {t("automations.title")}
                </NavLink>
              </>
            ) : (
              railItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "rounded-[var(--lw-radius-sm)] px-2 py-1.5 text-[13px]",
                      isActive
                        ? "bg-lw-surface font-medium text-lw-ink"
                        : "text-lw-ink-soft hover:bg-lw-surface",
                    )
                  }
                >
                  {t(item.labelKey)}
                </NavLink>
              ))
            )}
          </div>
          <p className="mt-auto px-2 text-[11px] text-lw-ink-faint">
            Cmd/Strg + K für Suche
          </p>
        </aside>

        {/* Hauptfläche */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-lw-bg">
          <Outlet />
        </main>
      </div>
      <CommandBar />
    </div>
  );
}
