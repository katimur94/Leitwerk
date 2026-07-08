import type { MailThreadRow } from "@leitwerk/shared";
import { AiBadge, Badge, cn } from "@leitwerk/ui";
import { formatAgo } from "../../lib/format";
import { CATEGORY_META } from "./categories";

/**
 * InboxRow (DESIGN.md Kernkomponente 6): Absender (500) · Betreff (400) ·
 * Snippet (faint) · rechts Kategorie-Chip + Zeit. Ungelesen = 2px Akzent-
 * Balken links, KEIN Fettdruck-Chaos. Kategorie stammt von der KI → AiBadge.
 */
export function InboxRow({
  thread,
  selected,
  onClick,
}: {
  thread: MailThreadRow;
  selected: boolean;
  onClick: () => void;
}) {
  const sender =
    thread.participants?.[0]?.name || thread.participants?.[0]?.email || "—";
  const category = thread.category ? CATEGORY_META[thread.category] : null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "relative flex w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lw-accent",
        selected ? "bg-lw-surface-2" : "hover:bg-lw-surface-2",
      )}
      style={{ minHeight: 40 }}
    >
      {thread.is_unread ? (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 w-[2px] rounded-full"
          style={{ backgroundColor: "var(--lw-accent)" }}
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 truncate text-[13px] font-medium text-lw-ink" style={{ maxWidth: 160 }}>
            {sender}
          </span>
          <span className="min-w-0 truncate text-[13px] text-lw-ink">
            {thread.subject || "(kein Betreff)"}
          </span>
        </div>
        <p className="truncate text-[12px] text-lw-ink-faint">
          {thread.snippet || ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {category ? (
          <AiBadge label={category.label} />
        ) : thread.archived_at ? (
          <Badge tone="neutral">Archiviert</Badge>
        ) : null}
        <span className="text-[11px] tabular-nums text-lw-ink-faint">
          {formatAgo(thread.last_message_at)}
        </span>
      </div>
    </button>
  );
}
