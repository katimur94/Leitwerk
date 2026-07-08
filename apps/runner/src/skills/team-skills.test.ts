import { describe, expect, it } from "vitest";
import { normalizeGcalEvent } from "../connectors/gcal";
import { imapMessageToIngest, parseAddressList, parseRfc822Headers } from "../connectors/imap";
import { calendarBriefingSkill } from "./calendar-briefing";
import { suggestSlotsSkill } from "./suggest-slots";
import { weeklyReportSkill } from "./weekly-report";

const uuid = (n: number) => `5a2b3c4d-0000-4000-8000-00000000000${n}`;

describe("gcal normalize", () => {
  it("normalisiert ein Timed-Event", () => {
    const ev = normalizeGcalEvent({
      id: "ev1",
      status: "confirmed",
      summary: "Baubesprechung",
      start: { dateTime: "2026-07-15T14:00:00Z" },
      end: { dateTime: "2026-07-15T15:00:00Z" },
      attendees: [{ email: "A@B.de", displayName: "Anna" }, {}],
    });
    expect(ev).toMatchObject({
      provider_event_id: "ev1",
      title: "Baubesprechung",
      all_day: false,
      status: "confirmed",
      attendees: [{ email: "A@B.de", name: "Anna" }],
    });
  });

  it("markiert All-Day-Events und wirft nicht bei fehlendem Ende", () => {
    const ev = normalizeGcalEvent({ id: "ev2", start: { date: "2026-07-20" } });
    expect(ev?.all_day).toBe(true);
    expect(ev?.starts_at).toBe("2026-07-20T00:00:00Z");
  });

  it("gibt null ohne id/Start zurück", () => {
    expect(normalizeGcalEvent({ id: "", start: {} })).toBeNull();
  });
});

describe("imap normalize", () => {
  const raw = [
    "From: Anna Meier <anna@acme.example>",
    "To: info@ditom.example, chef@ditom.example",
    "Subject: Angebot Sanierung",
    "Message-ID: <abc@acme.example>",
    "References: <root@acme.example> <mid@acme.example>",
    "Date: Wed, 08 Jul 2026 09:00:00 +0000",
    "",
    "Guten Tag, bitte um ein Angebot.",
  ].join("\r\n");

  it("parst Adresslisten inkl. Anzeigename", () => {
    expect(parseAddressList("Anna Meier <a@b.de>, x@y.de")).toEqual([
      { name: "Anna Meier", email: "a@b.de" },
      { email: "x@y.de" },
    ]);
  });

  it("liest Header (mit Unfolding)", () => {
    const h = parseRfc822Headers(raw);
    expect(h.subject).toBe("Angebot Sanierung");
    expect(h["message-id"]).toBe("<abc@acme.example>");
  });

  it("mappt auf Ingest-Form; Thread = erste Reference", () => {
    const msg = imapMessageToIngest({ uid: 42, raw, bodyText: "Guten Tag", flags: ["\\Seen"] });
    expect(msg).toMatchObject({
      provider_thread_id: "<root@acme.example>",
      provider_msg_id: "<abc@acme.example>",
      direction: "inbound",
      is_read: true,
      from_addr: { name: "Anna Meier", email: "anna@acme.example" },
    });
    expect(msg.to_addrs).toHaveLength(2);
  });
});

describe("calendar_briefing", () => {
  const ctx = {
    jobId: uuid(1),
    jobType: "calendar_briefing",
    locale: "de-DE",
    today: "2026-07-14",
    event: {
      event_id: uuid(2),
      title: "Termin mit Herrn Meier",
      starts_at: "2026-07-15T14:00:00Z",
      location: "Büro",
      attendees: ["meier@acme.example"],
      case_number: "V-2026-0001",
    },
    context: [{ kind: "Angebot", detail: "AN-2026-041 offen, 1.240 €" }],
  };

  it("nennt Kontext + Vorgang im Prompt", () => {
    const p = calendarBriefingSkill.buildPrompt(ctx)!;
    expect(p).toContain("AN-2026-041");
    expect(p).toContain("V-2026-0001");
  });

  it("parst das Briefing strikt", () => {
    const { result } = calendarBriefingSkill.parse('{"briefing_md":"Mit Herrn Meier offen: AN-2026-041 (1.240 €)."}', ctx);
    expect(result).toHaveProperty("briefing_md");
    expect(() => calendarBriefingSkill.parse("{}", ctx)).toThrow();
  });
});

describe("suggest_slots", () => {
  const ctx = {
    jobId: uuid(3),
    jobType: "suggest_slots",
    locale: "de-DE",
    today: "2026-07-14",
    thread: { thread_id: uuid(4), subject: "Terminvorschlag", reply_to: { email: "k@kunde.example" } },
    free_slots: [
      { starts_at: "2026-07-16T14:00:00Z", ends_at: "2026-07-16T15:00:00Z", label: "Do 16.07. 14:00" },
    ],
    signature_html: "<p>MfG</p>",
  };

  it("listet die freien Slots im Prompt", () => {
    expect(suggestSlotsSkill.buildPrompt(ctx)!).toContain("Do 16.07. 14:00");
  });

  it("parst subject + slots", () => {
    const { result } = suggestSlotsSkill.parse(
      '{"subject":"Re: Terminvorschlag","to_addrs":[{"email":"k@kunde.example"}],"slots":[{"starts_at":"2026-07-16T14:00:00Z","ends_at":"2026-07-16T15:00:00Z","label":"Do 16.07. 14:00"}]}',
      ctx,
    );
    expect(result.slots).toHaveLength(1);
  });
});

describe("weekly_report", () => {
  const ctx = {
    jobId: uuid(5),
    jobType: "weekly_report",
    locale: "de-DE",
    for_date: "2026-07-17",
    org_name: "DiTom GmbH",
    stats: {
      mails_handled: 42,
      tasks_done: 12,
      tasks_open: 5,
      invoices_sent: 3,
      invoices_paid: 2,
      pipeline_value_cents: 250000,
      ai_accuracy: 0.94,
    },
  };

  it("enthält Kennzahlen (Pipeline als Euro) im Prompt", () => {
    const p = weeklyReportSkill.buildPrompt(ctx)!;
    expect(p).toContain("2.500,00");
    expect(p).toContain("94 %");
  });

  it("parst content_md + items", () => {
    const { result } = weeklyReportSkill.parse(
      '{"content_md":"Solide Woche mit 12 erledigten Aufgaben.","items":[{"title":"Angebot AN-041 nachfassen"}]}',
      ctx,
    );
    expect(result.items).toHaveLength(1);
  });
});
