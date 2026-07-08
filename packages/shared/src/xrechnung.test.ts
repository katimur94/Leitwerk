// Golden-File-Test für die XRechnung-Erzeugung (CLAUDE.md Regel 10).
// Die Implementierung lebt in supabase/functions/_shared/xrechnung.ts
// (bewusst frei von Deno-APIs) und wird hier direkt mitgetestet.
// Golden aktualisieren: UPDATE_GOLDEN=1 pnpm --filter @leitwerk/shared test
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildXrechnungXml,
  computeTotals,
  type XrBuyer,
  type XrInvoice,
  type XrSeller,
} from "../../../supabase/functions/_shared/xrechnung";

const seller: XrSeller = {
  legal_name: "DiTom GmbH",
  vat_id: "DE123456789",
  street: "Musterstraße 12",
  zip: "44135",
  city: "Dortmund",
  country: "DE",
  email: "info@ditom.example",
  iban: "DE02 4405 0199 0000 1234 56",
  is_small_business: false,
};

const buyer: XrBuyer = {
  name: "ACME Bau GmbH",
  street: "Bauweg 1",
  zip: "44139",
  city: "Dortmund",
  country: "DE",
  email: "rechnung@acme-bau.example",
};

const invoice: XrInvoice = {
  invoice_number: "RE-2026-0001",
  invoice_date: "2026-07-08",
  due_date: "2026-07-22",
  currency: "EUR",
  buyer_reference: "04011000-1234512345-06",
  payment_terms: "Zahlbar innerhalb von 14 Tagen ohne Abzug.",
  items: [
    {
      position: 1,
      description: "Elektroinstallation Bürogebäude — Los A & B",
      quantity: 24,
      unit: "Std",
      unit_price: 85,
      vat_rate: 19,
      net_total: 2040,
    },
    {
      position: 2,
      description: "Material lt. Aufstellung <Kabel, Dosen>",
      quantity: 1,
      unit: "Pauschale",
      unit_price: 412.5,
      vat_rate: 19,
      net_total: 412.5,
    },
    {
      position: 3,
      description: "Fachliteratur (ermäßigt)",
      quantity: 2,
      unit: "Stk",
      unit_price: 20,
      vat_rate: 7,
      net_total: 40,
    },
  ],
};

const goldenPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
  "xrechnung-golden.xml",
);

describe("computeTotals", () => {
  it("gruppiert nach USt-Satz und rechnet Cent-genau", () => {
    const totals = computeTotals(invoice.items);
    expect(totals.net).toBe(2492.5);
    expect(totals.vatGroups).toEqual([
      { rate: 7, base: 40, vat: 2.8 },
      { rate: 19, base: 2452.5, vat: 465.98 },
    ]);
    expect(totals.vat).toBe(468.78);
    expect(totals.gross).toBe(2961.28);
  });
});

describe("buildXrechnungXml", () => {
  it("ist deterministisch und entspricht dem Golden File", () => {
    const xml = buildXrechnungXml(invoice, seller, buyer);
    expect(xml).toBe(buildXrechnungXml(invoice, seller, buyer)); // deterministisch

    if (process.env.UPDATE_GOLDEN === "1" || !existsSync(goldenPath)) {
      mkdirSync(dirname(goldenPath), { recursive: true });
      writeFileSync(goldenPath, xml, "utf8");
    }
    expect(xml).toBe(readFileSync(goldenPath, "utf8"));
  });

  it("enthält die EN16931-Pflichtangaben", () => {
    const xml = buildXrechnungXml(invoice, seller, buyer);
    expect(xml).toContain("xrechnung_3.0");
    expect(xml).toContain("<cbc:ID>RE-2026-0001</cbc:ID>");
    expect(xml).toContain("<cbc:BuyerReference>04011000-1234512345-06</cbc:BuyerReference>");
    expect(xml).toContain('unitCode="HUR"'); // Stunden
    expect(xml).toContain("DE024405019900001234 56".replaceAll(" ", "").slice(0, 10)); // IBAN ohne Leerzeichen
    expect(xml).toContain("&lt;Kabel, Dosen&gt;"); // XML-Escaping
    expect(xml).toContain('currencyID="EUR">2961.28'); // PayableAmount
  });

  it("bildet Kleinunternehmer (§19) als steuerbefreit ab", () => {
    const xml = buildXrechnungXml(invoice, { ...seller, is_small_business: true }, buyer);
    expect(xml).toContain("Kleinunternehmerregelung §19 UStG");
    expect(xml).toContain('currencyID="EUR">2492.50'); // brutto = netto
    expect(xml).not.toContain(">465.98<");
  });
});
