// export-datev — DATEV-EXTF-Buchungsstapel für eine Periode (Etappe 6).
// DETERMINISTISCH (Builder in packages/shared, hier via _shared/datev.ts). Bucht
// Ausgangs-/Eingangsrechnungen der Periode, legt export_batches + export_items an
// (exported_in-Sperre über den Unique-Constraint) und lädt die CP1252-Datei in den
// Bucket 'exports'. Nur Owner/Admin. Der Steuerberater bestätigt den Kontenrahmen.
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, type SupabaseClient } from "../_shared/supabase.ts";
import { buildDatevExtf, datevTotals, type DatevBooking } from "../_shared/datev.ts";

async function requireOwnerAdmin(db: SupabaseClient, req: Request, orgId: string): Promise<boolean> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data } = await db.auth.getUser(jwt);
  if (!data.user) return false;
  const { data: member } = await db
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", data.user.id)
    .eq("is_active", true)
    .maybeSingle();
  return !!member && (member.role === "owner" || member.role === "admin");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const db = serviceClient();
  try {
    const body = await req.json().catch(() => ({}));
    const orgId = String(body.orgId ?? "");
    const periodStart = String(body.periodStart ?? "");
    const periodEnd = String(body.periodEnd ?? "");
    if (!orgId || !periodStart || !periodEnd) return json({ error: "orgId, periodStart, periodEnd Pflicht" }, 400);
    if (!(await requireOwnerAdmin(db, req, orgId))) return json({ error: "Nur Owner/Admin" }, 403);

    const { data: settings } = await db
      .from("accounting_settings")
      .select("*")
      .eq("org_id", orgId)
      .maybeSingle();
    const s = settings ?? {
      chart_of_accounts: "SKR03", consultant_number: 0, client_number: 0,
      fiscal_year_start: 1, acct_revenue_19: "8400", acct_receivables: "1400",
      acct_payables: "1600", acct_expense_default: "4980",
    };

    // Bereits exportierte Belege (in irgendeinem Batch) sind gesperrt.
    const { data: alreadyExported } = await db
      .from("export_items")
      .select("source_type, source_id")
      .eq("org_id", orgId);
    const locked = new Set((alreadyExported ?? []).map((e) => `${e.source_type}:${e.source_id}`));

    // Ausgangsrechnungen (versendet/bezahlt) der Periode
    const { data: out } = await db
      .from("invoices_out")
      .select("id, invoice_number, invoice_date, gross_amount")
      .eq("org_id", orgId)
      .gte("invoice_date", periodStart)
      .lte("invoice_date", periodEnd)
      .in("status", ["sent", "overdue", "partially_paid", "paid"]);
    const { data: inv } = await db
      .from("invoices_in")
      .select("id, invoice_number, invoice_date, gross_amount, extraction")
      .eq("org_id", orgId)
      .not("invoice_date", "is", null)
      .gte("invoice_date", periodStart)
      .lte("invoice_date", periodEnd)
      .in("status", ["approved", "paid"]);

    const bookings: DatevBooking[] = [];
    const items: Array<Record<string, unknown>> = [];
    for (const i of out ?? []) {
      if (locked.has(`invoice_out:${i.id}`) || !i.gross_amount) continue;
      bookings.push({
        bookingDate: i.invoice_date, amount: Number(i.gross_amount), debitCredit: "S",
        account: s.acct_receivables, contraAccount: s.acct_revenue_19,
        documentRef: i.invoice_number, bookingText: `Ausgangsrechnung ${i.invoice_number}`,
      });
      items.push({ source_type: "invoice_out", source_id: i.id, booking_date: i.invoice_date,
        amount: i.gross_amount, debit_account: s.acct_receivables, credit_account: s.acct_revenue_19,
        document_ref: i.invoice_number, booking_text: `Ausgangsrechnung ${i.invoice_number}` });
    }
    for (const i of inv ?? []) {
      if (locked.has(`invoice_in:${i.id}`) || !i.gross_amount) continue;
      const acct = (i.extraction as { suggested_account?: string } | null)?.suggested_account ?? s.acct_expense_default;
      bookings.push({
        bookingDate: i.invoice_date, amount: Number(i.gross_amount), debitCredit: "H",
        account: s.acct_payables, contraAccount: acct, vatKey: "9",
        documentRef: i.invoice_number, bookingText: `Eingangsrechnung ${i.invoice_number ?? ""}`,
      });
      items.push({ source_type: "invoice_in", source_id: i.id, booking_date: i.invoice_date,
        amount: i.gross_amount, debit_account: s.acct_payables, credit_account: acct, vat_key: "9",
        document_ref: i.invoice_number, booking_text: `Eingangsrechnung ${i.invoice_number ?? ""}` });
    }

    if (bookings.length === 0) return json({ error: "Keine neuen Belege in dieser Periode." }, 422);

    const created = new Date().toISOString();
    const content = buildDatevExtf({
      settings: {
        consultantNumber: s.consultant_number ?? 0, clientNumber: s.client_number ?? 0,
        fiscalYearStartMonth: s.fiscal_year_start ?? 1, chartOfAccounts: s.chart_of_accounts,
      },
      periodStart, periodEnd, created, bookings,
    });
    const totals = datevTotals(bookings);

    // Batch + Items anlegen (Sperre)
    const { data: batch, error: batchErr } = await db
      .from("export_batches")
      .insert({
        org_id: orgId, kind: "datev_extf", period_start: periodStart, period_end: periodEnd,
        status: "generated", item_count: bookings.length,
        total_debit: totals.debit, total_credit: totals.credit, generated_at: created,
      })
      .select("id")
      .single();
    if (batchErr) return json({ error: batchErr.message }, 500);
    await db.from("export_items").insert(items.map((it) => ({ ...it, batch_id: batch.id, org_id: orgId })));

    // CP1252-taugliche Datei (latin1) hochladen
    const path = `org/${orgId}/datev/EXTF_${periodStart}_${periodEnd}.csv`;
    const bytes = Uint8Array.from([...content].map((c) => c.charCodeAt(0) & 0xff));
    const { error: upErr } = await db.storage
      .from("exports")
      .upload(path, bytes, { contentType: "text/csv; charset=windows-1252", upsert: true });
    if (upErr) return json({ error: `Upload: ${upErr.message}` }, 500);
    await db.from("export_batches").update({ file_storage_path: path }).eq("id", batch.id);
    const { data: signed } = await db.storage.from("exports").createSignedUrl(path, 3600);

    return json({ ok: true, batchId: batch.id, storagePath: path, signedUrl: signed?.signedUrl ?? null,
      itemCount: bookings.length, totalDebit: totals.debit, totalCredit: totals.credit });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
