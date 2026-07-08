import { describe, expect, it } from "vitest";
import { echoSkill } from "./echo";

const ctx = {
  jobId: "6f1f30fe-6a4f-4a3c-9b1a-2f4f0d9d1a11",
  jobType: "echo",
  locale: "de-DE",
  input: { text: "Sag Hallo, Leitwerk!" },
};

describe("echoSkill.buildPrompt", () => {
  it("verlangt reines JSON und enthält den Testtext", () => {
    const prompt = echoSkill.buildPrompt(ctx);
    expect(prompt).toBeTypeOf("string");
    expect(prompt).toContain("Sag Hallo, Leitwerk!");
    expect(prompt).toContain('{"reply"');
    expect(prompt?.toLowerCase()).toContain("json");
  });

  it("wirft bei kaputtem Kontext", () => {
    expect(() => echoSkill.buildPrompt({ jobType: "echo" })).toThrow();
  });
});

describe("echoSkill.parse", () => {
  it("parst reines JSON", () => {
    const { result, resultHash } = echoSkill.parse('{"reply":"Hallo!"}', ctx);
    expect(result).toEqual({ reply: "Hallo!" });
    expect(resultHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("toleriert Markdown-Zäune (Reparatur-freundlich)", () => {
    const raw = '```json\n{"reply":"Hallo aus dem Zaun"}\n```';
    expect(echoSkill.parse(raw, ctx).result).toEqual({
      reply: "Hallo aus dem Zaun",
    });
  });

  it("ist idempotent: gleiches Ergebnis → gleicher Hash", () => {
    const a = echoSkill.parse('{"reply":"x"}', ctx);
    const b = echoSkill.parse('{"reply":"x"}', ctx);
    expect(a.resultHash).toBe(b.resultHash);
  });

  it("wirft bei falschem Schema", () => {
    expect(() => echoSkill.parse('{"answer":"Hallo"}', ctx)).toThrow();
    expect(() => echoSkill.parse('{"reply":""}', ctx)).toThrow();
    expect(() => echoSkill.parse("Hallo ohne JSON", ctx)).toThrow();
  });
});
