import { useState } from "react";
import { Banknote, Clock, FileText, Phone, Plane, Receipt } from "lucide-react";
import { AiBadge, Badge, Button, Card, EmptyState, Input, SkeletonRows, cn } from "@leitwerk/ui";
import type { PaymentMatchRow } from "@leitwerk/shared";
import {
  useAbsenceMutations,
  useAbsences,
  useBankTransactions,
  useCallLogs,
  useContracts,
  useExportBatches,
  useExportDatev,
  useLogCall,
  usePaymentMatches,
  useResolveMatch,
  useTimeEntries,
  useTimeMutations,
} from "../features/office/queries";
import { t } from "../i18n/de";
import { formatDateTime } from "../lib/format";
// (formatDateTime in CallsTab)

type Tab = "time" | "bank" | "datev" | "contracts" | "calls" | "absences";

const eur = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(v);

const TABS: Array<{ key: Tab; icon: typeof Clock; labelKey: string }> = [
  { key: "time", icon: Clock, labelKey: "office.tab.time" },
  { key: "bank", icon: Banknote, labelKey: "office.tab.bank" },
  { key: "datev", icon: Receipt, labelKey: "office.tab.datev" },
  { key: "contracts", icon: FileText, labelKey: "office.tab.contracts" },
  { key: "calls", icon: Phone, labelKey: "office.tab.calls" },
  { key: "absences", icon: Plane, labelKey: "office.tab.absences" },
];

function TimeTab() {
  const entries = useTimeEntries();
  const { add, confirmSuggestion, remove } = useTimeMutations();
  const [minutes, setMinutes] = useState("30");
  const [desc, setDesc] = useState("");
  const [billable, setBillable] = useState(false);

  const total = (entries.data ?? []).reduce((s, e) => s + e.minutes, 0);

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <h3 className="text-[14px] font-semibold text-lw-ink">{t("office.time.new")}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input id="time-desc" placeholder={t("office.time.descPlaceholder")} value={desc}
            onChange={(e) => setDesc(e.target.value)} className="min-w-[220px] flex-1" />
          <Input id="time-minutes" type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)}
            className="w-20" aria-label={t("office.time.minutes")} />
          <label className="flex items-center gap-1.5 text-[12px] text-lw-ink">
            <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)}
              className="h-4 w-4 accent-[var(--lw-accent)]" />
            {t("office.time.billable")}
          </label>
          <Button size="sm" disabled={add.isPending || !desc.trim()}
            onClick={() => add.mutate({ minutes: Number(minutes) || 30, description: desc, isBillable: billable },
              { onSuccess: () => { setDesc(""); setMinutes("30"); setBillable(false); } })}>
            {t("office.time.add")}
          </Button>
        </div>
      </Card>
      {entries.isPending ? (
        <SkeletonRows rows={4} />
      ) : (entries.data ?? []).length === 0 ? (
        <EmptyState icon={<Clock />} title={t("office.time.empty.title")} description={t("office.time.empty.description")} className="py-10" />
      ) : (
        <Card className="p-4">
          <p className="mb-2 text-[12px] text-lw-ink-faint">
            {t("office.time.weekTotal").replace("{h}", (total / 60).toFixed(1))}
          </p>
          <ul className="divide-y divide-lw-border">
            {(entries.data ?? []).map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2">
                <span className="w-16 shrink-0 tabular-nums text-[13px] text-lw-ink">{(e.minutes / 60).toFixed(2)} h</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-lw-ink">{e.description ?? "—"}</span>
                {e.source === "ai_suggested" ? <AiBadge label={t("office.time.suggested")} /> : null}
                {e.is_billable ? <Badge tone="success">{t("office.time.billableBadge")}</Badge> : null}
                <span className="text-[12px] text-lw-ink-faint">{e.work_date}</span>
                {e.source === "ai_suggested" ? (
                  <Button size="sm" variant="secondary" onClick={() => confirmSuggestion.mutate(e.id)}>{t("common.confirm")}</Button>
                ) : null}
                {!e.locked_at ? (
                  <button aria-label={t("common.delete")} className="text-lw-ink-faint hover:text-lw-danger"
                    onClick={() => remove.mutate(e.id)}>×</button>
                ) : <Badge tone="neutral">{t("office.time.billed")}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function BankTab() {
  const tx = useBankTransactions();
  const matches = usePaymentMatches();
  const resolve = useResolveMatch();
  const matchByTx = new Map((matches.data ?? []).map((m) => [m.transaction_id, m]));

  if (tx.isPending) return <SkeletonRows rows={4} />;
  if ((tx.data ?? []).length === 0) {
    return <EmptyState icon={<Banknote />} title={t("office.bank.empty.title")} description={t("office.bank.empty.description")} className="py-10" />;
  }
  return (
    <ul className="divide-y divide-lw-border">
      {(tx.data ?? []).map((row) => {
        const m = matchByTx.get(row.id) as (PaymentMatchRow & { invoices_out?: { invoice_number: string } | null }) | undefined;
        return (
          <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <span className={cn("w-24 shrink-0 tabular-nums text-[14px]", row.amount >= 0 ? "text-lw-success" : "text-lw-ink")}>{eur(row.amount)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-lw-ink">{row.counterpart_name ?? "—"}</p>
              <p className="truncate text-[12px] text-lw-ink-faint">{row.purpose ?? ""} · {row.booked_on}</p>
            </div>
            {m && m.status === "suggested" ? (
              <>
                <AiBadge confidence={m.confidence ?? undefined} label={t("office.bank.suggested").replace("{nr}", m.invoices_out?.invoice_number ?? "?")} />
                <Button size="sm" disabled={resolve.isPending} onClick={() => resolve.mutate({ match: m, confirm: true })}>{t("office.bank.confirm")}</Button>
                <Button size="sm" variant="ghost" disabled={resolve.isPending} onClick={() => resolve.mutate({ match: m, confirm: false })}>{t("common.reject")}</Button>
              </>
            ) : (
              <Badge tone={row.match_status === "matched" ? "success" : "neutral"}>{row.match_status}</Badge>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DatevTab() {
  const batches = useExportBatches();
  const exportDatev = useExportDatev();
  const now = new Date();
  const [start, setStart] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
  const [end, setEnd] = useState(now.toISOString().slice(0, 10));

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <h3 className="text-[14px] font-semibold text-lw-ink">{t("office.datev.new")}</h3>
        <p className="mt-1 text-[12px] text-lw-warning">{t("office.datev.advisorHint")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input id="datev-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-40" />
          <Input id="datev-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-40" />
          <Button size="sm" disabled={exportDatev.isPending}
            onClick={() => exportDatev.mutate({ periodStart: start, periodEnd: end },
              { onSuccess: (d) => { if (d.signedUrl) window.open(d.signedUrl, "_blank"); } })}>
            {exportDatev.isPending ? t("office.datev.running") : t("office.datev.generate")}
          </Button>
          {exportDatev.isError ? <span className="text-[12px] text-lw-danger">{exportDatev.error.message}</span> : null}
          {exportDatev.isSuccess ? <span className="text-[12px]" style={{ color: "var(--lw-success)" }}>{t("office.datev.done")}</span> : null}
        </div>
      </Card>
      {batches.isPending ? (
        <SkeletonRows rows={2} />
      ) : (batches.data ?? []).length === 0 ? (
        <EmptyState icon={<Receipt />} title={t("office.datev.empty.title")} description={t("office.datev.empty.description")} className="py-8" />
      ) : (
        <Card className="p-4">
          <ul className="divide-y divide-lw-border">
            {(batches.data ?? []).map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-2 text-[13px]">
                <span className="flex-1 text-lw-ink">EXTF {b.period_start} – {b.period_end}</span>
                <span className="text-lw-ink-faint">{b.item_count} Buchungen</span>
                <span className="tabular-nums text-lw-ink">S {eur(b.total_debit)} / H {eur(b.total_credit)}</span>
                <Badge tone="neutral">{b.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ContractsTab() {
  const contracts = useContracts();
  if (contracts.isPending) return <SkeletonRows rows={4} />;
  if ((contracts.data ?? []).length === 0) {
    return <EmptyState icon={<FileText />} title={t("office.contracts.empty.title")} description={t("office.contracts.empty.description")} className="py-10" />;
  }
  const totalYearly = (contracts.data ?? []).reduce((s, c) => s + (c.yearly_cost ?? 0), 0);
  return (
    <Card className="p-4">
      <p className="mb-2 text-[12px] text-lw-ink-faint">{t("office.contracts.yearlyTotal").replace("{sum}", eur(totalYearly))}</p>
      <ul className="divide-y divide-lw-border">
        {(contracts.data ?? []).map((c) => {
          const days = c.notice_deadline ? Math.floor((Date.parse(c.notice_deadline) - Date.now()) / 86_400_000) : null;
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[13px] font-medium text-lw-ink">
                  {c.title}
                  {c.extraction_confidence != null ? <AiBadge confidence={c.extraction_confidence} label={t("office.contracts.extracted")} /> : null}
                </p>
                <p className="text-[12px] text-lw-ink-faint">{c.category ?? "—"} · {eur(c.yearly_cost)}/Jahr</p>
              </div>
              {c.notice_deadline ? (
                <Badge tone={days != null && days <= 30 ? "danger" : days != null && days <= 90 ? "warning" : "neutral"}>
                  {t("office.contracts.noticeBy").replace("{date}", c.notice_deadline)}
                </Badge>
              ) : null}
              <Badge tone={c.status === "active" ? "success" : "neutral"}>{c.status}</Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function CallsTab() {
  const calls = useCallLogs();
  const log = useLogCall();
  const [phone, setPhone] = useState("");
  const [summary, setSummary] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <h3 className="text-[14px] font-semibold text-lw-ink">{t("office.calls.new")}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input id="call-phone" placeholder={t("office.calls.phone")} value={phone} onChange={(e) => setPhone(e.target.value)} className="w-40" />
          <Input id="call-summary" placeholder={t("office.calls.summary")} value={summary} onChange={(e) => setSummary(e.target.value)} className="min-w-[220px] flex-1" />
          <Button size="sm" disabled={log.isPending || !summary.trim()}
            onClick={() => log.mutate({ phone, summary, direction: "outbound" }, { onSuccess: () => { setPhone(""); setSummary(""); } })}>
            {t("office.calls.add")}
          </Button>
        </div>
      </Card>
      {calls.isPending ? (
        <SkeletonRows rows={3} />
      ) : (calls.data ?? []).length === 0 ? (
        <EmptyState icon={<Phone />} title={t("office.calls.empty.title")} description={t("office.calls.empty.description")} className="py-8" />
      ) : (
        <Card className="p-4">
          <ul className="divide-y divide-lw-border">
            {(calls.data ?? []).map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2 text-[13px]">
                <Badge tone="neutral">{c.direction}</Badge>
                <span className="min-w-0 flex-1 truncate text-lw-ink">{c.summary ?? c.phone_number ?? "—"}</span>
                <span className="text-[12px] text-lw-ink-faint">{formatDateTime(c.occurred_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function AbsencesTab() {
  const absences = useAbsences();
  const { request, decide } = useAbsenceMutations();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <h3 className="text-[14px] font-semibold text-lw-ink">{t("office.absences.new")}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input id="absence-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-40" />
          <Input id="absence-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-40" />
          <Button size="sm" disabled={request.isPending || !start || !end}
            onClick={() => request.mutate({ kind: "vacation", startsOn: start, endsOn: end, note: "" }, { onSuccess: () => { setStart(""); setEnd(""); } })}>
            {t("office.absences.request")}
          </Button>
        </div>
      </Card>
      {absences.isPending ? (
        <SkeletonRows rows={3} />
      ) : (absences.data ?? []).length === 0 ? (
        <EmptyState icon={<Plane />} title={t("office.absences.empty.title")} description={t("office.absences.empty.description")} className="py-8" />
      ) : (
        <Card className="p-4">
          <ul className="divide-y divide-lw-border">
            {(absences.data ?? []).map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2 text-[13px]">
                <Badge tone="neutral">{a.kind}</Badge>
                <span className="min-w-0 flex-1 text-lw-ink">{a.starts_on} – {a.ends_on} ({a.days_counted ?? "?"} Tage)</span>
                <Badge tone={a.status === "approved" ? "success" : a.status === "rejected" ? "danger" : "neutral"}>{a.status}</Badge>
                {a.status === "requested" ? (
                  <>
                    <Button size="sm" onClick={() => decide.mutate({ id: a.id, status: "approved" })}>{t("office.absences.approve")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: a.id, status: "rejected" })}>{t("common.reject")}</Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Komplett-Büro (Etappe 6): Zeit, Bank, DATEV, Verträge, Anrufe, Abwesenheiten. */
export function Office() {
  const [tab, setTab] = useState<Tab>("time");
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-8">
      <header>
        <h1 className="text-[24px] font-semibold text-lw-ink">{t("office.title")}</h1>
        <p className="mt-1 text-[14px] text-lw-ink-soft">{t("office.subtitle")}</p>
      </header>
      <div className="flex flex-wrap gap-1">
        {TABS.map((entry) => (
          <button key={entry.key} type="button" onClick={() => setTab(entry.key)}
            className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors",
              tab === entry.key ? "bg-lw-surface-2 text-lw-ink" : "text-lw-ink-faint hover:text-lw-ink-soft")}>
            <entry.icon size={14} /> {t(entry.labelKey)}
          </button>
        ))}
      </div>
      <Card className="p-5">
        {tab === "time" ? <TimeTab /> : null}
        {tab === "bank" ? <BankTab /> : null}
        {tab === "datev" ? <DatevTab /> : null}
        {tab === "contracts" ? <ContractsTab /> : null}
        {tab === "calls" ? <CallsTab /> : null}
        {tab === "absences" ? <AbsencesTab /> : null}
      </Card>
    </div>
  );
}
