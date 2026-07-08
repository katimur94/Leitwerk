-- ============================================================
-- 005_tasks_calendar.sql — Aufgaben, Kalender, Benachrichtigungen
-- ============================================================

-- ---------- Aufgaben ----------
create type public.task_status as enum ('open','in_progress','done','cancelled');

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  case_id      uuid references public.cases(id) on delete set null,
  title        text not null,
  description  text,
  status       public.task_status not null default 'open',
  due_at       timestamptz,
  assignee_id  uuid references auth.users(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,   -- null = KI/System
  source       text not null default 'manual'
               check (source in ('manual','mail_extract','meeting','watcher','automation')),
  source_entity_type text,                       -- z.B. 'mail_message'
  source_entity_id   uuid,
  job_id       uuid references public.agent_jobs(id) on delete set null,
  recurrence   jsonb,                            -- RRULE-ähnlich für wiederkehrende Aufgaben
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_tasks_org_status on public.tasks(org_id, status, due_at);
create index idx_tasks_case on public.tasks(case_id);
create index idx_tasks_assignee on public.tasks(assignee_id) where status in ('open','in_progress');
create trigger trg_tasks_updated before update on public.tasks
  for each row execute function public.set_updated_at();

create table public.task_checklist_items (
  id        uuid primary key default gen_random_uuid(),
  task_id   uuid not null references public.tasks(id) on delete cascade,
  title     text not null,
  is_done   boolean not null default false,
  position  int not null default 0
);
create index idx_checklist_task on public.task_checklist_items(task_id);

-- ---------- Kalender-Konten & Termine ----------
create table public.calendar_accounts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  provider        text not null default 'google' check (provider in ('google','ics')),
  calendar_ref    text not null,                   -- Google calendarId oder ICS-URL
  vault_secret_id uuid,                            -- OAuth im Vault (bei google, meist gleicher Grant wie Gmail)
  sync_cursor     text,                            -- Google syncToken
  sync_state      text not null default 'pending' check (sync_state in ('pending','ok','error')),
  last_sync_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique (user_id, provider, calendar_ref)
);
create index idx_cal_accounts_org on public.calendar_accounts(org_id);

create table public.calendar_events (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  account_id     uuid not null references public.calendar_accounts(id) on delete cascade,
  provider_event_id text,
  case_id        uuid references public.cases(id) on delete set null,
  title          text not null,
  description    text,
  location       text,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  all_day        boolean not null default false,
  attendees      jsonb not null default '[]'::jsonb,
  ai_briefing    text,                             -- Kontext-Briefing vor dem Termin
  ai_briefing_at timestamptz,
  status         text not null default 'confirmed' check (status in ('confirmed','tentative','cancelled')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (account_id, provider_event_id)
);
create index idx_events_org_time on public.calendar_events(org_id, starts_at);
create index idx_events_case on public.calendar_events(case_id);
create trigger trg_events_updated before update on public.calendar_events
  for each row execute function public.set_updated_at();

-- ---------- Benachrichtigungen ----------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null,        -- 'finding','followup_due','invoice_overdue','runner_offline','mention',...
  title        text not null,
  body         text,
  entity_type  text,
  entity_id    uuid,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index idx_notif_user_unread on public.notifications(user_id, created_at desc) where read_at is null;
create index idx_notif_org on public.notifications(org_id);

-- ---------- Web-Push-Subscriptions ----------
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  keys       jsonb not null,                       -- p256dh + auth
  user_agent text,
  created_at timestamptz not null default now()
);
create index idx_push_user on public.push_subscriptions(user_id);

-- ---------- Snooze (auf beliebigen Entitäten) ----------
create table public.snoozes (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  entity_type  text not null,                      -- 'mail_thread','task','case','finding'
  entity_id    uuid not null,
  until_at     timestamptz not null,
  created_at   timestamptz not null default now(),
  unique (user_id, entity_type, entity_id)
);
create index idx_snoozes_due on public.snoozes(until_at);
create index idx_snoozes_org on public.snoozes(org_id);
