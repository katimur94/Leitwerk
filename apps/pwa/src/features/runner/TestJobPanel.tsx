import { useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import {
  AiBadge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  SkeletonRows,
} from "@leitwerk/ui";
import { t } from "../../i18n/de";
import { formatDateTime } from "../../lib/format";
import { JobStatusBadge } from "./JobStatusBadge";
import { useCreateEchoJob, useEchoJobs } from "./queries";

function jobReply(result: unknown): string | null {
  if (
    result &&
    typeof result === "object" &&
    "reply" in result &&
    typeof (result as { reply: unknown }).reply === "string"
  ) {
    return (result as { reply: string }).reply;
  }
  return null;
}

export function TestJobPanel() {
  const [text, setText] = useState("Sag Hallo, Leitwerk!");
  const jobs = useEchoJobs();
  const createJob = useCreateEchoJob();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    createJob.mutate(text.trim());
  }

  return (
    <Card className="p-6">
      <h3 className="text-[16px] font-semibold text-lw-ink">
        {t("testjob.title")}
      </h3>
      <p className="mt-1 text-[13px] text-lw-ink-soft">{t("testjob.hint")}</p>

      <form onSubmit={onSubmit} className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <Field label={t("testjob.inputLabel")} htmlFor="testjob-text">
            <Input
              id="testjob-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("testjob.inputPlaceholder")}
            />
          </Field>
        </div>
        <Button type="submit" disabled={createJob.isPending || !text.trim()}>
          {createJob.isPending ? t("common.loading") : t("testjob.submit")}
        </Button>
      </form>
      {createJob.isError ? (
        <p className="mt-2 text-[13px] text-lw-danger">
          {createJob.error.message}
        </p>
      ) : null}

      <h4 className="mt-6 text-[13px] font-medium uppercase tracking-wide text-lw-ink-faint">
        {t("testjob.jobs.title")}
      </h4>
      <div className="mt-3">
        {jobs.isPending ? (
          <SkeletonRows rows={3} />
        ) : jobs.isError ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-[13px] text-lw-danger">
              {t("common.error")} ({jobs.error.message})
            </p>
            <Button variant="secondary" size="sm" onClick={() => jobs.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : jobs.data.length === 0 ? (
          <EmptyState
            icon={<Sparkles />}
            title={t("testjob.jobs.empty")}
            className="py-8"
          />
        ) : (
          <ul className="divide-y divide-lw-border">
            {jobs.data.map((job) => {
              const reply = jobReply(job.result);
              return (
                <li key={job.id} className="flex flex-col gap-1.5 py-3">
                  <div className="flex items-center gap-2">
                    <JobStatusBadge status={job.status} />
                    <span className="truncate text-[13px] text-lw-ink-soft">
                      „{String((job.payload as { text?: string }).text ?? "")}“
                    </span>
                    <span className="ml-auto shrink-0 text-[12px] text-lw-ink-faint tnum">
                      {formatDateTime(job.created_at)}
                    </span>
                  </div>
                  {job.status === "done" && reply ? (
                    <div className="flex items-start gap-2 rounded-[var(--lw-radius-md)] bg-lw-surface-2 px-3 py-2">
                      <AiBadge label="KI" className="mt-0.5 shrink-0" />
                      <p className="text-[14px] text-lw-ink">{reply}</p>
                    </div>
                  ) : null}
                  {job.status === "failed" && job.error ? (
                    <p className="text-[13px] text-lw-danger">{job.error}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
