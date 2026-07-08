-- ============================================================
-- 006_finance.sql — Rechnungen, Angebote, Mahnwesen, Nummernkreise
-- ============================================================

-- ---------- Nummernkreise (Vorgänge, Angebote, Rechnungen) ----------
create table public.number_ranges (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  kind       text not null check (kind in ('case','quote','invoice','dunning')),
  prefix     text not null default '',              -- z.B. 'RE-2026-'
  next_value int  not null default 1,
  padding    int  not null default 4,
  unique (org_id, kind)
);
create index idx_number_ranges_org on public.number_ranges(org_id);

create or replace function public.next_number(p_org uuid, p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare v_prefix text; v_val int; v_pad int;
begin
  update public.number_ranges
     set next_value = next_value + 1
   where org_id = p_org and kind = p_kind
   returning prefix, next_value - 1, padding into v_prefix, v_val, v_pad;
  if not found then
    raise exception 'Kein Nummernkreis für % / %', p_org, p_kind;
  end if;
  return v_prefix || lpad(v_val::text, v_pad, '0');
end $$;

-- ---------- Eingangsrechnungen ----------
create type public.invoice_in_status as enum ('captured','review','approved','paid','rejected');

create table public.invoices_in (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  case_id        uuid references public.cases(id) on delete set null,
  company_id     uuid references public.companies(id) on delete set null,   -- Aussteller
  source         text not null default 'mail' check (source in ('mail','upload','manual')),
  attachment_id  uuid references public.mail_attachments(id) on delete set null,
  document_id    uuid,                              -- FK auf documents in 007 nachgezogen
  status         public.invoice_in_status not null default 'captured',
  invoice_number text,
  invoice_date   date,
  due_date       date,
  net_amount     numeric(12,2),
  vat_amount     numeric(12,2),
  gross_amount   numeric(12,2),
  currency       text not null default 'EUR',
  iban           text,
  payment_reference text,
  -- KI-Extraktion:
  extraction     jsonb not null default '{}'::jsonb,  -- Rohergebnis inkl. Positionsdaten
  extraction_confidence real,
  format_detected text,                              -- 'zugferd','xrechnung','pdf_ocr','pdf_text'
  is_einvoice    boolean not null default false,
  duplicate_of   uuid references public.invoices_in(id) on delete set null,
  reviewed_by    uuid references auth.users(id) on delete set null,
  approved_by    uuid references auth.users(id) on delete set null,
  paid_at        date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_inv_in_org_status on public.invoices_in(org_id, status, due_date);
create index idx_inv_in_case on public.invoices_in(case_id);
create index idx_inv_in_company on public.invoices_in(company_id);
create index idx_inv_in_dup on public.invoices_in(org_id, invoice_number, gross_amount);
create trigger trg_inv_in_updated before update on public.invoices_in
  for each row execute function public.set_updated_at();

-- ---------- Ausgangsrechnungen ----------
create type public.invoice_out_status as enum
  ('draft','approved','sent','partially_paid','paid','overdue','cancelled');

create table public.invoices_out (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  case_id        uuid references public.cases(id) on delete set null,
  company_id     uuid references public.companies(id) on delete set null,   -- Empfänger
  contact_id     uuid references public.contacts(id) on delete set null,
  quote_id       uuid,                              -- FK auf quotes weiter unten nachgezogen
  invoice_number text not null,
  status         public.invoice_out_status not null default 'draft',
  invoice_date   date not null default current_date,
  due_date       date,
  net_amount     numeric(12,2) not null default 0,
  vat_amount     numeric(12,2) not null default 0,
  gross_amount   numeric(12,2) not null default 0,
  currency       text not null default 'EUR',
  payment_terms  text,
  buyer_reference text,                             -- Leitweg-ID / Bestellreferenz (XRechnung-Pflichtfeld B2G)
  pdf_storage_path text,                            -- erzeugtes ZUGFeRD-PDF
  xml_storage_path text,                            -- XRechnung-XML
  sent_at        timestamptz,
  paid_amount    numeric(12,2) not null default 0,
  paid_at        date,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, invoice_number)
);
create index idx_inv_out_org_status on public.invoices_out(org_id, status, due_date);
create index idx_inv_out_case on public.invoices_out(case_id);
create index idx_inv_out_company on public.invoices_out(company_id);
create trigger trg_inv_out_updated before update on public.invoices_out
  for each row execute function public.set_updated_at();

create table public.invoice_items (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices_out(id) on delete cascade,
  position     int not null default 0,
  description  text not null,
  quantity     numeric(12,3) not null default 1,
  unit         text not null default 'Stk',
  unit_price   numeric(12,2) not null default 0,
  vat_rate     numeric(5,2) not null default 19.00,
  net_total    numeric(12,2) generated always as (round(quantity * unit_price, 2)) stored
);
create index idx_inv_items_inv on public.invoice_items(invoice_id);

-- ---------- Angebote ----------
create type public.quote_status as enum
  ('draft','sent','followed_up','accepted','rejected','expired');

create table public.quotes (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  case_id       uuid references public.cases(id) on delete set null,
  company_id    uuid references public.companies(id) on delete set null,
  contact_id    uuid references public.contacts(id) on delete set null,
  quote_number  text not null,
  status        public.quote_status not null default 'draft',
  quote_date    date not null default current_date,
  valid_until   date,
  net_amount    numeric(12,2) not null default 0,
  vat_amount    numeric(12,2) not null default 0,
  gross_amount  numeric(12,2) not null default 0,
  pdf_storage_path text,
  sent_at       timestamptz,
  decided_at    timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, quote_number)
);
create index idx_quotes_org_status on public.quotes(org_id, status);
create index idx_quotes_case on public.quotes(case_id);
create index idx_quotes_company on public.quotes(company_id);
create trigger trg_quotes_updated before update on public.quotes
  for each row execute function public.set_updated_at();

alter table public.invoices_out
  add constraint fk_inv_out_quote foreign key (quote_id)
  references public.quotes(id) on delete set null;
create index idx_inv_out_quote on public.invoices_out(quote_id);

create table public.quote_items (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quotes(id) on delete cascade,
  position    int not null default 0,
  description text not null,
  quantity    numeric(12,3) not null default 1,
  unit        text not null default 'Stk',
  unit_price  numeric(12,2) not null default 0,
  vat_rate    numeric(5,2) not null default 19.00,
  net_total   numeric(12,2) generated always as (round(quantity * unit_price, 2)) stored
);
create index idx_quote_items_quote on public.quote_items(quote_id);

-- ---------- Mahnwesen ----------
create table public.dunning_runs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  invoice_id   uuid not null references public.invoices_out(id) on delete cascade,
  level        smallint not null check (level between 1 and 3),
  draft_id     uuid references public.mail_drafts(id) on delete set null,
  fee          numeric(12,2) not null default 0,
  status       text not null default 'proposed'
               check (status in ('proposed','approved','sent','skipped')),
  proposed_by  text not null default 'ai' check (proposed_by in ('ai','user')),
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (invoice_id, level)
);
create index idx_dunning_org on public.dunning_runs(org_id, status);
create index idx_dunning_invoice on public.dunning_runs(invoice_id);
