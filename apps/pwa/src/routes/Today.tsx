import { Sunrise, AlertTriangle, Timer } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentFindingRow, BriefingRow, FollowupRow } from "@leitwerk/shared";
import { AiBadge, Badge, Button, Card, EmptyState, SkeletonRows } from "@leitwerk/ui";
import { t } from "../i18n/de";
import { formatAgo, formatDateTime } from "../lib/format";
import { supabase } from "../lib/supabase";
import { useSessionStore } from "../stores/session";

function useLatestBriefing() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["briefing", orgId],
    enabled: !!orgId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("briefings")
        .select("*")
        .eq("org_id", orgId!)
        .eq("kind", "morning")
        .order("for_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as BriefingRow | null) ?? null;
    },
  });
}

function useLatestWeekly() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["briefing_weekly", orgId],
    enabled: !!orgId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("briefings")
        .select("*")
        .eq("org_id", orgId!)
        .eq("kind", "weekly")
        .order("for_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as BriefingRow | null) ?? null;
    },
  });
}

function useOpenFindings() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["findings", orgId],
    enabled: !!orgId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_findings")
        .select("*")
        .eq("org_id", orgId!)
        .eq("status", "open")
        .order("severity", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);
      return (data ?? []) as AgentFindingRow[];
    },
  });
}

function useOverdueFollowups() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["followups", orgId],
    enabled: !!orgId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("followups")
        .select("*")
        .eq("org_id", orgId!)
        .in("status", ["waiting", "escalated"])
        .lt("expected_by", new Date().toISOString())
        .order("expected_by", { ascending: true })
        .limit(10);
      if (error) throw new Error(error.message);
      return (data ?? []) as FollowupRow[];
    },
  });
}

function entityLink(entityType: string | null, entityId: string | null): string {
  switch (entityType) {
    case "mail_thread":
    case "mail_message":
      return "/posteingang";
    case "task":
      return "/aufgaben";
    case "case":
      return entityId ? `/vorgaenge/${entityId}` : "/vorgaenge";
    default:
      return "/";
  }
}

function FindingRow({ finding }: { finding: AgentFindingRow }) {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  const resolve = useMutation({
    mutationFn: async (status: "resolved" | "dismissed") => {
      const { error } = await supabase
        .from("agent_findings")
        .update({ status, resolved_at: new Date().toISOString() })
        .eq("id", finding.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["findings", orgId] }),
  });

  return (
    <li className="flex items-start gap-3 py-2.5">
      <Badge tone={finding.severity <= 2 ? "danger" : "warning"}>S{finding.severity}</Badge>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-lw-ink">{finding.title}</p>
        {finding.description ? (
          <p className="text-[12px] text-lw-ink-soft">{finding.description}</p>
        ) : null}
        <p className="mt-0.5 text-[11px] text-lw-ink-faint">{formatAgo(finding.created_at)}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button size="sm" variant="secondary" onClick={() => resolve.mutate("resolved")}>
          {t("today.findings.resolve")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => resolve.mutate("dismissed")}>
          {t("today.findings.dismiss")}
        </Button>
      </div>
    </li>
  );
}

export function Today() {
  const navigate = useNavigate();
  const briefing = useLatestBriefing();
  const weekly = useLatestWeekly();
  const findings = useOpenFindings();
  const followups = useOverdueFollowups();

  const nothingYet =
    briefing.isSuccess && !briefing.data &&
    findings.isSuccess && (findings.data ?? []).length === 0 &&
    followups.isSuccess && (followups.data ?? []).length === 0;

  if (nothingYet) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<Sunrise />}
          title={t("today.empty.title")}
          description={t("today.empty.description")}
          action={
            <Button variant="secondary" onClick={() => navigate("/einstellungen/runner")}>
              {t("today.empty.cta")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-8">
      <header>
        <h1 className="text-[24px] font-semibold text-lw-ink">{t("today.title")}</h1>
        <p className="mt-1 text-[14px] text-lw-ink-soft">
          {new Intl.DateTimeFormat("de-DE", { dateStyle: "full" }).format(new Date())}
        </p>
      </header>

      {/* Morgen-Briefing (BriefingCard-Feed, DESIGN.md Kernkomponente 9) */}
      {briefing.isPending ? (
        <SkeletonRows rows={3} />
      ) : briefing.isError ? (
        <Card className="p-4">
          <p className="text-[13px] text-lw-danger">
            {t("common.error")} ({briefing.error.message})
          </p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => briefing.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : briefing.data ? (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <AiBadge label={t("today.briefingBadge")} />
            <span className="text-[12px] text-lw-ink-faint">
              {formatDateTime(briefing.data.created_at)}
            </span>
          </div>
          <p className="mt-3 text-[14px] leading-relaxed text-lw-ink">
            {briefing.data.content_md}
          </p>
          {briefing.data.items.length > 0 ? (
            <ol className="mt-4 flex flex-col gap-2">
              {briefing.data.items.map((item, index) => (
                <li
                  key={index}
                  className="flex items-center gap-3 rounded-[var(--lw-radius-md)] border border-lw-border bg-lw-surface-2 px-3 py-2"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
                    style={{ backgroundColor: "var(--lw-brand)" }}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-lw-ink">{item.title}</p>
                    {item.detail ? (
                      <p className="truncate text-[12px] text-lw-ink-soft">{item.detail}</p>
                    ) : null}
                  </div>
                  <Link to={entityLink(item.entity_type, item.entity_id)}>
                    <Button size="sm" variant="secondary">
                      {item.action ?? t("today.open")}
                    </Button>
                  </Link>
                </li>
              ))}
            </ol>
          ) : null}
        </Card>
      ) : (
        <Card className="p-4">
          <p className="text-[13px] text-lw-ink-soft">{t("today.noBriefingYet")}</p>
        </Card>
      )}

      {/* Wochenreport (Etappe 5): freitags erzeugt, hier verlinkt */}
      {weekly.data ? (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <AiBadge label={t("today.weeklyBadge")} />
            <span className="text-[12px] text-lw-ink-faint">
              {formatDateTime(weekly.data.created_at)}
            </span>
          </div>
          <p className="mt-3 text-[14px] leading-relaxed text-lw-ink">{weekly.data.content_md}</p>
        </Card>
      ) : null}

      {/* Wächter-Findings */}
      <Card className="p-5">
        <h3 className="flex items-center gap-2 text-[16px] font-semibold text-lw-ink">
          <AlertTriangle size={16} className="text-lw-ink-faint" /> {t("today.findings.title")}
        </h3>
        <div className="mt-2">
          {findings.isPending ? (
            <SkeletonRows rows={2} />
          ) : findings.isError ? (
            <p className="text-[13px] text-lw-danger">
              {t("common.error")} ({findings.error.message})
            </p>
          ) : (findings.data ?? []).length === 0 ? (
            <p className="py-3 text-[13px] text-lw-ink-faint">{t("today.findings.empty")}</p>
          ) : (
            <ul className="divide-y divide-lw-border">
              {(findings.data ?? []).map((finding) => (
                <FindingRow key={finding.id} finding={finding} />
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* Überfällige Follow-ups */}
      <Card className="p-5">
        <h3 className="flex items-center gap-2 text-[16px] font-semibold text-lw-ink">
          <Timer size={16} className="text-lw-ink-faint" /> {t("today.followups.title")}
        </h3>
        <div className="mt-2">
          {followups.isPending ? (
            <SkeletonRows rows={2} />
          ) : followups.isError ? (
            <p className="text-[13px] text-lw-danger">
              {t("common.error")} ({followups.error.message})
            </p>
          ) : (followups.data ?? []).length === 0 ? (
            <p className="py-3 text-[13px] text-lw-ink-faint">{t("today.followups.empty")}</p>
          ) : (
            <ul className="divide-y divide-lw-border">
              {(followups.data ?? []).map((followup) => (
                <li key={followup.id} className="flex items-center gap-3 py-2.5">
                  <Badge tone={followup.status === "escalated" ? "danger" : "warning"}>
                    {followup.status === "escalated"
                      ? t("today.followups.escalated")
                      : t("today.followups.waiting")}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-lw-ink">
                      {t("today.followups.expected")} {formatDateTime(followup.expected_by)}
                    </p>
                    {followup.reason ? (
                      <p className="text-[12px] text-lw-ink-faint">{followup.reason}</p>
                    ) : null}
                  </div>
                  <Link to="/posteingang">
                    <Button size="sm" variant="secondary">
                      {t("today.followups.open")}
                    </Button>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
