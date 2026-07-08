import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DunningRunRow,
  InvoiceInRow,
  InvoiceItemRow,
  InvoiceOutRow,
  QuoteItemRow,
  QuoteRow,
} from "@leitwerk/shared";
import { env } from "../../lib/env";
import { supabase } from "../../lib/supabase";
import { useSessionStore } from "../../stores/session";

export type DocKind = "invoice" | "quote";

/** Eigene Rolle in der aktiven Org (Viewer sieht keine Finanzen). */
export function useMyRole() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ["my_role", orgId, userId],
    enabled: !!orgId && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_members")
        .select("role")
        .eq("org_id", orgId!)
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.role ?? "viewer") as "owner" | "admin" | "member" | "viewer";
    },
  });
}

export function useInvoicesIn() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["invoices_in", orgId],
    enabled: !!orgId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices_in")
        .select("*, companies(name)")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<InvoiceInRow & { companies: { name: string } | null }>;
    },
  });
}

export function useUpdateInvoiceIn() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: InvoiceInRow["status"] }) => {
      const patch: Record<string, unknown> = { status };
      if (status === "review") patch.reviewed_by = userId;
      if (status === "approved") patch.approved_by = userId;
      if (status === "paid") patch.paid_at = new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from("invoices_in").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["invoices_in", orgId] }),
  });
}

export function useDocuments(kind: DocKind) {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const table = kind === "invoice" ? "invoices_out" : "quotes";
  return useQuery({
    queryKey: [table, orgId],
    enabled: !!orgId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table)
        .select("*, companies(name)")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<
        (InvoiceOutRow | QuoteRow) & { companies: { name: string } | null }
      >;
    },
  });
}

export function useDocItems(kind: DocKind, docId: string | undefined) {
  const table = kind === "invoice" ? "invoice_items" : "quote_items";
  const fk = kind === "invoice" ? "invoice_id" : "quote_id";
  return useQuery({
    queryKey: [table, docId],
    enabled: !!docId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq(fk, docId!)
        .order("position", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<InvoiceItemRow | QuoteItemRow>;
    },
  });
}

export function useCreateDocument(kind: DocKind) {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const userId = useSessionStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<string> => {
      if (!orgId) throw new Error("Keine aktive Organisation");
      const { data: number, error: numberError } = await supabase.rpc("next_number", {
        p_org: orgId,
        p_kind: kind === "invoice" ? "invoice" : "quote",
      });
      if (numberError) throw new Error(numberError.message);
      const table = kind === "invoice" ? "invoices_out" : "quotes";
      const numberColumn = kind === "invoice" ? "invoice_number" : "quote_number";
      const row: Record<string, unknown> = {
        org_id: orgId,
        created_by: userId,
        [numberColumn]: number,
      };
      const { data, error } = await supabase.from(table).insert(row).select("id").single();
      if (error) throw new Error(error.message);
      return data.id as string;
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: [kind === "invoice" ? "invoices_out" : "quotes", orgId],
      }),
  });
}

export function useDocMutations(kind: DocKind, docId: string) {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  const table = kind === "invoice" ? "invoices_out" : "quotes";
  const itemsTable = kind === "invoice" ? "invoice_items" : "quote_items";
  const fk = kind === "invoice" ? "invoice_id" : "quote_id";
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [table, orgId] });
    void queryClient.invalidateQueries({ queryKey: [itemsTable, docId] });
  };

  const updateDoc = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const { error } = await supabase.from(table).update(patch).eq("id", docId);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const addItem = useMutation({
    mutationFn: async (position: number) => {
      const { error } = await supabase
        .from(itemsTable)
        .insert({ [fk]: docId, position, description: "Position", quantity: 1, unit_price: 0 });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const updateItem = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase.from(itemsTable).update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(itemsTable).delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });

  return { updateDoc, addItem, updateItem, deleteItem };
}

/** XRechnung-XML erzeugen (Edge Function export-xrechnung). */
export function useExportXrechnung() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ invoiceId, isB2G }: { invoiceId: string; isB2G: boolean }) => {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch(`${env.supabaseUrl}/functions/v1/export-xrechnung`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: env.supabaseAnonKey,
        },
        body: JSON.stringify({ invoiceId, isB2G }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        xml?: string;
        xmlStoragePath?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      return data;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["invoices_out", orgId] }),
  });
}

export function useDunningRuns() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  return useQuery({
    queryKey: ["dunning_runs", orgId],
    enabled: !!orgId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dunning_runs")
        .select("*, invoices_out(invoice_number, gross_amount, currency, due_date)")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<
        DunningRunRow & {
          invoices_out: {
            invoice_number: string;
            gross_amount: number;
            currency: string;
            due_date: string | null;
          } | null;
        }
      >;
    },
  });
}

/** Mahnung freigeben: Draft in den Sendeplan (30s-Undo-Mechanik) + Status. */
export function useResolveDunning() {
  const orgId = useSessionStore((s) => s.activeOrg?.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      dunning,
      approve,
    }: {
      dunning: DunningRunRow;
      approve: boolean;
    }) => {
      if (approve) {
        if (!dunning.draft_id) throw new Error("Kein Mahnentwurf vorhanden (Runner offline?)");
        const { error: draftError } = await supabase
          .from("mail_drafts")
          .update({
            status: "scheduled",
            send_after: new Date(Date.now() + 30_000).toISOString(),
          })
          .eq("id", dunning.draft_id);
        if (draftError) throw new Error(draftError.message);
      }
      const { error } = await supabase
        .from("dunning_runs")
        .update(
          approve
            ? { status: "sent", sent_at: new Date().toISOString() }
            : { status: "skipped" },
        )
        .eq("id", dunning.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["dunning_runs", orgId] }),
  });
}
