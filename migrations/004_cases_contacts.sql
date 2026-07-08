-- ============================================================
-- 004_cases_contacts.sql — Vorgangsakten & Kontakte (Herzstück)
-- ============================================================

-- ---------- Firmen ----------
create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  name        text not null,
  domain      text,                                  -- fürs Auto-Matching per Mail-Domain
  address     jsonb,                                 -- {street, zip, city, country}
  vat_id      text,
  phone       text,
  notes       text,                                  -- Beziehungswissen, KI-lesbar
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_companies_org on public.companies(org_id);
create index idx_companies_domain on public.companies(org_id, lower(domain));
create index idx_companies_name_trgm on public.companies using gin(name gin_trgm_ops);
create trigger trg_companies_updated before update on public.companies
  for each row execute function public.set_updated_at();

-- ---------- Kontakte ----------
create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  company_id  uuid references public.companies(id) on delete set null,
  first_name  text,
  last_name   text,
  email       text,
  phone       text,
  role_title  text,                                  -- "Bauleiter", "Buchhaltung"
  address     jsonb,
  notes       text,                                  -- Beziehungswissen
  source      text not null default 'manual' check (source in ('manual','mail_auto','import')),
  confidence  real,                                  -- bei mail_auto: Extraktions-Konfidenz
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_contacts_org on public.contacts(org_id);
create index idx_contacts_email on public.contacts(org_id, lower(email));
create index idx_contacts_company on public.contacts(company_id);
create trigger trg_contacts_updated before update on public.contacts
  for each row execute function public.set_updated_at();

-- ---------- Vorgänge (Cases) ----------
create type public.case_status as enum ('open','waiting','done','archived');

create table public.cases (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  case_number  text not null,                        -- aus Nummernkreis (006), z.B. "V-2026-0142"
  title        text not null,
  status       public.case_status not null default 'open',
  company_id   uuid references public.companies(id) on delete set null,
  contact_id   uuid references public.contacts(id) on delete set null,
  owner_id     uuid references auth.users(id) on delete set null,   -- zuständig im Team
  tags         text[] not null default '{}',
  reference    text,                                 -- externes Aktenzeichen/Projektnr.
  ai_summary   text,                                 -- "Stand in 5 Sätzen"
  ai_summary_at timestamptz,
  expected_value numeric(12,2),                      -- Pipeline-Wert (aus Angeboten)
  last_activity_at timestamptz not null default now(),
  waiting_until timestamptz,                         -- bei status='waiting'
  created_by   uuid references auth.users(id) on delete set null,
  source       text not null default 'manual' check (source in ('manual','ai_auto')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (org_id, case_number)
);
create index idx_cases_org_status on public.cases(org_id, status, last_activity_at desc);
create index idx_cases_company on public.cases(company_id);
create index idx_cases_contact on public.cases(contact_id);
create index idx_cases_owner on public.cases(owner_id);
create index idx_cases_title_trgm on public.cases using gin(title gin_trgm_ops);
create trigger trg_cases_updated before update on public.cases
  for each row execute function public.set_updated_at();

-- FK von mail_threads.case_id jetzt nachziehen (Tabelle existiert erst jetzt):
alter table public.mail_threads
  add constraint fk_threads_case foreign key (case_id)
  references public.cases(id) on delete set null;

-- ---------- Polymorphe Verknüpfung: alles hängt am Vorgang ----------
create table public.case_links (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  case_id      uuid not null references public.cases(id) on delete cascade,
  entity_type  text not null check (entity_type in
                ('mail_thread','document','invoice_in','invoice_out','quote',
                 'task','calendar_event','note','meeting','contact')),
  entity_id    uuid not null,
  linked_by    text not null default 'ai' check (linked_by in ('ai','user')),
  confidence   real,                                 -- KI-Zuordnungs-Konfidenz
  job_id       uuid references public.agent_jobs(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (case_id, entity_type, entity_id)
);
create index idx_case_links_case on public.case_links(case_id);
create index idx_case_links_entity on public.case_links(entity_type, entity_id);
create index idx_case_links_org on public.case_links(org_id);

-- ---------- Vorgangs-Timeline (Ereignisse, denormalisiert für schnelle Anzeige) ----------
create table public.case_events (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.orgs(id) on delete cascade,
  case_id      uuid not null references public.cases(id) on delete cascade,
  event_type   text not null,       -- 'mail_in','mail_out','task_done','invoice_sent','note_added','status_changed',...
  title        text not null,
  entity_type  text,
  entity_id    uuid,
  actor_type   text not null default 'user' check (actor_type in ('user','runner','system')),
  actor_id     uuid,
  occurred_at  timestamptz not null default now(),
  detail       jsonb not null default '{}'::jsonb
);
create index idx_case_events_case on public.case_events(case_id, occurred_at desc);
create index idx_case_events_org on public.case_events(org_id);

-- last_activity_at automatisch pflegen
create or replace function public.touch_case_activity()
returns trigger language plpgsql as $$
begin
  update public.cases set last_activity_at = new.occurred_at where id = new.case_id;
  return new;
end $$;
create trigger trg_case_events_touch after insert on public.case_events
  for each row execute function public.touch_case_activity();
