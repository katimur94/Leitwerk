// Google-Calendar-Sync (Etappe 5): reiner Connector-Job, kein KI-Aufruf.
// Initial: letzte/nächste 30 Tage; Delta über syncToken. Geschrieben wird
// AUSSCHLIESSLICH über die Edge Function calendar-sync /ingest (CLAUDE.md Regel 2).
import { syncCalendarContextSchema } from "@leitwerk/shared";
import { GcalApi, normalizeGcalEvent } from "../connectors/gcal";
import { resultHash } from "../util/hash";
import { log } from "../util/log";
import type { Skill, SkillDeps } from "./types";

export const syncCalendarSkill: Skill = {
  type: "sync_calendar",
  schemaDescription: '{"events": <int>, "cursor": "<syncToken|null>", "mode": "initial|delta"}',

  buildPrompt() {
    return null; // Connector: execute()
  },

  parse() {
    throw new Error("sync_calendar läuft über execute()");
  },

  async execute(ctx, deps: SkillDeps) {
    const parsed = syncCalendarContextSchema.parse(ctx);
    const { accessToken, calendarRef } = await deps.broker.calendarToken(parsed.account.id);
    const api = new GcalApi(accessToken, calendarRef);

    const events = [];
    let cursor = parsed.account.sync_cursor;
    let mode: "initial" | "delta" = cursor ? "delta" : "initial";
    let pageToken: string | undefined;
    const timeMin = new Date(Date.now() - parsed.account.initial_days * 86_400_000).toISOString();

    try {
      do {
        const page = await api.listEvents({ syncToken: cursor ?? undefined, timeMin, pageToken });
        for (const raw of page.items ?? []) {
          const normalized = normalizeGcalEvent(raw);
          if (normalized) events.push(normalized);
        }
        pageToken = page.nextPageToken;
        if (page.nextSyncToken) cursor = page.nextSyncToken;
      } while (pageToken);
    } catch (error) {
      // Abgelaufener syncToken (410) → Voll-Sync beim nächsten Lauf
      if ((error as { status?: number }).status === 410) {
        log.warn("sync_calendar: syncToken abgelaufen — Voll-Sync nötig");
        cursor = null;
        mode = "initial";
      } else {
        throw error;
      }
    }

    const { events: ingested } = await deps.broker.calendarIngest({
      accountId: parsed.account.id,
      events,
      cursor,
      syncState: "ok",
    });
    log.info(`sync_calendar: ${ingested} Events (${mode})`);
    const result = { events: ingested, cursor, mode };
    return { result, resultHash: resultHash({ ...result, job: parsed.jobId }) };
  },
};
