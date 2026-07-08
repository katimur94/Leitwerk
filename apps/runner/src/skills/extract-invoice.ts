// Hybrid-Skill extract_invoice (MASTERPLAN §4 F):
// 1) XML-Anhang (ZUGFeRD/XRechnung) → deterministisch parsen, KEIN KI-Aufruf
// 2) sonst PDF-Text/Mail-Text → KI-Extraktion (striktes Zod-Parsing)
import {
  extractInvoiceContextSchema,
  extractInvoiceResultSchema,
  type ExtractInvoiceResult,
} from "@leitwerk/shared";
import { extractPdfText, parseEInvoiceXml } from "../connectors/einvoice";
import { resultHash } from "../util/hash";
import { extractJson } from "../util/json";
import { log } from "../util/log";
import type { Skill, SkillDeps } from "./types";

function buildAiPrompt(
  subject: string,
  fromEmail: string,
  text: string,
  today: string,
  schemaDescription: string,
): string {
  return [
    "Du bist Leitwerk. Extrahiere die Rechnungsdaten aus dem folgenden Text",
    "(E-Mail bzw. extrahierter PDF-Text einer Eingangsrechnung).",
    "",
    "Regeln:",
    "- Beträge als Zahlen (Punkt als Dezimaltrenner), Daten als ISO (YYYY-MM-DD).",
    `- Heute ist ${today}. Relativangaben („zahlbar in 14 Tagen“) umrechnen.`,
    '- Wenn der Text KEINE Rechnung ist: {"found": false}.',
    "",
    `Betreff: ${subject || "(kein Betreff)"}`,
    `Absender: ${fromEmail}`,
    "Text (gekürzt):",
    "---",
    text.slice(0, 6000) || "(leer)",
    "---",
    "",
    "Gib AUSSCHLIESSLICH reines JSON zurück — kein Markdown, keine Code-Zäune:",
    schemaDescription,
  ].join("\n");
}

export const extractInvoiceSkill: Skill = {
  type: "extract_invoice",

  schemaDescription:
    '{"found": true|false, "invoice_number": "<Nr>", "invoice_date": "<ISO|null>", "due_date": "<ISO|null>", "net_amount": <Zahl|null>, "vat_amount": <Zahl|null>, "gross_amount": <Zahl|null>, "currency": "EUR", "iban": "<IBAN|null>", "payment_reference": "<Verwendungszweck|null>", "issuer_name": "<Aussteller>", "confidence": <0.0-1.0>}',

  buildPrompt() {
    return null; // Hybrid: execute() entscheidet, ob KI nötig ist
  },

  parse(raw, _ctx) {
    const result = extractInvoiceResultSchema.parse(extractJson(raw));
    return { result, resultHash: resultHash(result) };
  },

  async execute(ctx, deps: SkillDeps) {
    const parsed = extractInvoiceContextSchema.parse(ctx);

    // 1) Strukturierte E-Rechnung (XML) direkt lesen
    for (const attachment of parsed.attachments) {
      const isXml =
        attachment.filename.toLowerCase().endsWith(".xml") ||
        (attachment.mime_type ?? "").includes("xml");
      if (!isXml || !attachment.storage_path) continue;
      try {
        const bytes = await deps.broker.mailDownload(attachment.storage_path);
        const result = parseEInvoiceXml(Buffer.from(bytes).toString("utf8"));
        if (result) {
          log.info(`extract_invoice: E-Rechnung erkannt (${result.format_detected})`);
          return { result, resultHash: resultHash(result) };
        }
      } catch (error) {
        log.warn(`extract_invoice: XML-Anhang nicht lesbar: ${String(error)}`);
      }
    }

    // 2) PDF-Text (naiv) oder Mail-Text → KI-Extraktion
    let text = "";
    let format: ExtractInvoiceResult["format_detected"] = "mail_text";
    for (const attachment of parsed.attachments) {
      const isPdf =
        attachment.filename.toLowerCase().endsWith(".pdf") ||
        (attachment.mime_type ?? "").includes("pdf");
      if (!isPdf || !attachment.storage_path) continue;
      try {
        const bytes = await deps.broker.mailDownload(attachment.storage_path);
        const pdfText = extractPdfText(bytes);
        if (pdfText.length > 80) {
          text = pdfText;
          format = "pdf_text";
          break;
        }
      } catch (error) {
        log.warn(`extract_invoice: PDF-Anhang nicht lesbar: ${String(error)}`);
      }
    }
    if (!text) text = parsed.message.body_excerpt;

    const prompt = buildAiPrompt(
      parsed.message.subject,
      parsed.message.from.email,
      text,
      parsed.today,
      this.schemaDescription,
    );
    const raw = await deps.provider.complete(prompt, { maxRuntimeSec: 300 });
    const aiResult = extractInvoiceResultSchema.parse(extractJson(raw));
    const result: ExtractInvoiceResult = {
      ...aiResult,
      format_detected: aiResult.found ? format : undefined,
      is_einvoice: false,
    };
    return { result, resultHash: resultHash(result) };
  },
};
