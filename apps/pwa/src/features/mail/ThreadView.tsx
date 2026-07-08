import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, ArchiveRestore, FolderOpen, MailOpen } from "lucide-react";
import type { MailAccountRow, MailThreadRow } from "@leitwerk/shared";
import { AiBadge, Badge, Button, EmptyState, SkeletonRows } from "@leitwerk/ui";
import { t } from "../../i18n/de";
import { formatDateTime } from "../../lib/format";
import { useCases } from "../cases/queries";
import { ThreadCollaboration } from "../team/ThreadCollaboration";
import { useRequestSlots } from "../team/queries";
import { CATEGORY_META, categoryLabel } from "./categories";
import { Composer } from "./Composer";
import {
  useCaseProposal,
  useCorrectCategory,
  useRequestAiJob,
  useResolveCaseProposal,
  useAssignThreadToCase,
  useThreadDrafts,
  useThreadMessages,
  useThreadMutations,
} from "./queries";

const selectClass =
  "h-8 rounded-[var(--lw-radius-sm)] border border-lw-border bg-lw-surface px-2 " +
  "text-[12px] text-lw-ink focus:outline-none focus:ring-2 focus:ring-lw-accent";

/** Vorgangs-Vorschlag der KI (case_match unter der Konfidenz-Schwelle). */
function CaseProposalBanner({ thread }: { thread: MailThreadRow }) {
  const proposal = useCaseProposal(thread.case_id ? undefined : thread.id);
  const resolve = useResolveCaseProposal();
  if (!proposal.data || thread.case_id) return null;
  const detail = proposal.data.detail;
  const text =
    detail.decision === "new"
      ? t("thread.proposal.new").replace("{title}", detail.title ?? "—")
      : t("thread.proposal.existing");

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[var(--lw-radius-md)] border px-3 py-2"
      style={{
        borderColor: "color-mix(in srgb, var(--lw-ai) 35%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--lw-ai) 7%, transparent)",
      }}
    >
      <AiBadge confidence={proposal.data.confidence ?? undefined} />
      <span className="min-w-0 flex-1 text-[13px] text-lw-ink">{text}</span>
      <Button
        size="sm"
        disabled={resolve.isPending}
        onClick={() =>
          resolve.mutate({ proposal: proposal.data!, threadId: thread.id, accept: true })
        }
      >
        {t("thread.proposal.accept")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={resolve.isPending}
        onClick={() =>
          resolve.mutate({ proposal: proposal.data!, threadId: thread.id, accept: false })
        }
      >
        {t("thread.proposal.reject")}
      </Button>
    </div>
  );
}

export function ThreadView({
  thread,
  account,
}: {
  thread: MailThreadRow;
  account: MailAccountRow | undefined;
}) {
  const messages = useThreadMessages(thread.id);
  const drafts = useThreadDrafts(thread.id);
  const { setUnread, setArchived } = useThreadMutations();
  const correctCategory = useCorrectCategory();
  const requestAi = useRequestAiJob();
  const assignCase = useAssignThreadToCase();
  const requestSlots = useRequestSlots();
  const cases = useCases("active");
  const [composerOpen, setComposerOpen] = useState<null | { draftId?: string }>(null);
  const [aiRequested, setAiRequested] = useState(false);
  const [slotsRequested, setSlotsRequested] = useState(false);

  const lastInbound = useMemo(
    () => [...(messages.data ?? [])].reverse().find((m) => m.direction === "inbound"),
    [messages.data],
  );

  const activeDraft = composerOpen?.draftId
    ? (drafts.data ?? []).find((d) => d.id === composerOpen.draftId) ?? null
    : null;

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Kopf: Betreff, Kategorie (KI, korrigierbar), Aktionen */}
      <header className="border-b border-lw-border px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-semibold text-lw-ink">
              {thread.subject || "(kein Betreff)"}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-lw-ink-soft">
              {thread.category ? (
                <AiBadge label={categoryLabel(thread.category)} />
              ) : null}
              <select
                aria-label={t("thread.correctCategory")}
                className={selectClass}
                value={thread.category ?? ""}
                onChange={(e) =>
                  correctCategory.mutate({ threadId: thread.id, category: e.target.value })
                }
              >
                <option value="" disabled>
                  {t("thread.correctCategory")}
                </option>
                {Object.entries(CATEGORY_META).map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.label}
                  </option>
                ))}
              </select>
              {thread.case_id ? (
                <Link
                  to={`/vorgaenge/${thread.case_id}`}
                  className="inline-flex items-center gap-1 text-[12px] font-medium"
                  style={{ color: "var(--lw-accent)" }}
                >
                  <FolderOpen size={13} /> {t("thread.openCase")}
                </Link>
              ) : (
                <select
                  aria-label={t("thread.assignCase")}
                  className={selectClass}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      assignCase.mutate({
                        threadId: thread.id,
                        caseId: e.target.value,
                        isCorrection: false,
                      });
                    }
                  }}
                >
                  <option value="">{t("thread.assignCase")}</option>
                  {(cases.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.case_number} · {c.title}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              title={t("thread.markUnread")}
              onClick={() => setUnread.mutate({ threadId: thread.id, unread: true })}
            >
              <MailOpen size={15} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title={thread.archived_at ? t("thread.unarchive") : t("thread.archive")}
              onClick={() =>
                setArchived.mutate({ threadId: thread.id, archived: !thread.archived_at })
              }
            >
              {thread.archived_at ? <ArchiveRestore size={15} /> : <Archive size={15} />}
            </Button>
          </div>
        </div>
        {thread.ai_summary ? (
          <p
            className="mt-2 rounded-[var(--lw-radius-sm)] px-2 py-1.5 text-[12px]"
            style={{
              backgroundColor: "color-mix(in srgb, var(--lw-ai) 7%, transparent)",
              color: "var(--lw-ink-soft)",
            }}
          >
            <AiBadge label={t("thread.summaryBadge")} className="mr-1.5" /> {thread.ai_summary}
          </p>
        ) : null}
      </header>

      {/* Nachrichten */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto flex max-w-[720px] flex-col gap-4">
          <CaseProposalBanner thread={thread} />

          {messages.isPending ? (
            <SkeletonRows rows={3} />
          ) : messages.isError ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-[13px] text-lw-danger">
                {t("common.error")} ({messages.error.message})
              </p>
              <Button size="sm" variant="secondary" onClick={() => messages.refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          ) : (messages.data ?? []).length === 0 ? (
            <EmptyState title={t("thread.empty")} className="py-10" />
          ) : (
            (messages.data ?? []).map((message) => (
              <article
                key={message.id}
                className="rounded-[var(--lw-radius-md)] border border-lw-border bg-lw-surface p-4"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-[13px] font-medium text-lw-ink">
                    {message.from_addr?.name || message.from_addr?.email}
                    {message.direction === "outbound" ? (
                      <Badge tone="neutral" className="ml-2">
                        {t("thread.outbound")}
                      </Badge>
                    ) : null}
                  </p>
                  <span className="shrink-0 text-[11px] tabular-nums text-lw-ink-faint">
                    {formatDateTime(message.sent_at)}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-lw-ink-faint">
                  an {(message.to_addrs ?? []).map((a) => a.email).join(", ") || "—"}
                </p>
                <div className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-lw-ink">
                  {message.body_text || "(kein Inhalt)"}
                </div>
                {message.has_attachments ? (
                  <p className="mt-2 text-[12px] text-lw-ink-faint">📎 {t("thread.hasAttachments")}</p>
                ) : null}
              </article>
            ))
          )}

          {/* KI-Entwürfe / eigene Entwürfe */}
          {(drafts.data ?? [])
            .filter((d) => d.id !== composerOpen?.draftId)
            .map((draft) => (
              <div
                key={draft.id}
                className="rounded-[var(--lw-radius-md)] border p-3"
                style={{
                  borderColor:
                    draft.source === "ai"
                      ? "color-mix(in srgb, var(--lw-ai) 35%, transparent)"
                      : "var(--lw-border)",
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {draft.source === "ai" ? (
                      <AiBadge label={t("composer.aiDraft")} />
                    ) : (
                      <Badge tone="neutral">{t("thread.draft")}</Badge>
                    )}
                    <span className="text-[13px] text-lw-ink">{draft.subject}</span>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setComposerOpen({ draftId: draft.id })}>
                    {t("thread.editDraft")}
                  </Button>
                </div>
                <div
                  className="mt-2 max-h-32 overflow-hidden text-[13px] text-lw-ink-soft"
                  // KI-/Nutzer-HTML nur als Vorschau
                  dangerouslySetInnerHTML={{ __html: draft.body_html ?? "" }}
                />
              </div>
            ))}

          {/* Composer (Antwort) */}
          {composerOpen && account ? (
            <Composer
              accountId={account.id}
              threadId={thread.id}
              draft={activeDraft}
              initialTo={lastInbound ? [lastInbound.from_addr] : []}
              initialSubject={
                thread.subject?.toLowerCase().startsWith("re:")
                  ? thread.subject
                  : `Re: ${thread.subject ?? ""}`
              }
              signatureHtml={account.signature_html}
              onClose={() => setComposerOpen(null)}
            />
          ) : null}
        </div>
      </div>

      {/* Aktionsleiste */}
      {!composerOpen ? (
        <footer className="flex flex-wrap items-center gap-2 border-t border-lw-border px-5 py-3">
          <Button size="sm" onClick={() => setComposerOpen({})}>
            {t("thread.reply")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={requestAi.isPending || aiRequested}
            onClick={() => {
              requestAi.mutate({ jobType: "draft_reply", threadId: thread.id });
              setAiRequested(true);
            }}
          >
            {/* Violetter Punkt = KI-Herkunft (DESIGN.md: kein Sparkle-Icon) */}
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "var(--lw-ai)" }}
            />
            {aiRequested ? t("thread.aiDraftPending") : t("thread.aiDraft")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={requestAi.isPending}
            onClick={() => requestAi.mutate({ jobType: "thread_summary", threadId: thread.id })}
          >
            {t("thread.summarize")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={requestSlots.isPending || slotsRequested}
            onClick={() => {
              requestSlots.mutate(thread.id);
              setSlotsRequested(true);
            }}
          >
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "var(--lw-ai)" }}
            />
            {slotsRequested ? t("thread.slotsPending") : t("thread.suggestSlots")}
          </Button>
          {requestAi.isError ? (
            <span className="text-[12px] text-lw-danger">{requestAi.error.message}</span>
          ) : null}
        </footer>
      ) : null}

      {/* Geteiltes Postfach: Zuweisung + interne Kommentare (Etappe 5) */}
      <ThreadCollaboration threadId={thread.id} assigneeId={thread.assignee_id ?? null} />
    </div>
  );
}
