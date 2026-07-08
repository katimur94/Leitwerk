-- ============================================================
-- 014_calls.sql — Anrufprotokolle & Telefonnotizen
-- Stufe 1: manuelle Schnellerfassung (auch per Sprachnotiz).
-- Stufe 2 (später): Anbindung Telefonanlage/AB-Transkription.
-- ============================================================

create table public.call_logs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,   -- wer telefoniert hat
  contact_id    uuid references public.contacts(id) on delete set null,
  company_id    uuid references public.companies(id) on delete set null,
  case_id       uuid references public.cases(id) on delete set null,
  direction     text not null default 'inbound' check (direction in ('inbound','outbound','missed')),
  phone_number  text,
  occurred_at   timestamptz not null default now(),
  duration_sec  int,
  summary       text,                             -- Kurznotiz (manuell oder KI aus Transkript)
  transcript    text,                             -- optional: Sprachnotiz/AB via Whisper
  audio_storage_path text,                        -- Bucket 'audio'
  outcome       text,                             -- 'rueckruf_vereinbart','angebot_gewuenscht',...
  follow_up_task_id uuid references public.tasks(id) on delete set null,
  source        text not null default 'manual' check (source in ('manual','voice_note','pbx','answering_machine')),
  job_id        uuid references public.agent_jobs(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_calls_org_time on public.call_logs(org_id, occurred_at desc);
create index idx_calls_case on public.call_logs(case_id);
create index idx_calls_contact on public.call_logs(contact_id);
create index idx_calls_company on public.call_logs(company_id);
create index idx_calls_user on public.call_logs(user_id);
create index idx_calls_task on public.call_logs(follow_up_task_id);
create trigger trg_calls_updated before update on public.call_logs
  for each row execute function public.set_updated_at();

-- case_events-Typ 'call' + case_links entity_type erweitern
alter table public.case_links drop constraint case_links_entity_type_check;
alter table public.case_links add constraint case_links_entity_type_check
  check (entity_type in
    ('mail_thread','document','invoice_in','invoice_out','quote',
     'task','calendar_event','note','meeting','contact','call_log','contract'));

-- RLS
alter table public.call_logs enable row level security;
create policy calls_select on public.call_logs for select
  using (public.is_org_member(org_id));
create policy calls_write on public.call_logs for all
  using (public.has_org_role(org_id, array['owner','admin','member']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner','admin','member']::public.org_role[]));

-- Neue Job-Typen: 'transcribe_call' (Whisper lokal), 'summarize_call'
-- (Kurzfassung + outcome + Aufgaben-Vorschlag, hängt Anruf per case_match an Vorgang).
