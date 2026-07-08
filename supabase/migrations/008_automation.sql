-- ============================================================
-- 008_automation.sql — Autonomie-Regler, Wächter, Briefings, Follow-ups
-- ============================================================

-- ---------- Automationen (mit Autonomie-Stufen 1–4) ----------
-- Stufe 1: KI schlägt vor, Mensch klickt
-- Stufe 2: KI bereitet vollständig vor, Mensch gibt frei
-- Stufe 3: KI führt aus, Halte-Zone (stoppbar), dann Ausführung
-- Stufe 4: KI führt autonom aus, meldet nur Ausnahmen
create table public.automations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  key             text not null,          -- 'auto_label_mail','auto_case_match','auto_reply_followup',
                                          -- 'auto_capture_invoice','auto_dunning','auto_send_reply',...
  name            text not null,
  description     text,
  autonomy_level  smallint not null default 1 check (autonomy_level between 1 and 4),
  hold_minutes    int not null default 15,          -- Halte-Zone bei Stufe 3
  is_enabled      boolean not null default true,
  config          jsonb not null default '{}'::jsonb,  -- Schwellen, Filter, Vorlagen
  min_confidence  real not null default 0.9,        -- KI-Konfidenz-Schwelle für autonome Ausführung
  promote_threshold real not null default 0.95,     -- Trefferquote, ab der Hochstufung angeboten wird
  promote_min_runs  int not null default 30,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, key)
);
create index idx_automations_org on public.automations(org_id);
create trigger trg_automations_updated before update on public.automations
  for each row execute function public.set_updated_at();

-- ---------- Ausführungsprotokoll ----------
create table public.automation_runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  job_id        uuid references public.agent_jobs(id) on delete set null,
  entity_type   text,
  entity_id     uuid,
  action        text not null,                     -- was getan/vorgeschlagen wurde
  autonomy_level smallint not null,
  confidence    real,
  status        text not null default 'proposed'
                check (status in ('proposed','approved','holding','executed','stopped','rejected','failed')),
  hold_until    timestamptz,                       -- Ende der Halte-Zone (Stufe 3)
  decided_by    uuid references auth.users(id) on delete set null,
  -- Feedback-Schleife für Trefferquote:
  outcome       text check (outcome in ('correct','corrected','wrong')),
  outcome_by    uuid references auth.users(id) on delete set null,
  outcome_at    timestamptz,
  detail        jsonb not null default '{}'::jsonb,
  executed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index idx_auto_runs_org on public.automation_runs(org_id, created_at desc);
create index idx_auto_runs_automation on public.automation_runs(automation_id, created_at desc);
create index idx_auto_runs_holding on public.automation_runs(hold_until) where status = 'holding';

-- ---------- Trefferquoten (materialisiert für schnelle Anzeige) ----------
create table public.trust_stats (
  automation_id  uuid primary key references public.automations(id) on delete cascade,
  org_id         uuid not null references public.orgs(id) on delete cascade,
  total_runs     int not null default 0,
  correct_runs   int not null default 0,
  last_50_correct int not null default 0,          -- rollierendes Fenster
  last_50_total   int not null default 0,
  accuracy       real generated always as
                 (case when total_runs = 0 then null else correct_runs::real / total_runs end) stored,
  updated_at     timestamptz not null default now()
);
create index idx_trust_org on public.trust_stats(org_id);

-- ---------- Wächter-Findings (Lücken, Widersprüche, Liegengebliebenes) ----------
create type public.finding_kind as enum ('gap','contradiction','stale','risk','opportunity');

create table public.agent_findings (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  case_id       uuid references public.cases(id) on delete cascade,
  kind          public.finding_kind not null,
  severity      smallint not null default 3 check (severity between 1 and 5),  -- 1 = kritisch
  title         text not null,
  description   text,
  suggested_action jsonb,                          -- {type:'draft_reply', payload:{...}}
  entity_type   text,
  entity_id     uuid,
  job_id        uuid references public.agent_jobs(id) on delete set null,
  status        text not null default 'open'
                check (status in ('open','acknowledged','resolved','dismissed','snoozed')),
  resolved_by   uuid references auth.users(id) on delete set null,
  resolved_at   timestamptz,
  dedupe_key    text,                              -- verhindert tägliche Wiederholung desselben Findings
  created_at    timestamptz not null default now(),
  unique (org_id, dedupe_key)
);
create index idx_findings_org_open on public.agent_findings(org_id, severity, created_at desc)
  where status = 'open';
create index idx_findings_case on public.agent_findings(case_id);

-- ---------- Briefings (Morgen-Briefing, Wochenreport) ----------
create table public.briefings (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,   -- null = Org-weit
  kind        text not null check (kind in ('morning','weekly')),
  for_date    date not null,
  content_md  text not null,
  items       jsonb not null default '[]'::jsonb,  -- strukturierte Punkte mit Entity-Links
  job_id      uuid references public.agent_jobs(id) on delete set null,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (org_id, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, for_date)
);
create index idx_briefings_org on public.briefings(org_id, for_date desc);

-- ---------- Follow-up-Engine ----------
create table public.followups (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  case_id       uuid references public.cases(id) on delete set null,
  entity_type   text not null check (entity_type in ('mail_thread','quote','invoice_out')),
  entity_id     uuid not null,
  expected_by   timestamptz not null,              -- "Antwort erwartet bis"
  reason        text,                              -- KI-Begründung der Frist
  status        text not null default 'waiting'
                check (status in ('waiting','answered','escalated','done','cancelled')),
  reminder_draft_id uuid references public.mail_drafts(id) on delete set null,
  answered_at   timestamptz,
  created_by    text not null default 'ai' check (created_by in ('ai','user')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (entity_type, entity_id)
);
create index idx_followups_due on public.followups(org_id, expected_by) where status = 'waiting';
create index idx_followups_case on public.followups(case_id);
create trigger trg_followups_updated before update on public.followups
  for each row execute function public.set_updated_at();
