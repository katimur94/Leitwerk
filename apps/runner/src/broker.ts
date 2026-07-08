// HTTP-Client für die Edge Functions runner-broker und build-job-context.
// Der Runner spricht AUSSCHLIESSLICH mit diesen Functions — nie direkt mit
// der Datenbank (CLAUDE.md Regel 2).
import {
  agentJobSchema,
  brokerErrorSchema,
  claimResponseSchema,
  contextResponseSchema,
  pairResponseSchema,
  runnerStatusResponseSchema,
  type AgentJob,
  type Json,
  type PairRequest,
  type PairResponse,
  type RunnerStatusResponse,
} from "@leitwerk/shared";

export interface BrokerAuth {
  runnerId: string;
  runnerToken: string;
}

/** Typisierter Broker-Fehler mit HTTP-Status und maschinenlesbarem Code. */
export class BrokerHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "BrokerHttpError";
  }
}

export class BrokerClient {
  constructor(
    private readonly functionsUrl: string,
    private readonly auth?: BrokerAuth,
  ) {}

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.auth) {
      headers["x-runner-id"] = this.auth.runnerId;
      headers["x-runner-token"] = this.auth.runnerToken;
    }
    return headers;
  }

  private async post(
    fn: "runner-broker" | "build-job-context" | "mail-sync",
    path: string,
    body: unknown,
  ): Promise<unknown> {
    const headers = this.authHeaders({ "Content-Type": "application/json" });
    const res = await fetch(`${this.functionsUrl}/${fn}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
    });
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const parsed = brokerErrorSchema.safeParse(data);
      const retryAfter = Number(res.headers.get("retry-after") ?? "") || undefined;
      throw new BrokerHttpError(
        parsed.success ? parsed.data.error : `Broker HTTP ${res.status}`,
        res.status,
        parsed.success ? parsed.data.code : undefined,
        retryAfter,
      );
    }
    return data;
  }

  async pair(request: PairRequest): Promise<PairResponse> {
    return pairResponseSchema.parse(
      await this.post("runner-broker", "/pair", request),
    );
  }

  /** Selbstauskunft — funktioniert auch, solange der Runner auf Freigabe wartet. */
  async status(): Promise<RunnerStatusResponse["status"]> {
    return runnerStatusResponseSchema.parse(
      await this.post("runner-broker", "/status", {}),
    ).status;
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

  // ---------- mail-sync (Etappe 1): Gmail-Connector-Endpunkte ----------

  /** Kurzlebiges Gmail-Access-Token — das Refresh-Token bleibt im Vault. */
  async mailToken(accountId: string): Promise<{ accessToken: string; emailAddress: string }> {
    const data = (await this.post("mail-sync", "/token", { accountId })) as {
      accessToken?: string;
      emailAddress?: string;
    };
    if (!data.accessToken || !data.emailAddress) {
      throw new Error("mail-sync /token lieferte kein Access-Token");
    }
    return { accessToken: data.accessToken, emailAddress: data.emailAddress };
  }

  /** Batch-Ingest synchronisierter Nachrichten (Dedupe serverseitig). */
  async mailIngest(payload: unknown): Promise<{ messages: number; attachments: number }> {
    const data = (await this.post("mail-sync", "/ingest", payload)) as {
      messages?: number;
      attachments?: number;
    };
    return { messages: data.messages ?? 0, attachments: data.attachments ?? 0 };
  }

  /** Anhangs-Blob in den Storage-Bucket 'attachments' hochladen. */
  async mailAttachment(
    accountId: string,
    filename: string,
    mime: string,
    bytes: Uint8Array,
  ): Promise<string> {
    const params = new URLSearchParams({ accountId, filename, mime });
    const res = await fetch(`${this.functionsUrl}/mail-sync/attachment?${params}`, {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/octet-stream" }),
      body: bytes,
    });
    const data = (await res.json().catch(() => ({}))) as {
      storagePath?: string;
      error?: string;
    };
    if (!res.ok || !data.storagePath) {
      throw new Error(data.error ?? `Anhang-Upload HTTP ${res.status}`);
    }
    return data.storagePath;
  }
}

export { agentJobSchema };
