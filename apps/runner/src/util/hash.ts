import { createHash } from "node:crypto";

/** Deterministische Serialisierung (Schlüssel sortiert) für Idempotenz-Hashes. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortValue(v)]),
    );
  }
  return value;
}

/** SHA-256-Hex über das stabil serialisierte Ergebnis (agent_jobs.result_hash). */
export function resultHash(result: unknown): string {
  return createHash("sha256").update(stableStringify(result)).digest("hex");
}
