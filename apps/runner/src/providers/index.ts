import { AnthropicApiProvider } from "./anthropic-api";
import { ClaudeCliProvider } from "./claude-cli";
import { CodexCliProvider } from "./codex-cli";
import type { AiProvider } from "./types";

export type ProviderKind = "claude_cli" | "codex_cli" | "anthropic_api";

export function createProvider(kind: ProviderKind): AiProvider {
  switch (kind) {
    case "claude_cli":
      return new ClaudeCliProvider();
    case "codex_cli":
      return new CodexCliProvider();
    case "anthropic_api":
      return new AnthropicApiProvider();
  }
}

export type { AiProvider, CompleteOptions } from "./types";
export { parseClaudeCliOutput } from "./claude-cli";
