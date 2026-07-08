// runner-broker — einzige Schnittstelle zwischen Runner und Datenbank.
// Endpunkte: /pair /claim /heartbeat /complete /fail
// Der Runner schreibt NIE direkt auf agent_jobs (CLAUDE.md Regel 2) —
// alles läuft über die RPCs claim_next_job / job_heartbeat / complete_job / fail_job.
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, type SupabaseClient } from "../_shared/supabase.ts";
import {
  hashRunnerToken,
  verifyRunner,
  type RunnerRow,
} from "../_shared/runner-auth.ts";

function newRunnerToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `lwr_${b64}`;
}

async function handlePair(db: SupabaseClient, req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code || code.length < 6 || code.length > 16) {
    return json({ error: "Ungültiger Pairing-Code" }, 400);
  }

  const { data: pairing } = await db
    .from("runner_pairing_codes")
    .select("id, user_id, org_id, expires_at, claimed_at")
    .eq("code", code)
    .is("claimed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  // Nutzer hat den Code noch nicht in der PWA eingegeben → Runner pollt weiter.
  if (!pairing) return json({ status: "pending" });

  const token = newRunnerToken();
  const tokenHash = await hashRunnerToken(token);

  const { data: runner, error: runnerError } = await db
    .from("runners")
    .insert({
      org_id: pairing.org_id,
      user_id: pairing.user_id,
      name: typeof body.name === "string" && body.name ? body.name : "Mein Runner",
      token_hash: tokenHash,
      provider: body.provider ?? "claude_cli",
      version: typeof body.version === "string" ? body.version : null,
      status: "online",
      last_heartbeat: new Date().toISOString(),
    })
    .select("id, org_id")
    .single();
  if (runnerError || !runner) {
    return json({ error: `Runner-Anlage fehlgeschlagen: ${runnerError?.message}` }, 500);
  }

  await db
    .from("runner_pairing_codes")
    .update({ claimed_at: new Date().toISOString(), runner_id: runner.id })
    .eq("id", pairing.id);

  await db.from("audit_log").insert({
    org_id: pairing.org_id,
    actor_type: "runner",
    actor_id: runner.id,
    action: "runner.paired",
    entity_type: "runner",
    entity_id: runner.id,
  });

  // Der Klartext-Token existiert nur in dieser Antwort — danach nur noch als Hash.
  return json({
    status: "paired",
    runnerId: runner.id,
    runnerToken: token,
    orgId: runner.org_id,
  });
}

async function handleClaim(db: SupabaseClient, runner: RunnerRow): Promise<Response> {
  const { data, error } = await db.rpc("claim_next_job", { p_runner_id: runner.id });
  if (error) return json({ error: error.message }, 500);
  // RPC gibt eine agent_jobs-Zeile oder null (kein Job) zurück.
  const job = data && (data as { id?: string }).id ? data : null;
  await db
    .from("runners")
    .update({ last_heartbeat: new Date().toISOString(), status: "online" })
    .eq("id", runner.id);
  return json({ job });
}

async function handleHeartbeat(
  db: SupabaseClient,
  runner: RunnerRow,
  req: Request,
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  if (body.jobId) {
    const { error } = await db.rpc("job_heartbeat", {
      p_runner_id: runner.id,
      p_job_id: body.jobId,
    });
    if (error) return json({ error: error.message }, 500);
  } else {
    await db
      .from("runners")
      .update({ last_heartbeat: new Date().toISOString(), status: "online" })
      .eq("id", runner.id);
  }
  return json({ ok: true });
}

async function handleComplete(
  db: SupabaseClient,
  runner: RunnerRow,
  req: Request,
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  if (!body.jobId || body.result === undefined || !body.resultHash) {
    return json({ error: "jobId, result und resultHash sind Pflicht" }, 400);
  }
  const { error } = await db.rpc("complete_job", {
    p_runner_id: runner.id,
    p_job_id: body.jobId,
    p_result: body.result,
    p_result_hash: body.resultHash,
  });
  if (error) return json({ error: error.message }, 500);

  await db.from("audit_log").insert({
    org_id: runner.org_id,
    actor_type: "runner",
    actor_id: runner.id,
    action: "job.completed",
    entity_type: "agent_job",
    entity_id: body.jobId,
    job_id: body.jobId,
  });
  return json({ ok: true });
}

async function handleFail(
  db: SupabaseClient,
  runner: RunnerRow,
  req: Request,
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  if (!body.jobId) return json({ error: "jobId ist Pflicht" }, 400);
  const { error } = await db.rpc("fail_job", {
    p_runner_id: runner.id,
    p_job_id: body.jobId,
    p_error: String(body.error ?? "Unbekannter Fehler"),
  });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const action = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  const db = serviceClient();

  try {
    if (action === "pair") return await handlePair(db, req);

    const runner = await verifyRunner(db, req);
    if (!runner) return json({ error: "Runner-Authentifizierung fehlgeschlagen" }, 401);

    switch (action) {
      case "claim":
        return await handleClaim(db, runner);
      case "heartbeat":
        return await handleHeartbeat(db, runner, req);
      case "complete":
        return await handleComplete(db, runner, req);
      case "fail":
        return await handleFail(db, runner, req);
      default:
        return json({ error: `Unbekannte Aktion: ${action}` }, 404);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
