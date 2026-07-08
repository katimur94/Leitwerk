/** Job-Prioritäten: 1 = interaktiv (Nutzer wartet) … 9 = Nacht-Batch. */
export const JOB_PRIORITY = {
  interactive: 1,
  high: 2,
  normal: 5,
  sync: 6,
  briefing: 6,
  followup: 7,
  night: 8,
  batch: 9,
} as const;

/** Interaktive Jobs (priority <= 2) unterbrechen die Batch-Verarbeitung im Runner. */
export const INTERACTIVE_PRIORITY_THRESHOLD = 2;

/** Autonomie-Stufen (MASTERPLAN §4 J). */
export const AUTONOMY_LEVELS = {
  1: "KI schlägt vor, Mensch klickt",
  2: "KI bereitet vor, Mensch gibt frei",
  3: "KI führt aus, Mensch kann stoppen (Halte-Zone)",
  4: "KI führt aus, meldet nur Ausnahmen",
} as const;

/** Alphabet ohne verwechselbare Zeichen (0/O, 1/I/L). */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PAIRING_CODE_LENGTH = 8;

/** Rate-Limit auf /pair: max. Versuche pro IP pro Minute (Migration 017). */
export const MAX_PAIRING_ATTEMPTS_PER_MINUTE = 10;
/** Nach so vielen Fehlversuchen ist ein Pairing-Code dauerhaft ungültig. */
export const MAX_PAIRING_CODE_FAILURES = 5;
/**
 * Poll-Intervall beim Pairing (ms) — bewusst > 6 s, damit ein einzelner
 * Runner das IP-Rate-Limit von 10/Minute nie selbst auslöst.
 */
export const RUNNER_PAIR_POLL_INTERVAL_MS = 7_000;

/** Poll-Intervall des Runners, wenn die Queue leer ist (ms). */
export const RUNNER_POLL_INTERVAL_MS = 5_000;
/** Heartbeat-Intervall während ein Job läuft (ms). */
export const RUNNER_HEARTBEAT_INTERVAL_MS = 30_000;
/** Wartezeit zwischen Claim-Versuchen, solange der Runner auf Freigabe wartet (ms). */
export const RUNNER_PENDING_APPROVAL_POLL_MS = 10_000;

/**
 * Ereignisse der Regel-Engine (org_rules.trigger_event).
 * P1–P6 schleusen jedes dieser Ereignisse durch evaluate_org_rules.
 */
export const ORG_RULE_EVENTS = [
  "mail_received",
  "mail_sent",
  "case_created",
  "task_created",
  "invoice_captured",
  "invoice_paid",
  "quote_sent",
  "quote_accepted",
  "payment_matched",
  "finding_created",
] as const;
export type OrgRuleEvent = (typeof ORG_RULE_EVENTS)[number];
