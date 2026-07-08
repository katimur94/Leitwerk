import { describe, expect, it } from "vitest";
import { buildRepairPrompt, REPAIR_RAW_MAX_CHARS } from "./repair";

describe("buildRepairPrompt", () => {
  it("enthält Schema und fehlerhafte Antwort, aber keinen Original-Prompt", () => {
    const prompt = buildRepairPrompt('{"reply": "<string>"}', "kaputtes { json");
    expect(prompt).toContain('{"reply": "<string>"}');
    expect(prompt).toContain("kaputtes { json");
    expect(prompt).toContain("AUSSCHLIESSLICH");
  });

  it("kürzt die fehlerhafte Antwort auf 2000 Zeichen", () => {
    const longRaw = "x".repeat(10_000);
    const prompt = buildRepairPrompt("{}", longRaw);
    expect(prompt).not.toContain("x".repeat(REPAIR_RAW_MAX_CHARS + 1));
    expect(prompt).toContain("x".repeat(REPAIR_RAW_MAX_CHARS));
    // Grobe Obergrenze: Schema + Rahmentext + 2000 Zeichen Antwort
    expect(prompt.length).toBeLessThan(REPAIR_RAW_MAX_CHARS + 500);
  });
});
