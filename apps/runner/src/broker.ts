// HTTP-Client für die Edge Functions runner-broker und build-job-context.
// Der Runner spricht AUSSCHLIESSLICH mit diesen Functions — nie direkt mit
// der Datenbank (CLAUDE.md Regel 2).
import {
  agentJobSchema,
  brokerErrorSchema,
  claimResponseSchema,
  contextResponseSchema,
  pairResponseSchema,
  type AgentJob,
  type Json,
  type PairRequest,
  type PairResponse,
} from "@leitwerk/shared";

export interface BrokerAuth {
  runnerId: string;
  runnerToken: string;
}

export class BrokerClient {
  constructor(
    private readonly functionsUrl: string,
    private readonly auth?: BrokerAuth,
  ) {}

  private async post(
    fn: "runner-broker" | "build-job-context",
    path: string,
    body: unknown,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.auth) {
      headers["x-runner-id"] = this.auth.runnerId;
      headers["x-runner-token"] = this.auth.runnerToken;
    }
    const res = await fetch(`${this.functionsUrl}/${fn}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
    });
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const parsed = brokerErrorSchema.safeParse(data);
      throw new Error(
        parsed.success ? parsed.data.error : `Broker HTTP ${res.status}`,
      );
    }
    return data;
  }

  async pair(request: PairRequest): Promise<PairResponse> {
    return pairResponseSchema.parse(
      await this.post("runner-broker", "/pair", request),
    );
  }

  async claim(): Promise<AgentJob | null> {
    return claimResponseSchema.parse(
      await this.post("runner-broker", "/claim", {}),
    ).job;
  }

  async heartbeat(jobId?: string): Promise<void> {
    await this.post("runner-broker", "/heartbeat", jobId ? { jobId } : {});
  }

  async complete(jobId: string, result: Json, resultHash: string): Promise<void> {
    await this.post("runner-broker", "/complete", { jobId, result, resultHash });
  }

  async fail(jobId: string, error: string): Promise<void> {
    await this.post("runner-broker", "/fail", { jobId, error });
  }

  async buildContext(jobId: string): Promise<Record<string, unknown>> {
    return contextResponseSchema.parse(
      await this.post("build-job-context", "", { jobId }),
    ).context;
  }
}

export { agentJobSchema };
