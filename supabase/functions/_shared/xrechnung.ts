// XRechnung-3.x-XML (EN 16931, UBL 2.1) — DETERMINISTISCH, ohne LLM.
// Bewusst frei von Deno-/Node-APIs: dieselbe Datei wird von der Edge Function
// export-xrechnung UND vom Golden-File-Test (packages/shared) verwendet.

export interface XrSeller {
  legal_name: string;
  vat_id?: string | null;
  tax_number?: string | null;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country: string; // ISO 3166-1 alpha-2
  email?: string | null;
  iban?: string | null;
  bank_name?: string | null;
  is_small_business?: boolean;
}

export interface XrBuyer {
  name: string;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
  email?: string | null;
}

export interface XrItem {
  position: number;
  description: string;
  quantity: number;
  unit: string; // UN/ECE Rec 20 wird gemappt, Fallback C62
  unit_price: number;
  vat_rate: number; // Prozent
  net_total: number;
}

export interface XrInvoice {
  invoice_number: string;
  invoice_date: string; // YYYY-MM-DD
  due_date?: string | null;
  currency: string;
  buyer_reference?: string | null; // Leitweg-ID, Pflicht bei B2G
  payment_terms?: string | null;
  items: XrItem[];
}

const UNIT_CODES: Record<string, string> = {
  Stk: "H87",
  Stück: "H87",
  Std: "HUR",
  Stunde: "HUR",
  Tag: "DAY",
  kg: "KGM",
  m: "MTR",
  m2: "MTK",
  "m²": "MTK",
  Pauschale: "C62",
};

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function money(value: number): string {
  return value.toFixed(2);
}

export interface XrTotals {
  net: number;
  vat: number;
  gross: number;
  /** VAT-Gruppen nach Satz */
  vatGroups: Array<{ rate: number; base: number; vat: number }>;
}

/** Summen + USt-Gruppen deterministisch aus den Positionen (Cent-genau). */
export function computeTotals(items: XrItem[]): XrTotals {
  const groups = new Map<number, { base: number; vat: number }>();
  for (const item of items) {
    const group = groups.get(item.vat_rate) ?? { base: 0, vat: 0 };
    group.base = Math.round((group.base + item.net_total) * 100) / 100;
    groups.set(item.vat_rate, group);
  }
  let net = 0;
  let vat = 0;
  const vatGroups = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, group]) => {
      const groupVat = Math.round(group.base * rate) / 100;
      net = Math.round((net + group.base) * 100) / 100;
      vat = Math.round((vat + groupVat) * 100) / 100;
      return { rate, base: group.base, vat: groupVat };
    });
  return { net, vat, gross: Math.round((net + vat) * 100) / 100, vatGroups };
}

/**
 * XRechnung 3.0 (UBL 2.1 Invoice). Kleinunternehmer (§19 UStG) → Kategorie E
 * (steuerbefreit) mit Begründung; sonst Kategorie S mit Satz pro Gruppe.
 */
export function buildXrechnungXml(
  invoice: XrInvoice,
  seller: XrSeller,
  buyer: XrBuyer,
): string {
  const totals = computeTotals(invoice.items);
  const smallBusiness = seller.is_small_business === true;
  const category = smallBusiness ? "E" : "S";

  const lines = invoice.items
    .map((item) => {
      const unitCode = UNIT_CODES[item.unit] ?? "C62";
      return `  <cac:InvoiceLine>
    <cbc:ID>${item.position}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${unitCode}">${item.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${invoice.currency}">${money(item.net_total)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(item.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${category}</cbc:ID>
        <cbc:Percent>${smallBusiness ? "0" : item.vat_rate.toFixed(2)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${invoice.currency}">${money(item.unit_price)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
    })
    .join("\n");

  const vatSubtotals = (smallBusiness
    ? [{ rate: 0, base: totals.net, vat: 0 }]
    : totals.vatGroups
  )
    .map(
      (group) => `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${invoice.currency}">${money(group.base)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${invoice.currency}">${money(group.vat)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${category}</cbc:ID>
        <cbc:Percent>${group.rate.toFixed(2)}</cbc:Percent>${
          smallBusiness
            ? `
        <cbc:TaxExemptionReason>Kleinunternehmerregelung §19 UStG</cbc:TaxExemptionReason>`
            : ""
        }
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`,
    )
    .join("\n");

  const vatTotal = smallBusiness ? 0 : totals.vat;
  const gross = smallBusiness ? totals.net : totals.gross;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${esc(invoice.invoice_number)}</cbc:ID>
  <cbc:IssueDate>${invoice.invoice_date}</cbc:IssueDate>${
    invoice.due_date
      ? `
  <cbc:DueDate>${invoice.due_date}</cbc:DueDate>`
      : ""
  }
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${invoice.currency}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${esc(invoice.buyer_reference ?? "")}</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(seller.street ?? "")}</cbc:StreetName>
        <cbc:CityName>${esc(seller.city ?? "")}</cbc:CityName>
        <cbc:PostalZone>${esc(seller.zip ?? "")}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${seller.country}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>${
        seller.vat_id
          ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(seller.vat_id)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>`
          : ""
      }
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(seller.legal_name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>${
        seller.email
          ? `
      <cac:Contact><cbc:ElectronicMail>${esc(seller.email)}</cbc:ElectronicMail></cac:Contact>`
          : ""
      }
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(buyer.street ?? "")}</cbc:StreetName>
        <cbc:CityName>${esc(buyer.city ?? "")}</cbc:CityName>
        <cbc:PostalZone>${esc(buyer.zip ?? "")}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${buyer.country ?? "DE"}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(buyer.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>${
        buyer.email
          ? `
      <cac:Contact><cbc:ElectronicMail>${esc(buyer.email)}</cbc:ElectronicMail></cac:Contact>`
          : ""
      }
    </cac:Party>
  </cac:AccountingCustomerParty>${
    seller.iban
      ? `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc(seller.iban.replaceAll(" ", ""))}</cbc:ID>
      <cbc:Name>${esc(seller.legal_name)}</cbc:Name>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>`
      : ""
  }${
    invoice.payment_terms
      ? `
  <cac:PaymentTerms><cbc:Note>${esc(invoice.payment_terms)}</cbc:Note></cac:PaymentTerms>`
      : ""
  }
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${invoice.currency}">${money(vatTotal)}</cbc:TaxAmount>
${vatSubtotals}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${invoice.currency}">${money(totals.net)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${invoice.currency}">${money(totals.net)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${invoice.currency}">${money(gross)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${invoice.currency}">${money(gross)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>
`;
}
