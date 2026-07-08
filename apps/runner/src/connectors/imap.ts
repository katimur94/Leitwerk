// IMAP/SMTP-Connector als Gmail-Alternative (Etappe 5, MASTERPLAN §4 B).
// Der Transport (IMAP-FETCH via TLS) ist pluggbar — hier liegt die testbare
// Normalisierung, die RFC822-Rohnachrichten in dieselbe Ingest-Form bringt,
// die auch der Gmail-Connector liefert. So teilt sich IMAP die komplette
// serverseitige Pipeline (mail-sync /ingest, Trigger, Skills).
import type { IngestMessage, MailAddress } from "@leitwerk/shared";

/** "Anna Meier <a@b.de>, x@y.de" → [{name,email}] */
export function parseAddressList(value: string | undefined): MailAddress[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
      if (match) return { name: match[1]?.trim() || undefined, email: match[2].trim().toLowerCase() };
      return { email: part.replace(/[<>]/g, "").trim().toLowerCase() };
    })
    .filter((a) => a.email.includes("@"));
}

/** RFC822-Header (nur der Kopf, bis zur Leerzeile) in eine Map lesen. */
export function parseRfc822Headers(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const head = raw.split(/\r?\n\r?\n/)[0] ?? "";
  // Fortsetzungszeilen (beginnen mit Space/Tab) an die Vorzeile anhängen
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return headers;
}

export interface ImapRawMessage {
  uid: number;
  raw: string; // RFC822
  bodyText?: string;
  flags?: string[];
}

/** IMAP-Rohnachricht → Ingest-Form (wie GmailApi → IngestMessage). */
export function imapMessageToIngest(msg: ImapRawMessage): IngestMessage {
  const h = parseRfc822Headers(msg.raw);
  const from = parseAddressList(h.from)[0] ?? { email: "unbekannt@imap.local" };
  const references = (h.references ?? "").split(/\s+/).filter(Boolean);
  // Thread-Schlüssel: erster References-Eintrag bzw. eigene Message-ID
  const threadKey = references[0] ?? h["message-id"] ?? `imap-${msg.uid}`;
  return {
    provider_msg_id: h["message-id"] ?? `imap-${msg.uid}`,
    provider_thread_id: threadKey,
    rfc822_message_id: h["message-id"] ?? null,
    thread_subject: h.subject ?? "",
    subject: h.subject ?? "",
    from_addr: from,
    to_addrs: parseAddressList(h.to),
    cc_addrs: parseAddressList(h.cc),
    direction: "inbound",
    sent_at: h.date ? new Date(h.date).toISOString() : new Date(0).toISOString(),
    body_text: msg.bodyText ?? "",
    body_html: null,
    labels: [],
    is_read: (msg.flags ?? []).includes("\\Seen"),
    attachments: [],
  };
}
