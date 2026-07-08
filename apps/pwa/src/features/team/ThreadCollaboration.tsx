import { useState } from "react";
import { AtSign, UserCheck } from "lucide-react";
import { Button } from "@leitwerk/ui";
import { t } from "../../i18n/de";
import { formatAgo } from "../../lib/format";
import {
  useAddComment,
  useAssignThread,
  useOrgMembers,
  useThreadComments,
} from "./queries";

const selectClass =
  "rounded-[var(--lw-radius-sm)] border border-lw-border bg-lw-surface px-2 py-1 text-[12px] text-lw-ink outline-none focus:ring-2 focus:ring-lw-accent";

/**
 * Geteiltes Postfach (Etappe 5): Thread einem Mitglied zuweisen und intern
 * kommentieren (mit @Mentions) — ohne Weiterleiten-Chaos (MASTERPLAN §4 Y).
 */
export function ThreadCollaboration({
  threadId,
  assigneeId,
}: {
  threadId: string;
  assigneeId: string | null;
}) {
  const members = useOrgMembers();
  const assign = useAssignThread();
  const comments = useThreadComments(threadId);
  const addComment = useAddComment(threadId);
  const [body, setBody] = useState("");

  const memberList = members.data ?? [];
  const nameFor = (id: string | null) =>
    memberList.find((m) => m.user_id === id)?.display_name ?? "—";

  function submit() {
    const text = body.trim();
    if (!text) return;
    // @Name → user_ids auflösen (Anzeigename, case-insensitive, ganzes Wort)
    const mentions = memberList
      .filter((m) => new RegExp(`@${m.display_name}\\b`, "i").test(text))
      .map((m) => m.user_id);
    addComment.mutate({ body: text, mentions }, { onSuccess: () => setBody("") });
  }

  return (
    <section className="border-t border-lw-border px-5 py-3">
      <div className="flex items-center gap-2">
        <UserCheck size={14} className="text-lw-ink-faint" />
        <span className="text-[12px] text-lw-ink-soft">{t("collab.assignee")}:</span>
        <select
          aria-label={t("collab.assign")}
          className={selectClass}
          value={assigneeId ?? ""}
          disabled={assign.isPending}
          onChange={(e) => assign.mutate({ threadId, assignee: e.target.value || null })}
        >
          <option value="">{t("collab.unassigned")}</option>
          {memberList.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.display_name}
            </option>
          ))}
        </select>
        {assigneeId ? (
          <span className="text-[12px] text-lw-ink-faint">→ {nameFor(assigneeId)}</span>
        ) : null}
      </div>

      <div className="mt-3">
        <h4 className="flex items-center gap-1.5 text-[12px] font-medium text-lw-ink-soft">
          <AtSign size={13} /> {t("collab.comments")}
        </h4>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {(comments.data ?? []).map((c) => (
            <li key={c.id} className="rounded-[var(--lw-radius-sm)] bg-lw-surface-2 px-2.5 py-1.5">
              <p className="text-[12px] text-lw-ink">{c.body}</p>
              <p className="mt-0.5 text-[11px] text-lw-ink-faint">
                {nameFor(c.author_id)} · {formatAgo(c.created_at)}
              </p>
            </li>
          ))}
          {(comments.data ?? []).length === 0 ? (
            <li className="text-[12px] text-lw-ink-faint">{t("collab.noComments")}</li>
          ) : null}
        </ul>
        <div className="mt-2 flex items-center gap-2">
          <input
            id="thread-comment"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={t("collab.commentPlaceholder")}
            className="h-8 flex-1 rounded-[var(--lw-radius-sm)] border border-lw-border bg-lw-surface px-2 text-[13px] text-lw-ink outline-none focus:ring-2 focus:ring-lw-accent"
          />
          <Button size="sm" disabled={addComment.isPending || !body.trim()} onClick={submit}>
            {t("collab.send")}
          </Button>
        </div>
        {addComment.isError ? (
          <p className="mt-1 text-[12px] text-lw-danger">{addComment.error.message}</p>
        ) : null}
      </div>
    </section>
  );
}
