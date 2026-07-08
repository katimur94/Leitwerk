// runner-broker — einzige Schnittstelle zwischen Runner und Datenbank.
// Endpunkte: /pair /status /claim /heartbeat /complete /fail
// Der Runner schreibt NIE direkt auf agent_jobs (CLAUDE.md Regel 2) —
// alles läuft über die RPCs claim_next_job / job_heartbeat / complete_job / fail_job.
//
// Etappe 0.5 (Migration 017):
//  - /pair: Rate-Limit pro IP (10/Min), Fehlversuchszähler pro Code (5 → gesperrt)
//  - Zwei-Stufen-Pairing: Runner startet als 'pending_approval', erst die
//    Freigabe in der PWA (approve_runner) schaltet ihn frei
//  - /status: Selbstauskunft, damit der Runner auf seine Freigabe warten kann
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, type SupabaseClient } from "../_shared/supabase.ts";
import {
  authenticateRunner,
  hashPairingIp,
  hashRunnerToken,
  type RunnerRow,
} from "../_shared/runner-auth.ts";

const MAX_PAIRING_CODE_FAILURES = 5;

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

  // Rate-Limit: max. 10 Versuche pro IP pro Minute (Migration 017)
  const ipHash = await hashPairingIp(req);
  const { data: allowed, error: rateError } = await db.rpc(
    "register_pairing_attempt",
    { p_ip_hash: ipHash },
  );
  if (rateError) return json({ error: rateError.message }, 500);
  if (!allowed) {
    return new Response(
      JSON.stringify({
        error: "Zu viele Pairing-Versuche. Warte eine Minute.",
        code: "rate_limited",
      }),
      {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
      },
    );
  }

  // Code in JEDEM Zustand laden — nur so lassen sich Fehlversuche zählen.
  const { data: pairing } = await db
    .from("runner_pairing_codes")
    .select("id, user_id, org_id, expires_at, claimed_at, failed_attempts")
    .eq("code", code)
    .maybeSingle();

  // Nutzer hat den Code noch nicht in der PWA eingegeben → Runner pollt weiter.
  // (Kein Fehlversuch: das ist der normale Wartezustand des Pairings.)
  if (!pairing) return json({ status: "pending" });

  if (pairing.failed_attempts >= MAX_PAIRING_CODE_FAILURES) {
    return json(
      { error: "Pairing-Code gesperrt (zu viele Fehlversuche). Starte das Pairing neu.", code: "code_blocked" },
      410,
    );
  }
  if (pairing.claimed_at || pairing.expires_at <= new Date().toISOString()) {
    await db.rpc("register_pairing_failure", { p_code: code });
    return json(
      { error: "Pairing-Code abgelaufen oder bereits verwendet. Starte das Pairing neu.", code: "code_invalid" },
      410,
    );
  }

  const token = newRunnerToken();
  const tokenHash = await hashRunnerToken(token);

  // Zwei-Stufen-Pairing: Runner startet als pending_approval und darf
  // NICHTS claimen, bis ein Owner/Admin ihn in der PWA bestätigt.
  const { data: runner, error: runnerError } = await db
    .from("runners")
    .insert({
      org_id: pairing.org_id,
      user_id: pairing.user_id,
      name: typeof body.name === "string" && body.name ? body.name : "Mein Runner",
      token_hash: tokenHash,
      provider: body.provider ?? "claude_cli",
      version: typeof body.version === "string" ? body.version : null,
      status: "pending_approval",
    })
    .select("id, org_id")
    .single();
  if (runnerError || !runner) {
    return json({ error: `Runner-Anlage fehlgeschlagen: ${runnerError?.message}` }, 500);
  }

  // Code atomar einlösen — verliert dieser Request das Rennen, Runner zurückrollen.
  const { data: claimed } = await db
    .from("runner_pairing_codes")
    .update({ claimed_at: new Date().toISOString(), runner_id: runner.id })
    .eq("id", pairing.id)
    .is("claimed_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) {
    await db.from("runners").delete().eq("id", runner.id);
    await db.rpc("register_pairing_failure", { p_code: code });
    return json(
      { error: "Pairing-Code wurde soeben anderweitig eingelöst.", code: "code_invalid" },
      410,
    );
  }

  await db.from("audit_log").insert({
    org_id: pairing.org_id,
    actor_type: "runner",
    actor_id: runner.id,
    action: "runner.paired",
    entity_type: "runner",
    entity_id: runner.id,
    detail: { status: "pending_approval" },
  });

  // Der Klartext-Token existiert nur in dieser Antwort — danach nur noch als Hash.
  return json({
    status: "paired",
    runnerId: runner.id,
    runnerToken: token,
    orgId: runner.org_id,
    pendingApproval: true,
  });
}

async function handleClaim(db: SupabaseClient, runner: RunnerRow): Promise<Response> {
  // Heartbeat/Status-Update passiert seit Migration 017 IN der RPC (ein Roundtrip).
  const { data, error } = await db.rpc("claim_next_job", { p_runner_id: runner.id });
  if (error) return json({ error: error.message }, 500);
  // RPC gibt eine agent_jobs-Zeile oder null (kein Job / Limit / Nachtfenster) zurück.
  const job = data && (data as { id?: string }).id ? data : null;
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
      .eq("id", runner.id)
      .in("status", ["online", "offline"]);
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

  const action = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  // Deploy-Verifikation (tutorials/03), bewusst ohne Auth
  if (action === "health") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const db = serviceClient();

  try {
    if (action === "pair") return await handlePair(db, req);

    const runner = await authenticateRunner(db, req);
    if (!runner) return json({ error: "Runner-Authentifizierung fehlgeschlagen" }, 401);

    // Selbstauskunft — auch für pending_approval erlaubt, damit der Runner
    // seine Freigabe abwarten kann. Alle anderen Aktionen erst nach Freigabe.
    if (action === "status") return json({ status: runner.status });

    if (runner.status === "pending_approval") {
      return json(
        {
          error: "Runner wartet auf Freigabe in der PWA (Einstellungen → Runner).",
          code: "pending_approval",
        },
        403,
      );
    }
    if (runner.status === "disabled") {
      return json({ error: "Runner wurde deaktiviert.", code: "runner_disabled" }, 403);
    }

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
