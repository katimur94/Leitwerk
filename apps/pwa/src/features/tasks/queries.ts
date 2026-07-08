import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TaskChecklistItemRow, TaskRow } from "@leitwerk/shared";
import { supabase } from "../../lib/supabase";
import { useSessionStore } from "../../stores/session";

export type TaskFilter = "open" | "done" | "all";

export function useTasks(filter: TaskFilter) {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["tasks", orgId, filter],
    enabled: !!orgId,
    refetchInterval: 20_000,
    queryFn: async () => {
      let query = supabase
        .from("tasks")
        .select("*")
        .eq("org_id", orgId!)
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(200);
      if (filter === "open") query = query.in("status", ["open", "in_progress"]);
      if (filter === "done") query = query.in("status", ["done", "cancelled"]);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as TaskRow[];
    },
  });
}

export function useTaskChecklist(taskId: string | undefined) {
  return useQuery({
    queryKey: ["task_checklist", taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_checklist_items")
        .select("*")
        .eq("task_id", taskId!)
        .order("position", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as TaskChecklistItemRow[];
    },
  });
}

export function useTaskMutations() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tasks", orgId] });
    void queryClient.invalidateQueries({ queryKey: ["task_checklist"] });
  };

  const createTask = useMutation({
    mutationFn: async (fields: Partial<TaskRow> & { title: string }) => {
      const { error } = await supabase.from("tasks").insert({
        org_id: orgId,
        created_by: userId,
        source: "manual",
        ...fields,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const updateTask = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<TaskRow> }) => {
      const { error } = await supabase.from("tasks").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  /** Erledigen/Reaktivieren inkl. completed_at + Wiederholung (recurrence). */
  const toggleDone = useMutation({
    mutationFn: async (task: TaskRow) => {
      const done = task.status !== "done";
      const { error } = await supabase
        .from("tasks")
        .update({
          status: done ? "done" : "open",
          completed_at: done ? new Date().toISOString() : null,
        })
        .eq("id", task.id);
      if (error) throw new Error(error.message);

      // Einfache Wiederholung: {every_days: N} → Folgeaufgabe anlegen
      const everyDays = Number(
        (task.recurrence as { every_days?: number } | null)?.every_days ?? 0,
      );
      if (done && everyDays > 0) {
        const base = task.due_at ? new Date(task.due_at) : new Date();
        await supabase.from("tasks").insert({
          org_id: task.org_id,
          case_id: task.case_id,
          title: task.title,
          description: task.description,
          due_at: new Date(base.getTime() + everyDays * 86_400_000).toISOString(),
          assignee_id: task.assignee_id,
          created_by: task.created_by,
          source: task.source,
          recurrence: task.recurrence,
        });
      }
    },
    onSuccess: invalidate,
  });

  /** KI-Vorschlag verwerfen: Aufgabe abbrechen + Feedback in die Trefferquote. */
  const dismissSuggestion = useMutation({
    mutationFn: async (task: TaskRow) => {
      const { error } = await supabase
        .from("tasks")
        .update({ status: "cancelled" })
        .eq("id", task.id);
      if (error) throw new Error(error.message);
      const { data: run } = await supabase
        .from("automation_runs")
        .select("id")
        .eq("org_id", task.org_id)
        .eq("entity_type", "task")
        .eq("entity_id", task.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (run) {
        await supabase.rpc("record_automation_outcome", {
          p_run_id: run.id,
          p_outcome: "wrong",
        });
      }
    },
    onSuccess: invalidate,
  });

  const addChecklistItem = useMutation({
    mutationFn: async ({ taskId, title, position }: { taskId: string; title: string; position: number }) => {
      const { error } = await supabase
        .from("task_checklist_items")
        .insert({ task_id: taskId, title, position });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const toggleChecklistItem = useMutation({
    mutationFn: async (item: TaskChecklistItemRow) => {
      const { error } = await supabase
        .from("task_checklist_items")
        .update({ is_done: !item.is_done })
        .eq("id", item.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  /** Snooze: "Zeig mir das wieder am …" (Tabelle snoozes, 005). */
  const snoozeTask = useMutation({
    mutationFn: async ({ taskId, until }: { taskId: string; until: string }) => {
      if (!orgId || !userId) throw new Error("Keine aktive Organisation");
      const { error } = await supabase.from("snoozes").upsert(
        { org_id: orgId, user_id: userId, entity_type: "task", entity_id: taskId, until_at: until },
        { onConflict: "user_id,entity_type,entity_id" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  return {
    createTask,
    updateTask,
    toggleDone,
    dismissSuggestion,
    addChecklistItem,
    toggleChecklistItem,
    snoozeTask,
  };
}

export function useOrgMembers() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["org_members", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_members")
        .select("user_id, role")
        .eq("org_id", orgId!)
        .eq("is_active", true);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useSnoozes() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ["snoozes", orgId, userId],
    enabled: !!orgId && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("snoozes")
        .select("entity_type, entity_id, until_at")
        .eq("org_id", orgId!)
        .eq("user_id", userId!)
        .gt("until_at", new Date().toISOString());
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
