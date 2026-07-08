import { useState } from "react";
import { Cpu, ShieldQuestion, SlidersHorizontal } from "lucide-react";
import type { RunnerRow } from "@leitwerk/shared";
import { Badge, Button, Card, EmptyState, SkeletonRows, StatusDot } from "@leitwerk/ui";
import { t } from "../../i18n/de";
import { formatAgo, formatDateTime } from "../../lib/format";
import {
  isPendingApproval,
  isRunnerOnline,
  useApproveRunner,
  useRejectRunner,
  useRunners,
} from "./queries";
import { RunnerLimitsForm } from "./RunnerLimitsForm";

const providerLabels: Record<string, string> = {
  claude_cli: "Claude CLI (Max-Abo)",
  codex_cli: "Codex CLI",
  anthropic_api: "Anthropic API",
};

/**
 * Zwei-Stufen-Pairing (Etappe 0.5): Frisch gepairte Runner warten hier auf
 * die Bestätigung durch Owner/Admin. Erst danach dürfen sie Jobs claimen.
 */
function PendingApprovalCard({ runner }: { runner: RunnerRow }) {
  const approve = useApproveRunner();
  const reject = useRejectRunner();
  const busy = approve.isPending || reject.isPending;

  return (
    <div
      className="rounded-[var(--lw-radius-md)] border p-4"
      style={{
        borderColor: "color-mix(in srgb, var(--lw-warning) 35%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--lw-warning) 6%, transparent)",
      }}
    >
      <div className="flex items-start gap-3">
        <ShieldQuestion
          size={18}
          strokeWidth={1.75}
          style={{ color: "var(--lw-warning)" }}
          className="mt-0.5 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-lw-ink">
            {t("runner.approval.title")}
          </p>
          <p className="mt-1 text-[13px] text-lw-ink-soft">
            {t("runner.approval.hostname")}: <span className="font-medium">{runner.name}</span>
            {" · "}
            {providerLabels[runner.provider] ?? runner.provider}
            {" · "}
            {t("runner.approval.pairedAt")}: {formatDateTime(runner.created_at)}
          </p>
          <p className="mt-1 text-[12px] text-lw-ink-faint">
            {t("runner.approval.hint")}
          </p>
          {approve.isError || reject.isError ? (
            <p className="mt-2 text-[12px] text-lw-danger">
              {t("common.error")} (
              {approve.error?.message ?? reject.error?.message})
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => approve.mutate(runner.id)}>
              {t("runner.approval.approve")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => reject.mutate(runner.id)}
            >
              {t("runner.approval.reject")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RunnerItem({ runner }: { runner: RunnerRow }) {
  const [showLimits, setShowLimits] = useState(false);
  const online = isRunnerOnline(runner);

  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <StatusDot
          status={online ? "online" : runner.status === "disabled" ? "disabled" : "offline"}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-lw-ink">{runner.name}</p>
          <p className="text-[12px] text-lw-ink-faint">
            {t("runner.list.lastHeartbeat")}: {formatAgo(runner.last_heartbeat)}
            {runner.version ? ` · v${runner.version}` : ""}
            {" · "}
            {runner.max_jobs_per_hour}/h · {runner.daily_job_limit}/Tag
            {runner.quiet_hours
              ? ` · ${t("runner.limits.quietBadge")} ${runner.quiet_hours.start}–${runner.quiet_hours.end}`
              : ""}
          </p>
        </div>
        <Badge tone={online ? "success" : "neutral"}>
          {providerLabels[runner.provider] ?? runner.provider}
        </Badge>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={showLimits}
          onClick={() => setShowLimits((v) => !v)}
        >
          <SlidersHorizontal size={14} strokeWidth={1.75} />
          {t("runner.limits.toggle")}
        </Button>
      </div>
      {showLimits ? <RunnerLimitsForm runner={runner} /> : null}
    </li>
  );
}

export function RunnerList() {
  const runners = useRunners();
  const pending = (runners.data ?? []).filter(isPendingApproval);
  const active = (runners.data ?? []).filter((r) => !isPendingApproval(r));

  return (
    <Card className="p-6">
      <h3 className="text-[16px] font-semibold text-lw-ink">
        {t("runner.list.title")}
      </h3>
      <div className="mt-4">
        {runners.isPending ? (
          <SkeletonRows rows={2} />
        ) : runners.isError ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-[13px] text-lw-danger">
              {t("common.error")} ({runners.error.message})
            </p>
            <Button variant="secondary" size="sm" onClick={() => runners.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : runners.data.length === 0 ? (
          <EmptyState
            icon={<Cpu />}
            title={t("runner.list.empty.title")}
            description={t("runner.list.empty.description")}
            className="py-8"
          />
        ) : (
          <>
            {pending.length > 0 ? (
              <div className="mb-4 flex flex-col gap-3">
                {pending.map((runner) => (
                  <PendingApprovalCard key={runner.id} runner={runner} />
                ))}
              </div>
            ) : null}
            {active.length > 0 ? (
              <ul className="divide-y divide-lw-border">
                {active.map((runner) => (
                  <RunnerItem key={runner.id} runner={runner} />
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
