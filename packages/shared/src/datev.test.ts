import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDatevExtf, datevTotals, type DatevBooking, type DatevExtfParams } from "./datev";

const here = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(here, "__fixtures__", "datev-extf-golden.csv");

// Deterministische Beispiel-Eingabe: zwei Ausgangsrechnungen + eine
// Eingangsrechnung (SKR03). Fixe Werte → stabiler Golden-File-Vergleich.
const bookings: DatevBooking[] = [
  {
    bookingDate: "2026-07-05",
    amount: 2961.28,
    debitCredit: "S",
    account: "10001", // Debitor
    contraAccount: "8400", // Erlöse 19 %
    vatKey: "",
    documentRef: "RE-2026-0007",
    bookingText: "Rechnung RE-2026-0007 Muster GmbH",
  },
  {
    bookingDate: "2026-07-06",
    amount: 535.5,
    debitCredit: "S",
    account: "10002",
    contraAccount: "8400",
    documentRef: "RE-2026-0008",
    bookingText: "Rechnung RE-2026-0008",
  },
  {
    bookingDate: "2026-07-07",
    amount: 486.9,
    debitCredit: "H",
    account: "70001", // Kreditor
    contraAccount: "4980",
    vatKey: "9", // 19 % Vorsteuer
    documentRef: "RE-88123",
    bookingText: "Eingangsrechnung OfficeSupply GmbH",
  },
];

const params: DatevExtfParams = {
  settings: {
    consultantNumber: 12345,
    clientNumber: 6789,
    fiscalYearStartMonth: 1,
    chartOfAccounts: "SKR03",
  },
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  created: "2026-07-08T12:00:00.000Z",
  description: "Buchungsstapel Juli 2026",
  bookings,
};

describe("DATEV EXTF Builder", () => {
  it("entspricht dem Golden-File (byte-genau)", () => {
    const golden = readFileSync(goldenPath, "latin1");
    expect(buildDatevExtf(params)).toBe(golden);
  });

  it("verwendet CRLF-Zeilenenden", () => {
    const out = buildDatevExtf(params);
    expect(out.includes("\r\n")).toBe(true);
    expect(out.split("\r\n").length).toBeGreaterThan(4); // Header + Spalten + 3 Zeilen
  });

  it("Kopfzeile: EXTF, Format 700, Kategorie 21, Berater/Mandant", () => {
    const header = buildDatevExtf(params).split("\r\n")[0];
    expect(header.startsWith('"EXTF";700;21;"Buchungsstapel"')).toBe(true);
    expect(header).toContain(";12345;6789;");
  });

  it("formatiert Beträge mit Dezimalkomma", () => {
    expect(buildDatevExtf(params)).toContain("2961,28;\"S\"");
  });

  it("summiert Soll/Haben korrekt", () => {
    expect(datevTotals(bookings)).toEqual({ debit: 3496.78, credit: 486.9 });
  });
});
