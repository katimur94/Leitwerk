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

/** Poll-Intervall des Runners, wenn die Queue leer ist (ms). */
export const RUNNER_POLL_INTERVAL_MS = 5_000;
/** Heartbeat-Intervall während ein Job läuft (ms). */
export const RUNNER_HEARTBEAT_INTERVAL_MS = 30_000;
