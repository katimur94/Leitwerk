-- ============================================================
-- 013_accounting_export.sql — Buchhaltungs-Export (DATEV EXTF / CSV)
-- Ziel: Monatlicher Stapel für den Steuerberater ohne manuellen Bruch.
-- ============================================================

-- ---------- Einstellungen pro Org ----------
create table public.accounting_settings (
  org_id           uuid primary key references public.orgs(id) on delete cascade,
  chart_of_accounts text not null default 'SKR03' check (chart_of_accounts in ('SKR03','SKR04')),
  consultant_number int,                          -- DATEV Beraternummer
  client_number     int,                          -- DATEV Mandantennummer
  fiscal_year_start int not null default 1 check (fiscal_year_start between 1 and 12),
  -- Standard-Konten (vom Steuerberater bestätigen lassen!)
  acct_revenue_19   text not null default '8400', -- SKR03: Erlöse 19%
  acct_revenue_7    text not null default '8300',
  acct_revenue_0    text not null default '8125', -- steuerfrei/§13b etc. anpassen
  acct_receivables  text not null default '1400', -- Forderungen
  acct_payables     text not null default '1600', -- Verbindlichkeiten
  acct_bank         text not null default '1200',
  acct_expense_default text not null default '4980',
  vendor_account_start int not null default 70000, -- Kreditoren-Nummernkreis
  customer_account_start int not null default 10000, -- Debitoren
  updated_at        timestamptz not null default now()
);
create trigger trg_acct_settings_updated before update on public.accounting_settings
  for each row execute function public.set_updated_at();

-- Debitoren-/Kreditoren-Nummern an Firmen
alter table public.companies
  add column debtor_account  int,
  add column creditor_account int;
create index idx_companies_debtor on public.companies(org_id, debtor_account);

-- ---------- Export-Stapel ----------
create table public.export_batches (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  kind          text not null default 'datev_extf' check (kind in ('datev_extf','csv')),
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'draft'
                check (status in ('draft','generated','downloaded','sent_to_tax_advisor')),
  file_storage_path text,                        -- Bucket 'exports'
  item_count    int not null default 0,
  total_debit   numeric(14,2) not null default 0,
  total_credit  numeric(14,2) not null default 0,
  generated_by  uuid references auth.users(id) on delete set null,
  generated_at  timestamptz,
  note          text,
  created_at    timestamptz not null default now()
);
create index idx_export_batches_org on public.export_batches(org_id, period_start desc);

-- ---------- Buchungszeilen (Snapshot, unveränderlich nach Generierung) ----------
create table public.export_items (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references public.export_batches(id) on delete cascade,
  org_id         uuid not null references public.orgs(id) on delete cascade,
  source_type    text not null check (source_type in ('invoice_out','invoice_in','bank_transaction')),
  source_id      uuid not null,
  booking_date   date not null,
  amount         numeric(12,2) not null,
  debit_account  text not null,                  -- Soll
  credit_account text not null,                  -- Haben
  vat_key        text,                           -- BU-Schlüssel (z.B. '9' = 19% VSt)
  document_ref   text,                           -- Belegfeld 1 (Rechnungsnummer)
  booking_text   text not null,
  created_at     timestamptz not null default now(),
  unique (batch_id, source_type, source_id)
);
create index idx_export_items_batch on public.export_items(batch_id);
create index idx_export_items_org on public.export_items(org_id);

-- Doppel-Export verhindern: Quelle merkt sich Batch
alter table public.invoices_out add column exported_in uuid references public.export_batches(id) on delete set null;
alter table public.invoices_in  add column exported_in uuid references public.export_batches(id) on delete set null;
create index idx_inv_out_exported on public.invoices_out(exported_in);
create index idx_inv_in_exported  on public.invoices_in(exported_in);

-- ---------- RLS (nur owner/admin — Buchhaltung ist Chefsache) ----------
alter table public.accounting_settings enable row level security;
alter table public.export_batches      enable row level security;
alter table public.export_items        enable row level security;

create policy acct_settings_all on public.accounting_settings for all
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy export_batches_all on public.export_batches for all
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy export_items_select on public.export_items for select
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- Neuer Job-Typ 'accounting_export_prepare' (Runner/KI ordnet Eingangsrechnungen
-- Sachkonten zu — Vorschlag mit Konfidenz, Freigabe durch Menschen vor Generierung).
-- Die EXTF-Datei selbst erzeugt die Edge Function 'export-datev' deterministisch (kein LLM).
-- WICHTIG (Tutorial-Hinweis): Kontenrahmen + Konten vor erstem Export vom Steuerberater
-- bestätigen lassen. Der Export ist eine Buchungsvorschlagsliste, keine Steuerberatung.
