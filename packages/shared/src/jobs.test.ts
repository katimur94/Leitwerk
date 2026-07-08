import { describe, expect, it } from "vitest";
import {
  agentJobSchema,
  echoContextSchema,
  echoResultSchema,
} from "./jobs";
import { pairResponseSchema } from "./broker";

describe("agentJobSchema", () => {
  it("akzeptiert eine Broker-Job-Zeile", () => {
    const job = agentJobSchema.parse({
      id: "6f1f30fe-6a4f-4a3c-9b1a-2f4f0d9d1a11",
      org_id: "6f1f30fe-6a4f-4a3c-9b1a-2f4f0d9d1a12",
      job_type: "echo",
      priority: 2,
      payload: { text: "Hallo" },
      context_hint: {},
      status: "claimed",
      claimed_by: "6f1f30fe-6a4f-4a3c-9b1a-2f4f0d9d1a13",
      max_runtime_sec: 300,
      attempts: 1,
      max_attempts: 3,
      created_at: "2026-07-08T10:00:00Z",
      run_after: "2026-07-08T10:00:00Z",
    });
    expect(job.job_type).toBe("echo");
  });

  it("lehnt unbekannten Status ab", () => {
    expect(() =>
      agentJobSchema.parse({ id: "x", status: "kaputt" }),
    ).toThrow();
  });
});

describe("echo-Schemas", () => {
  it("validiert Kontext und Ergebnis", () => {
    const ctx = echoContextSchema.parse({
      jobId: "6f1f30fe-6a4f-4a3c-9b1a-2f4f0d9d1a11",
      jobType: "echo",
      locale: "de-DE",
      input: { text: "Sag Hallo" },
    });
    expect(ctx.input.text).toBe("Sag Hallo");

    expect(echoResultSchema.parse({ reply: "Hallo!" }).reply).toBe("Hallo!");
    expect(() => echoResultSchema.parse({ reply: "" })).toThrow();
    expect(() => echoResultSchema.parse({ answer: "Hallo" })).toThrow();
  });
});

describe("pairResponseSchema", () => {
  it("unterscheidet pending und paired", () => {
    expect(pairResponseSchema.parse({ status: "pending" }).status).toBe(
      "pending",
    );
    const paired = pairResponseSchema.parse({
      status: "paired",
      runnerId: "6f1f30fe-6a4f-4a3c-9b1a-2f4f0d9d1a11",
      runnerToken: "lwr_0123456789abcdef0123456789abcdef",
      orgId: "6f1f30fe-6a4f-4a3c-9b1a-2f4f0d9d1a12",
    });
    expect(paired.status).toBe("paired");
  });
});
