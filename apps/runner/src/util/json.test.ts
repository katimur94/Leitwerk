import { describe, expect, it } from "vitest";
import { extractJson } from "./json";

describe("extractJson", () => {
  it("parst reines JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("entfernt Markdown-Zäune", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("schneidet Vorspann/Nachspann ab", () => {
    expect(extractJson('Hier ist das Ergebnis: {"a":1} — fertig.')).toEqual({
      a: 1,
    });
  });

  it("wirft bei leerer oder JSON-freier Antwort", () => {
    expect(() => extractJson("")).toThrow();
    expect(() => extractJson("kein json hier")).toThrow();
  });
});
