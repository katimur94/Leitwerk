import { Badge, type BadgeTone } from "@leitwerk/ui";
import type { AgentJobRow } from "@leitwerk/shared";
import { t } from "../../i18n/de";

const tones: Record<AgentJobRow["status"], BadgeTone> = {
  queued: "neutral",
  claimed: "warning",
  running: "warning",
  done: "success",
  failed: "danger",
  cancelled: "neutral",
  expired: "neutral",
};

export function JobStatusBadge({ status }: { status: AgentJobRow["status"] }) {
  return <Badge tone={tones[status]}>{t(`job.status.${status}`)}</Badge>;
}
