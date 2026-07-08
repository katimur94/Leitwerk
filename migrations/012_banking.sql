-- ============================================================
-- 012_banking.sql — Bankkonten, Umsätze, Zahlungsabgleich
-- Anbindung über GoCardless Bank Account Data (EU/PSD2) oder
-- FinTS via Runner-Connector. Tokens im Vault.
-- ============================================================

-- ---------- Bankverbindungen ----------
create table public.bank_connections (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  provider        text not null default 'gocardless' check (provider in ('gocardless','fints','csv')),
  bank_name       text not null,
  iban            text,
  account_name    text,
  vault_secret_id uuid,                          -- Provider-Tokens/Zugangsdaten im Vault
  sync_state      text not null default 'pending' check (sync_state in ('pending','ok','error','expired')),
  sync_cursor     text,
  last_sync_at    timestamptz,
  last_error      text,
  consent_expires_at timestamptz,                -- PSD2: Zustimmung alle 90/180 Tage erneuern
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_bank_conn_org on public.bank_connections(org_id);
create trigger trg_bank_conn_updated before update on public.bank_connections
  for each row execute function public.set_updated_at();

-- ---------- Umsätze ----------
create table public.bank_transactions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  connection_id  uuid not null references public.bank_connections(id) on delete cascade,
  provider_tx_id text not null,
  booked_on      date not null,
  value_date     date,
  amount         numeric(12,2) not null,          -- positiv = Eingang
  currency       text not null default 'EUR',
  counterpart_name text,
  counterpart_iban text,
  purpose        text,                            -- Verwendungszweck
  end_to_end_ref text,
  match_status   text not null default 'unmatched'
                 check (match_status in ('unmatched','suggested','matched','ignored','manual')),
  created_at     timestamptz not null default now(),
  unique (connection_id, provider_tx_id)
);
create index idx_bank_tx_org_date on public.bank_transactions(org_id, booked_on desc);
create index idx_bank_tx_unmatched on public.bank_transactions(org_id, booked_on desc)
  where match_status in ('unmatched','suggested');
create index idx_bank_tx_purpose_trgm on public.bank_transactions using gin(purpose gin_trgm_ops);

-- ---------- Zahlungszuordnung (Umsatz ↔ Rechnung) ----------
create table public.payment_matches (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  transaction_id  uuid not null references public.bank_transactions(id) on delete cascade,
  invoice_out_id  uuid references public.invoices_out(id) on delete cascade,
  invoice_in_id   uuid references public.invoices_in(id) on delete cascade,
  matched_amount  numeric(12,2) not null,          -- Teilzahlungen möglich
  confidence      real,                            -- KI-Match-Konfidenz
  matched_by      text not null default 'ai' check (matched_by in ('ai','user','rule')),
  status          text not null default 'suggested'
                  check (status in ('suggested','confirmed','rejected')),
  job_id          uuid references public.agent_jobs(id) on delete set null,
  confirmed_by    uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  check (num_nonnulls(invoice_out_id, invoice_in_id) = 1)
);
create index idx_pm_org on public.payment_matches(org_id, status);
create index idx_pm_tx on public.payment_matches(transaction_id);
create index idx_pm_inv_out on public.payment_matches(invoice_out_id);
create index idx_pm_inv_in on public.payment_matches(invoice_in_id);
create index idx_pm_job on public.payment_matches(job_id);

-- ---------- Bestätigter Match aktualisiert Rechnungsstatus ----------
create or replace function public.apply_payment_match()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_paid numeric; v_gross numeric;
begin
  if new.status = 'confirmed' and old.status <> 'confirmed' then
    if new.invoice_out_id is not null then
      update public.invoices_out
         set paid_amount = paid_amount + new.matched_amount
       where id = new.invoice_out_id
       returning paid_amount, gross_amount into v_paid, v_gross;
      update public.invoices_out
         set status = case when v_paid >= v_gross then 'paid' else 'partially_paid' end,
             paid_at = case when v_paid >= v_gross then current_date else paid_at end
       where id = new.invoice_out_id;
      update public.bank_transactions set match_status = 'matched' where id = new.transaction_id;
    elsif new.invoice_in_id is not null then
      update public.invoices_in set status = 'paid', paid_at = current_date
       where id = new.invoice_in_id;
      update public.bank_transactions set match_status = 'matched' where id = new.transaction_id;
    end if;
  end if;
  return new;
end $$;
create trigger trg_apply_payment_match after update on public.payment_matches
  for each row execute function public.apply_payment_match();

-- ---------- RLS (Finanz-Regel: kein Viewer) ----------
alter table public.bank_connections  enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.payment_matches   enable row level security;

create policy bank_conn_all on public.bank_connections for all
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy bank_tx_select on public.bank_transactions for select
  using (public.has_org_role(org_id, array['owner','admin','member']::public.org_role[]));
create policy pm_select on public.payment_matches for select
  using (public.has_org_role(org_id, array['owner','admin','member']::public.org_role[]));
create policy pm_update on public.payment_matches for update
  using (public.has_org_role(org_id, array['owner','admin','member']::public.org_role[]));

-- Neue Job-Typen für den Runner: 'bank_sync' (Connector), 'payment_match' (KI-Zuordnung:
-- Betrag + Rechnungsnummer/Name im Verwendungszweck + Fälligkeitsnähe).
-- Cron-Ergänzung (SQL Editor):
-- select cron.schedule('bank-sync',     '15 */4 * * *', $$select public.enqueue_org_jobs('bank_sync', 7)$$);
-- select cron.schedule('payment-match', '30 */4 * * *', $$select public.enqueue_org_jobs('payment_match', 7)$$);
