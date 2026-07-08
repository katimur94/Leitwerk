import { buildStyleProfileSkill } from "./build-style-profile";
import { caseMatchSkill } from "./case-match";
import { classifyEmailSkill } from "./classify-email";
import { draftDunningSkill } from "./draft-dunning";
import { draftReplySkill } from "./draft-reply";
import { echoSkill } from "./echo";
import { embedBacklogSkill } from "./embed-backlog";
import { extractCommitmentsSkill } from "./extract-commitments";
import { extractInvoiceSkill } from "./extract-invoice";
import { followupCheckSkill } from "./followup-check";
import { gapScanSkill } from "./gap-scan";
import { knowledgeDistillSkill } from "./knowledge-distill";
import { morningBriefingSkill } from "./morning-briefing";
import { semanticSearchSkill } from "./semantic-search";
import { summarizeMeetingSkill } from "./summarize-meeting";
import { syncMailSkill } from "./sync-mail";
import { threadSummarySkill } from "./thread-summary";
import { transcribeMeetingSkill } from "./transcribe-meeting";
import { transcribeNoteSkill } from "./transcribe-note";
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
    transcribeNoteSkill,
    transcribeMeetingSkill,
    summarizeMeetingSkill,
    knowledgeDistillSkill,
    buildStyleProfileSkill,
    embedBacklogSkill,
    semanticSearchSkill,
  ].map((skill) => [skill.type, skill]),
);

export function getSkill(jobType: string): Skill | undefined {
  return registry.get(jobType);
}

export type { Skill } from "./types";
