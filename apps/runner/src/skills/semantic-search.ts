// Semantische Suche (interaktiv, Priorität 1): bettet die Suchanfrage lokal
// ein; die eigentliche Vektor-Suche macht die DB (RPC search_combined).
import { semanticSearchContextSchema } from "@leitwerk/shared";
import { embedTexts } from "../connectors/embedder";
import { resultHash } from "../util/hash";
import type { Skill } from "./types";

export const semanticSearchSkill: Skill = {
  type: "semantic_search",
  schemaDescription: '{"embedding": [<1024 Zahlen>], "model": "<Modellname>"}',

  buildPrompt() {
    return null; // lokales Embedding, kein KI-Aufruf
  },

  parse() {
    throw new Error("semantic_search läuft über execute()");
  },

  async execute(ctx) {
    const parsed = semanticSearchContextSchema.parse(ctx);
    const { embeddings, model } = await embedTexts([parsed.query]);
    const result = { embedding: embeddings[0] ?? [], model };
    return { result, resultHash: resultHash({ ...result, job: parsed.jobId }) };
  },
};
