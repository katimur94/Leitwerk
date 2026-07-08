// Deterministischer DATEV-EXTF-Builder (Buchungsstapel, Format 700) — Etappe 6.
// Bewusst Deno-frei, damit der Golden-File-Test (packages/shared) ihn direkt
// importieren kann (wie xrechnung.ts). Erzeugt den Kern-Buchungsstapel
// (erste 14 Spalten der DATEV-Spezifikation) — CRLF-Zeilen, CP1252-taugliche
// Zeichen, deutsche Dezimalkommata. Der Steuerberater bestätigt den Kontenrahmen.

export interface DatevSettings {
  consultantNumber: number; // Beraternummer
  clientNumber: number; // Mandantennummer
  fiscalYearStartMonth: number; // 1–12
  chartOfAccounts: "SKR03" | "SKR04";
}

export interface DatevBooking {
  bookingDate: string; // ISO YYYY-MM-DD
  amount: number; // immer positiv (Betrag), Vorzeichen über debitCredit
  debitCredit: "S" | "H"; // Soll/Haben-Kennzeichen
  account: string; // Konto
  contraAccount: string; // Gegenkonto (ohne BU-Schlüssel)
  vatKey?: string; // BU-Schlüssel (z. B. "9" = 19 % VSt)
  documentRef?: string; // Belegfeld 1 (Rechnungsnummer)
  bookingText: string; // Buchungstext
}

export interface DatevExtfParams {
  settings: DatevSettings;
  periodStart: string; // ISO
  periodEnd: string; // ISO
  created: string; // ISO-Zeitstempel (für Determinismus explizit übergeben)
  description?: string; // Bezeichnung des Stapels
  bookings: DatevBooking[];
}

const COLUMN_HEADER = [
  "Umsatz (ohne Soll/Haben-Kz)",
  "Soll/Haben-Kennzeichen",
  "WKZ Umsatz",
  "Kurs",
  "Basis-Umsatz",
  "WKZ Basis-Umsatz",
  "Konto",
  "Gegenkonto (ohne BU-Schlüssel)",
  "BU-Schlüssel",
  "Belegdatum",
  "Belegfeld 1",
  "Belegfeld 2",
  "Skonto",
  "Buchungstext",
];

/** 1190 → "1190,00" (DATEV: Komma-Dezimal, keine Tausendertrennung). */
function money(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

/** "2026-07-08" → "0807" (Belegdatum: TTMM). */
function belegDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}${m}`;
}

/** "2026-07-08" → "20260708" (Header: JJJJMMTT). */
function fullDate(iso: string): string {
  return iso.replace(/-/g, "").slice(0, 8);
}

/** DATEV-Zeitstempel JJJJMMTTHHMMSSFFF aus ISO. */
function stamp(iso: string): string {
  const d = iso.replace(/[-:T.Z]/g, "");
  return d.padEnd(17, "0").slice(0, 17);
}

/** Feld für die DATEV-CSV quoten (Semikolon-getrennt, " als Textmarke). */
function field(value: string | number, quote = false): string {
  const s = String(value);
  if (quote) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * EXTF-Buchungsstapel als String (CRLF). Deterministisch: gleiche Eingaben →
 * identische Ausgabe (der Zeitstempel wird explizit übergeben).
 */
export function buildDatevExtf(params: DatevExtfParams): string {
  const { settings, periodStart, periodEnd, created, bookings } = params;
  const wjBegin = `${fullDate(periodStart).slice(0, 4)}${String(settings.fiscalYearStartMonth).padStart(2, "0")}01`;
  const sachkontenLength = 4;
  const skr = settings.chartOfAccounts === "SKR04" ? "SKR04" : "SKR03";

  // Kopfzeile (Format 700, Kategorie 21 = Buchungsstapel, Version 9)
  const header = [
    field("EXTF", true),
    700,
    21,
    field("Buchungsstapel", true),
    9,
    stamp(created),
    "", // importiert
    field("", true), // Herkunft
    field("Leitwerk", true), // exportiert von
    field("", true), // importiert von
    settings.consultantNumber,
    settings.clientNumber,
    wjBegin,
    sachkontenLength,
    fullDate(periodStart),
    fullDate(periodEnd),
    field(params.description ?? `Buchungsstapel ${periodStart}–${periodEnd}`, true),
    field("", true), // Diktatkürzel
    1, // Buchungstyp: 1 = Finanzbuchführung
    0, // Rechnungslegungszweck
    0, // Festschreibung (0 = nein, Stapel offen)
    field("EUR", true),
    "", "", "", "",
    field("", true), // Sachkontenrahmen
    field(skr, true), // Branchen-/Kontenrahmen-Hinweis (informativ)
    "", "",
  ].join(";");

  const columns = COLUMN_HEADER.map((c) => field(c, true)).join(";");

  const rows = bookings.map((b) =>
    [
      money(b.amount),
      field(b.debitCredit, true),
      "", // WKZ Umsatz
      "", // Kurs
      "", // Basis-Umsatz
      "", // WKZ Basis-Umsatz
      field(b.account),
      field(b.contraAccount),
      b.vatKey ? field(b.vatKey) : "",
      belegDate(b.bookingDate),
      b.documentRef ? field(b.documentRef, true) : field("", true),
      field("", true), // Belegfeld 2
      "", // Skonto
      field(b.bookingText, true),
    ].join(";"),
  );

  // DATEV erwartet CRLF-Zeilenenden.
  return [header, columns, ...rows].join("\r\n") + "\r\n";
}

/** Summen (Soll/Haben) für den export_batches-Kopf. */
export function datevTotals(bookings: DatevBooking[]): { debit: number; credit: number } {
  let debit = 0;
  let credit = 0;
  for (const b of bookings) {
    if (b.debitCredit === "S") debit += b.amount;
    else credit += b.amount;
  }
  return { debit: Math.round(debit * 100) / 100, credit: Math.round(credit * 100) / 100 };
}
