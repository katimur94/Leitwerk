import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  JOB_PRIORITY,
  type AutomationRunRow,
  type MailAccountRow,
  type MailAddressJson,
  type MailDraftRow,
  type MailMessageRow,
  type MailThreadRow,
} from "@leitwerk/shared";
import { env } from "../../lib/env";
import { supabase } from "../../lib/supabase";
import { useSessionStore } from "../../stores/session";

export type InboxFilter = "inbox" | "archived" | "all";

// ---------- Konten ----------

export function useMailAccounts() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["mail_accounts", orgId],
    enabled: !!orgId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mail_accounts")
        .select("*")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as MailAccountRow[];
    },
  });
}

/** Gmail-OAuth starten: Edge Function liefert die Google-URL, Browser folgt ihr. */
export function useConnectGmail() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error("Keine aktive Organisation");
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Nicht angemeldet");
      const res = await fetch(`${env.supabaseUrl}/functions/v1/oauth-gmail/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: env.supabaseAnonKey,
        },
        body: JSON.stringify({ orgId }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? `HTTP ${res.status}`);
      window.location.href = data.url;
    },
  });
}

// ---------- Threads ----------

export function useMailThreads(filter: InboxFilter, search: string) {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["mail_threads", orgId, filter, search],
    enabled: !!orgId,
    refetchInterval: 20_000, // Fallback — primär Realtime
    queryFn: async () => {
      if (search.trim()) {
        // Volltextsuche über mail_messages.search_tsv (german), dann Threads laden
        const { data: hits, error: searchError } = await supabase
          .from("mail_messages")
          .select("thread_id")
          .eq("org_id", orgId!)
          .textSearch("search_tsv", search.trim(), { type: "websearch", config: "german" })
          .limit(50);
        if (searchError) throw new Error(searchError.message);
        const ids = [...new Set((hits ?? []).map((h) => h.thread_id))];
        if (ids.length === 0) return [];
        const { data, error } = await supabase
          .from("mail_threads")
          .select("*")
          .in("id", ids)
          .is("deleted_at", null)
          .order("last_message_at", { ascending: false });
        if (error) throw new Error(error.message);
        return (data ?? []) as MailThreadRow[];
      }

      let query = supabase
        .from("mail_threads")
        .select("*")
        .eq("org_id", orgId!)
        .is("deleted_at", null)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(100);
      if (filter === "inbox") query = query.is("archived_at", null);
      if (filter === "archived") query = query.not("archived_at", "is", null);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as MailThreadRow[];
    },
  });
}

export function useMailThread(threadId: string | undefined) {
  return useQuery({
    queryKey: ["mail_thread", threadId],
    enabled: !!threadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mail_threads")
        .select("*")
        .eq("id", threadId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Thread nicht gefunden");
      return data as MailThreadRow;
    },
  });
}

export function useThreadMessages(threadId: string | undefined) {
  return useQuery({
    queryKey: ["mail_messages", threadId],
    enabled: !!threadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mail_messages")
        .select("*")
        .eq("thread_id", threadId!)
        .order("sent_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as MailMessageRow[];
    },
  });
}

export function useThreadMutations() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["mail_threads", orgId] });
    void queryClient.invalidateQueries({ queryKey: ["mail_thread"] });
  };

  const setUnread = useMutation({
    mutationFn: async ({ threadId, unread }: { threadId: string; unread: boolean }) => {
      const { error } = await supabase
        .from("mail_threads")
        .update({ is_unread: unread })
        .eq("id", threadId);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const setArchived = useMutation({
    mutationFn: async ({ threadId, archived }: { threadId: string; archived: boolean }) => {
      const { error } = await supabase
        .from("mail_threads")
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq("id", threadId);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  return { setUnread, setArchived, invalidate };
}

/**
 * Kategorie-Korrektur durch den Nutzer: Thread updaten UND das Feedback
 * in die Trefferquote zurückspielen (CLAUDE.md Regel 5).
 */
export function useCorrectCategory() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId, category }: { threadId: string; category: string }) => {
      const { error } = await supabase
        .from("mail_threads")
        .update({ category })
        .eq("id", threadId);
      if (error) throw new Error(error.message);

      const run = await latestRunForEntity(orgId!, "mail_thread", threadId, "auto_label_mail");
      if (run) {
        await supabase.rpc("record_automation_outcome", {
          p_run_id: run.id,
          p_outcome: "corrected",
        });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mail_threads", orgId] });
      void queryClient.invalidateQueries({ queryKey: ["mail_thread"] });
    },
  });
}

async function latestRunForEntity(
  orgId: string,
  entityType: string,
  entityId: string,
  automationKey: string,
): Promise<AutomationRunRow | null> {
  const { data } = await supabase
    .from("automation_runs")
    .select("*, automations!inner(key)")
    .eq("org_id", orgId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("automations.key", automationKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as AutomationRunRow | null) ?? null;
}

// ---------- Vorgangs-Vorschläge (case_match, status='proposed') ----------

export interface CaseProposal extends AutomationRunRow {
  detail: {
    decision?: "existing" | "new" | "none";
    case_id?: string;
    title?: string;
    confidence?: number;
    reason?: string;
  };
}

export function useCaseProposal(threadId: string | undefined) {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["case_proposal", threadId],
    enabled: !!threadId && !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_runs")
        .select("*, automations!inner(key)")
        .eq("org_id", orgId!)
        .eq("entity_type", "mail_thread")
        .eq("entity_id", threadId!)
        .eq("status", "proposed")
        .eq("automations.key", "auto_case_match")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as CaseProposal | null) ?? null;
    },
  });
}

export function useResolveCaseProposal() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      proposal,
      threadId,
      accept,
    }: {
      proposal: CaseProposal;
      threadId: string;
      accept: boolean;
    }) => {
      if (accept) {
        let caseId = proposal.detail.case_id ?? null;
        if (proposal.detail.decision === "new" || !caseId) {
          const { data: created, error } = await supabase.rpc("create_case", {
            p_org: orgId,
            p_title: proposal.detail.title ?? "Neuer Vorgang",
            p_source: "ai_auto",
          });
          if (error) throw new Error(error.message);
          caseId = (created as { id: string }).id;
        }
        const { error: assignError } = await supabase.rpc("assign_thread_to_case", {
          p_thread: threadId,
          p_case: caseId,
          p_linked_by: "user",
          p_confidence: proposal.confidence,
        });
        if (assignError) throw new Error(assignError.message);
      }
      await supabase
        .from("automation_runs")
        .update({ status: accept ? "approved" : "rejected" })
        .eq("id", proposal.id);
      await supabase.rpc("record_automation_outcome", {
        p_run_id: proposal.id,
        p_outcome: accept ? "correct" : "wrong",
      });
    },
    onSuccess: (_, { threadId }) => {
      void queryClient.invalidateQueries({ queryKey: ["case_proposal", threadId] });
      void queryClient.invalidateQueries({ queryKey: ["mail_thread", threadId] });
      void queryClient.invalidateQueries({ queryKey: ["cases", orgId] });
    },
  });
}

/** Thread manuell einem Vorgang zuordnen/umhängen (Feedback: corrected). */
export function useAssignThreadToCase() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      threadId,
      caseId,
      isCorrection,
    }: {
      threadId: string;
      caseId: string;
      isCorrection: boolean;
    }) => {
      const { error } = await supabase.rpc("assign_thread_to_case", {
        p_thread: threadId,
        p_case: caseId,
        p_linked_by: "user",
      });
      if (error) throw new Error(error.message);
      if (isCorrection) {
        const run = await latestRunForEntity(orgId!, "mail_thread", threadId, "auto_case_match");
        if (run) {
          await supabase.rpc("record_automation_outcome", {
            p_run_id: run.id,
            p_outcome: "corrected",
          });
        }
      }
    },
    onSuccess: (_, { threadId }) => {
      void queryClient.invalidateQueries({ queryKey: ["mail_thread", threadId] });
      void queryClient.invalidateQueries({ queryKey: ["cases", orgId] });
    },
  });
}

// ---------- KI-Jobs aus der Inbox anstoßen ----------

export function useRequestAiJob() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      jobType,
      threadId,
      instructions,
    }: {
      jobType: "draft_reply" | "thread_summary";
      threadId: string;
      instructions?: string;
    }) => {
      const { error } = await supabase.from("agent_jobs").insert({
        org_id: orgId,
        created_by: userId,
        job_type: jobType,
        priority: JOB_PRIORITY.high, // interaktiv: Nutzer wartet
        payload: { thread_id: threadId, ...(instructions ? { instructions } : {}) },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["jobs", orgId] }),
  });
}

// ---------- Entwürfe & Senden (30s-Undo) ----------

export function useThreadDrafts(threadId: string | undefined) {
  return useQuery({
    queryKey: ["mail_drafts", threadId],
    enabled: !!threadId,
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mail_drafts")
        .select("*")
        .eq("thread_id", threadId!)
        .in("status", ["draft", "scheduled", "holding"])
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as MailDraftRow[];
    },
  });
}

export interface DraftAttachment {
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
}

export interface ComposePayload {
  accountId: string;
  threadId: string | null;
  to: MailAddressJson[];
  cc: MailAddressJson[];
  subject: string;
  bodyHtml: string;
  attachments: DraftAttachment[];
  draftId?: string; // bestehenden Entwurf (z. B. KI) weiterbearbeiten
}

/** Anhang in den Bucket 'attachments' laden (org-scoped Pfad, RLS-Policy). */
export async function uploadDraftAttachment(
  orgId: string,
  file: File,
): Promise<DraftAttachment> {
  const safeName = file.name.replace(/[^\w.\-äöüÄÖÜß ]/g, "_");
  const path = `org/${orgId}/uploads/${crypto.randomUUID()}/${safeName}`;
  const { error } = await supabase.storage.from("attachments").upload(path, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw new Error(error.message);
  return {
    storage_path: path,
    filename: safeName,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.size,
  };
}

export function useSaveDraft() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ComposePayload): Promise<MailDraftRow> => {
      const row = {
        org_id: orgId,
        account_id: payload.accountId,
        thread_id: payload.threadId,
        created_by: userId,
        to_addrs: payload.to,
        cc_addrs: payload.cc,
        subject: payload.subject,
        body_html: payload.bodyHtml,
        attachments: payload.attachments,
      };
      if (payload.draftId) {
        const { data, error } = await supabase
          .from("mail_drafts")
          .update(row)
          .eq("id", payload.draftId)
          .select("*")
          .single();
        if (error) throw new Error(error.message);
        return data as MailDraftRow;
      }
      const { data, error } = await supabase
        .from("mail_drafts")
        .insert({ ...row, source: "user", status: "draft" })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data as MailDraftRow;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["mail_drafts"] }),
  });
}

export const SEND_UNDO_SECONDS = 30;

/** Senden planen: status='scheduled', send_after=jetzt+30s (Undo-Fenster). */
export function useScheduleSend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draftId: string) => {
      const sendAfter = new Date(Date.now() + SEND_UNDO_SECONDS * 1000).toISOString();
      const { error } = await supabase
        .from("mail_drafts")
        .update({ status: "scheduled", send_after: sendAfter })
        .eq("id", draftId);
      if (error) throw new Error(error.message);
      return sendAfter;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["mail_drafts"] }),
  });
}

export function useUndoSend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draftId: string) => {
      const { error } = await supabase
        .from("mail_drafts")
        .update({ status: "draft", send_after: null })
        .eq("id", draftId)
        .eq("status", "scheduled");
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["mail_drafts"] }),
  });
}

export function useDiscardDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draftId: string) => {
      const { error } = await supabase
        .from("mail_drafts")
        .update({ status: "discarded" })
        .eq("id", draftId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["mail_drafts"] }),
  });
}

/** Nach Ablauf des Undo-Fensters: Versand über die Edge Function auslösen. */
export async function triggerSend(draftId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error("Nicht angemeldet");
  const res = await fetch(`${env.supabaseUrl}/functions/v1/send-mail`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: env.supabaseAnonKey,
    },
    body: JSON.stringify({ draftId }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Senden fehlgeschlagen (HTTP ${res.status})`);
  }
}
