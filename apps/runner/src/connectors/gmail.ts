// Gmail-API-Anbindung für den Sync-Connector (Etappe 1).
// Reine Parser-Funktionen (testbar) + dünner API-Client.
// Der Runner spricht Gmail NUR mit dem kurzlebigen Access-Token an,
// das die Edge Function mail-sync aus dem Vault-Refresh-Token erzeugt.
import type { IngestMessage, MailAddress } from "@leitwerk/shared";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// ---------- Typen (Gmail-API-Subset) ----------

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
}

// ---------- Reine Parser ----------

export function decodeB64Url(data: string): string {
  return Buffer.from(data.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString(
    "utf8",
  );
}

/** "Anna Meier <anna@acme.de>" → {name, email}; nackte Adressen ok. */
export function parseAddress(raw: string): MailAddress {
  const match = raw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  if (match) {
    return { name: (match[1] ?? "").trim(), email: match[2].trim().toLowerCase() };
  }
  return { name: "", email: raw.trim().toLowerCase() };
}

export function parseAddressList(raw: string | undefined): MailAddress[] {
  if (!raw) return [];
  // Kommas innerhalb von "Name, Vorname" <…> nicht splitten
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted;
    if (ch === "<") depth++;
    if (ch === ">") depth--;
    if (ch === "," && depth === 0 && !quoted) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map(parseAddress).filter((a) => a.email.includes("@"));
}

function header(message: GmailMessage, name: string): string | undefined {
  return message.payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  )?.value;
}

/** Bevorzugten Body-Teil (text/plain + text/html) aus dem Part-Baum ziehen. */
export function extractBodies(part: GmailPart | undefined): {
  text: string;
  html: string | null;
} {
  let text = "";
  let html: string | null = null;
  const walk = (p: GmailPart | undefined): void => {
    if (!p) return;
    if (!p.filename && p.body?.data) {
      if (p.mimeType === "text/plain" && !text) text = decodeB64Url(p.body.data);
      if (p.mimeType === "text/html" && !html) html = decodeB64Url(p.body.data);
    }
    for (const child of p.parts ?? []) walk(child);
  };
  walk(part);
  if (!text && html) {
    text = html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();
  }
  return { text, html };
}

/** Anhangs-Metadaten (Parts mit filename + attachmentId) einsammeln. */
export function extractAttachmentParts(
  part: GmailPart | undefined,
): Array<{ filename: string; mimeType: string; attachmentId: string; size: number }> {
  const found: Array<{ filename: string; mimeType: string; attachmentId: string; size: number }> = [];
  const walk = (p: GmailPart | undefined): void => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      found.push({
        filename: p.filename,
        mimeType: p.mimeType ?? "application/octet-stream",
        attachmentId: p.body.attachmentId,
        size: p.body.size ?? 0,
      });
    }
    for (const child of p.parts ?? []) walk(child);
  };
  walk(part);
  return found;
}

/**
 * Gmail-Message → Ingest-Format der Edge Function mail-sync.
 * Anhänge kommen ohne storage_path zurück — der Sync lädt Blobs separat hoch.
 */
export function toIngestMessage(
  message: GmailMessage,
  accountEmail: string,
): Omit<IngestMessage, "attachments"> & {
  attachments: Array<{
    filename: string;
    mime_type: string;
    size_bytes: number;
    storage_path: string | null;
    attachmentId: string;
  }>;
} {
  const labels = message.labelIds ?? [];
  const from = parseAddress(header(message, "From") ?? "");
  const outbound =
    labels.includes("SENT") || from.email === accountEmail.toLowerCase();
  const { text, html } = extractBodies(message.payload);
  const sentAtMs = Number(message.internalDate ?? "");

  return {
    provider_thread_id: message.threadId,
    provider_msg_id: message.id,
    rfc822_message_id: header(message, "Message-ID") ?? null,
    direction: outbound ? "outbound" : "inbound",
    from_addr: from,
    to_addrs: parseAddressList(header(message, "To")),
    cc_addrs: parseAddressList(header(message, "Cc")),
    sent_at: Number.isFinite(sentAtMs) && sentAtMs > 0
      ? new Date(sentAtMs).toISOString()
      : null,
    subject: header(message, "Subject") ?? "",
    body_text: text,
    body_html: html,
    is_read: !labels.includes("UNREAD"),
    thread_subject: header(message, "Subject") ?? "",
    labels,
    attachments: extractAttachmentParts(message.payload).map((a) => ({
      filename: a.filename,
      mime_type: a.mimeType,
      size_bytes: a.size,
      storage_path: null,
      attachmentId: a.attachmentId,
    })),
  };
}

// ---------- API-Client ----------

export class GmailApi {
  constructor(private readonly accessToken: string) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${GMAIL_BASE}${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      const err = new Error(`Gmail API ${path} → HTTP ${res.status}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return (await res.json()) as T;
  }

  profile(): Promise<{ emailAddress: string; historyId: string }> {
    return this.get("/profile");
  }

  listMessages(
    query: string,
    pageToken?: string,
  ): Promise<{ messages?: Array<{ id: string }>; nextPageToken?: string }> {
    const params = new URLSearchParams({ q: query, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    return this.get(`/messages?${params}`);
  }

  /** History-Delta seit Cursor; wirft mit status 404, wenn der Cursor abgelaufen ist. */
  listHistory(
    startHistoryId: string,
    pageToken?: string,
  ): Promise<{
    history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>;
    historyId?: string;
    nextPageToken?: string;
  }> {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
      maxResults: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);
    return this.get(`/history?${params}`);
  }

  message(id: string): Promise<GmailMessage> {
    return this.get(`/messages/${id}?format=full`);
  }

  async attachment(messageId: string, attachmentId: string): Promise<Uint8Array> {
    const data = await this.get<{ data: string }>(
      `/messages/${messageId}/attachments/${attachmentId}`,
    );
    return new Uint8Array(
      Buffer.from(data.data.replaceAll("-", "+").replaceAll("_", "/"), "base64"),
    );
  }
}
