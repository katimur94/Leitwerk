import { describe, expect, it } from "vitest";
import {
  extractAttachmentParts,
  extractBodies,
  parseAddress,
  parseAddressList,
  toIngestMessage,
  type GmailMessage,
} from "./gmail";

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("parseAddress", () => {
  it("parst Name + Adresse", () => {
    expect(parseAddress('"Meier, Anna" <Anna.Meier@ACME.de>')).toEqual({
      name: "Meier, Anna",
      email: "anna.meier@acme.de",
    });
    expect(parseAddress("info@acme.de")).toEqual({ name: "", email: "info@acme.de" });
  });
});

describe("parseAddressList", () => {
  it("splittet nicht innerhalb von quoted Namen", () => {
    const list = parseAddressList('"Meier, Anna" <a@x.de>, b@y.de');
    expect(list).toHaveLength(2);
    expect(list[0].email).toBe("a@x.de");
    expect(list[1].email).toBe("b@y.de");
  });
  it("gibt leere Liste bei undefined", () => {
    expect(parseAddressList(undefined)).toEqual([]);
  });
});

const message: GmailMessage = {
  id: "msg-1",
  threadId: "thr-1",
  labelIds: ["INBOX", "UNREAD"],
  internalDate: "1752000000000",
  payload: {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: "Anna Meier <anna@acme.de>" },
      { name: "To", value: "timur@ditom.de" },
      { name: "Subject", value: "Rechnung 2026-041" },
      { name: "Message-ID", value: "<abc@mail.acme.de>" },
    ],
    parts: [
      {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: b64url("Hallo, anbei die Rechnung.") } },
          { mimeType: "text/html", body: { data: b64url("<p>Hallo, anbei die Rechnung.</p>") } },
        ],
      },
      {
        mimeType: "application/pdf",
        filename: "rechnung.pdf",
        body: { attachmentId: "att-1", size: 12345 },
      },
    ],
  },
};

describe("extractBodies / extractAttachmentParts", () => {
  it("findet text/plain und text/html im Part-Baum", () => {
    const { text, html } = extractBodies(message.payload);
    expect(text).toBe("Hallo, anbei die Rechnung.");
    expect(html).toContain("<p>");
  });
  it("findet Anhänge mit attachmentId", () => {
    const atts = extractAttachmentParts(message.payload);
    expect(atts).toEqual([
      { filename: "rechnung.pdf", mimeType: "application/pdf", attachmentId: "att-1", size: 12345 },
    ]);
  });
});

describe("toIngestMessage", () => {
  it("mappt eine Inbound-Mail komplett", () => {
    const ingest = toIngestMessage(message, "timur@ditom.de");
    expect(ingest).toMatchObject({
      provider_thread_id: "thr-1",
      provider_msg_id: "msg-1",
      direction: "inbound",
      from_addr: { name: "Anna Meier", email: "anna@acme.de" },
      subject: "Rechnung 2026-041",
      is_read: false,
      rfc822_message_id: "<abc@mail.acme.de>",
    });
    expect(ingest.sent_at).toBe(new Date(1752000000000).toISOString());
    expect(ingest.attachments[0]).toMatchObject({ filename: "rechnung.pdf", attachmentId: "att-1" });
  });

  it("erkennt Outbound über SENT-Label oder Absender", () => {
    const sent = { ...message, labelIds: ["SENT"] };
    expect(toIngestMessage(sent, "timur@ditom.de").direction).toBe("outbound");
    const fromSelf = { ...message, labelIds: ["INBOX"] };
    expect(toIngestMessage(fromSelf, "anna@acme.de").direction).toBe("outbound");
  });
});
