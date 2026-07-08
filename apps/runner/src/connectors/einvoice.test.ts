import { describe, expect, it } from "vitest";
import { extractPdfText, parseEInvoiceXml } from "./einvoice";

const CII = `<?xml version="1.0"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">
  <rsm:ExchangedDocument>
    <ram:ID>RE-88123</ram:ID>
    <ram:IssueDateTime><udt:DateTimeString format="102" xmlns:udt="x">20260705</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>OfficeSupply GmbH</ram:Name></ram:SellerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:PaymentReference>RE-88123</ram:PaymentReference>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>DE02120300000000202051</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime><udt:DateTimeString format="102" xmlns:udt="x">20260721</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>409.16</ram:LineTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">77.74</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>486.90</ram:GrandTotalAmount>
        <ram:DuePayableAmount>486.90</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

describe("parseEInvoiceXml (CII/ZUGFeRD)", () => {
  it("liest die Kerndaten deterministisch", () => {
    const result = parseEInvoiceXml(CII)!;
    expect(result).toMatchObject({
      found: true,
      invoice_number: "RE-88123",
      invoice_date: "2026-07-05",
      due_date: "2026-07-21",
      gross_amount: 486.9,
      vat_amount: 77.74,
      net_amount: 409.16,
      currency: "EUR",
      iban: "DE02120300000000202051",
      issuer_name: "OfficeSupply GmbH",
      format_detected: "zugferd",
      is_einvoice: true,
      confidence: 1,
    });
  });

  it("gibt null für Nicht-Rechnungs-XML", () => {
    expect(parseEInvoiceXml("<html><body>Hallo</body></html>")).toBeNull();
  });
});

describe("parseEInvoiceXml (UBL/XRechnung)", () => {
  it("liest von uns erzeugtes XRechnung-XML zurück", () => {
    const ubl = `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
      xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
      xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
      <cbc:ID>RE-2026-0001</cbc:ID>
      <cbc:IssueDate>2026-07-08</cbc:IssueDate>
      <cbc:DueDate>2026-07-22</cbc:DueDate>
      <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
      <cac:AccountingSupplierParty><cac:Party><cac:PartyLegalEntity>
        <cbc:RegistrationName>DiTom GmbH</cbc:RegistrationName>
      </cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
      <cac:LegalMonetaryTotal>
        <cbc:TaxExclusiveAmount currencyID="EUR">2492.50</cbc:TaxExclusiveAmount>
        <cbc:PayableAmount currencyID="EUR">2961.28</cbc:PayableAmount>
      </cac:LegalMonetaryTotal>
    </Invoice>`;
    const result = parseEInvoiceXml(ubl)!;
    expect(result).toMatchObject({
      invoice_number: "RE-2026-0001",
      gross_amount: 2961.28,
      net_amount: 2492.5,
      issuer_name: "DiTom GmbH",
      format_detected: "xrechnung",
    });
  });
});

describe("extractPdfText", () => {
  it("liest Tj-Text aus unkomprimierten Streams", () => {
    const pdf = Buffer.from(
      "%PDF-1.4 BT (Rechnung Nr. 42) Tj (Betrag: 100,00 EUR) Tj ET",
      "latin1",
    );
    expect(extractPdfText(new Uint8Array(pdf))).toBe("Rechnung Nr. 42 Betrag: 100,00 EUR");
  });
});
