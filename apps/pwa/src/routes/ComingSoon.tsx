import { Hourglass } from "lucide-react";
import { EmptyState } from "@leitwerk/ui";
import { t } from "../i18n/de";

export function ComingSoon({
  titleKey,
  phase,
}: {
  titleKey: string;
  phase: number;
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={<Hourglass />}
        title={t(titleKey)}
        description={`${t("common.comingSoon")} (Phase ${phase})`}
      />
    </div>
  );
}
