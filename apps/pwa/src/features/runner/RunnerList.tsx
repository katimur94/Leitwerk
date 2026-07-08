import { Cpu } from "lucide-react";
import { Badge, Button, Card, EmptyState, SkeletonRows, StatusDot } from "@leitwerk/ui";
import { t } from "../../i18n/de";
import { formatAgo } from "../../lib/format";
import { isRunnerOnline, useRunners } from "./queries";

const providerLabels: Record<string, string> = {
  claude_cli: "Claude CLI (Max-Abo)",
  codex_cli: "Codex CLI",
  anthropic_api: "Anthropic API",
};

export function RunnerList() {
  const runners = useRunners();

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
          <ul className="divide-y divide-lw-border">
            {runners.data.map((runner) => {
              const online = isRunnerOnline(runner);
              return (
                <li key={runner.id} className="flex items-center gap-3 py-3">
                  <StatusDot status={online ? "online" : runner.status === "disabled" ? "disabled" : "offline"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-lw-ink">
                      {runner.name}
                    </p>
                    <p className="text-[12px] text-lw-ink-faint">
                      {t("runner.list.lastHeartbeat")}:{" "}
                      {formatAgo(runner.last_heartbeat)}
                      {runner.version ? ` · v${runner.version}` : ""}
                    </p>
                  </div>
                  <Badge tone={online ? "success" : "neutral"}>
                    {providerLabels[runner.provider] ?? runner.provider}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
