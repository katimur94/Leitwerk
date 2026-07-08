// Connector-Skill sync_mail: Gmail-Sync ohne KI-Aufruf (MASTERPLAN §2.3).
// Initial-Sync (90 Tage, neueste zuerst, gedeckelt) und Delta-Sync über die
// History-API. Alle Schreibzugriffe laufen über die Edge Function mail-sync.
import {
  syncMailContextSchema,
  syncMailResultSchema,
  type SyncMailResult,
} from "@leitwerk/shared";
import { GmailApi, toIngestMessage } from "../connectors/gmail";
import { resultHash } from "../util/hash";
import { log } from "../util/log";
import type { Skill, SkillDeps } from "./types";

/** Obergrenzen pro Lauf — hält max_runtime_sec und das Abo-Budget ein. */
const MAX_MESSAGES_PER_RUN = 500;
const INGEST_BATCH_SIZE = 50;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

async function fetchMessageIds(
  api: GmailApi,
  cursor: string | null,
  initialDays: number,
): Promise<{ ids: string[]; nextCursor: string; mode: "initial" | "delta" }> {
  const profile = await api.profile();

  if (cursor) {
    try {
      const ids: string[] = [];
      let pageToken: string | undefined;
      let latestHistoryId = cursor;
      do {
        const page = await api.listHistory(cursor, pageToken);
        for (const entry of page.history ?? []) {
          for (const added of entry.messagesAdded ?? []) ids.push(added.message.id);
        }
        if (page.historyId) latestHistoryId = page.historyId;
        pageToken = page.nextPageToken;
      } while (pageToken && ids.length < MAX_MESSAGES_PER_RUN);
      return { ids: [...new Set(ids)], nextCursor: latestHistoryId, mode: "delta" };
    } catch (error) {
      // 404 = historyId abgelaufen (Gmail hält History nur begrenzt vor)
      if ((error as { status?: number }).status !== 404) throw error;
      log.warn("Gmail-History-Cursor abgelaufen — starte Initial-Sync neu");
    }
  }

  // Initial-Sync: neueste Nachrichten der letzten N Tage, gedeckelt.
  // Der Cursor (historyId von JETZT) stellt sicher, dass ab dem nächsten
  // Lauf lückenlos per Delta weitergeht.
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await api.listMessages(`newer_than:${initialDays}d`, pageToken);
    ids.push(...(page.messages ?? []).map((m) => m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < MAX_MESSAGES_PER_RUN);
  return {
    ids: ids.slice(0, MAX_MESSAGES_PER_RUN),
    nextCursor: profile.historyId,
    mode: "initial",
  };
}

export const syncMailSkill: Skill = {
  type: "sync_mail",
  schemaDescription:
    '{"threads": <int>, "messages": <int>, "attachments": <int>, "cursor": "<string|null>", "mode": "initial|delta"}',

  // Kein KI-Aufruf: execute() übernimmt (Ausnahme laut CLAUDE.md Job-Vertrag).
  buildPrompt() {
    return null;
  },

  parse(raw, _ctx) {
    const result = syncMailResultSchema.parse(JSON.parse(raw));
    return { result, resultHash: resultHash(result) };
  },

  async execute(ctx, deps: SkillDeps) {
    const { account } = syncMailContextSchema.parse(ctx);
    const { accessToken, emailAddress } = await deps.broker.mailToken(account.id);
    const api = new GmailApi(accessToken);

    const { ids, nextCursor, mode } = await fetchMessageIds(
      api,
      account.sync_cursor,
      account.initial_days,
    );
    log.info(
      `gmail-sync ${emailAddress}: ${ids.length} Nachricht(en), Modus ${mode}`,
    );

    let ingestedMessages = 0;
    let ingestedAttachments = 0;
    const threadIds = new Set<string>();

    for (let offset = 0; offset < ids.length; offset += INGEST_BATCH_SIZE) {
      const batchIds = ids.slice(offset, offset + INGEST_BATCH_SIZE);
      const batch = [];
      for (const id of batchIds) {
        const raw = await api.message(id);
        const parsed = toIngestMessage(raw, emailAddress);
        threadIds.add(parsed.provider_thread_id);

        // Anhangs-Blobs hochladen (Bucket 'attachments'), Metadaten ingesten
        const attachments = [];
        for (const attachment of parsed.attachments) {
          let storagePath: string | null = null;
          if (attachment.size_bytes <= MAX_ATTACHMENT_BYTES) {
            try {
              const bytes = await api.attachment(raw.id, attachment.attachmentId);
              storagePath = await deps.broker.mailAttachment(
                account.id,
                attachment.filename,
                attachment.mime_type,
                bytes,
              );
            } catch (error) {
              log.warn(
                `Anhang ${attachment.filename} übersprungen: ${String(error)}`,
              );
            }
          }
          attachments.push({
            filename: attachment.filename,
            mime_type: attachment.mime_type,
            size_bytes: attachment.size_bytes,
            storage_path: storagePath,
          });
        }
        batch.push({ ...parsed, attachments });
      }

      const isLastBatch = offset + INGEST_BATCH_SIZE >= ids.length;
      const { messages, attachments } = await deps.broker.mailIngest({
        accountId: account.id,
        messages: batch,
        // Cursor erst mit dem letzten Batch fortschreiben (Crash-sicher:
        // vorher abgebrochene Läufe wiederholen ab altem Cursor, Dedupe
        // übernimmt die unique-Constraint).
        cursor: isLastBatch ? nextCursor : account.sync_cursor,
        syncState: isLastBatch ? "ok" : "syncing",
      });
      ingestedMessages += messages;
      ingestedAttachments += attachments;
    }

    if (ids.length === 0) {
      // Auch ohne neue Nachrichten Cursor/Status fortschreiben
      await deps.broker.mailIngest({
        accountId: account.id,
        messages: [],
        cursor: nextCursor,
        syncState: "ok",
      });
    }

    const result: SyncMailResult = {
      threads: threadIds.size,
      messages: ingestedMessages,
      attachments: ingestedAttachments,
      cursor: nextCursor,
      mode,
    };
    return { result, resultHash: resultHash(result) };
  },
};
