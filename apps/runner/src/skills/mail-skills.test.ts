import { describe, expect, it } from "vitest";
import { caseMatchSkill } from "./case-match";
import { classifyEmailSkill } from "./classify-email";
import { draftReplySkill } from "./draft-reply";
import { threadSummarySkill } from "./thread-summary";

const classifyCtx = {
  jobId: "9e0f9b1a-0000-4000-8000-000000000001",
  jobType: "classify_email",
  locale: "de-DE",
  categories: ["anfrage", "rechnung", "sonstiges"],
  message: {
    subject: "Rechnung 2026-041",
    from: { name: "ACME Buchhaltung", email: "buchhaltung@acme.de" },
    body_excerpt: "Anbei unsere Rechnung über 1.240,00 EUR, zahlbar bis 21.07.",
    has_attachments: true,
    sent_at: "2026-07-08T09:00:00Z",
  },
  thread: { subject: "Rechnung 2026-041", message_count: 1 },
};

describe("classify_email", () => {
  it("baut einen Prompt mit Kategorien und Inhalt", () => {
    const prompt = classifyEmailSkill.buildPrompt(classifyCtx)!;
    expect(prompt).toContain("anfrage, rechnung, sonstiges");
    expect(prompt).toContain("Rechnung 2026-041");
    expect(prompt).toContain("reines JSON");
  });

  it("parst gültige Antworten strikt", () => {
    const { result } = classifyEmailSkill.parse(
      '{"category":"rechnung","urgency":2,"confidence":0.97,"reason":"Rechnungsanhang"}',
      classifyCtx,
    );
    expect(result).toMatchObject({ category: "rechnung", urgency: 2 });
  });

  it("lehnt unbekannte Kategorien ab", () => {
    expect(() =>
      classifyEmailSkill.parse('{"category":"quatsch","urgency":2,"confidence":0.9}', classifyCtx),
    ).toThrow();
  });
});

const caseCtx = {
  jobId: "9e0f9b1a-0000-4000-8000-000000000002",
  jobType: "case_match",
  locale: "de-DE",
  thread: {
    subject: "AW: Angebot Dachsanierung",
    participants: [{ name: "", email: "meier@acme.de" }],
    snippet: "…",
    category: "auftrag",
  },
  message: { from: { name: "", email: "meier@acme.de" }, body_excerpt: "Wir nehmen an." },
  candidates: [
    {
      case_id: "11111111-1111-4111-8111-111111111111",
      case_number: "V-2026-0001",
      title: "Dachsanierung ACME",
      status: "open",
      company: "ACME GmbH",
      reference: null,
      last_activity_at: null,
    },
  ],
};

describe("case_match", () => {
  it("listet Kandidaten im Prompt", () => {
    const prompt = caseMatchSkill.buildPrompt(caseCtx)!;
    expect(prompt).toContain("V-2026-0001");
    expect(prompt).toContain("11111111-1111-4111-8111-111111111111");
  });

  it("verlangt case_id bei decision=existing", () => {
    expect(() =>
      caseMatchSkill.parse('{"decision":"existing","confidence":0.95}', caseCtx),
    ).toThrow();
    const { result } = caseMatchSkill.parse(
      '{"decision":"existing","case_id":"11111111-1111-4111-8111-111111111111","confidence":0.95}',
      caseCtx,
    );
    expect(result).toMatchObject({ decision: "existing" });
  });

  it("verlangt title bei decision=new", () => {
    expect(() => caseMatchSkill.parse('{"decision":"new","confidence":0.9}', caseCtx)).toThrow();
  });
});

const draftCtx = {
  jobId: "9e0f9b1a-0000-4000-8000-000000000003",
  jobType: "draft_reply",
  locale: "de-DE",
  reply_to: { name: "Herr Meier", email: "meier@acme.de" },
  subject: "Angebot Dachsanierung",
  messages: [
    {
      direction: "inbound",
      from: { name: "", email: "meier@acme.de" },
      sent_at: null,
      body_excerpt: "Können Sie uns ein Angebot schicken?",
    },
  ],
  style_profile: {},
  signature_html: "<p>—<br>DiTom GmbH</p>",
  instructions: "",
  sender_name: "Timur Kalayci",
};

describe("draft_reply", () => {
  it("nimmt Signatur und Verlauf in den Prompt auf", () => {
    const prompt = draftReplySkill.buildPrompt(draftCtx)!;
    expect(prompt).toContain("DiTom GmbH");
    expect(prompt).toContain("Können Sie uns ein Angebot schicken?");
  });

  it("erzwingt den Reply-To-Empfänger bei halluzinierten Adressen", () => {
    const { result } = draftReplySkill.parse(
      '{"subject":"Re: Angebot","body_html":"<p>Gern.</p>","to_addrs":[{"email":"falsch@fremd.de"}]}',
      draftCtx,
    );
    expect((result as { to_addrs: Array<{ email: string }> }).to_addrs).toEqual([
      { name: "Herr Meier", email: "meier@acme.de" },
    ]);
  });
});

describe("thread_summary", () => {
  it("parst die Zusammenfassung", () => {
    const ctx = {
      jobId: "9e0f9b1a-0000-4000-8000-000000000004",
      jobType: "thread_summary",
      locale: "de-DE",
      subject: "X",
      messages: [],
    };
    const { result, resultHash } = threadSummarySkill.parse(
      '{"summary":"Kunde wartet auf Angebot; nächster Schritt liegt bei uns."}',
      ctx,
    );
    expect(result).toMatchObject({ summary: expect.stringContaining("Angebot") });
    expect(resultHash).toHaveLength(64);
  });
});
