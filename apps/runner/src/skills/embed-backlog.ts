// Embeddings-Pipeline (Etappe 4): bettet neue Inhalte lokal ein —
// reiner Lokal-Job über den Embedder-Adapter, kein KI-Provider-Aufruf.
import { embedBacklogContextSchema } from "@leitwerk/shared";
import { embedTexts } from "../connectors/embedder";
import { resultHash } from "../util/hash";
import { log } from "../util/log";
import type { Skill } from "./types";

export const embedBacklogSkill: Skill = {
  type: "embed_backlog",
  schemaDescription:
    '{"items": [{"entity_type": "<typ>", "entity_id": "<uuid>", "chunk_index": <int>, "content": "<Text>", "embedding": [<1024 Zahlen>]}], "model": "<Modellname>"}',

  buildPrompt() {
    return null; // lokales Embedding, kein KI-Aufruf
  },

  parse() {
    throw new Error("embed_backlog läuft über execute()");
  },

  async execute(ctx) {
    const parsed = embedBacklogContextSchema.parse(ctx);
    if (parsed.pending.length === 0) {
      const empty = { items: [], model: "none" };
      return { result: empty, resultHash: resultHash({ ...empty, job: parsed.jobId }) };
    }
    const { embeddings, model } = await embedTexts(parsed.pending.map((p) => p.content));
    log.info(`embed_backlog: ${parsed.pending.length} Inhalte eingebettet (${model})`);
    const result = {
      items: parsed.pending.map((p, i) => ({
        entity_type: p.entity_type,
        entity_id: p.entity_id,
        chunk_index: p.chunk_index,
        content: p.content.slice(0, 2000),
        embedding: embeddings[i] ?? [],
      })),
      model,
    };
    return { result, resultHash: resultHash(result) };
  },
};
