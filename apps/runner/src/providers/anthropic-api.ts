// Optionaler Provider: Anthropic Messages API mit eigenem API-Key.
// Bewusst per fetch statt SDK — der Runner bleibt schlank.
import type { AiProvider, CompleteOptions } from "./types";

interface ContentBlock {
  type: string;
  text?: string;
}

interface MessagesResponse {
  content?: ContentBlock[];
  stop_reason?: string;
  error?: { message?: string };
}

export class AnthropicApiProvider implements AiProvider {
  readonly name = "anthropic_api";

  constructor(
    private readonly apiKey = process.env.ANTHROPIC_API_KEY,
    private readonly model = process.env.LEITWERK_ANTHROPIC_MODEL ??
      "claude-opus-4-8",
  ) {}

  async complete(prompt: string, opts?: CompleteOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error("ANTHROPIC_API_KEY ist nicht gesetzt (Provider anthropic_api)");
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 16000,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout((opts?.maxRuntimeSec ?? 300) * 1000),
    });

    const data = (await res.json().catch(() => ({}))) as MessagesResponse;
    if (!res.ok) {
      throw new Error(
        `Anthropic API ${res.status}: ${data.error?.message ?? "unbekannter Fehler"}`,
      );
    }
    if (data.stop_reason === "refusal") {
      throw new Error("Anthropic API hat die Anfrage abgelehnt (refusal)");
    }
    const text = (data.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
    if (!text) throw new Error("Anthropic API lieferte keine Textantwort");
    return text;
  }
}
