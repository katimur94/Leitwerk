import { caseMatchSkill } from "./case-match";
import { classifyEmailSkill } from "./classify-email";
import { draftReplySkill } from "./draft-reply";
import { echoSkill } from "./echo";
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
  ].map((skill) => [skill.type, skill]),
);

export function getSkill(jobType: string): Skill | undefined {
  return registry.get(jobType);
}

export type { Skill } from "./types";
