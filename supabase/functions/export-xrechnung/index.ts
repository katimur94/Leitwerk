// export-xrechnung — XRechnung 3.x XML (EN 16931, UBL) für Ausgangsrechnungen.
// DETERMINISTISCH (kein LLM in der Dateierzeugung). Das XML landet im Bucket
// 'exports' und an der Rechnung (xml_storage_path). Ein vereinfachtes
// Rechnungs-PDF liefert die PWA (Druckansicht); zertifiziertes ZUGFeRD-PDF/A-3
// ist für die Produktisierung (P7) vorgesehen.
import { corsHeaders, json } from "../_shared/cors.ts";
import { serviceClient, type SupabaseClient } from "../_shared/supabase.ts";
import { buildXrechnungXml, type XrItem } from "../_shared/xrechnung.ts";

async function requireMember(
  db: SupabaseClient,
  req: Request,
  orgId: string,
): Promise<boolean> {
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
  return !!member && member.role !== "viewer";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Nur POST" }, 405);

  const db = serviceClient();
  try {
    const body = await req.json().catch(() => ({}));
    const invoiceId = String(body.invoiceId ?? "");
    if (!invoiceId) return json({ error: "invoiceId ist Pflicht" }, 400);

    const { data: invoice } = await db
      .from("invoices_out")
      .select("*, companies(name, address), contacts(first_name, last_name, email)")
      .eq("id", invoiceId)
      .maybeSingle();
    if (!invoice) return json({ error: "Rechnung nicht gefunden" }, 404);
    if (!(await requireMember(db, req, invoice.org_id))) {
      return json({ error: "Keine Berechtigung" }, 403);
    }

    // B2G: Leitweg-ID (buyer_reference) ist Pflicht
    if (body.isB2G === true && !invoice.buyer_reference) {
      return json(
        { error: "Für Rechnungen an öffentliche Auftraggeber (B2G) ist die Leitweg-ID (Käuferreferenz) Pflicht.", code: "buyer_reference_required" },
        422,
      );
    }

    const { data: items } = await db
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("position", { ascending: true });
    if (!items || items.length === 0) {
      return json({ error: "Rechnung hat keine Positionen" }, 422);
    }

    const { data: profile } = await db
      .from("org_profile")
      .select("*")
      .eq("org_id", invoice.org_id)
      .maybeSingle();
    if (!profile?.legal_name) {
      return json({ error: "Firmen-Stammdaten unvollständig (Einstellungen → Onboarding)" }, 422);
    }

    const company = invoice.companies as { name?: string; address?: Record<string, string> } | null;
    const contact = invoice.contacts as { first_name?: string; last_name?: string; email?: string } | null;
    const address = company?.address ?? {};

    const xml = buildXrechnungXml(
      {
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date,
        due_date: invoice.due_date,
        currency: invoice.currency,
        buyer_reference: invoice.buyer_reference,
        payment_terms: invoice.payment_terms,
        items: (items as XrItem[]).map((item) => ({
          position: item.position,
          description: item.description,
          quantity: Number(item.quantity),
          unit: item.unit,
          unit_price: Number(item.unit_price),
          vat_rate: Number(item.vat_rate),
          net_total: Number(item.net_total),
        })),
      },
      {
        legal_name: profile.legal_name,
        vat_id: profile.vat_id,
        tax_number: profile.tax_number,
        street: profile.street,
        zip: profile.zip,
        city: profile.city,
        country: profile.country ?? "DE",
        email: profile.email,
        iban: profile.iban,
        bank_name: profile.bank_name,
        is_small_business: profile.is_small_business,
      },
      {
        name: company?.name ?? [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") ?? "—",
        street: address.street ?? null,
        zip: address.zip ?? null,
        city: address.city ?? null,
        country: address.country ?? "DE",
        email: contact?.email ?? null,
      },
    );

    const path = `org/${invoice.org_id}/xrechnung/${invoice.invoice_number}.xml`;
    const { error: uploadError } = await db.storage
      .from("exports")
      .upload(path, new TextEncoder().encode(xml), {
        contentType: "application/xml",
        upsert: true,
      });
    if (uploadError) return json({ error: `Storage: ${uploadError.message}` }, 500);

    await db.from("invoices_out").update({ xml_storage_path: path }).eq("id", invoiceId);
    await db.from("audit_log").insert({
      org_id: invoice.org_id,
      actor_type: "system",
      action: "invoice.xrechnung_exported",
      entity_type: "invoice_out",
      entity_id: invoiceId,
      detail: { path },
    });

    return json({ ok: true, xmlStoragePath: path, xml });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
