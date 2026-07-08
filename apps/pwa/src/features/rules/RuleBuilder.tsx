import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import {
  ORG_RULE_EVENTS,
  RULE_CONDITION_OPS,
  ruleActionSchema,
  type RuleAction,
  type RuleCondition,
  type RuleConditionOp,
} from "@leitwerk/shared";
import { Button, Card, Field, Input } from "@leitwerk/ui";
import { t } from "../../i18n/de";
import { useCreateRule } from "./queries";

const selectClass =
  "h-9 rounded-[var(--lw-radius-md)] border border-lw-border bg-lw-surface px-3 " +
  "text-[14px] text-lw-ink transition-colors duration-150 " +
  "focus:border-transparent focus:outline-none focus:ring-2 focus:ring-lw-accent";

interface ConditionDraft {
  field: string;
  op: RuleConditionOp;
  value: string;
}

type ActionType = "create_job" | "notify" | "create_task";

/** "3" → 3, "true" → true, sonst String; für op=in: Komma-Liste. */
function parseConditionValue(raw: string, op: RuleConditionOp): unknown {
  if (op === "exists" || op === "not_exists") return undefined;
  const parseOne = (s: string): unknown => {
    const trimmed = s.trim();
    if (trimmed === "") return "";
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (["number", "boolean"].includes(typeof parsed)) return parsed;
    } catch {
      /* Klartext */
    }
    return trimmed;
  };
  if (op === "in") return raw.split(",").map(parseOne);
  return parseOne(raw);
}

/** Einfacher Regel-Builder: Wenn <Ereignis> und <Bedingungen> dann <Aktion>. */
export function RuleBuilder() {
  const createRule = useCreateRule();
  const [name, setName] = useState("");
  const [event, setEvent] = useState<string>(ORG_RULE_EVENTS[0]);
  const [conditions, setConditions] = useState<ConditionDraft[]>([]);
  const [actionType, setActionType] = useState<ActionType>("notify");
  const [jobType, setJobType] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueInDays, setDueInDays] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function updateCondition(index: number, patch: Partial<ConditionDraft>) {
    setConditions((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );
  }

  function buildAction(): RuleAction | null {
    const raw: Record<string, unknown> = { type: actionType };
    if (actionType === "create_job") {
      raw.job_type = jobType.trim();
    } else {
      raw.title = title.trim();
      if (actionType === "notify" && body.trim()) raw.body = body.trim();
      if (actionType === "create_task" && dueInDays.trim()) {
        raw.due_in_days = Number(dueInDays);
      }
    }
    const parsed = ruleActionSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setValidationError(t("rules.builder.nameRequired"));
      return;
    }
    const action = buildAction();
    if (!action) {
      setValidationError(t("rules.builder.actionInvalid"));
      return;
    }
    const parsedConditions: RuleCondition[] = [];
    for (const c of conditions) {
      if (!c.field.trim()) {
        setValidationError(t("rules.builder.conditionFieldRequired"));
        return;
      }
      parsedConditions.push({
        field: c.field.trim(),
        op: c.op,
        value: parseConditionValue(c.value, c.op),
      });
    }
    setValidationError(null);
    createRule.mutate(
      { name: name.trim(), trigger_event: event, conditions: parsedConditions, action },
      {
        onSuccess: () => {
          setName("");
          setConditions([]);
          setJobType("");
          setTitle("");
          setBody("");
          setDueInDays("");
        },
      },
    );
  }

  const valueDisabled = (op: RuleConditionOp) => op === "exists" || op === "not_exists";

  return (
    <Card className="p-6">
      <h3 className="text-[16px] font-semibold text-lw-ink">
        {t("rules.builder.title")}
      </h3>
      <p className="mt-1 text-[13px] text-lw-ink-soft">{t("rules.builder.hint")}</p>

      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <Field label={t("rules.builder.name")} htmlFor="rule-name">
          <Input
            id="rule-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("rules.builder.namePlaceholder")}
          />
        </Field>

        {/* Wenn <Ereignis> */}
        <Field label={t("rules.builder.when")} htmlFor="rule-event">
          <select
            id="rule-event"
            className={`${selectClass} w-full`}
            value={event}
            onChange={(e) => setEvent(e.target.value)}
          >
            {ORG_RULE_EVENTS.map((ev) => (
              <option key={ev} value={ev}>
                {t(`rules.event.${ev}`)}
              </option>
            ))}
          </select>
        </Field>

        {/* und <Bedingungen> */}
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-lw-ink">
            {t("rules.builder.conditions")}
          </p>
          {conditions.length === 0 ? (
            <p className="text-[12px] text-lw-ink-faint">
              {t("rules.builder.noConditions")}
            </p>
          ) : null}
          {conditions.map((cond, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                className="flex-1"
                value={cond.field}
                placeholder={t("rules.builder.fieldPlaceholder")}
                onChange={(e) => updateCondition(index, { field: e.target.value })}
              />
              <select
                className={`${selectClass} w-40 flex-none`}
                value={cond.op}
                onChange={(e) =>
                  updateCondition(index, { op: e.target.value as RuleConditionOp })
                }
              >
                {RULE_CONDITION_OPS.map((op) => (
                  <option key={op} value={op}>
                    {t(`rules.op.${op}`)}
                  </option>
                ))}
              </select>
              <Input
                className="flex-1"
                value={cond.value}
                disabled={valueDisabled(cond.op)}
                placeholder={
                  cond.op === "in"
                    ? t("rules.builder.valueListPlaceholder")
                    : t("rules.builder.valuePlaceholder")
                }
                onChange={(e) => updateCondition(index, { value: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("rules.builder.removeCondition")}
                onClick={() =>
                  setConditions((prev) => prev.filter((_, i) => i !== index))
                }
              >
                <X size={14} />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setConditions((prev) => [...prev, { field: "", op: "eq", value: "" }])
              }
            >
              <Plus size={14} /> {t("rules.builder.addCondition")}
            </Button>
          </div>
        </div>

        {/* dann <Aktion> */}
        <Field label={t("rules.builder.then")} htmlFor="rule-action-type">
          <select
            id="rule-action-type"
            className={`${selectClass} w-full`}
            value={actionType}
            onChange={(e) => setActionType(e.target.value as ActionType)}
          >
            <option value="notify">{t("rules.action.notify")}</option>
            <option value="create_task">{t("rules.action.create_task")}</option>
            <option value="create_job">{t("rules.action.create_job")}</option>
          </select>
        </Field>

        {actionType === "create_job" ? (
          <Field
            label={t("rules.builder.jobType")}
            hint={t("rules.builder.jobTypeHint")}
          >
            <Input
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
              placeholder="z. B. draft_reply"
            />
          </Field>
        ) : (
          <>
            <Field label={t("rules.builder.actionTitle")} htmlFor="rule-action-title">
              <Input
                id="rule-action-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            {actionType === "notify" ? (
              <Field label={t("rules.builder.actionBody")}>
                <Input value={body} onChange={(e) => setBody(e.target.value)} />
              </Field>
            ) : (
              <Field
                label={t("rules.builder.dueInDays")}
                hint={t("rules.builder.dueInDaysHint")}
              >
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={dueInDays}
                  onChange={(e) => setDueInDays(e.target.value)}
                />
              </Field>
            )}
          </>
        )}

        {validationError ? (
          <p className="text-[12px] text-lw-danger">{validationError}</p>
        ) : createRule.isError ? (
          <p className="text-[12px] text-lw-danger">
            {t("common.error")} ({createRule.error.message})
          </p>
        ) : null}

        <div>
          <Button type="submit" disabled={createRule.isPending}>
            {createRule.isPending ? t("common.loading") : t("rules.builder.submit")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
