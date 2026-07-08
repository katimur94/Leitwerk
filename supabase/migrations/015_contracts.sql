-- ============================================================
-- 015_contracts.sql — Verträge, Abos, Kündigungsfristen-Wächter
-- + Erweiterung der Standard-Automationen für neue Orgs
-- ============================================================

create type public.contract_status as enum ('active','notice_given','ended','draft');

create table public.contracts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  company_id     uuid references public.companies(id) on delete set null,   -- Vertragspartner
  case_id        uuid references public.cases(id) on delete set null,
  title          text not null,                   -- "Leasing Sprinter", "Adobe CC", "Miete Halle 2"
  category       text,                            -- 'miete','leasing','versicherung','software','wartung','telekom','energie','sonstiges'
  status         public.contract_status not null default 'active',
  contract_number text,
  starts_on      date,
  ends_on        date,                            -- fixes Ende (null = unbefristet)
  -- Verlängerung & Kündigung:
  auto_renews    boolean not null default true,
  renewal_months int,                             -- verlängert sich um X Monate
  notice_period_months int,                       -- Kündigungsfrist
  next_renewal_on date,                           -- nächster Verlängerungszeitpunkt
  notice_deadline date,                           -- SPÄTESTER Kündigungstermin (Wächter-relevant!)
  -- Kosten:
  amount         numeric(12,2),
  billing_cycle  text check (billing_cycle in ('monthly','quarterly','yearly','once')),
  yearly_cost    numeric(12,2) generated always as (
                   case billing_cycle
                     when 'monthly'   then amount * 12
                     when 'quarterly' then amount * 4
                     when 'yearly'    then amount
                     else null
                   end) stored,
  -- Quellen & KI:
  document_id    uuid references public.documents(id) on delete set null,   -- Vertragsdokument
  extraction     jsonb not null default '{}'::jsonb,   -- KI-extrahierte Vertragsdaten (extract_contract)
  extraction_confidence real,
  notes          text,
  notice_given_at date,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_contracts_org_status on public.contracts(org_id, status);
create index idx_contracts_deadline on public.contracts(org_id, notice_deadline)
  where status = 'active';
create index idx_contracts_company on public.contracts(company_id);
create index idx_contracts_case on public.contracts(case_id);
create index idx_contracts_document on public.contracts(document_id);
create trigger trg_contracts_updated before update on public.contracts
  for each row execute function public.set_updated_at();

-- RLS (Kosten = Finanzdaten → kein Viewer)
alter table public.contracts enable row level security;
create policy contracts_select on public.contracts for select
  using (public.has_org_role(org_id, array['owner','admin','member']::public.org_role[]));
create policy contracts_write on public.contracts for all
  using (public.has_org_role(org_id, array['owner','admin','member']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner','admin','member']::public.org_role[]));

-- ============================================================
-- Standard-Automationen erweitern (ersetzt Funktion aus 010)
-- ============================================================
create or replace function public.handle_new_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.org_profile (org_id, legal_name) values (new.id, new.name);
  insert into public.accounting_settings (org_id) values (new.id);

  insert into public.number_ranges (org_id, kind, prefix, next_value, padding) values
    (new.id, 'case',    'V-'  || extract(year from now()) || '-', 1, 4),
    (new.id, 'quote',   'AN-' || extract(year from now()) || '-', 1, 4),
    (new.id, 'invoice', 'RE-' || extract(year from now()) || '-', 1, 4),
    (new.id, 'dunning', 'MA-' || extract(year from now()) || '-', 1, 4);

  insert into public.automations (org_id, key, name, description, autonomy_level) values
    (new.id, 'auto_label_mail',      'Mails kategorisieren', 'Ordnet eingehende Mails automatisch Kategorien zu.', 1),
    (new.id, 'auto_case_match',      'Vorgangs-Zuordnung',   'Hängt Mails, Dokumente und Termine an den passenden Vorgang.', 1),
    (new.id, 'auto_extract_tasks',   'Aufgaben aus Mails',   'Erkennt Verpflichtungen und Fristen in Mails und schlägt Aufgaben vor.', 1),
    (new.id, 'auto_capture_invoice', 'Rechnungserfassung',   'Erfasst Eingangsrechnungen aus Anhängen automatisch.', 1),
    (new.id, 'auto_followup',        'Nachfassen',           'Erstellt Nachfass-Entwürfe für unbeantwortete Angebote und Mails.', 1),
    (new.id, 'auto_dunning',         'Mahnwesen',            'Schlägt Mahnungen für überfällige Rechnungen vor.', 1),
    (new.id, 'auto_send_reply',      'Antworten senden',     'Sendet KI-Antwortentwürfe (nur nach Hochstufung!).', 1),
    (new.id, 'auto_payment_match',   'Zahlungsabgleich',     'Ordnet Bankumsätze offenen Rechnungen zu.', 1),
    (new.id, 'auto_contract_watch',  'Vertrags-Wächter',     'Warnt vor Kündigungsfristen und Vertragsverlängerungen.', 1),
    (new.id, 'auto_time_suggest',    'Zeiterfassungs-Hinweis','Schlägt Zeiteinträge aus Terminen und Vorgangsaktivität vor.', 1),
    (new.id, 'auto_account_assign',  'Kontierung',           'Schlägt Sachkonten für Eingangsrechnungen vor (DATEV-Export).', 1);

  return new;
end $$;
-- Trigger aus 010 bleibt bestehen und nutzt die neue Funktionsversion.

-- Neue Job-Typen: 'extract_contract' (Vertragsdaten aus Dokument),
-- 'contract_watch' (Fristen → agent_findings mit dedupe_key 'contract:<id>:<deadline>').
-- Cron-Ergänzung (SQL Editor):
-- select cron.schedule('contract-watch', '0 6 * * *', $$select public.enqueue_org_jobs('contract_watch', 8)$$);
