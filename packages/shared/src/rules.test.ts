import { describe, expect, it } from "vitest";
import {
  getByPath,
  ruleActionSchema,
  ruleConditionMatches,
  ruleConditionsMatch,
  type RuleCondition,
} from "./rules";

const entity = {
  entity_type: "mail_message",
  entity_id: "9e0f9b1a-0000-4000-8000-000000000001",
  category: "invoice",
  urgency: 3,
  mail: { from: "buchhaltung@acme.de", subject: "Rechnung 2026-041" },
};

describe("getByPath", () => {
  it("löst Punktpfade auf", () => {
    expect(getByPath(entity, "category")).toBe("invoice");
    expect(getByPath(entity, "mail.from")).toBe("buchhaltung@acme.de");
    expect(getByPath(entity, "mail.missing")).toBeUndefined();
    expect(getByPath(entity, "nope.deep")).toBeUndefined();
  });
});

describe("ruleConditionMatches", () => {
  const cases: Array<[RuleCondition, boolean]> = [
    [{ field: "category", op: "eq", value: "invoice" }, true],
    [{ field: "category", op: "eq", value: "spam" }, false],
    [{ field: "category", op: "neq", value: "spam" }, true],
    [{ field: "mail.from", op: "contains", value: "ACME" }, true],
    [{ field: "mail.from", op: "contains", value: "gmail" }, false],
    [{ field: "urgency", op: "gt", value: 2 }, true],
    [{ field: "urgency", op: "gte", value: 3 }, true],
    [{ field: "urgency", op: "lt", value: 3 }, false],
    [{ field: "urgency", op: "lte", value: 3 }, true],
    [{ field: "category", op: "in", value: ["invoice", "dunning"] }, true],
    [{ field: "category", op: "in", value: ["spam"] }, false],
    [{ field: "mail.subject", op: "exists" }, true],
    [{ field: "mail.cc", op: "exists" }, false],
    [{ field: "mail.cc", op: "not_exists" }, true],
  ];

  it.each(cases)("%j → %s", (cond, expected) => {
    expect(ruleConditionMatches(entity, cond)).toBe(expected);
  });

  it("vergleicht bei gt/lt nur, wenn beide Werte vorhanden sind", () => {
    expect(ruleConditionMatches(entity, { field: "mail.cc", op: "gt", value: 1 })).toBe(false);
  });
});

describe("ruleConditionsMatch", () => {
  it("verknüpft alle Bedingungen mit UND", () => {
    expect(
      ruleConditionsMatch(entity, [
        { field: "category", op: "eq", value: "invoice" },
        { field: "urgency", op: "gte", value: 3 },
      ]),
    ).toBe(true);
    expect(
      ruleConditionsMatch(entity, [
        { field: "category", op: "eq", value: "invoice" },
        { field: "urgency", op: "gt", value: 3 },
      ]),
    ).toBe(false);
  });

  it("leere Bedingungsliste trifft immer zu", () => {
    expect(ruleConditionsMatch(entity, [])).toBe(true);
  });
});

describe("ruleActionSchema", () => {
  it("akzeptiert die drei Aktionstypen", () => {
    expect(
      ruleActionSchema.safeParse({ type: "create_job", job_type: "draft_reply", priority: 5 })
        .success,
    ).toBe(true);
    expect(ruleActionSchema.safeParse({ type: "notify", title: "Neue Rechnung" }).success).toBe(
      true,
    );
    expect(
      ruleActionSchema.safeParse({ type: "create_task", title: "Prüfen", due_in_days: 3 })
        .success,
    ).toBe(true);
  });

  it("lehnt unbekannte Typen und fehlende Pflichtfelder ab", () => {
    expect(ruleActionSchema.safeParse({ type: "delete_everything" }).success).toBe(false);
    expect(ruleActionSchema.safeParse({ type: "create_job" }).success).toBe(false);
    expect(ruleActionSchema.safeParse({ type: "notify" }).success).toBe(false);
  });
});
