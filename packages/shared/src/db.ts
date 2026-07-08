// ============================================================
// PLATZHALTER — nach dem ersten `supabase start` durch generierte
// Typen ersetzen:  pnpm gen:types
// (supabase gen types typescript --local > packages/shared/src/db.ts)
// Bis dahin: handgepflegte Zeilen-Typen für die in P0 genutzten Tabellen.
// Quelle der Wahrheit ist IMMER /migrations.
// ============================================================

export type OrgRole = "owner" | "admin" | "member" | "viewer";
export type AiProviderKind = "claude_cli" | "codex_cli" | "anthropic_api";
export type RunnerStatus = "online" | "offline" | "disabled";

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  locale: string;
  timezone: string;
  created_by: string;
  created_at: string;
}

export interface ProfileRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  locale: string;
  timezone: string;
  active_org_id: string | null;
  prefs: Record<string, unknown>;
}

export interface OrgMemberRow {
  org_id: string;
  user_id: string;
  role: OrgRole;
  is_active: boolean;
}

export interface OrgProfileOnboarding {
  company_done: boolean;
  mail_connected: boolean;
  runner_paired: boolean;
  number_ranges_done: boolean;
  first_case_created: boolean;
}

export interface OrgProfileRow {
  org_id: string;
  legal_name: string;
  legal_form: string | null;
  owner_name: string | null;
  vat_id: string | null;
  tax_number: string | null;
  is_small_business: boolean;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  bank_name: string | null;
  iban: string | null;
  bic: string | null;
  default_payment_terms_days: number;
  default_vat_rate: number;
  onboarding: OrgProfileOnboarding;
}

export interface RunnerRow {
  id: string;
  org_id: string;
  user_id: string;
  name: string;
  provider: AiProviderKind;
  status: RunnerStatus;
  last_heartbeat: string | null;
  version: string | null;
  max_jobs_per_hour: number;
  daily_job_limit: number;
  created_at: string;
}

export interface RunnerPairingCodeRow {
  id: string;
  user_id: string;
  org_id: string;
  code: string;
  expires_at: string;
  claimed_at: string | null;
  runner_id: string | null;
}

export interface AgentJobRow {
  id: string;
  org_id: string;
  created_by: string | null;
  job_type: string;
  priority: number;
  payload: Record<string, unknown>;
  status:
    | "queued"
    | "claimed"
    | "running"
    | "done"
    | "failed"
    | "cancelled"
    | "expired";
  claimed_by: string | null;
  attempts: number;
  max_attempts: number;
  result: unknown;
  result_hash: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface NumberRangeRow {
  id: string;
  org_id: string;
  kind: string;
  prefix: string;
  next_value: number;
  padding: number;
}
