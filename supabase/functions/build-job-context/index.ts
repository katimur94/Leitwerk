// build-job-context — baut serverseitig den Kontext für KI-Jobs zusammen.
// Der Runner ist "dumm": er bekommt fertigen Kontext, baut daraus den Prompt
// (Skill.buildPrompt) und führt nur aus. Prompt-Logik bleibt so zentral
// versionierbar (MASTERPLAN §2.3) und der Kontext wird datenminimiert
// zugeschnitten (§6.3).
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, type SupabaseClient } from "../_shared/supabase.ts";
import { verifyRunner } from "../_shared/runner-auth.ts";

interface JobRow {
  id: string;
  org_id: string;
  job_type: string;
  status: string;
  claimed_by: string | null;
  payload: Record<string, unknown>;
  context_hint: Record<string, unknown>;
}

async function buildContext(
  _db: SupabaseClient,
  job: JobRow,
): Promise<Record<string, unknown> | null> {
  switch (job.job_type) {
    // P0: Dummy-Job — KI beantwortet einen Testtext.
    case "echo":
      return {
        jobId: job.id,
        jobType: "echo",
        locale: "de-DE",
        input: { text: String(job.payload.text ?? "") },
      };
    // Weitere Job-Typen (classify_email, case_match, draft_reply, ...) folgen in P1+.
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const db = serviceClient();
  try {
    const runner = await verifyRunner(db, req);
    if (!runner) return json({ error: "Runner-Authentifizierung fehlgeschlagen" }, 401);

    const body = await req.json().catch(() => ({}));
    if (!body.jobId) return json({ error: "jobId ist Pflicht" }, 400);

    const { data: job, error } = await db
      .from("agent_jobs")
      .select("id, org_id, job_type, status, claimed_by, payload, context_hint")
      .eq("id", body.jobId)
      .maybeSingle();
    if (error || !job) return json({ error: "Job nicht gefunden" }, 404);

    // Kontext gibt es nur für den Runner, der den Job geclaimt hat.
    if (job.claimed_by !== runner.id || !["claimed", "running"].includes(job.status)) {
      return json({ error: "Job gehört nicht zu diesem Runner" }, 403);
    }

    const context = await buildContext(db, job as JobRow);
    if (!context) return json({ error: `Unbekannter Job-Typ: ${job.job_type}` }, 422);

    return json({ context });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
