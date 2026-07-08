import { PairingPanel } from "../features/runner/PairingPanel";
import { RunnerList } from "../features/runner/RunnerList";
import { TestJobPanel } from "../features/runner/TestJobPanel";
import { isRunnerOnline, useRunners } from "../features/runner/queries";
import { t } from "../i18n/de";

export function RunnerSettings() {
  const runners = useRunners();
  const anyOnline = (runners.data ?? []).some(isRunnerOnline);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-[24px] font-semibold text-lw-ink">
          {t("runner.title")}
        </h1>
        <p className="mt-1 text-[14px] text-lw-ink-soft">
          {t("runner.subtitle")}
        </p>
      </header>

      {runners.isSuccess && !anyOnline ? (
        // Runner-offline-Zustand: dezenter Hinweis, Rest der App unbeeinträchtigt
        <div
          className="rounded-[var(--lw-radius-md)] border px-4 py-3 text-[13px]"
          style={{
            borderColor: "color-mix(in srgb, var(--lw-warning) 35%, transparent)",
            backgroundColor:
              "color-mix(in srgb, var(--lw-warning) 8%, transparent)",
            color: "var(--lw-warning)",
          }}
        >
          {t("runner.offlineHint")}
        </div>
      ) : null}

      <RunnerList />
      <PairingPanel />
      <TestJobPanel />
    </div>
  );
}
