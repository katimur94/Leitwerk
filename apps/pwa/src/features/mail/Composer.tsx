import { useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { MailAddressJson, MailDraftRow } from "@leitwerk/shared";
import { AiBadge, Button, Card, Field, Input } from "@leitwerk/ui";
import { t } from "../../i18n/de";
import { useSessionStore } from "../../stores/session";
import {
  SEND_UNDO_SECONDS,
  triggerSend,
  uploadDraftAttachment,
  useDiscardDraft,
  useSaveDraft,
  useScheduleSend,
  useUndoSend,
  type DraftAttachment,
} from "./queries";

function parseAddressInput(raw: string): MailAddressJson[] {
  return raw
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => part.includes("@"))
    .map((email) => ({ email: email.toLowerCase() }));
}

export interface ComposerProps {
  accountId: string;
  threadId: string | null;
  /** Bestehenden Entwurf weiterbearbeiten (z. B. KI-Entwurf) */
  draft?: MailDraftRow | null;
  initialTo?: MailAddressJson[];
  initialSubject?: string;
  initialBodyHtml?: string;
  signatureHtml?: string | null;
  onClose: () => void;
}

/**
 * Composer (Tiptap): Neu/Antworten/Weiterleiten. Senden = planen mit
 * 30s-Undo (mail_drafts status='scheduled', send_after) — der Versand
 * selbst läuft serverseitig über die Edge Function send-mail.
 */
export function Composer(props: ComposerProps) {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const saveDraft = useSaveDraft();
  const schedule = useScheduleSend();
  const undo = useUndoSend();
  const discard = useDiscardDraft();

  const [draftId, setDraftId] = useState<string | null>(props.draft?.id ?? null);
  const [attachments, setAttachments] = useState<DraftAttachment[]>(
    (props.draft as (MailDraftRow & { attachments?: DraftAttachment[] }) | null | undefined)
      ?.attachments ?? [],
  );
  const [uploading, setUploading] = useState(false);

  async function onFilesSelected(files: FileList | null): Promise<void> {
    if (!files || !orgId) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: DraftAttachment[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024) {
          throw new Error(t("composer.attachmentTooLarge").replace("{name}", file.name));
        }
        uploaded.push(await uploadDraftAttachment(orgId, file));
      }
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }
  const [to, setTo] = useState(
    (props.draft?.to_addrs ?? props.initialTo ?? []).map((a) => a.email).join(", "),
  );
  const [cc, setCc] = useState((props.draft?.cc_addrs ?? []).map((a) => a.email).join(", "));
  const [subject, setSubject] = useState(props.draft?.subject ?? props.initialSubject ?? "");
  const [phase, setPhase] = useState<"editing" | "scheduled" | "sent">("editing");
  const [remaining, setRemaining] = useState(SEND_UNDO_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const sendTriggered = useRef(false);

  const initialContent = useMemo(() => {
    const base = props.draft?.body_html ?? props.initialBodyHtml ?? "<p></p>";
    if (!props.draft && !props.initialBodyHtml && props.signatureHtml) {
      return `<p></p><p></p>${props.signatureHtml}`;
    }
    return base;
  }, [props.draft, props.initialBodyHtml, props.signatureHtml]);

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent,
    editorProps: {
      attributes: {
        class:
          "min-h-[160px] max-w-none px-3 py-2 text-[14px] leading-relaxed text-lw-ink focus:outline-none",
      },
    },
  });

  // Countdown nach dem Planen; bei 0 → Versand über die Edge Function
  useEffect(() => {
    if (phase !== "scheduled" || !draftId) return;
    setRemaining(SEND_UNDO_SECONDS);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const left = SEND_UNDO_SECONDS - Math.floor((Date.now() - startedAt) / 1000);
      setRemaining(Math.max(0, left));
      if (left <= 0 && !sendTriggered.current) {
        sendTriggered.current = true;
        clearInterval(timer);
        triggerSend(draftId)
          .then(() => setPhase("sent"))
          .catch((e: unknown) => {
            setError(e instanceof Error ? e.message : String(e));
            setPhase("editing");
            sendTriggered.current = false;
          });
      }
    }, 250);
    return () => clearInterval(timer);
  }, [phase, draftId]);

  async function persistDraft(): Promise<string> {
    const body = editor?.getHTML() ?? "";
    const saved = await saveDraft.mutateAsync({
      accountId: props.accountId,
      threadId: props.threadId,
      to: parseAddressInput(to),
      cc: parseAddressInput(cc),
      subject,
      bodyHtml: body,
      attachments,
      draftId: draftId ?? undefined,
    });
    setDraftId(saved.id);
    return saved.id;
  }

  async function onSend(): Promise<void> {
    setError(null);
    if (parseAddressInput(to).length === 0) {
      setError(t("composer.noRecipient"));
      return;
    }
    try {
      const id = await persistDraft();
      await schedule.mutateAsync(id);
      sendTriggered.current = false;
      setPhase("scheduled");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onUndo(): Promise<void> {
    if (!draftId) return;
    await undo.mutateAsync(draftId);
    setPhase("editing");
  }

  async function onDiscard(): Promise<void> {
    if (draftId) await discard.mutateAsync(draftId);
    props.onClose();
  }

  if (phase === "sent") {
    return (
      <Card className="p-4">
        <p className="text-[14px]" style={{ color: "var(--lw-success)" }}>
          {t("composer.sent")}
        </p>
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={props.onClose}>
            {t("composer.close")}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-lw-ink">
          {props.threadId ? t("composer.replyTitle") : t("composer.newTitle")}
        </h3>
        {props.draft?.source === "ai" ? <AiBadge label={t("composer.aiDraft")} /> : null}
      </div>

      <div className="mt-3 flex flex-col gap-3">
        <Field label={t("composer.to")} htmlFor="composer-to">
          <Input
            id="composer-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="empfaenger@firma.de, weitere@firma.de"
            disabled={phase === "scheduled"}
          />
        </Field>
        <Field label={t("composer.cc")} htmlFor="composer-cc">
          <Input
            id="composer-cc"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            disabled={phase === "scheduled"}
          />
        </Field>
        <Field label={t("composer.subject")} htmlFor="composer-subject">
          <Input
            id="composer-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={phase === "scheduled"}
          />
        </Field>
        <div className="rounded-[var(--lw-radius-md)] border border-lw-border bg-lw-surface">
          <EditorContent editor={editor} />
        </div>

        {/* Anhänge */}
        <div className="flex flex-wrap items-center gap-2">
          <label
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--lw-radius-md)] border border-lw-border-strong px-3 py-1.5 text-[13px] font-medium text-lw-ink hover:bg-lw-surface-2"
          >
            <Paperclip size={14} />
            {uploading ? t("common.loading") : t("composer.attach")}
            <input
              type="file"
              multiple
              className="hidden"
              disabled={uploading || phase === "scheduled"}
              onChange={(e) => {
                void onFilesSelected(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          {attachments.map((attachment) => (
            <span
              key={attachment.storage_path}
              className="inline-flex items-center gap-1 rounded-full bg-lw-surface-2 px-2.5 py-1 text-[12px] text-lw-ink"
            >
              {attachment.filename}
              <button
                type="button"
                aria-label={t("composer.removeAttachment")}
                className="text-lw-ink-faint hover:text-lw-danger"
                onClick={() =>
                  setAttachments((prev) =>
                    prev.filter((a) => a.storage_path !== attachment.storage_path),
                  )
                }
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      </div>

      {error ? <p className="mt-2 text-[12px] text-lw-danger">{error}</p> : null}

      {phase === "scheduled" ? (
        // Sichtbare Rückhol-Zone (DESIGN.md: destruktiv nie ohne sichtbaren Zustand)
        <div
          className="mt-3 flex items-center justify-between rounded-[var(--lw-radius-md)] px-3 py-2"
          style={{
            backgroundColor: "color-mix(in srgb, var(--lw-warning) 10%, transparent)",
            color: "var(--lw-warning)",
          }}
        >
          <span className="text-[13px] font-medium tabular-nums">
            {t("composer.sendingIn").replace("{s}", String(remaining))}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void onUndo()}>
            {t("composer.undo")}
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={() => void onSend()} disabled={saveDraft.isPending || schedule.isPending}>
            {t("composer.send")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void persistDraft().catch(() => undefined)}
            disabled={saveDraft.isPending}
          >
            {t("composer.saveDraft")}
          </Button>
          <Button variant="ghost" onClick={() => void onDiscard()}>
            {t("composer.discard")}
          </Button>
        </div>
      )}
    </Card>
  );
}
