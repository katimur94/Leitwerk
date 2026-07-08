import { accountAssignSkill } from "./account-assign";
import { buildStyleProfileSkill } from "./build-style-profile";
import { calendarBriefingSkill } from "./calendar-briefing";
import { caseMatchSkill } from "./case-match";
import { classifyEmailSkill } from "./classify-email";
import { contractWatchSkill } from "./contract-watch";
import { extractContractSkill } from "./extract-contract";
import { paymentMatchSkill } from "./payment-match";
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
import { suggestSlotsSkill } from "./suggest-slots";
import { summarizeCallSkill } from "./summarize-call";
import { summarizeMeetingSkill } from "./summarize-meeting";
import { syncCalendarSkill } from "./sync-calendar";
import { syncMailSkill } from "./sync-mail";
import { threadSummarySkill } from "./thread-summary";
import { timeSuggestSkill } from "./time-suggest";
import { transcribeCallSkill } from "./transcribe-call";
import { weeklyReportSkill } from "./weekly-report";
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
    syncCalendarSkill,
    calendarBriefingSkill,
    suggestSlotsSkill,
    weeklyReportSkill,
    timeSuggestSkill,
    paymentMatchSkill,
    accountAssignSkill,
    transcribeCallSkill,
    summarizeCallSkill,
    extractContractSkill,
    contractWatchSkill,
  ].map((skill) => [skill.type, skill]),
);

export function getSkill(jobType: string): Skill | undefined {
  return registry.get(jobType);
}

export type { Skill } from "./types";
