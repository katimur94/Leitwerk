import { z } from "zod";
import { agentJobSchema } from "./jobs";

/** Endpunkte der Edge Function runner-broker. */
export const BROKER_ACTIONS = [
  "pair",
  "claim",
  "heartbeat",
  "complete",
  "fail",
] as const;
export type BrokerAction = (typeof BROKER_ACTIONS)[number];

export const pairRequestSchema = z.object({
  code: z.string().min(6).max(16),
  name: z.string().optional(),
  provider: z.enum(["claude_cli", "codex_cli", "anthropic_api"]).optional(),
  version: z.string().optional(),
});
export type PairRequest = z.infer<typeof pairRequestSchema>;

export const pairResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({
    status: z.literal("paired"),
    runnerId: z.string().uuid(),
    runnerToken: z.string().min(20),
    orgId: z.string().uuid(),
  }),
]);
export type PairResponse = z.infer<typeof pairResponseSchema>;

export const claimResponseSchema = z.object({
  job: agentJobSchema.nullable(),
});
export type ClaimResponse = z.infer<typeof claimResponseSchema>;

export const okResponseSchema = z.object({ ok: z.literal(true) });

export const contextResponseSchema = z.object({
  context: z.record(z.unknown()),
});
export type ContextResponse = z.infer<typeof contextResponseSchema>;

export const brokerErrorSchema = z.object({ error: z.string() });
