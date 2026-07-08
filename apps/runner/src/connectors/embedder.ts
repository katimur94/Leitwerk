// Lokaler Embedding-Adapter (Etappe 4, MASTERPLAN §4 G/Q):
// Embeddings entstehen IMMER lokal beim Nutzer — nie in einer Cloud.
//
// Zwei Modi:
// 1. LEITWERK_EMBED_BIN gesetzt → externes Programm (z. B. Wrapper um
//    bge-m3/multilingual-e5 via llama.cpp o. ä.). Vertrag: stdin bekommt
//    JSON {"texts": ["…"]}, stdout liefert JSON
//    {"embeddings": [[…1024 Zahlen…]], "model": "<name>"}.
// 2. Fallback ohne Modell: deterministisches Hash-Embedding (Bag-of-Words
//    auf 1024 Dimensionen, L2-normalisiert). Ehrlich gekennzeichnet als
//    'hash-fallback' — grobe Ähnlichkeit statt echter Semantik, aber
//    reproduzierbar und offline. Für Produktion Modell konfigurieren
//    (tutorials/06_runner_setup.md).
import { spawn } from "node:child_process";

export const EMBEDDING_DIM = 1024;

function hashToken(token: string): number {
  // FNV-1a — stabil über Plattformen
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministisches Fallback-Embedding (kein Modell nötig). */
export function hashEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const tokens = text
    .toLowerCase()
    .normalize("NFKD")
    .split(/[^a-zäöüß0-9]+/)
    .filter((t) => t.length > 1);
  for (const token of tokens) {
    const h = hashToken(token);
    const dim = h % EMBEDDING_DIM;
    const sign = (h >>> 16) % 2 === 0 ? 1 : -1;
    vec[dim] += sign;
    // Bigramm-artige Zweitdimension für etwas mehr Trennschärfe
    const dim2 = (h >>> 8) % EMBEDDING_DIM;
    vec[dim2] += sign * 0.5;
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => Math.round((x / norm) * 1e6) / 1e6);
}

async function embedViaBin(
  bin: string,
  texts: string[],
): Promise<{ embeddings: number[][]; model: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Embed-Bin Exit ${code}: ${err.slice(0, 300)}`));
      try {
        const parsed = JSON.parse(out) as { embeddings?: number[][]; model?: string };
        if (!Array.isArray(parsed.embeddings)) throw new Error("embeddings fehlt");
        for (const e of parsed.embeddings) {
          if (!Array.isArray(e) || e.length !== EMBEDDING_DIM) {
            throw new Error(`Embedding hat ${Array.isArray(e) ? e.length : "?"} statt ${EMBEDDING_DIM} Dimensionen`);
          }
        }
        resolve({ embeddings: parsed.embeddings, model: parsed.model ?? "custom" });
      } catch (error) {
        reject(new Error(`Embed-Bin lieferte ungültiges JSON: ${String(error)}`));
      }
    });
    child.stdin.write(JSON.stringify({ texts }));
    child.stdin.end();
  });
}

/** Texte einbetten — Modell wenn konfiguriert, sonst Hash-Fallback. */
export async function embedTexts(
  texts: string[],
): Promise<{ embeddings: number[][]; model: string }> {
  const bin = process.env.LEITWERK_EMBED_BIN;
  if (bin) return embedViaBin(bin, texts);
  return { embeddings: texts.map(hashEmbedding), model: "hash-fallback" };
}
