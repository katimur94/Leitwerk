import { useMemo, useState } from "react";
import { Plus, Receipt, ShieldOff } from "lucide-react";
import {
  formatCents,
  type DunningRunRow,
  type InvoiceInRow,
  type InvoiceOutRow,
  type QuoteRow,
} from "@leitwerk/shared";
import { AiBadge, Badge, Button, Card, EmptyState, SkeletonRows, cn } from "@leitwerk/ui";
import { DocEditor } from "../features/finance/DocEditor";
import {
  useCreateDocument,
  useDocuments,
  useDunningRuns,
  useInvoicesIn,
  useMyRole,
  useResolveDunning,
  useUpdateInvoiceIn,
} from "../features/finance/queries";
import { t } from "../i18n/de";
import { formatAgo } from "../lib/format";

type Tab = "overview" | "incoming" | "invoices" | "quotes" | "dunning";

const TABS: Array<{ key: Tab; labelKey: string }> = [
  { key: "overview", labelKey: "finance.tab.overview" },
  { key: "incoming", labelKey: "finance.tab.incoming" },
  { key: "invoices", labelKey: "finance.tab.invoices" },
  { key: "quotes", labelKey: "finance.tab.quotes" },
  { key: "dunning", labelKey: "finance.tab.dunning" },
];

const IN_STATUS: Record<string, { label: string; next?: InvoiceInRow["status"]; nextLabel?: string }> = {
  captured: { label: "Erfasst", next: "review", nextLabel: "Prüfen" },
  review: { label: "In Prüfung", next: "approved", nextLabel: "Freigeben" },
  approved: { label: "Freigegeben", next: "paid", nextLabel: "Als bezahlt markieren" },
  paid: { label: "Bezahlt" },
  rejected: { label: "Abgelehnt" },
};

function cents(value: number | null): string {
  return value == null ? "—" : formatCents(Math.round(value * 100));
}

function IncomingTab() {
  const invoices = useInvoicesIn();
  const update = useUpdateInvoiceIn();

  if (invoices.isPending) return <SkeletonRows rows={4} />;
  if (invoices.isError) {
    return (
      <p className="text-[13px] text-lw-danger">
        {t("common.error")} ({invoices.error.message})
      </p>
    );
  }
  if ((invoices.data ?? []).length === 0) {
    return (
      <EmptyState
        icon={<Receipt />}
        title={t("finance.incoming.empty.title")}
        description={t("finance.incoming.empty.description")}
        className="py-10"
      />
    );
  }
  return (
    <ul className="divide-y divide-lw-border">
      {(invoices.data ?? []).map((invoice) => {
        const meta = IN_STATUS[invoice.status] ?? { label: invoice.status };
        return (
          <li key={invoice.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[14px] font-medium text-lw-ink">
                {invoice.invoice_number ?? "(ohne Nummer)"}
                {invoice.is_einvoice ? <AiBadge label="E-Rechnung" /> : null}
                {invoice.duplicate_of ? <Badge tone="danger">{t("finance.duplicate")}</Badge> : null}
              </p>
              <p className="text-[12px] text-lw-ink-faint">
                {invoice.companies?.name ?? "—"} · fällig {invoice.due_date ?? "—"} ·{" "}
                {formatAgo(invoice.created_at)}
                {invoice.format_detected ? ` · ${invoice.format_detected}` : ""}
              </p>
            </div>
            <span className="tabular-nums text-[14px] text-lw-ink">{cents(invoice.gross_amount)}</span>
            <Badge tone={invoice.status === "paid" ? "success" : "neutral"}>{meta.label}</Badge>
            {meta.next ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={update.isPending}
                onClick={() => update.mutate({ id: invoice.id, status: meta.next! })}
              >
                {meta.nextLabel}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function DocsTab({ kind }: { kind: "invoice" | "quote" }) {
  const docs = useDocuments(kind);
  const create = useCreateDocument(kind);
  const [openId, setOpenId] = useState<string | null>(null);

  const open = (docs.data ?? []).find((d) => d.id === openId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button
          size="sm"
          disabled={create.isPending}
          onClick={() => create.mutate(undefined, { onSuccess: (id) => setOpenId(id) })}
        >
          <Plus size={14} /> {kind === "invoice" ? t("finance.newInvoice") : t("finance.newQuote")}
        </Button>
        {create.isError ? (
          <p className="mt-1 text-[12px] text-lw-danger">{create.error.message}</p>
        ) : null}
      </div>

      {open ? (
        <DocEditor kind={kind} doc={open} onClose={() => setOpenId(null)} />
      ) : null}

      {docs.isPending ? (
        <SkeletonRows rows={4} />
      ) : docs.isError ? (
        <p className="text-[13px] text-lw-danger">
          {t("common.error")} ({docs.error.message})
        </p>
      ) : (docs.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title={kind === "invoice" ? t("finance.invoices.empty") : t("finance.quotes.empty")}
          description={t("finance.docs.emptyHint")}
          className="py-10"
        />
      ) : (
        <ul className="divide-y divide-lw-border">
          {(docs.data ?? []).map((doc) => {
            const number =
              kind === "invoice"
                ? (doc as InvoiceOutRow).invoice_number
                : (doc as QuoteRow).quote_number;
            return (
              <li key={doc.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-lw-surface-2"
                  onClick={() => setOpenId(doc.id)}
                >
                  <span className="w-[110px] shrink-0 font-mono text-[12px] text-lw-ink-faint">
                    {number}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-lw-ink">
                    {doc.companies?.name ?? "—"}
                  </span>
                  <span className="tabular-nums text-[13px] text-lw-ink">
                    {cents(doc.gross_amount)}
                  </span>
                  <Badge
                    tone={
                      ["paid", "accepted"].includes(doc.status)
                        ? "success"
                        : doc.status === "overdue"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {doc.status}
                  </Badge>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DunningTab() {
  const runs = useDunningRuns();
  const resolve = useResolveDunning();

  if (runs.isPending) return <SkeletonRows rows={3} />;
  if (runs.isError) {
    return (
      <p className="text-[13px] text-lw-danger">
        {t("common.error")} ({runs.error.message})
      </p>
    );
  }
  if ((runs.data ?? []).length === 0) {
    return (
      <EmptyState
        icon={<Receipt />}
        title={t("finance.dunning.empty.title")}
        description={t("finance.dunning.empty.description")}
        className="py-10"
      />
    );
  }
  return (
    <ul className="divide-y divide-lw-border">
      {(runs.data ?? []).map((run) => (
        <li key={run.id} className="flex flex-wrap items-center gap-3 py-2.5">
          <AiBadge label={`Mahnstufe ${run.level}`} />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium text-lw-ink">
              {run.invoices_out?.invoice_number ?? "—"}
            </p>
            <p className="text-[12px] text-lw-ink-faint">
              fällig seit {run.invoices_out?.due_date ?? "—"} · Gebühr{" "}
              {formatCents(Math.round(run.fee * 100))}
            </p>
          </div>
          <span className="tabular-nums text-[14px] text-lw-ink">
            {run.invoices_out ? cents(run.invoices_out.gross_amount) : "—"}
          </span>
          <Badge tone={run.status === "sent" ? "success" : "neutral"}>{run.status}</Badge>
          {run.status === "proposed" ? (
            <>
              <Button
                size="sm"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ dunning: run as DunningRunRow, approve: true })}
              >
                {t("finance.dunning.approve")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ dunning: run as DunningRunRow, approve: false })}
              >
                {t("finance.dunning.skip")}
              </Button>
            </>
          ) : null}
          {resolve.isError ? (
            <span className="text-[12px] text-lw-danger">{resolve.error.message}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function OverviewTab() {
  const incoming = useInvoicesIn();
  const invoices = useDocuments("invoice");
  const quotes = useDocuments("quote");

  const stats = useMemo(() => {
    const openIn = (incoming.data ?? []).filter((i) => !["paid", "rejected"].includes(i.status));
    const openOut = (invoices.data ?? []).filter((i) =>
      ["sent", "overdue", "partially_paid"].includes(i.status),
    );
    const pipeline = (quotes.data ?? []).filter((q) => ["sent", "followed_up"].includes(q.status));
    const sum = (rows: Array<{ gross_amount: number | null }>) =>
      rows.reduce((total, row) => total + Math.round((row.gross_amount ?? 0) * 100), 0);
    return {
      openInCount: openIn.length,
      openInSum: sum(openIn),
      openOutCount: openOut.length,
      openOutSum: sum(openOut),
      pipelineCount: pipeline.length,
      pipelineSum: sum(pipeline),
    };
  }, [incoming.data, invoices.data, quotes.data]);

  if (incoming.isPending || invoices.isPending || quotes.isPending) return <SkeletonRows rows={3} />;

  const tiles = [
    { label: t("finance.overview.openOut"), count: stats.openOutCount, sum: stats.openOutSum },
    { label: t("finance.overview.openIn"), count: stats.openInCount, sum: stats.openInSum },
    { label: t("finance.overview.pipeline"), count: stats.pipelineCount, sum: stats.pipelineSum },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-[var(--lw-radius-md)] border border-lw-border p-4">
          <p className="text-[12px] text-lw-ink-soft">{tile.label}</p>
          <p className="mt-1 text-[24px] font-semibold tabular-nums text-lw-ink">
            {formatCents(tile.sum)}
          </p>
          <p className="text-[12px] text-lw-ink-faint">{tile.count} offen</p>
        </div>
      ))}
    </div>
  );
}

export function Finance() {
  const role = useMyRole();
  const [tab, setTab] = useState<Tab>("overview");

  // Viewer sieht KEINE Finanzdaten (RLS + UI, CLAUDE.md Regel 3 / Rollenmatrix)
  if (role.data === "viewer") {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<ShieldOff />}
          title={t("finance.viewer.title")}
          description={t("finance.viewer.description")}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-8">
      <header>
        <h1 className="text-[24px] font-semibold text-lw-ink">{t("finance.title")}</h1>
        <p className="mt-1 text-[14px] text-lw-ink-soft">{t("finance.subtitle")}</p>
      </header>

      <div className="flex gap-1">
        {TABS.map((entry) => (
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
            {t(entry.labelKey)}
          </button>
        ))}
      </div>

      <Card className="p-5">
        {tab === "overview" ? <OverviewTab /> : null}
        {tab === "incoming" ? <IncomingTab /> : null}
        {tab === "invoices" ? <DocsTab kind="invoice" /> : null}
        {tab === "quotes" ? <DocsTab kind="quote" /> : null}
        {tab === "dunning" ? <DunningTab /> : null}
      </Card>
    </div>
  );
}
