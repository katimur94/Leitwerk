import { describe, expect, it } from "vitest";
import { accountAssignSkill } from "./account-assign";
import { contractWatchSkill } from "./contract-watch";
import { extractContractSkill } from "./extract-contract";
import { paymentMatchSkill } from "./payment-match";
import { summarizeCallSkill } from "./summarize-call";
import { timeSuggestSkill } from "./time-suggest";

const uuid = (n: number) => `6b3c4d5e-0000-4000-8000-00000000000${n}`;

describe("payment_match", () => {
  const ctx = {
    jobId: uuid(1),
    jobType: "payment_match",
    locale: "de-DE",
    transactions: [{ transaction_id: uuid(2), amount: 1190, booked_on: "2026-07-08", counterpart_name: "ACME Bau", purpose: "RE-2026-0001" }],
    open_invoices_out: [{ invoice_out_id: uuid(3), number: "RE-2026-0001", gross: 1190, company: "ACME Bau" }],
    open_invoices_in: [],
  };
  it("listet Umsätze + offene Rechnungen im Prompt", () => {
    const p = paymentMatchSkill.buildPrompt(ctx)!;
    expect(p).toContain("RE-2026-0001");
    expect(p).toContain("ACME Bau");
  });
  it("ohne Umsätze kein KI-Aufruf", () => {
    expect(paymentMatchSkill.buildPrompt({ ...ctx, transactions: [] })).toBeNull();
    expect(paymentMatchSkill.parse("", { ...ctx, transactions: [] }).result).toEqual({ matches: [] });
  });
  it("parst Matches strikt", () => {
    const { result } = paymentMatchSkill.parse(
      `{"matches":[{"transaction_id":"${uuid(2)}","invoice_out_id":"${uuid(3)}","invoice_in_id":null,"matched_amount":1190,"confidence":0.95}]}`,
      ctx,
    );
    expect(result.matches).toHaveLength(1);
  });
});

describe("account_assign", () => {
  const ctx = {
    jobId: uuid(4), jobType: "account_assign", locale: "de-DE", invoice_in_id: uuid(5),
    issuer: "OfficeSupply GmbH", gross_amount: 486.9, chart_of_accounts: "SKR03",
    known_accounts: [{ account: "4980", label: "Bürobedarf" }],
  };
  it("nennt Kontenrahmen + bekannte Konten", () => {
    const p = accountAssignSkill.buildPrompt(ctx)!;
    expect(p).toContain("SKR03");
    expect(p).toContain("4980");
  });
  it("parst Konto + Konfidenz", () => {
    const { result } = accountAssignSkill.parse('{"account":"4980","label":"Bürobedarf","confidence":0.9}', ctx);
    expect(result.account).toBe("4980");
  });
});

describe("extract_contract", () => {
  const ctx = {
    jobId: uuid(6), jobType: "extract_contract", locale: "de-DE", today: "2026-07-08",
    contract_id: uuid(7),
    document_text: "Mietvertrag Halle 2, monatlich 1.200 EUR, Kündigungsfrist 3 Monate zum Jahresende.",
  };
  it("baut den Prompt aus dem Dokumenttext", () => {
    expect(extractContractSkill.buildPrompt(ctx)!).toContain("Kündigungsfrist");
  });
  it("parst Eckdaten (Kategorie-Enum)", () => {
    const { result } = extractContractSkill.parse(
      '{"title":"Miete Halle 2","category":"miete","amount":1200,"billing_cycle":"monthly","notice_period_months":3,"notice_deadline":"2026-09-30","confidence":0.9}',
      ctx,
    );
    expect(result).toMatchObject({ category: "miete", billing_cycle: "monthly" });
    expect(() => extractContractSkill.parse('{"category":"unbekannt"}', ctx)).toThrow();
  });
});

describe("contract_watch", () => {
  const ctx = {
    jobId: uuid(8), jobType: "contract_watch", locale: "de-DE", today: "2026-07-08",
    contracts: [
      { contract_id: uuid(9), title: "Leasing Sprinter", notice_deadline: "2026-08-05", days_until_deadline: 28, yearly_cost: 7200 },
      { contract_id: uuid(1), title: "Fern-Vertrag", notice_deadline: "2027-01-01", days_until_deadline: 180, yearly_cost: 100 },
    ],
  };
  it("nur Verträge ≤90 Tage im Prompt", () => {
    const p = contractWatchSkill.buildPrompt(ctx)!;
    expect(p).toContain("Leasing Sprinter");
    expect(p).not.toContain("Fern-Vertrag");
  });
  it("ohne nahe Fristen kein KI-Aufruf", () => {
    expect(contractWatchSkill.buildPrompt({ ...ctx, contracts: [ctx.contracts[1]] })).toBeNull();
  });
});

describe("time_suggest / summarize_call", () => {
  it("time_suggest ohne Signale = leer, kein KI-Aufruf", () => {
    const ctx = { jobId: uuid(2), jobType: "time_suggest", locale: "de-DE", user_id: uuid(3), for_date: "2026-07-08", signals: [] };
    expect(timeSuggestSkill.buildPrompt(ctx)).toBeNull();
    expect(timeSuggestSkill.parse("", ctx).result).toEqual({ entries: [] });
  });
  it("summarize_call parst Zusammenfassung + Follow-up", () => {
    const ctx = { jobId: uuid(4), jobType: "summarize_call", locale: "de-DE", call: { call_id: uuid(5), counterpart: "Meier", case_number: null, transcript_excerpt: "Rückruf gewünscht" } };
    expect(summarizeCallSkill.buildPrompt(ctx)!).toContain("Rückruf gewünscht");
    const { result } = summarizeCallSkill.parse('{"summary":"Kunde wünscht Rückruf","outcome":"rueckruf","follow_up_title":"Herrn Meier zurückrufen"}', ctx);
    expect(result.follow_up_title).toBe("Herrn Meier zurückrufen");
  });
});
