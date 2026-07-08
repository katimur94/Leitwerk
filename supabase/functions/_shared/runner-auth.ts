import type { SupabaseClient } from "./supabase.ts";

export interface RunnerRow {
  id: string;
  org_id: string;
  user_id: string;
  name: string;
  token_hash: string;
  status: "pending_approval" | "online" | "offline" | "disabled";
}

/** SHA-256(pepper:token) als Hex — muss identisch zum Pairing-Hash sein. */
export async function hashRunnerToken(token: string): Promise<string> {
  const pepper = Deno.env.get("RUNNER_TOKEN_PEPPER");
  if (!pepper) throw new Error("RUNNER_TOKEN_PEPPER ist nicht gesetzt");
  const data = new TextEncoder().encode(`${pepper}:${token}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** IP-Hash fürs Pairing-Rate-Limit — Klartext-IPs landen nie in der DB. */
export async function hashPairingIp(req: Request): Promise<string> {
  const pepper = Deno.env.get("RUNNER_TOKEN_PEPPER") ?? "";
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0].trim() || "unknown";
  const data = new TextEncoder().encode(`${pepper}:ip:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Reine Token-Prüfung (x-runner-id / x-runner-token gegen runners.token_hash)
 * OHNE Status-Prüfung — für /status, damit ein Runner in pending_approval
 * seine Freigabe abfragen kann. Für alles andere: verifyRunner.
 */
export async function authenticateRunner(
  db: SupabaseClient,
  req: Request,
): Promise<RunnerRow | null> {
  const runnerId = req.headers.get("x-runner-id");
  const token = req.headers.get("x-runner-token");
  if (!runnerId || !token) return null;

  const { data: runner, error } = await db
    .from("runners")
    .select("id, org_id, user_id, name, token_hash, status")
    .eq("id", runnerId)
    .maybeSingle();
  if (error || !runner) return null;

  const hash = await hashRunnerToken(token);
  if (!timingSafeEqual(hash, runner.token_hash)) return null;
  return runner as RunnerRow;
}

/**
 * Verifiziert den Runner UND lehnt pending_approval/disabled ab (Etappe 0.5):
 * ein nicht freigegebener oder deaktivierter Runner darf keine Aktion ausführen.
 */
export async function verifyRunner(
  db: SupabaseClient,
  req: Request,
): Promise<RunnerRow | null> {
  const runner = await authenticateRunner(db, req);
  if (!runner || runner.status === "disabled" || runner.status === "pending_approval") {
    return null;
  }
  return runner;
}
