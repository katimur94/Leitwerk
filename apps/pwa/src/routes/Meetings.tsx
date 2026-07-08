import { useRef, useState } from "react";
import { AudioLines, FileUp, Mic2 } from "lucide-react";
import { AiBadge, Badge, Button, Card, EmptyState, Input, SkeletonRows } from "@leitwerk/ui";
import { useCreateMeeting, useMeetings } from "../features/knowledge/queries";
import { t } from "../i18n/de";
import { formatAgo } from "../lib/format";

/**
 * Meetings (MASTERPLAN §4 M): Audio-Upload → Whisper LOKAL im Runner →
 * summarize_meeting: Protokoll, Entscheidungen, offene Fragen, Aufgaben.
 */
export function Meetings() {
  const meetings = useMeetings();
  const create = useCreateMeeting();
  const [title, setTitle] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const open = (meetings.data ?? []).find((m) => m.id === openId);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-8">
      <header>
        <h1 className="text-[24px] font-semibold text-lw-ink">{t("meetings.title")}</h1>
        <p className="mt-1 text-[14px] text-lw-ink-soft">{t("meetings.subtitle")}</p>
      </header>

      <Card className="p-4">
        <h3 className="text-[14px] font-semibold text-lw-ink">{t("meetings.new")}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            id="meeting-title"
            placeholder={t("meetings.titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="max-w-xs"
          />
          <input
            ref={fileRef}
            id="meeting-audio"
            type="file"
            accept="audio/*,.webm,.m4a,.mp3,.wav"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                create.mutate(
                  { title, audio: file },
                  { onSuccess: () => { setTitle(""); if (fileRef.current) fileRef.current.value = ""; } },
                );
              }
            }}
          />
          <Button
            size="sm"
            disabled={create.isPending}
            onClick={() => fileRef.current?.click()}
          >
            <FileUp size={14} /> {t("meetings.upload")}
          </Button>
          {create.isPending ? (
            <span className="text-[12px] text-lw-ink-faint">{t("meetings.uploading")}</span>
          ) : null}
        </div>
        <p className="mt-2 text-[12px] text-lw-ink-faint">{t("meetings.privacyHint")}</p>
        {create.isError ? (
          <p className="mt-1 text-[12px] text-lw-danger">{create.error.message}</p>
        ) : null}
      </Card>

      {open ? (
        <Card className="p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[16px] font-semibold text-lw-ink">{open.title}</h3>
            <Button size="sm" variant="ghost" onClick={() => setOpenId(null)}>
              {t("composer.close")}
            </Button>
          </div>
          {open.protocol_md ? (
            <>
              <div className="mt-2 flex items-center gap-2">
                <AiBadge label={t("meetings.protocolBadge")} />
              </div>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] text-lw-ink">
                {open.protocol_md}
              </pre>
              {open.decisions.length > 0 ? (
                <>
                  <h4 className="mt-4 text-[13px] font-semibold text-lw-ink">
                    {t("meetings.decisions")}
                  </h4>
                  <ul className="mt-1 list-disc pl-5 text-[13px] text-lw-ink-soft">
                    {open.decisions.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {open.open_questions.length > 0 ? (
                <>
                  <h4 className="mt-3 text-[13px] font-semibold text-lw-ink">
                    {t("meetings.openQuestions")}
                  </h4>
                  <ul className="mt-1 list-disc pl-5 text-[13px] text-lw-ink-soft">
                    {open.open_questions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          ) : open.transcript ? (
            <>
              <p className="mt-2 text-[13px] text-lw-ink-faint">{t("meetings.summarizing")}</p>
              <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap font-sans text-[13px] text-lw-ink-soft">
                {open.transcript}
              </pre>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-lw-ink-faint">{t("meetings.transcribing")}</p>
          )}
        </Card>
      ) : null}

      <Card className="p-5">
        {meetings.isPending ? (
          <SkeletonRows rows={3} />
        ) : meetings.isError ? (
          <p className="text-[13px] text-lw-danger">
            {t("common.error")} ({meetings.error.message})
          </p>
        ) : (meetings.data ?? []).length === 0 ? (
          <EmptyState
            icon={<Mic2 />}
            title={t("meetings.empty.title")}
            description={t("meetings.empty.description")}
            className="py-10"
          />
        ) : (
          <ul className="divide-y divide-lw-border">
            {(meetings.data ?? []).map((meeting) => (
              <li key={meeting.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-lw-surface-2"
                  onClick={() => setOpenId(meeting.id)}
                >
                  <AudioLines size={16} className="shrink-0 text-lw-ink-faint" />
                  <span className="min-w-0 flex-1 truncate text-[14px] text-lw-ink">
                    {meeting.title}
                  </span>
                  <span className="text-[12px] text-lw-ink-faint">{formatAgo(meeting.held_at)}</span>
                  {meeting.protocol_md ? (
                    <Badge tone="success">{t("meetings.status.done")}</Badge>
                  ) : meeting.transcript ? (
                    <Badge tone="neutral">{t("meetings.status.summarizing")}</Badge>
                  ) : (
                    <Badge tone="neutral">{t("meetings.status.transcribing")}</Badge>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
