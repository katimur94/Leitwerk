-- ============================================================
-- 010_org_profile.sql — Firmen-Stammdaten & Workspace-Einstellungen
-- Jeder Workspace (Org) stellt hier SEINE Firma ein:
-- Rechtsdaten, Bankverbindung, Logo, Rechnungs-Defaults.
-- Diese Daten fließen in Angebote, Rechnungen (ZUGFeRD/XRechnung),
-- Mahnungen und Signaturen ein.
-- ============================================================

create table public.org_profile (
  org_id            uuid primary key references public.orgs(id) on delete cascade,
  -- Rechtliches
  legal_name        text not null default '',       -- "Muster GmbH"
  legal_form        text,                            -- GmbH, UG, e.K., Einzelunternehmen...
  owner_name        text,                            -- Geschäftsführer / Inhaber
  register_court    text,                            -- Amtsgericht
  register_number   text,                            -- HRB 12345
  vat_id            text,                            -- USt-IdNr. DE...
  tax_number        text,                            -- Steuernummer
  is_small_business boolean not null default false,  -- §19 UStG Kleinunternehmer
  -- Adresse & Kontakt
  street            text,
  zip               text,
  city              text,
  country           text not null default 'DE',
  phone             text,
  email             text,
  website           text,
  -- Bank (Pflicht für Rechnungen)
  bank_name         text,
  iban              text,
  bic               text,
  -- Branding
  logo_storage_path text,                            -- Bucket 'branding'
  brand_color       text not null default '#1E2A4A', -- Leitwerk-Tinte als Default
  -- Rechnungs-Defaults
  default_payment_terms_days int not null default 14,
  default_vat_rate  numeric(5,2) not null default 19.00,
  invoice_footer    text,                            -- Fußzeile auf allen Belegen
  quote_intro       text,                            -- Standard-Einleitung Angebote
  dunning_fees      jsonb not null default '{"1":0,"2":5.00,"3":10.00}'::jsonb,
  -- Onboarding-Status (steuert den Einrichtungs-Assistenten der PWA)
  onboarding        jsonb not null default '{
    "company_done": false,
    "mail_connected": false,
    "runner_paired": false,
    "number_ranges_done": false,
    "first_case_created": false
  }'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_org_profile_updated before update on public.org_profile
  for each row execute function public.set_updated_at();

-- Auto-Anlage bei Org-Erstellung (inkl. Standard-Nummernkreise & Standard-Automationen)
create or replace function public.handle_new_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.org_profile (org_id, legal_name) values (new.id, new.name);

  insert into public.number_ranges (org_id, kind, prefix, next_value, padding) values
    (new.id, 'case',    'V-'  || extract(year from now()) || '-', 1, 4),
    (new.id, 'quote',   'AN-' || extract(year from now()) || '-', 1, 4),
    (new.id, 'invoice', 'RE-' || extract(year from now()) || '-', 1, 4),
    (new.id, 'dunning', 'MA-' || extract(year from now()) || '-', 1, 4);

  -- Standard-Automationen, alle auf Stufe 1 (nur Vorschläge) — Vertrauen wird verdient
  insert into public.automations (org_id, key, name, description, autonomy_level) values
    (new.id, 'auto_label_mail',      'Mails kategorisieren', 'Ordnet eingehende Mails automatisch Kategorien zu.', 1),
    (new.id, 'auto_case_match',      'Vorgangs-Zuordnung',   'Hängt Mails, Dokumente und Termine an den passenden Vorgang.', 1),
    (new.id, 'auto_extract_tasks',   'Aufgaben aus Mails',   'Erkennt Verpflichtungen und Fristen in Mails und schlägt Aufgaben vor.', 1),
    (new.id, 'auto_capture_invoice', 'Rechnungserfassung',   'Erfasst Eingangsrechnungen aus Anhängen automatisch.', 1),
    (new.id, 'auto_followup',        'Nachfassen',           'Erstellt Nachfass-Entwürfe für unbeantwortete Angebote und Mails.', 1),
    (new.id, 'auto_dunning',         'Mahnwesen',            'Schlägt Mahnungen für überfällige Rechnungen vor.', 1),
    (new.id, 'auto_send_reply',      'Antworten senden',     'Sendet KI-Antwortentwürfe (nur nach Hochstufung!).', 1);

  return new;
end $$;
create trigger trg_on_org_created
  after insert on public.orgs
  for each row execute function public.handle_new_org();

-- ---------- RLS ----------
alter table public.org_profile enable row level security;
create policy org_profile_select on public.org_profile for select
  using (public.is_org_member(org_id));
create policy org_profile_update on public.org_profile for update
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
