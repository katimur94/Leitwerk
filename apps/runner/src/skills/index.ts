import { echoSkill } from "./echo";
import type { Skill } from "./types";

const registry = new Map<string, Skill>([[echoSkill.type, echoSkill]]);

export function getSkill(jobType: string): Skill | undefined {
  return registry.get(jobType);
}

export type { Skill } from "./types";
