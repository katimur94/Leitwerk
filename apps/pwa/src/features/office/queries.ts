import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AbsenceRow,
  BankTransactionRow,
  CallLogRow,
  ContractRow,
  ExportBatchRow,
  PaymentMatchRow,
  TimeEntryRow,
} from "@leitwerk/shared";
import { env } from "../../lib/env";
import { supabase } from "../../lib/supabase";
import { useSessionStore } from "../../stores/session";

const KEY = (t: string, o: string | undefined) => [t, o];

// ---------- Zeiterfassung ----------
export function useTimeEntries() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: KEY("time_entries", orgId),
    enabled: !!orgId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("time_entries")
        .select("*")
        .eq("org_id", orgId!)
        .gte("work_date", weekAgo)
        .order("work_date", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as TimeEntryRow[];
    },
  });
}

export function useTimeMutations() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: KEY("time_entries", orgId) });
  const add = useMutation({
    mutationFn: async ({ minutes, description, isBillable }: { minutes: number; description: string; isBillable: boolean }) => {
      const { error } = await supabase.from("time_entries").insert({
        org_id: orgId, user_id: userId, minutes, description, is_billable: isBillable, source: "manual",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
  const confirmSuggestion = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("time_entries").update({ source: "manual" }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("time_entries").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
  return { add, confirmSuggestion, remove };
}

// ---------- Banking / Zahlungsabgleich ----------
export function useBankTransactions() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: KEY("bank_transactions", orgId),
    enabled: !!orgId,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_transactions")
        .select("*")
        .eq("org_id", orgId!)
        .order("booked_on", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as BankTransactionRow[];
    },
  });
}

export function usePaymentMatches() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: KEY("payment_matches", orgId),
    enabled: !!orgId,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_matches")
        .select("*, invoices_out(invoice_number)")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<PaymentMatchRow & { invoices_out: { invoice_number: string } | null }>;
    },
  });
}

/** Match bestätigen (Trigger apply_payment_match verbucht die Zahlung) oder ablehnen. */
export function useResolveMatch() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ match, confirm }: { match: PaymentMatchRow; confirm: boolean }) => {
      const { error } = await supabase
        .from("payment_matches")
        .update(confirm ? { status: "confirmed", confirmed_by: userId } : { status: "rejected" })
        .eq("id", match.id);
      if (error) throw new Error(error.message);
      await supabase
        .from("bank_transactions")
        .update({ match_status: confirm ? "matched" : "unmatched" })
        .eq("id", match.transaction_id);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY("payment_matches", orgId) });
      void qc.invalidateQueries({ queryKey: KEY("bank_transactions", orgId) });
    },
  });
}

// ---------- DATEV-Export ----------
export function useExportBatches() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: KEY("export_batches", orgId),
    enabled: !!orgId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("export_batches")
        .select("*")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return (data ?? []) as ExportBatchRow[];
    },
  });
}

export function useExportDatev() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ periodStart, periodEnd }: { periodStart: string; periodEnd: string }) => {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch(`${env.supabaseUrl}/functions/v1/export-datev`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session?.access_token}`,
          apikey: env.supabaseAnonKey,
        },
        body: JSON.stringify({ orgId, periodStart, periodEnd }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        signedUrl?: string; itemCount?: number; error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      return data;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY("export_batches", orgId) }),
  });
}

// ---------- Verträge ----------
export function useContracts() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: KEY("contracts", orgId),
    enabled: !!orgId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contracts")
        .select("*")
        .eq("org_id", orgId!)
        .order("notice_deadline", { ascending: true, nullsFirst: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as ContractRow[];
    },
  });
}

// ---------- Anrufe ----------
export function useCallLogs() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: KEY("call_logs", orgId),
    enabled: !!orgId,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_logs")
        .select("*")
        .eq("org_id", orgId!)
        .order("occurred_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as CallLogRow[];
    },
  });
}

export function useLogCall() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ phone, summary, direction }: { phone: string; summary: string; direction: CallLogRow["direction"] }) => {
      const { error } = await supabase.from("call_logs").insert({
        org_id: orgId, user_id: userId, phone_number: phone || null, summary: summary || null,
        direction, source: "manual",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY("call_logs", orgId) }),
  });
}

// ---------- Abwesenheiten ----------
export function useAbsences() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: KEY("absences", orgId),
    enabled: !!orgId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("absences")
        .select("*")
        .eq("org_id", orgId!)
        .order("starts_on", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as AbsenceRow[];
    },
  });
}

export function useAbsenceMutations() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: KEY("absences", orgId) });
  const request = useMutation({
    mutationFn: async ({ kind, startsOn, endsOn, note }: { kind: AbsenceRow["kind"]; startsOn: string; endsOn: string; note: string }) => {
      const days = Math.max(1, Math.round((Date.parse(endsOn) - Date.parse(startsOn)) / 86_400_000) + 1);
      const { error } = await supabase.from("absences").insert({
        org_id: orgId, user_id: userId, kind, starts_on: startsOn, ends_on: endsOn,
        note: note || null, days_counted: days, status: "requested",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const { error } = await supabase
        .from("absences")
        .update({ status, decided_by: userId, decided_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
  return { request, decide };
}
