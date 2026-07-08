import { describe, expect, it } from "vitest";
import { formatCents, toCents } from "./money";

describe("formatCents", () => {
  it("formatiert Cent-Beträge deutsch", () => {
    // Intl nutzt geschütztes Leerzeichen vor dem €-Zeichen
    expect(formatCents(123456).replace(/ /g, " ")).toBe("1.234,56 €");
    expect(formatCents(0).replace(/ /g, " ")).toBe("0,00 €");
    expect(formatCents(-9950).replace(/ /g, " ")).toBe("-99,50 €");
  });

  it("wirft bei ungültigen Werten", () => {
    expect(() => formatCents(Number.NaN)).toThrow();
  });
});

describe("toCents", () => {
  it("parst deutsche Eingaben", () => {
    expect(toCents("1.234,56")).toBe(123456);
    expect(toCents("12")).toBe(1200);
    expect(toCents("0,99")).toBe(99);
    expect(toCents(" 19,90 € ")).toBe(1990);
  });

  it("akzeptiert Zahlen", () => {
    expect(toCents(12.5)).toBe(1250);
  });

  it("wirft bei Müll-Eingaben", () => {
    expect(() => toCents("abc")).toThrow();
    expect(() => toCents("")).toThrow();
  });
});
