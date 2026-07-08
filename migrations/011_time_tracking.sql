-- ============================================================
-- 011_time_tracking.sql — Zeiterfassung & Abwesenheiten
-- ============================================================

-- ---------- Zeiteinträge ----------
create table public.time_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  case_id     uuid references public.cases(id) on delete set null,
  task_id     uuid references public.tasks(id) on delete set null,
  work_date   date not null default current_date,
  started_at  timestamptz,                       -- optional (Timer-Modus)
  ended_at    timestamptz,
  minutes     int not null check (minutes > 0 and minutes <= 1440),
  description text,
  is_billable boolean not null default false,
  hourly_rate numeric(10,2),                     -- Snapshot bei Abrechnung
  invoice_id  uuid references public.invoices_out(id) on delete set null,  -- abgerechnet über
  source      text not null default 'manual' check (source in ('manual','timer','ai_suggested')),
  locked_at   timestamptz,                       -- nach Export/Abrechnung gesperrt
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_time_org_date on public.time_entries(org_id, work_date desc);
create index idx_time_user_date on public.time_entries(user_id, work_date desc);
create index idx_time_case on public.time_entries(case_id);
create index idx_time_task on public.time_entries(task_id);
create index idx_time_invoice on public.time_entries(invoice_id);
create trigger trg_time_updated before update on public.time_entries
  for each row execute function public.set_updated_at();

-- ---------- Arbeitszeitprofile (Soll-Stunden, Urlaubsanspruch) ----------
create table public.work_profiles (
  org_id           uuid not null references public.orgs(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  weekly_hours     numeric(5,2) not null default 40.00,
  workdays         int[] not null default '{1,2,3,4,5}',   -- ISO: 1=Mo … 7=So
  vacation_days_per_year numeric(5,2) not null default 30,
  valid_from       date not null default current_date,
  primary key (org_id, user_id, valid_from)
);
create index idx_work_profiles_user on public.work_profiles(user_id);

-- ---------- Abwesenheiten (Urlaub, Krank, …) ----------
create type public.absence_kind as enum ('vacation','sick','unpaid','special','training','home_office');
create type public.absence_status as enum ('requested','approved','rejected','cancelled');

create table public.absences (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         public.absence_kind not null,
  status       public.absence_status not null default 'requested',
  starts_on    date not null,
  ends_on      date not null,
  half_day_start boolean not null default false,
  half_day_end   boolean not null default false,
  days_counted numeric(5,2),                     -- berechnete anrechenbare Tage
  note         text,
  decided_by   uuid references auth.users(id) on delete set null,
  decided_at   timestamptz,
  sick_note_document_id uuid references public.documents(id) on delete set null,  -- AU-Bescheinigung
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index idx_absences_org_range on public.absences(org_id, starts_on, ends_on);
create index idx_absences_user on public.absences(user_id, starts_on desc);
create index idx_absences_pending on public.absences(org_id) where status = 'requested';
create index idx_absences_decided_by on public.absences(decided_by);
create index idx_absences_sick_note on public.absences(sick_note_document_id);
create trigger trg_absences_updated before update on public.absences
  for each row execute function public.set_updated_at();

-- ---------- Urlaubskonto (materialisiert pro Jahr) ----------
create table public.leave_balances (
  org_id        uuid not null references public.orgs(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  year          int not null,
  entitled_days numeric(5,2) not null,
  carried_over  numeric(5,2) not null default 0,
  taken_days    numeric(5,2) not null default 0,
  primary key (org_id, user_id, year)
);
create index idx_leave_user on public.leave_balances(user_id);

-- ---------- Feiertage (pro Org konfigurierbar, z.B. Bundesland) ----------
create table public.holidays (
  org_id   uuid not null references public.orgs(id) on delete cascade,
  day      date not null,
  name     text not null,
  primary key (org_id, day)
);

-- ---------- RLS ----------
alter table public.time_entries  enable row level security;
alter table public.work_profiles enable row level security;
alter table public.absences      enable row level security;
alter table public.leave_balances enable row level security;
alter table public.holidays      enable row level security;

-- Zeiteinträge: eigene voll, fremde nur admin/owner
create policy time_select on public.time_entries for select
  using (user_id = (select auth.uid())
         or public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy time_insert on public.time_entries for insert
  with check (user_id = (select auth.uid()) and public.is_org_member(org_id));
create policy time_update on public.time_entries for update
  using ((user_id = (select auth.uid()) and locked_at is null)
         or public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy time_delete on public.time_entries for delete
  using (user_id = (select auth.uid()) and locked_at is null);

-- Abwesenheiten: eigene anlegen/sehen, Team-Kalender sieht approved aller, Admin entscheidet
create policy absences_select on public.absences for select
  using (user_id = (select auth.uid())
         or public.has_org_role(org_id, array['owner','admin']::public.org_role[])
         or (public.is_org_member(org_id) and status = 'approved'));
create policy absences_insert on public.absences for insert
  with check (user_id = (select auth.uid()) and public.is_org_member(org_id));
create policy absences_update on public.absences for update
  using (user_id = (select auth.uid())
         or public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

create policy work_profiles_select on public.work_profiles for select
  using (user_id = (select auth.uid())
         or public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy work_profiles_write on public.work_profiles for all
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

create policy leave_select on public.leave_balances for select
  using (user_id = (select auth.uid())
         or public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy leave_write on public.leave_balances for all
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

create policy holidays_select on public.holidays for select
  using (public.is_org_member(org_id));
create policy holidays_write on public.holidays for all
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
