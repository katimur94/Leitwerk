import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  KnowledgeItemRow,
  MeetingRow,
  NoteRow,
  SearchResultRow,
} from "@leitwerk/shared";
import { supabase } from "../../lib/supabase";
import { useSessionStore } from "../../stores/session";

// ---------- Notizen ----------

export function useNotes() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["notes", orgId],
    enabled: !!orgId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as NoteRow[];
    },
  });
}

export function useNoteMutations() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["notes", orgId] });

  const create = useMutation({
    mutationFn: async ({ title, body }: { title: string; body: string }) => {
      const { error } = await supabase.from("notes").insert({
        org_id: orgId,
        title: title || null,
        body_md: body,
        source: "manual",
        created_by: userId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, title, body }: { id: string; title: string; body: string }) => {
      const { error } = await supabase
        .from("notes")
        .update({ title: title || null, body_md: body })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notes").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  /** Sprachnotiz: Audio → Bucket 'audio' → Notiz-Stub + transcribe_note-Job. */
  const createVoice = useMutation({
    mutationFn: async (audio: Blob) => {
      if (!orgId) throw new Error("Keine aktive Organisation");
      const path = `org/${orgId}/notes/${crypto.randomUUID()}.webm`;
      const { error: uploadError } = await supabase.storage
        .from("audio")
        .upload(path, audio, { contentType: audio.type || "audio/webm" });
      if (uploadError) throw new Error(uploadError.message);
      const { data: note, error: noteError } = await supabase
        .from("notes")
        .insert({
          org_id: orgId,
          title: "Sprachnotiz",
          body_md: "_(Transkription läuft — Runner + Whisper lokal)_",
          source: "voice",
          created_by: userId,
        })
        .select("id")
        .single();
      if (noteError) throw new Error(noteError.message);
      const { error: jobError } = await supabase.from("agent_jobs").insert({
        org_id: orgId,
        job_type: "transcribe_note",
        priority: 2,
        payload: { note_id: note.id, audio_storage_path: path },
        created_by: userId,
      });
      if (jobError) throw new Error(jobError.message);
    },
    onSuccess: invalidate,
  });

  return { create, update, remove, createVoice };
}

// ---------- Wissen (Review proposed → confirmed) ----------

export function useKnowledgeItems() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["knowledge_items", orgId],
    enabled: !!orgId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_items")
        .select("*")
        .eq("org_id", orgId!)
        .neq("status", "rejected")
        .order("status", { ascending: false }) // proposed vor confirmed
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as KnowledgeItemRow[];
    },
  });
}

export function useReviewKnowledge() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "confirmed" | "rejected" | "outdated" }) => {
      const patch: Record<string, unknown> = { status };
      if (status === "confirmed") patch.confirmed_by = userId;
      const { error } = await supabase.from("knowledge_items").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["knowledge_items", orgId] }),
  });
}

// ---------- Meetings ----------

export function useMeetings() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["meetings", orgId],
    enabled: !!orgId,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetings")
        .select("*")
        .eq("org_id", orgId!)
        .order("held_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as MeetingRow[];
    },
  });
}

/** Meeting anlegen: Audio → Bucket 'audio' → meetings-Zeile + transcribe_meeting-Job. */
export function useCreateMeeting() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ title, audio }: { title: string; audio: File | Blob }) => {
      if (!orgId) throw new Error("Keine aktive Organisation");
      const ext = audio instanceof File ? audio.name.split(".").pop() || "webm" : "webm";
      const path = `org/${orgId}/meetings/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("audio")
        .upload(path, audio, { contentType: audio.type || "audio/webm" });
      if (uploadError) throw new Error(uploadError.message);
      const { data: meeting, error: meetingError } = await supabase
        .from("meetings")
        .insert({
          org_id: orgId,
          title: title || "Meeting",
          audio_storage_path: path,
          created_by: userId,
        })
        .select("id")
        .single();
      if (meetingError) throw new Error(meetingError.message);
      const { error: jobError } = await supabase.from("agent_jobs").insert({
        org_id: orgId,
        job_type: "transcribe_meeting",
        priority: 4,
        payload: { meeting_id: meeting.id },
        created_by: userId,
      });
      if (jobError) throw new Error(jobError.message);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["meetings", orgId] }),
  });
}

// ---------- Kombinierte Suche (Volltext + semantisch) ----------

/** Volltext sofort; semantisch optional über einen semantic_search-Job. */
export function useCombinedSearch(query: string, embeddingJobId: string | null) {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["search", orgId, query, embeddingJobId],
    enabled: !!orgId && query.trim().length >= 2,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_combined", {
        p_org: orgId,
        p_query: query.trim(),
        p_embedding_job: embeddingJobId,
        p_limit: 20,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as SearchResultRow[];
    },
  });
}

/** Startet einen interaktiven semantic_search-Job und liefert dessen ID,
 *  sobald er fertig ist (Poll alle 1,5 s, max. 20 s). */
export function useSemanticSearchJob() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  return useMutation({
    mutationFn: async (query: string): Promise<string> => {
      if (!orgId) throw new Error("Keine aktive Organisation");
      const { data: job, error } = await supabase
        .from("agent_jobs")
        .insert({
          org_id: orgId,
          job_type: "semantic_search",
          priority: 1,
          payload: { query },
          created_by: userId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const { data: current } = await supabase
          .from("agent_jobs")
          .select("status")
          .eq("id", job.id)
          .maybeSingle();
        if (current?.status === "done") return job.id as string;
        if (current?.status === "failed") throw new Error("Semantische Suche fehlgeschlagen (Runner-Log prüfen)");
      }
      throw new Error("Semantische Suche: Zeitüberschreitung — ist ein Runner online?");
    },
  });
}
