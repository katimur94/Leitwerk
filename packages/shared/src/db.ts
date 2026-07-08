// ============================================================
// PLATZHALTER — nach dem ersten `supabase start` durch generierte
// Typen ersetzen:  pnpm gen:types
// (supabase gen types typescript --local > packages/shared/src/db.ts)
// Bis dahin: handgepflegte Zeilen-Typen für die in P0 genutzten Tabellen.
// Quelle der Wahrheit ist IMMER /migrations.
// ============================================================

export type OrgRole = "owner" | "admin" | "member" | "viewer";
export type AiProviderKind = "claude_cli" | "codex_cli" | "anthropic_api";
export type RunnerStatus =
  | "pending_approval"
  | "online"
  | "offline"
  | "disabled";

/** Nachtfenster für Batch-Jobs (runners.quiet_hours, Migration 017). */
export interface QuietHours {
  /** "HH:MM" */
  start: string;
  /** "HH:MM" — darf vor start liegen (Fenster über Mitternacht) */
  end: string;
  /** IANA-Zeitzone; Default = Org-Zeitzone */
  timezone?: string;
}

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
  quiet_hours: QuietHours | null;
  approved_by: string | null;
  approved_at: string | null;
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
  failed_attempts: number;
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

// ---------- Etappe 1: Mail-Hub + Vorgangsakte ----------

export interface MailAddressJson {
  name?: string;
  email: string;
}

export interface MailAccountRow {
  id: string;
  org_id: string;
  user_id: string;
  provider: "gmail" | "imap";
  email_address: string;
  display_name: string | null;
  is_shared: boolean;
  sync_state: "pending" | "syncing" | "ok" | "error" | "revoked";
  sync_cursor: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  signature_html: string | null;
  created_at: string;
}

export interface MailThreadRow {
  id: string;
  org_id: string;
  account_id: string;
  provider_thread_id: string;
  subject: string | null;
  snippet: string | null;
  participants: MailAddressJson[];
  message_count: number;
  last_message_at: string | null;
  is_unread: boolean;
  labels: string[];
  category: string | null;
  urgency: number | null;
  ai_summary: string | null;
  case_id: string | null;
  assignee_id: string | null;
  snoozed_until: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface MailMessageRow {
  id: string;
  org_id: string;
  thread_id: string;
  account_id: string;
  provider_msg_id: string;
  direction: "inbound" | "outbound";
  from_addr: MailAddressJson;
  to_addrs: MailAddressJson[];
  cc_addrs: MailAddressJson[];
  sent_at: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  has_attachments: boolean;
  is_read: boolean;
  created_at: string;
}

export interface MailAttachmentRow {
  id: string;
  org_id: string;
  message_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  ai_kind: string | null;
}

export interface MailDraftRow {
  id: string;
  org_id: string;
  account_id: string;
  thread_id: string | null;
  created_by: string | null;
  source: "user" | "ai" | "automation";
  job_id: string | null;
  to_addrs: MailAddressJson[];
  cc_addrs: MailAddressJson[];
  subject: string | null;
  body_html: string | null;
  status: "draft" | "approved" | "scheduled" | "holding" | "sent" | "discarded";
  send_after: string | null;
  sent_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseRow {
  id: string;
  org_id: string;
  case_number: string;
  title: string;
  status: "open" | "waiting" | "done" | "archived";
  company_id: string | null;
  contact_id: string | null;
  owner_id: string | null;
  tags: string[];
  reference: string | null;
  ai_summary: string | null;
  ai_summary_at: string | null;
  expected_value: number | null;
  last_activity_at: string;
  waiting_until: string | null;
  created_by: string | null;
  source: "manual" | "ai_auto";
  created_at: string;
}

export interface CaseEventRow {
  id: number;
  org_id: string;
  case_id: string;
  event_type: string;
  title: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_type: "user" | "runner" | "system";
  actor_id: string | null;
  occurred_at: string;
  detail: Record<string, unknown>;
}

export interface ContactRow {
  id: string;
  org_id: string;
  company_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  role_title: string | null;
  source: "manual" | "mail_auto" | "import";
  confidence: number | null;
  created_at: string;
}

export interface AutomationRunRow {
  id: string;
  org_id: string;
  automation_id: string;
  job_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  action: string;
  autonomy_level: number;
  confidence: number | null;
  status:
    | "proposed"
    | "approved"
    | "holding"
    | "executed"
    | "stopped"
    | "rejected"
    | "failed";
  hold_until: string | null;
  outcome: "correct" | "corrected" | "wrong" | null;
  detail: Record<string, unknown>;
  executed_at: string | null;
  created_at: string;
}
