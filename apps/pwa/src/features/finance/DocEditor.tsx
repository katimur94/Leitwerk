import { useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import { formatCents, toCents, type InvoiceOutRow, type QuoteRow } from "@leitwerk/shared";
import { Badge, Button, Card, Input, SkeletonRows } from "@leitwerk/ui";
import { t } from "../../i18n/de";
import {
  useDocItems,
  useDocMutations,
  useExportXrechnung,
  type DocKind,
} from "./queries";

const INVOICE_STATUS: Array<InvoiceOutRow["status"]> = ["draft", "approved", "sent", "paid"];
const QUOTE_STATUS: Array<QuoteRow["status"]> = ["draft", "sent", "accepted", "rejected"];

const STATUS_LABELS: Record<string, string> = {
  draft: "Entwurf",
  approved: "Freigegeben",
  sent: "Versendet",
  partially_paid: "Teilbezahlt",
  paid: "Bezahlt",
  overdue: "Überfällig",
  cancelled: "Storniert",
  followed_up: "Nachgefasst",
  accepted: "Angenommen",
  rejected: "Abgelehnt",
  expired: "Abgelaufen",
};

/** Gemeinsamer Beleg-Editor für Angebote und Rechnungen (MoneyCell-Prinzip). */
export function DocEditor({
  kind,
  doc,
  onClose,
}: {
  kind: DocKind;
  doc: (InvoiceOutRow | QuoteRow) & { companies?: { name: string } | null };
  onClose: () => void;
}) {
  const items = useDocItems(kind, doc.id);
  const { updateDoc, addItem, updateItem, deleteItem } = useDocMutations(kind, doc.id);
  const exportXml = useExportXrechnung();
  const [isB2G, setIsB2G] = useState(false);
  const number = kind === "invoice"
    ? (doc as InvoiceOutRow).invoice_number
    : (doc as QuoteRow).quote_number;
  const statusOptions = kind === "invoice" ? INVOICE_STATUS : QUOTE_STATUS;
  const editable = doc.status === "draft";

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] text-lw-ink-faint">{number}</span>
          <Badge tone={doc.status === "paid" || doc.status === "accepted" ? "success" : doc.status === "overdue" ? "danger" : "neutral"}>
            {STATUS_LABELS[doc.status] ?? doc.status}
          </Badge>
          {doc.companies?.name ? <Badge tone="neutral">{doc.companies.name}</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          {statusOptions
            .filter((status) => status !== doc.status)
            .slice(0, 3)
            .map((status) => (
              <Button
                key={status}
                size="sm"
                variant="secondary"
                disabled={updateDoc.isPending}
                onClick={() => updateDoc.mutate({ status })}
              >
                {STATUS_LABELS[status]}
              </Button>
            ))}
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t("composer.close")}
          </Button>
        </div>
      </div>

      {/* Positionen */}
      <div className="mt-4 overflow-x-auto">
        {items.isPending ? (
          <SkeletonRows rows={2} />
        ) : items.isError ? (
          <p className="text-[13px] text-lw-danger">
            {t("common.error")} ({items.error.message})
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-lw-ink-faint">
                <th className="py-1 pr-2">Beschreibung</th>
                <th className="w-20 py-1 pr-2 text-right">Menge</th>
                <th className="w-16 py-1 pr-2">Einheit</th>
                <th className="w-28 py-1 pr-2 text-right">Einzelpreis</th>
                <th className="w-20 py-1 pr-2 text-right">USt %</th>
                <th className="w-28 py-1 pr-2 text-right">Netto</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {(items.data ?? []).map((item) => (
                <tr key={item.id} className="border-t border-lw-border">
                  <td className="py-1 pr-2">
                    <Input
                      defaultValue={item.description}
                      disabled={!editable}
                      className="h-8 text-[13px]"
                      onBlur={(e) =>
                        updateItem.mutate({ id: item.id, patch: { description: e.target.value } })
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      defaultValue={String(item.quantity)}
                      disabled={!editable}
                      className="h-8 text-right text-[13px] tabular-nums"
                      onBlur={(e) =>
                        updateItem.mutate({
                          id: item.id,
                          patch: { quantity: Number(e.target.value.replace(",", ".")) || 0 },
                        })
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      defaultValue={item.unit}
                      disabled={!editable}
                      className="h-8 text-[13px]"
                      onBlur={(e) => updateItem.mutate({ id: item.id, patch: { unit: e.target.value } })}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      defaultValue={item.unit_price.toFixed(2).replace(".", ",")}
                      disabled={!editable}
                      className="h-8 text-right text-[13px] tabular-nums"
                      onBlur={(e) =>
                        updateItem.mutate({
                          id: item.id,
                          patch: { unit_price: toCents(e.target.value) / 100 },
                        })
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      defaultValue={String(item.vat_rate)}
                      disabled={!editable}
                      className="h-8 text-right text-[13px] tabular-nums"
                      onBlur={(e) =>
                        updateItem.mutate({
                          id: item.id,
                          patch: { vat_rate: Number(e.target.value.replace(",", ".")) || 0 },
                        })
                      }
                    />
                  </td>
                  {/* MoneyCell: rechtsbündig, tabular-nums (DESIGN.md) */}
                  <td className="py-1 pr-2 text-right tabular-nums text-lw-ink">
                    {formatCents(Math.round(item.net_total * 100))}
                  </td>
                  <td className="py-1">
                    {editable ? (
                      <button
                        aria-label="Position löschen"
                        className="text-lw-ink-faint hover:text-lw-danger"
                        onClick={() => deleteItem.mutate(item.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editable ? (
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          onClick={() => addItem.mutate((items.data ?? []).length + 1)}
        >
          <Plus size={14} /> {t("finance.addItem")}
        </Button>
      ) : null}

      {/* Summen */}
      <div className="mt-4 flex justify-end">
        <div className="w-56 text-[13px] tabular-nums">
          <div className="flex justify-between text-lw-ink-soft">
            <span>Netto</span>
            <span>{formatCents(Math.round(doc.net_amount * 100))}</span>
          </div>
          <div className="flex justify-between text-lw-ink-soft">
            <span>USt.</span>
            <span>{formatCents(Math.round(doc.vat_amount * 100))}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-lw-border pt-1 font-semibold text-lw-ink">
            <span>Brutto</span>
            <span>{formatCents(Math.round(doc.gross_amount * 100))}</span>
          </div>
        </div>
      </div>

      {/* XRechnung (nur Rechnungen) */}
      {kind === "invoice" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-lw-border pt-3">
          <label className="flex items-center gap-2 text-[12px] text-lw-ink">
            <input
              type="checkbox"
              checked={isB2G}
              onChange={(e) => setIsB2G(e.target.checked)}
              className="h-4 w-4 accent-[var(--lw-accent)]"
            />
            {t("finance.b2g")}
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={exportXml.isPending}
            onClick={() =>
              exportXml.mutate(
                { invoiceId: doc.id, isB2G },
                {
                  onSuccess: (data) => {
                    if (data.xml) {
                      const blob = new Blob([data.xml], { type: "application/xml" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `${number}.xml`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }
                  },
                },
              )
            }
          >
            <Download size={14} /> {t("finance.exportXrechnung")}
          </Button>
          {(doc as InvoiceOutRow).xml_storage_path ? (
            <span className="text-[12px]" style={{ color: "var(--lw-success)" }}>
              {t("finance.xmlExported")}
            </span>
          ) : null}
          {exportXml.isError ? (
            <span className="text-[12px] text-lw-danger">{exportXml.error.message}</span>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
