// Deterministischer Parser für E-Rechnungs-XML (Etappe 3):
// ZUGFeRD/Factur-X (UN/CEFACT CII) und XRechnung (UBL 2.1).
// Kein LLM — strukturierte Rechnungen werden direkt gelesen (MASTERPLAN §4 F).
import type { ExtractInvoiceResult } from "@leitwerk/shared";

/** Erstes Tag-Match (namespace-agnostisch): <…:tag …>WERT</…:tag> */
function tag(xml: string, name: string): string | null {
  const match = xml.match(
    new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[\\w-]+:)?${name}>`),
  );
  return match ? match[1].trim() : null;
}

/** Tag innerhalb eines Elternelements suchen. */
function tagIn(xml: string, parent: string, name: string): string | null {
  const parentMatch = xml.match(
    new RegExp(`<(?:[\\w-]+:)?${parent}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${parent}>`),
  );
  return parentMatch ? tag(parentMatch[1], name) : null;
}

function num(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/** "20260722" bzw. "2026-07-22" → ISO-Datum */
function isoDate(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  return null;
}

/**
 * CII (ZUGFeRD/Factur-X/XRechnung-CII) oder UBL parsen.
 * Gibt null zurück, wenn das XML keine E-Rechnung ist.
 */
export function parseEInvoiceXml(xml: string): ExtractInvoiceResult | null {
  const isCii = xml.includes("CrossIndustryInvoice");
  const isUbl = /<(?:[\w-]+:)?Invoice[\s>]/.test(xml) && xml.includes("ubl");

  if (isCii) {
    const gross = num(tag(xml, "DuePayableAmount")) ?? num(tag(xml, "GrandTotalAmount"));
    const net = num(tag(xml, "LineTotalAmount")) ?? num(tag(xml, "TaxBasisTotalAmount"));
    const vat = num(tag(xml, "TaxTotalAmount"));
    return {
      found: true,
      invoice_number: tagIn(xml, "ExchangedDocument", "ID") ?? tag(xml, "ID") ?? undefined,
      invoice_date: isoDate(tagIn(xml, "IssueDateTime", "DateTimeString")),
      due_date: isoDate(tagIn(xml, "DueDateDateTime", "DateTimeString")),
      net_amount: net,
      vat_amount: vat ?? (gross != null && net != null ? Math.round((gross - net) * 100) / 100 : null),
      gross_amount: gross,
      currency: tag(xml, "InvoiceCurrencyCode") ?? "EUR",
      iban: tagIn(xml, "PayeePartyCreditorFinancialAccount", "IBANID"),
      payment_reference: tag(xml, "PaymentReference"),
      issuer_name: tagIn(xml, "SellerTradeParty", "Name") ?? undefined,
      format_detected: "zugferd",
      is_einvoice: true,
      confidence: 1,
    };
  }

  if (isUbl) {
    const gross = num(tag(xml, "PayableAmount")) ?? num(tag(xml, "TaxInclusiveAmount"));
    const net = num(tag(xml, "TaxExclusiveAmount")) ?? num(tag(xml, "LineExtensionAmount"));
    return {
      found: true,
      invoice_number: tag(xml, "ID") ?? undefined,
      invoice_date: isoDate(tag(xml, "IssueDate")),
      due_date: isoDate(tag(xml, "DueDate")),
      net_amount: net,
      vat_amount: num(tag(xml, "TaxAmount")),
      gross_amount: gross,
      currency: tag(xml, "DocumentCurrencyCode") ?? "EUR",
      iban: tagIn(xml, "PayeeFinancialAccount", "ID"),
      payment_reference: null,
      issuer_name:
        tagIn(xml, "AccountingSupplierParty", "RegistrationName") ?? undefined,
      format_detected: "xrechnung",
      is_einvoice: true,
      confidence: 1,
    };
  }

  return null;
}

/**
 * Sehr einfacher PDF-Text-Extraktor: liest Klartext aus unkomprimierten
 * Text-Streams (Tj/TJ-Operatoren). Komprimierte PDFs liefern wenig/nichts —
 * dann fällt der Skill auf den Mail-Text zurück (OCR kommt in Phase 4).
 */
export function extractPdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const chunks: string[] = [];
  const re = /\(((?:[^()\\]|\\.)*)\)\s*T[Jj]/g;
  let match;
  while ((match = re.exec(raw)) && chunks.length < 2000) {
    chunks.push(
      match[1]
        .replace(/\\([()\\])/g, "$1")
        .replace(/\\(\d{3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8))),
    );
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}
