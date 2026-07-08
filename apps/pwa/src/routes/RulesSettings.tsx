import { ListChecks, Trash2 } from "lucide-react";
import type { OrgRuleRow } from "@leitwerk/shared";
import { Badge, Button, Card, EmptyState, SkeletonRows } from "@leitwerk/ui";
import { RuleBuilder } from "../features/rules/RuleBuilder";
import { useDeleteRule, useOrgRules, useToggleRule } from "../features/rules/queries";
import { t } from "../i18n/de";

function describeConditions(rule: OrgRuleRow): string {
  if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) {
    return t("rules.list.always");
  }
  return rule.conditions
    .map((c) => {
      const op = t(`rules.op.${c.op}`);
      const value =
        c.op === "exists" || c.op === "not_exists"
          ? ""
          : ` ${Array.isArray(c.value) ? c.value.join(", ") : String(c.value ?? "")}`;
      return `${c.field} ${op}${value}`;
    })
    .join(" und ");
}

function describeAction(rule: OrgRuleRow): string {
  const action = rule.action;
  switch (action?.type) {
    case "create_job":
      return `${t("rules.action.create_job")}: ${action.job_type}`;
    case "notify":
      return `${t("rules.action.notify")}: „${action.title}“`;
    case "create_task":
      return `${t("rules.action.create_task")}: „${action.title}“`;
    default:
      return "—";
  }
}

function RuleItem({ rule }: { rule: OrgRuleRow }) {
  const toggle = useToggleRule();
  const remove = useDeleteRule();

  return (
    <li className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14px] font-medium text-lw-ink">{rule.name}</p>
          <Badge tone={rule.is_enabled ? "success" : "neutral"}>
            {rule.is_enabled ? t("rules.list.enabled") : t("rules.list.disabled")}
          </Badge>
        </div>
        <p className="mt-0.5 text-[13px] text-lw-ink-soft">
          {t("rules.builder.when")} {t(`rules.event.${rule.trigger_event}`)}
          {" · "}
          {describeConditions(rule)}
        </p>
        <p className="text-[13px] text-lw-ink-soft">
          {t("rules.builder.then")} {describeAction(rule)}
        </p>
        {toggle.isError || remove.isError ? (
          <p className="mt-1 text-[12px] text-lw-danger">
            {t("common.error")} ({toggle.error?.message ?? remove.error?.message})
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate({ id: rule.id, is_enabled: !rule.is_enabled })}
        >
          {rule.is_enabled ? t("rules.list.disable") : t("rules.list.enable")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t("rules.list.delete")}
          disabled={remove.isPending}
          onClick={() => remove.mutate(rule.id)}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </li>
  );
}

export function RulesSettings() {
  const rules = useOrgRules();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-[24px] font-semibold text-lw-ink">{t("rules.title")}</h1>
        <p className="mt-1 text-[14px] text-lw-ink-soft">{t("rules.subtitle")}</p>
      </header>

      <Card className="p-6">
        <h3 className="text-[16px] font-semibold text-lw-ink">
          {t("rules.list.title")}
        </h3>
        <div className="mt-4">
          {rules.isPending ? (
            <SkeletonRows rows={3} />
          ) : rules.isError ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-[13px] text-lw-danger">
                {t("common.error")} ({rules.error.message})
              </p>
              <Button variant="secondary" size="sm" onClick={() => rules.refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          ) : rules.data.length === 0 ? (
            <EmptyState
              icon={<ListChecks />}
              title={t("rules.list.empty.title")}
              description={t("rules.list.empty.description")}
              className="py-8"
            />
          ) : (
            <ul className="divide-y divide-lw-border">
              {rules.data.map((rule) => (
                <RuleItem key={rule.id} rule={rule} />
              ))}
            </ul>
          )}
        </div>
      </Card>

      <RuleBuilder />
    </div>
  );
}
