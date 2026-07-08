import { z } from "zod";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

export const jobStatusSchema = z.enum([
  "queued",
  "claimed",
  "running",
  "done",
  "failed",
  "cancelled",
  "expired",
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/** agent_jobs-Zeile, wie sie der Broker an den Runner liefert. */
export const agentJobSchema = z
  .object({
    id: z.string().uuid(),
    org_id: z.string().uuid(),
    job_type: z.string(),
    priority: z.number().int(),
    payload: z.record(z.unknown()).default({}),
    context_hint: z.record(z.unknown()).default({}),
    status: jobStatusSchema,
    claimed_by: z.string().uuid().nullable(),
    max_runtime_sec: z.number().int().default(300),
    attempts: z.number().int(),
    max_attempts: z.number().int(),
    created_at: z.string(),
  })
  .passthrough();
export type AgentJob = z.infer<typeof agentJobSchema>;

// ---------- Job-Kontexte (geliefert von build-job-context) ----------

export const echoContextSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal("echo"),
  locale: z.string().default("de-DE"),
  input: z.object({ text: z.string() }),
});
export type EchoContext = z.infer<typeof echoContextSchema>;

/** Union wächst mit jedem Job-Typ (classify_email, case_match, … in P1). */
export type JobContext = EchoContext;

// ---------- Job-Ergebnisse (striktes Zod-Parsing im Runner) ----------

export const echoResultSchema = z.object({
  reply: z.string().min(1),
});
export type EchoResult = z.infer<typeof echoResultSchema>;

// ---------- Skill-Vertrag (CLAUDE.md „Job-Handler-Vertrag") ----------

export interface NewJob {
  jobType: string;
  priority?: number;
  payload: Record<string, Json>;
}

export interface SkillResult {
  result: Json;
  resultHash: string;
  followUpJobs?: NewJob[];
}
