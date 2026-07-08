import { describe, expect, it } from "vitest";
import { parseClaudeCliOutput } from "./claude-cli";

describe("parseClaudeCliOutput", () => {
  it("liefert das result-Feld", () => {
    const stdout = JSON.stringify({
      type: "result",
      is_error: false,
      result: '{"reply":"Hallo"}',
    });
    expect(parseClaudeCliOutput(stdout)).toBe('{"reply":"Hallo"}');
  });

  it("wirft bei is_error", () => {
    const stdout = JSON.stringify({ is_error: true, result: "Rate limit" });
    expect(() => parseClaudeCliOutput(stdout)).toThrow(/Rate limit/);
  });

  it("wirft bei Nicht-JSON-Ausgabe", () => {
    expect(() => parseClaudeCliOutput("command not found")).toThrow(
      /kein JSON/,
    );
  });

  it("wirft bei fehlendem result", () => {
    expect(() => parseClaudeCliOutput('{"is_error":false}')).toThrow();
  });
});
