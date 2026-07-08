import { describe, expect, it } from "vitest";
import { resultHash, stableStringify } from "./hash";

describe("stableStringify", () => {
  it("sortiert Schlüssel rekursiv", () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":2}',
    );
  });

  it("lässt Arrays in Reihenfolge", () => {
    expect(stableStringify([2, 1])).toBe("[2,1]");
  });
});

describe("resultHash", () => {
  it("ist unabhängig von der Schlüssel-Reihenfolge (Idempotenz)", () => {
    expect(resultHash({ a: 1, b: 2 })).toBe(resultHash({ b: 2, a: 1 }));
  });

  it("unterscheidet unterschiedliche Ergebnisse", () => {
    expect(resultHash({ a: 1 })).not.toBe(resultHash({ a: 2 }));
  });
});
