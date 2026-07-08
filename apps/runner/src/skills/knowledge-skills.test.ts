import { describe, expect, it } from "vitest";
import { EMBEDDING_DIM, hashEmbedding } from "../connectors/embedder";
import { buildStyleProfileSkill } from "./build-style-profile";
import { embedBacklogSkill } from "./embed-backlog";
import { knowledgeDistillSkill } from "./knowledge-distill";
import { semanticSearchSkill } from "./semantic-search";
import { summarizeMeetingSkill } from "./summarize-meeting";
import type { SkillDeps } from "./types";

const uuid = (n: number) => `7c1d2e3f-0000-4000-8000-00000000000${n}`;
const deps = {} as SkillDeps; // Lokal-Skills brauchen weder Broker noch Provider

describe("embedder (hash-fallback)", () => {
  it("liefert deterministische, normalisierte 1024-dim Vektoren", () => {
    const a = hashEmbedding("Gewährleistung Firma Zeta Dachsanierung");
    const b = hashEmbedding("Gewährleistung Firma Zeta Dachsanierung");
    expect(a).toHaveLength(EMBEDDING_DIM);
    expect(a).toEqual(b);
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeGreaterThan(0.99);
    expect(norm).toBeLessThan(1.01);
  });

  it("ähnliche Texte liegen näher beieinander als fremde", () => {
    const cos = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0);
    const a = hashEmbedding("Rechnung überfällig Mahnung Zahlung");
    const b = hashEmbedding("Zahlung der Rechnung ist überfällig");
    const c = hashEmbedding("Dachziegel Lieferung Baustelle Kran");
    expect(cos(a, b)).toBeGreaterThan(cos(a, c));
  });
});

describe("embed_backlog / semantic_search", () => {
  it("bettet den Backlog ein (execute, ohne KI)", async () => {
    const ctx = {
      jobId: uuid(1),
      jobType: "embed_backlog",
      locale: "de-DE",
      pending: [
        { entity_type: "note", entity_id: uuid(2), chunk_index: 0, content: "Formular B-12 nötig" },
      ],
    };
    const { result } = await embedBacklogSkill.execute!(ctx, deps);
    const typed = result as { items: Array<{ embedding: number[] }>; model: string };
    expect(typed.items).toHaveLength(1);
    expect(typed.items[0]!.embedding).toHaveLength(EMBEDDING_DIM);
    expect(typed.model).toBe("hash-fallback");
  });

  it("liefert für die Suche ein Query-Embedding", async () => {
    const ctx = { jobId: uuid(3), jobType: "semantic_search", locale: "de-DE", query: "Gewährleistung Zeta" };
    const { result } = await semanticSearchSkill.execute!(ctx, deps);
    expect((result as { embedding: number[] }).embedding).toHaveLength(EMBEDDING_DIM);
  });
});

describe("knowledge_distill", () => {
  const ctx = {
    jobId: uuid(4),
    jobType: "knowledge_distill",
    locale: "de-DE",
    today: "2026-07-08",
    sources: [
      {
        source_type: "mail_message",
        source_id: uuid(5),
        title: "Aufbruchgenehmigung",
        excerpt: "Die Stadt verlangt für Aufbrüche immer Formular B-12.",
        counterpart: "amt@stadt.example",
      },
    ],
    known_facts: ["ACME zahlt erst nach 2. Erinnerung"],
  };

  it("nennt Quellen + bekannte Fakten im Prompt", () => {
    const prompt = knowledgeDistillSkill.buildPrompt(ctx)!;
    expect(prompt).toContain("Formular B-12");
    expect(prompt).toContain("ACME zahlt erst nach 2. Erinnerung");
  });

  it("ohne Quellen: kein KI-Aufruf, leeres Ergebnis", () => {
    const empty = { ...ctx, sources: [] };
    expect(knowledgeDistillSkill.buildPrompt(empty)).toBeNull();
    const { result } = knowledgeDistillSkill.parse("", empty);
    expect(result).toEqual({ facts: [] });
  });

  it("parst Fakten strikt (fact >= 10 Zeichen)", () => {
    const { result } = knowledgeDistillSkill.parse(
      '{"facts":[{"fact":"Stadt Dortmund verlangt für Aufbrüche Formular B-12","category":"behörde","confidence":0.9}]}',
      ctx,
    );
    expect(result).toMatchObject({ facts: [{ category: "behörde" }] });
    expect(() => knowledgeDistillSkill.parse('{"facts":[{"fact":"kurz"}]}', ctx)).toThrow();
  });
});

describe("build_style_profile", () => {
  const ctx = {
    jobId: uuid(6),
    jobType: "build_style_profile",
    locale: "de-DE",
    account_id: uuid(7),
    sent_samples: ["Hallo Herr Meier,\n\nanbei das Angebot.\n\nBeste Grüße\nTimur"],
  };

  it("baut den Prompt aus den gesendeten Mails", () => {
    expect(buildStyleProfileSkill.buildPrompt(ctx)!).toContain("Hallo Herr Meier");
  });

  it("parst das Profil strikt", () => {
    const { result } = buildStyleProfileSkill.parse(
      '{"profile":{"greeting":"Hallo Herr …","closing":"Beste Grüße","tone":"freundlich-direkt","avg_length":"kurz","phrases":["anbei"],"language":"de"},"sample_count":1}',
      ctx,
    );
    expect(result).toMatchObject({ sample_count: 1, profile: { avg_length: "kurz" } });
  });
});

describe("summarize_meeting", () => {
  const ctx = {
    jobId: uuid(8),
    jobType: "summarize_meeting",
    locale: "de-DE",
    today: "2026-07-08",
    meeting: {
      meeting_id: uuid(9),
      title: "Baubesprechung KW 28",
      held_at: "2026-07-08T09:00:00Z",
      case_number: "V-2026-0001",
      transcript_excerpt: "Wir haben entschieden, den Gerüstbau vorzuziehen.",
    },
  };

  it("Prompt enthält Transkript + Vorgang", () => {
    const prompt = summarizeMeetingSkill.buildPrompt(ctx)!;
    expect(prompt).toContain("Gerüstbau");
    expect(prompt).toContain("V-2026-0001");
  });

  it("parst Protokoll + Aufgaben strikt", () => {
    const { result } = summarizeMeetingSkill.parse(
      '{"protocol_md":"## Ergebnisse\\n- Gerüstbau vorgezogen","decisions":["Gerüstbau vorziehen"],"open_questions":[],"tasks":[{"title":"Gerüstbauer beauftragen","due_at":null}]}',
      ctx,
    );
    expect(result).toMatchObject({ tasks: [{ title: "Gerüstbauer beauftragen" }] });
    expect(() => summarizeMeetingSkill.parse('{"protocol_md":"x"}', ctx)).toThrow();
  });
});
