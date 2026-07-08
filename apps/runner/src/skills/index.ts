import { caseMatchSkill } from "./case-match";
import { classifyEmailSkill } from "./classify-email";
import { draftDunningSkill } from "./draft-dunning";
import { draftReplySkill } from "./draft-reply";
import { echoSkill } from "./echo";
import { extractCommitmentsSkill } from "./extract-commitments";
import { extractInvoiceSkill } from "./extract-invoice";
import { followupCheckSkill } from "./followup-check";
import { gapScanSkill } from "./gap-scan";
import { morningBriefingSkill } from "./morning-briefing";
import { syncMailSkill } from "./sync-mail";
import { threadSummarySkill } from "./thread-summary";
import type { Skill } from "./types";

const registry = new Map<string, Skill>(
  [
    echoSkill,
    syncMailSkill,
    classifyEmailSkill,
    caseMatchSkill,
    draftReplySkill,
    threadSummarySkill,
    extractCommitmentsSkill,
    gapScanSkill,
    morningBriefingSkill,
    followupCheckSkill,
    extractInvoiceSkill,
    draftDunningSkill,
  ].map((skill) => [skill.type, skill]),
);

export function getSkill(jobType: string): Skill | undefined {
  return registry.get(jobType);
}

export type { Skill } from "./types";
