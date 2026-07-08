import { useRef, useState } from "react";
import { BookOpenCheck, Mic, NotebookPen, Plus, Square, Trash2 } from "lucide-react";
import { AiBadge, Badge, Button, Card, EmptyState, Input, SkeletonRows, cn } from "@leitwerk/ui";
import {
  useKnowledgeItems,
  useNoteMutations,
  useNotes,
  useReviewKnowledge,
} from "../features/knowledge/queries";
import { t } from "../i18n/de";
import { formatAgo } from "../lib/format";

type Tab = "notes" | "knowledge";

function VoiceRecorder({ onRecorded }: { onRecorded: (audio: Blob) => void }) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        onRecorded(new Blob(chunksRef.current, { type: "audio/webm" }));
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function stop() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  return (
    <div className="flex items-center gap-2">
      {recording ? (
        <Button size="sm" variant="secondary" onClick={stop}>
          <Square size={14} /> {t("notes.stopRecording")}
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => void start()}>
          <Mic size={14} /> {t("notes.voiceNote")}
        </Button>
      )}
      {error ? <span className="text-[12px] text-lw-danger">{error}</span> : null}
    </div>
  );
}

function NotesTab() {
  const notes = useNotes();
  const { create, update, remove, createVoice } = useNoteMutations();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = (notes.data ?? []).find((n) => n.id === editingId);

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <h3 className="text-[14px] font-semibold text-lw-ink">
          {editing ? t("notes.edit") : t("notes.new")}
        </h3>
        <div className="mt-2 flex flex-col gap-2">
          <Input
            id="note-title"
            placeholder={t("notes.titlePlaceholder")}
            value={editing ? (editing.title ?? "") : title}
            onChange={(e) =>
              editing
                ? update.mutate({ id: editing.id, title: e.target.value, body: editing.body_md })
                : setTitle(e.target.value)
            }
          />
          <textarea
            id="note-body"
            rows={4}
            placeholder={t("notes.bodyPlaceholder")}
            value={editing ? editing.body_md : body}
            onChange={(e) =>
              editing
                ? update.mutate({ id: editing.id, title: editing.title ?? "", body: e.target.value })
                : setBody(e.target.value)
            }
            className="w-full rounded-[var(--lw-radius-sm)] border border-lw-border bg-lw-surface p-2 text-[13px] text-lw-ink outline-none focus:ring-2 focus:ring-lw-accent"
          />
          <div className="flex items-center gap-2">
            {editing ? (
              <Button size="sm" onClick={() => setEditingId(null)}>
                {t("common.done")}
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={create.isPending || body.trim().length === 0}
                onClick={() =>
                  create.mutate(
                    { title, body },
                    { onSuccess: () => { setTitle(""); setBody(""); } },
                  )
                }
              >
                <Plus size={14} /> {t("notes.create")}
              </Button>
            )}
            <VoiceRecorder onRecorded={(audio) => createVoice.mutate(audio)} />
            {createVoice.isPending ? (
              <span className="text-[12px] text-lw-ink-faint">{t("notes.uploading")}</span>
            ) : null}
          </div>
          {(create.isError || createVoice.isError) ? (
            <p className="text-[12px] text-lw-danger">
              {create.error?.message ?? createVoice.error?.message}
            </p>
          ) : null}
        </div>
      </Card>

      {notes.isPending ? (
        <SkeletonRows rows={4} />
      ) : notes.isError ? (
        <p className="text-[13px] text-lw-danger">
          {t("common.error")} ({notes.error.message})
        </p>
      ) : (notes.data ?? []).length === 0 ? (
        <EmptyState
          icon={<NotebookPen />}
          title={t("notes.empty.title")}
          description={t("notes.empty.description")}
          className="py-10"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {(notes.data ?? []).map((note) => (
            <Card key={note.id} className="p-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[14px] font-medium text-lw-ink">
                    {note.title ?? t("notes.untitled")}
                    {note.source === "voice" ? <AiBadge label={t("notes.voiceBadge")} /> : null}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] text-lw-ink-soft">
                    {note.body_md.length > 400 ? `${note.body_md.slice(0, 400)}…` : note.body_md}
                  </p>
                  <p className="mt-1 text-[11px] text-lw-ink-faint">{formatAgo(note.created_at)}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(note.id)}>
                  {t("common.edit")}
                </Button>
                <button
                  aria-label={t("notes.delete")}
                  className="mt-1 text-lw-ink-faint hover:text-lw-danger"
                  onClick={() => remove.mutate(note.id)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

function KnowledgeTab() {
  const items = useKnowledgeItems();
  const review = useReviewKnowledge();

  if (items.isPending) return <SkeletonRows rows={4} />;
  if (items.isError) {
    return (
      <p className="text-[13px] text-lw-danger">
        {t("common.error")} ({items.error.message})
      </p>
    );
  }
  if ((items.data ?? []).length === 0) {
    return (
      <EmptyState
        icon={<BookOpenCheck />}
        title={t("knowledge.empty.title")}
        description={t("knowledge.empty.description")}
        className="py-10"
      />
    );
  }
  return (
    <ul className="divide-y divide-lw-border">
      {(items.data ?? []).map((item) => (
        <li key={item.id} className="flex flex-wrap items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] text-lw-ink">{item.fact}</p>
            <p className="mt-0.5 flex items-center gap-2 text-[12px] text-lw-ink-faint">
              {item.category ? <Badge tone="neutral">{item.category}</Badge> : null}
              {formatAgo(item.created_at)}
            </p>
          </div>
          {item.status === "proposed" ? (
            <>
              <AiBadge confidence={item.confidence} label={t("knowledge.proposed")} />
              <Button
                size="sm"
                disabled={review.isPending}
                onClick={() => review.mutate({ id: item.id, status: "confirmed" })}
              >
                {t("knowledge.confirm")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={review.isPending}
                onClick={() => review.mutate({ id: item.id, status: "rejected" })}
              >
                {t("knowledge.reject")}
              </Button>
            </>
          ) : (
            <Badge tone="success">{t("knowledge.confirmed")}</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Gedächtnis (MASTERPLAN §4 G): Notizen + destilliertes Wissen mit Review. */
export function Notes() {
  const [tab, setTab] = useState<Tab>("notes");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-8">
      <header>
        <h1 className="text-[24px] font-semibold text-lw-ink">{t("notes.title")}</h1>
        <p className="mt-1 text-[14px] text-lw-ink-soft">{t("notes.subtitle")}</p>
      </header>

      <div className="flex gap-1">
        {(
          [
            { key: "notes", label: t("notes.tab.notes") },
            { key: "knowledge", label: t("notes.tab.knowledge") },
          ] as Array<{ key: Tab; label: string }>
        ).map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            className={cn(
              "rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
              tab === entry.key
                ? "bg-lw-surface-2 text-lw-ink"
                : "text-lw-ink-faint hover:text-lw-ink-soft",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "notes" ? <NotesTab /> : <Card className="p-5"><KnowledgeTab /></Card>}
    </div>
  );
}
