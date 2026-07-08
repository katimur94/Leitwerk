import { describe, expect, it } from "vitest";
import { extractCommitmentsSkill } from "./extract-commitments";
import { followupCheckSkill } from "./followup-check";
import { gapScanSkill } from "./gap-scan";
import { morningBriefingSkill } from "./morning-briefing";

const uuid = (n: number) => `9e0f9b1a-0000-4000-8000-00000000000${n}`;

describe("extract_commitments", () => {
  const ctx = {
    jobId: uuid(1),
    jobType: "extract_commitments",
    locale: "de-DE",
    today: "2026-07-08",
    message: {
      subject: "Unterlagen",
      from: { name: "", email: "a@b.de" },
      body_excerpt: "Bitte senden Sie uns bis Freitag die Statik-Unterlagen.",
      sent_at: null,
    },
    existing_tasks: ["Rückruf Meier"],
  };

  it("nimmt vorhandene Aufgaben als Dubletten-Hinweis auf", () => {
    const prompt = extractCommitmentsSkill.buildPrompt(ctx)!;
    expect(prompt).toContain("Rückruf Meier");
    expect(prompt).toContain("2026-07-08");
  });

  it("parst Ergebnisse strikt (max. 10, title Pflicht)", () => {
    const { result } = extractCommitmentsSkill.parse(
      '{"commitments":[{"title":"Statik-Unterlagen senden","due_at":"2026-07-10","confidence":0.9}]}',
      ctx,
    );
    expect(result).toMatchObject({ commitments: [{ title: "Statik-Unterlagen senden" }] });
    expect(() => extractCommitmentsSkill.parse('{"commitments":[{"title":""}]}', ctx)).toThrow();
  });
});

describe("gap_scan", () => {
  const ctx = {
    jobId: uuid(2),
    jobType: "gap_scan",
    locale: "de-DE",
    today: "2026-07-08",
    stale_cases: [
      { case_id: uuid(3), case_number: "V-2026-0001", title: "Dach", status: "open", days_inactive: 9 },
    ],
    unanswered_threads: [],
    overdue_followups: 1,
    overdue_tasks: 2,
  };

  it("listet Signale im Prompt und verlangt dedupe_key", () => {
    expect(gapScanSkill.buildPrompt(ctx)!).toContain("V-2026-0001");
    expect(() =>
      gapScanSkill.parse('{"findings":[{"kind":"stale","severity":2,"title":"X"}]}', ctx),
    ).toThrow(); // dedupe_key fehlt
    const { result } = gapScanSkill.parse(
      '{"findings":[{"kind":"stale","severity":2,"title":"Vorgang liegt","dedupe_key":"stale:V-2026-0001","case_id":null}]}',
      ctx,
    );
    expect(result).toMatchObject({ findings: [{ dedupe_key: "stale:V-2026-0001" }] });
  });
});

describe("morning_briefing", () => {
  it("parst content_md + items", () => {
    const ctx = {
      jobId: uuid(4),
      jobType: "morning_briefing",
      locale: "de-DE",
      for_date: "2026-07-08",
      org_name: "DiTom",
      stats: { unread_threads: 3, urgent_threads: 1, due_tasks: 2, overdue_followups: 1, open_findings: 1 },
      top_items: [],
    };
    expect(morningBriefingSkill.buildPrompt(ctx)!).toContain("Morgen-Briefing");
    const { result } = morningBriefingSkill.parse(
      '{"content_md":"Heute zählen drei Dinge: …","items":[{"title":"Anfrage ACME beantworten","entity_type":"mail_thread","entity_id":"9e0f9b1a-0000-4000-8000-000000000001","action":"Entwurf ansehen"}]}',
      ctx,
    );
    expect(result).toMatchObject({ items: [{ action: "Entwurf ansehen" }] });
  });
});

describe("followup_check", () => {
  const base = {
    jobId: uuid(5),
    jobType: "followup_check",
    locale: "de-DE",
    today: "2026-07-08",
  };

  it("liefert ohne Überfälliges keinen Prompt (kein KI-Aufruf)", () => {
    expect(followupCheckSkill.buildPrompt({ ...base, overdue: [] })).toBeNull();
    const { result } = followupCheckSkill.parse("", { ...base, overdue: [] });
    expect(result).toEqual({ followups: [] });
  });

  it("bewertet überfällige Follow-ups", () => {
    const ctx = {
      ...base,
      overdue: [
        {
          followup_id: uuid(6),
          thread_id: uuid(7),
          subject: "Angebot",
          counterpart: "meier@acme.de",
          expected_by: "2026-07-04",
          days_overdue: 4,
        },
      ],
    };
    expect(followupCheckSkill.buildPrompt(ctx)!).toContain("Angebot");
    const { result } = followupCheckSkill.parse(
      `{"followups":[{"followup_id":"${uuid(6)}","action":"escalate","title":"Antwort überfällig","draft_instructions":"Freundlich nachfassen"}]}`,
      ctx,
    );
    expect(result).toMatchObject({ followups: [{ action: "escalate" }] });
  });
});
