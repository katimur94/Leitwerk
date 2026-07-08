// Regel-Engine light (Migration 017): Typen + clientseitige Auswertung.
// Die AUTORITATIVE Auswertung ist die Postgres-Funktion evaluate_org_rules;
// dieses Modul ist deren exakter JS-Spiegel — für den Regel-Builder
// (Vorschau/Validierung in der PWA) und den Mock-Server.
import { z } from "zod";

export const RULE_CONDITION_OPS = [
  "eq",
  "neq",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "exists",
  "not_exists",
] as const;
export type RuleConditionOp = (typeof RULE_CONDITION_OPS)[number];

export const ruleConditionSchema = z.object({
  /** Pfad in der Entity, Punktnotation — z. B. "category" oder "mail.from" */
  field: z.string().min(1),
  op: z.enum(RULE_CONDITION_OPS).default("eq"),
  value: z.unknown().optional(),
});
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

export const ruleActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_job"),
    job_type: z.string().min(1),
    priority: z.number().int().min(1).max(9).optional(),
    payload: z.record(z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("notify"),
    title: z.string().min(1),
    body: z.string().optional(),
    /** leer = alle aktiven Org-Mitglieder */
    user_id: z.string().uuid().optional(),
  }),
  z.object({
    type: z.literal("create_task"),
    title: z.string().min(1),
    description: z.string().optional(),
    assignee_id: z.string().uuid().optional(),
    due_in_days: z.number().int().positive().optional(),
  }),
]);
export type RuleAction = z.infer<typeof ruleActionSchema>;

export interface OrgRuleRow {
  id: string;
  org_id: string;
  name: string;
  is_enabled: boolean;
  trigger_event: string;
  conditions: RuleCondition[];
  action: RuleAction;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Wert per Punktpfad aus der Entity holen (wie jsonb #> in Postgres). */
export function getByPath(entity: unknown, path: string): unknown {
  let current: unknown = entity;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function jsonEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Eine Bedingung prüfen — Spiegel von rule_condition_matches (Migration 017). */
export function ruleConditionMatches(
  entity: Record<string, unknown>,
  cond: RuleCondition,
): boolean {
  const actual = getByPath(entity, cond.field);
  const value = cond.value;

  switch (cond.op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "not_exists":
      return actual === undefined || actual === null;
    case "eq":
      return jsonEq(actual, value);
    case "neq":
      return !jsonEq(actual, value);
    case "contains":
      return (
        actual != null &&
        value != null &&
        String(actual).toLowerCase().includes(String(value).toLowerCase())
      );
    case "in":
      return Array.isArray(value) && value.some((v) => jsonEq(actual, v));
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (actual == null || value == null) return false;
      // Zahlen numerisch, sonst Textvergleich (wie in SQL)
      const numeric = typeof actual === "number" && typeof value === "number";
      const a = numeric ? (actual as number) : String(actual);
      const b = numeric ? (value as number) : String(value);
      switch (cond.op) {
        case "gt":
          return a > b;
        case "gte":
          return a >= b;
        case "lt":
          return a < b;
        default:
          return a <= b;
      }
    }
    default:
      return false;
  }
}

/** Alle Bedingungen (UND-verknüpft) prüfen. Leere Liste = trifft immer zu. */
export function ruleConditionsMatch(
  entity: Record<string, unknown>,
  conditions: RuleCondition[],
): boolean {
  return conditions.every((cond) => ruleConditionMatches(entity, cond));
}
