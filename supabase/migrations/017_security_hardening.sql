-- ============================================================
-- 017_security_hardening.sql — Etappe 0.5: Security & Robustheit
-- 1) Pairing härten: Rate-Limit pro IP, Fehlversuche pro Code,
--    Zwei-Stufen-Pairing (status 'pending_approval' + Freigabe-RPCs)
-- 2) Abo-Schutz: claim_next_job prüft max_jobs_per_hour,
--    daily_job_limit und quiet_hours (Nachtfenster)
-- 3) Runner-Heartbeat-Update in claim_next_job (ein Roundtrip)
-- 4) Regel-Engine light: org_rules + evaluate_org_rules
-- 5) Grants nachziehen: Runner-RPCs nur noch Service Role,
--    Client darf runners nur in erlaubten Spalten ändern
-- ============================================================

-- ============================================================
-- 1a) Rate-Limit auf /pair — Zählung pro IP-Hash und Minutenfenster.
--     Der Broker hasht die IP (SHA-256 mit Pepper); Klartext-IPs
--     landen nie in der Datenbank.
-- ============================================================
create table public.pairing_attempts (
  ip_hash      text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (ip_hash, window_start)
);
alter table public.pairing_attempts enable row level security;
-- Keine Policies: Zugriff ausschließlich über Service Role / definer-Funktion.

-- Atomarer Zähler: true = Versuch erlaubt, false = Limit (10/Minute) erreicht.
create or replace function public.register_pairing_attempt(p_ip_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  -- Opportunistisches Aufräumen alter Fenster (Tabelle bleibt winzig)
  delete from public.pairing_attempts where window_start < now() - interval '1 hour';

  insert into public.pairing_attempts (ip_hash, window_start, count)
  values (p_ip_hash, date_trunc('minute', now()), 1)
  on conflict (ip_hash, window_start)
    do update set count = pairing_attempts.count + 1
  returning count into v_count;

  return v_count <= 10;
end $$;
revoke execute on function public.register_pairing_attempt(text) from public, anon, authenticated;

-- ============================================================
-- 1b) Fehlversuche pro Pairing-Code.
--     Ein Fehlversuch ist ein /pair-Aufruf mit einem Code, der zwar
--     existiert, aber nicht (mehr) einlösbar ist (abgelaufen, bereits
--     eingelöst, gesperrt). Unbekannte Codes sind KEIN Fehlversuch —
--     das ist der normale Poll-Zustand des Runners, bevor der Nutzer
--     den Code in der PWA registriert; Brute-Force auf unbekannte
--     Codes fängt das IP-Rate-Limit (1a) ab.
--     Ab 5 Fehlversuchen ist der Code dauerhaft ungültig.
-- ============================================================
alter table public.runner_pairing_codes
  add column failed_attempts int not null default 0;

create or replace function public.register_pairing_failure(p_code text)
returns void language sql security definer set search_path = public as $$
  update public.runner_pairing_codes
     set failed_attempts = failed_attempts + 1
   where code = p_code;
$$;
revoke execute on function public.register_pairing_failure(text) from public, anon, authenticated;

-- ============================================================
-- 1c) Zwei-Stufen-Pairing: neuer Runner-Status 'pending_approval'.
--     /pair legt den Runner nur noch als pending_approval an; erst die
--     Bestätigung in der PWA (approve_runner) schaltet ihn frei.
-- ============================================================
alter table public.runners drop constraint runners_status_check;
alter table public.runners add constraint runners_status_check
  check (status in ('pending_approval','online','offline','disabled'));

alter table public.runners
  add column approved_by uuid references auth.users(id) on delete set null,
  add column approved_at timestamptz;

-- Freigabe/Ablehnung nur durch Owner/Admin der Org, mit Audit-Eintrag.
create or replace function public.approve_runner(p_runner_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_runner public.runners;
begin
  select * into v_runner from public.runners
   where id = p_runner_id and status = 'pending_approval';
  if not found then raise exception 'Runner nicht gefunden oder nicht freigabebedürftig'; end if;
  if not public.has_org_role(v_runner.org_id, array['owner','admin']::public.org_role[]) then
    raise exception 'Keine Berechtigung (Owner/Admin erforderlich)';
  end if;

  update public.runners
     set status = 'online', approved_by = (select auth.uid()), approved_at = now()
   where id = p_runner_id;

  insert into public.audit_log (org_id, actor_type, actor_id, action, entity_type, entity_id)
  values (v_runner.org_id, 'user', (select auth.uid()), 'runner.approved', 'runner', p_runner_id);
end $$;

create or replace function public.reject_runner(p_runner_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_runner public.runners;
begin
  select * into v_runner from public.runners where id = p_runner_id;
  if not found then raise exception 'Runner nicht gefunden'; end if;
  if not public.has_org_role(v_runner.org_id, array['owner','admin']::public.org_role[]) then
    raise exception 'Keine Berechtigung (Owner/Admin erforderlich)';
  end if;

  -- disabled statt löschen: Token wird sofort unbrauchbar, Vorgang bleibt nachvollziehbar.
  update public.runners set status = 'disabled' where id = p_runner_id;

  insert into public.audit_log (org_id, actor_type, actor_id, action, entity_type, entity_id)
  values (v_runner.org_id, 'user', (select auth.uid()), 'runner.rejected', 'runner', p_runner_id);
end $$;

-- ============================================================
-- 2) Abo-Schutz: Nachtfenster + Limits.
--    quiet_hours-Format: {"start":"22:00","end":"06:00","timezone":"Europe/Berlin"}
--    (timezone optional, Default = Org-Zeitzone). null = kein Fenster.
--    Semantik (Etappe 0.5):
--      priority <= 2  (interaktiv)  → läuft IMMER
--      priority 3–7   (Sync/Normal) → nur AUSSERHALB des Nachtfensters
--      priority >= 8  (Nacht-Batch) → NUR IM Nachtfenster, wenn eines
--                                     konfiguriert ist (sonst jederzeit)
-- ============================================================
alter table public.runners add column quiet_hours jsonb;

-- Zählbasis für die Limits: agent_job_events 'claimed' mit direkter
-- runner_id-Spalte (bisher nur in detail->>'runner' — nicht indexierbar).
alter table public.agent_job_events
  add column runner_id uuid references public.runners(id) on delete set null;
update public.agent_job_events
   set runner_id = nullif(detail->>'runner','')::uuid
 where event = 'claimed' and detail ? 'runner';
create index idx_job_events_runner_claimed
  on public.agent_job_events (runner_id, created_at desc)
  where event = 'claimed';

-- ============================================================
-- 2+3+4) claim_next_job v2:
--   - lehnt pending_approval/disabled ab
--   - aktualisiert last_heartbeat/status selbst (spart den zweiten
--     Roundtrip, den bisher der Broker machte)
--   - erzwingt max_jobs_per_hour / daily_job_limit (rollierende Fenster
--     60 Min / 24 h über agent_job_events 'claimed')
--   - respektiert quiet_hours nach obiger Semantik
-- ============================================================
create or replace function public.claim_next_job(p_runner_id uuid)
returns public.agent_jobs
language plpgsql security definer set search_path = public as $$
declare
  v_runner      public.runners;
  v_job         public.agent_jobs;
  v_now         timestamptz := now();
  v_has_window  boolean := false;
  v_in_window   boolean := false;
  v_tz          text;
  v_local       time;
  v_start       time;
  v_end         time;
  v_claims_hour int;
  v_claims_day  int;
begin
  select * into v_runner from public.runners where id = p_runner_id;
  if not found or v_runner.status in ('disabled','pending_approval') then
    raise exception 'Runner unbekannt, deaktiviert oder wartet auf Freigabe';
  end if;

  -- Heartbeat direkt hier (ein Roundtrip statt Extra-Update im Broker)
  update public.runners set last_heartbeat = v_now, status = 'online'
   where id = p_runner_id;

  -- Abo-Schutz: rollierende Fenster über die claimed-Ereignisse
  select count(*) into v_claims_hour from public.agent_job_events
   where runner_id = p_runner_id and event = 'claimed'
     and created_at > v_now - interval '1 hour';
  if v_claims_hour >= v_runner.max_jobs_per_hour then return null; end if;

  select count(*) into v_claims_day from public.agent_job_events
   where runner_id = p_runner_id and event = 'claimed'
     and created_at > v_now - interval '24 hours';
  if v_claims_day >= v_runner.daily_job_limit then return null; end if;

  -- Nachtfenster auswerten (inkl. Fenster über Mitternacht)
  if v_runner.quiet_hours ? 'start' and v_runner.quiet_hours ? 'end' then
    v_has_window := true;
    v_tz := coalesce(
      v_runner.quiet_hours->>'timezone',
      (select o.timezone from public.orgs o where o.id = v_runner.org_id),
      'Europe/Berlin');
    v_local := (v_now at time zone v_tz)::time;
    v_start := (v_runner.quiet_hours->>'start')::time;
    v_end   := (v_runner.quiet_hours->>'end')::time;
    if v_start <= v_end then
      v_in_window := v_local >= v_start and v_local < v_end;
    else
      v_in_window := v_local >= v_start or v_local < v_end;
    end if;
  end if;

  select * into v_job
    from public.agent_jobs
   where org_id = v_runner.org_id
     and status = 'queued'
     and run_after <= v_now
     and attempts < max_attempts
     and ( priority <= 2
           or not v_has_window
           or (priority >= 8 and v_in_window)
           or (priority between 3 and 7 and not v_in_window) )
   order by priority asc, created_at asc
   for update skip locked
   limit 1;

  if not found then return null; end if;

  update public.agent_jobs
     set status = 'claimed', claimed_by = p_runner_id,
         claimed_at = v_now, heartbeat_at = v_now, attempts = attempts + 1
   where id = v_job.id
   returning * into v_job;

  insert into public.agent_job_events (job_id, event, runner_id, detail)
  values (v_job.id, 'claimed', p_runner_id, jsonb_build_object('runner', p_runner_id));

  return v_job;
end $$;

-- job_heartbeat darf pending/disabled Runner nicht online schalten
create or replace function public.job_heartbeat(p_runner_id uuid, p_job_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.agent_jobs set heartbeat_at = now(), status = 'running'
   where id = p_job_id and claimed_by = p_runner_id and status in ('claimed','running');
  update public.runners set last_heartbeat = now(), status = 'online'
   where id = p_runner_id and status in ('online','offline');
$$;

-- Cron-Erzeuger: pending_approval zählt nicht als aktiver Runner
create or replace function public.enqueue_org_jobs(p_job_type text, p_priority int default 8)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.agent_jobs (org_id, job_type, priority, payload)
  select o.id, p_job_type, p_priority, jsonb_build_object('scope','org')
    from public.orgs o
   where o.deleted_at is null
     and exists (select 1 from public.runners r
                  where r.org_id = o.id and r.status not in ('disabled','pending_approval'))
     and not exists (
       select 1 from public.agent_jobs j
        where j.org_id = o.id and j.job_type = p_job_type
          and j.status in ('queued','claimed','running')
     );
  get diagnostics n = row_count;
  return n;
end $$;

-- ============================================================
-- 5) Grants nachziehen.
--    a) Runner-RPCs sind ausschließlich Sache der Broker-Edge-Function
--       (Service Role) — Clients haben dort nichts verloren.
--    b) runners: Client darf nur die Selbstschutz-Spalten ändern
--       (Limits, Nachtfenster, Name). Status/Token/Freigabe laufen
--       über Broker bzw. approve_runner/reject_runner. INSERT/DELETE
--       auf runners macht nur der Broker.
-- ============================================================
revoke execute on function public.claim_next_job(uuid) from public, anon, authenticated;
revoke execute on function public.job_heartbeat(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.complete_job(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.fail_job(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.release_stale_jobs() from public, anon, authenticated;
revoke execute on function public.enqueue_org_jobs(text, int) from public, anon, authenticated;

revoke insert, update, delete on public.runners from anon, authenticated;
grant update (name, max_jobs_per_hour, daily_job_limit, quiet_hours)
  on public.runners to authenticated;

-- ============================================================
-- 6) Regel-Engine light: org_rules + evaluate_org_rules.
--    conditions: Array von {"field":"category","op":"eq","value":"invoice"}
--      field  = Pfad in der Entity (Punktnotation, z. B. "mail.from")
--      op     = eq | neq | contains | gt | gte | lt | lte | in | exists | not_exists
--      value  = Vergleichswert (JSON)
--    Alle Bedingungen sind UND-verknüpft.
--    action: {"type":"create_job"|"notify"|"create_task", ...}
--    Aufruf aus Triggern/Jobs der Phasen 1–6:
--      select public.evaluate_org_rules(org_id, 'mail_received', jsonb-Entity);
-- ============================================================
create table public.org_rules (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  name          text not null,
  is_enabled    boolean not null default true,
  trigger_event text not null,          -- 'mail_received','invoice_captured','quote_sent','payment_matched',…
  conditions    jsonb not null default '[]'::jsonb,
  action        jsonb not null default '{}'::jsonb,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_org_rules_org on public.org_rules(org_id);
create index idx_org_rules_event on public.org_rules(org_id, trigger_event) where is_enabled;
create trigger trg_org_rules_updated before update on public.org_rules
  for each row execute function public.set_updated_at();

alter table public.org_rules enable row level security;
create policy org_rules_select on public.org_rules for select
  using (public.is_org_member(org_id));
create policy org_rules_insert on public.org_rules for insert
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy org_rules_update on public.org_rules for update
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy org_rules_delete on public.org_rules for delete
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- Eine einzelne Bedingung gegen die Entity prüfen
create or replace function public.rule_condition_matches(p_entity jsonb, p_cond jsonb)
returns boolean language plpgsql immutable as $$
declare
  v_field text := p_cond->>'field';
  v_op    text := coalesce(p_cond->>'op','eq');
  v_value jsonb := p_cond->'value';
  v_actual jsonb;
begin
  if v_field is null then return false; end if;
  v_actual := p_entity #> string_to_array(v_field, '.');

  case v_op
    when 'exists'     then return v_actual is not null and v_actual <> 'null'::jsonb;
    when 'not_exists' then return v_actual is null or v_actual = 'null'::jsonb;
    when 'eq'  then return v_actual is not distinct from v_value;
    when 'neq' then return v_actual is distinct from v_value;
    when 'contains' then
      return v_actual is not null and v_value is not null
        and position(lower(coalesce(v_value #>> '{}','')) in lower(coalesce(v_actual #>> '{}',''))) > 0;
    when 'in' then
      return v_value is not null and jsonb_typeof(v_value) = 'array' and v_actual is not null
        and exists (select 1 from jsonb_array_elements(v_value) e where e.value is not distinct from v_actual);
    when 'gt','gte','lt','lte' then
      if v_actual is null or v_value is null then return false; end if;
      if jsonb_typeof(v_actual) = 'number' and jsonb_typeof(v_value) = 'number' then
        return case v_op
          when 'gt'  then (v_actual #>> '{}')::numeric >  (v_value #>> '{}')::numeric
          when 'gte' then (v_actual #>> '{}')::numeric >= (v_value #>> '{}')::numeric
          when 'lt'  then (v_actual #>> '{}')::numeric <  (v_value #>> '{}')::numeric
          else            (v_actual #>> '{}')::numeric <= (v_value #>> '{}')::numeric
        end;
      end if;
      return case v_op
        when 'gt'  then (v_actual #>> '{}') >  (v_value #>> '{}')
        when 'gte' then (v_actual #>> '{}') >= (v_value #>> '{}')
        when 'lt'  then (v_actual #>> '{}') <  (v_value #>> '{}')
        else            (v_actual #>> '{}') <= (v_value #>> '{}')
      end;
    else
      return false;
  end case;
end $$;

-- Alle aktiven Regeln der Org für ein Ereignis auswerten und die
-- Aktionen ausführen. Rückgabe: Anzahl ausgeführter Regeln.
-- p_entity ist eine KOMPAKTE Referenz-Struktur (IDs + wenige Felder),
-- keine Volltexte (CLAUDE.md: payload = Referenzen).
create or replace function public.evaluate_org_rules(p_org uuid, p_event text, p_entity jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_rule     public.org_rules;
  v_cond     jsonb;
  v_matches  boolean;
  v_action   jsonb;
  v_type     text;
  v_executed int := 0;
  v_member   record;
begin
  for v_rule in
    select * from public.org_rules
     where org_id = p_org and trigger_event = p_event and is_enabled
     order by created_at asc
  loop
    v_matches := true;
    if jsonb_typeof(v_rule.conditions) = 'array' then
      for v_cond in select value from jsonb_array_elements(v_rule.conditions) loop
        if not public.rule_condition_matches(p_entity, v_cond) then
          v_matches := false;
          exit;
        end if;
      end loop;
    end if;
    if not v_matches then continue; end if;

    v_action := v_rule.action;
    v_type := v_action->>'type';

    if v_type = 'create_job' and (v_action->>'job_type') is not null then
      insert into public.agent_jobs (org_id, job_type, priority, payload)
      values (
        p_org,
        v_action->>'job_type',
        coalesce((v_action->>'priority')::int, 5),
        coalesce(v_action->'payload','{}'::jsonb)
          || jsonb_build_object('entity', p_entity, 'rule_id', v_rule.id, 'event', p_event)
      );

    elsif v_type = 'notify' then
      if (v_action->>'user_id') is not null then
        insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id)
        values (p_org, (v_action->>'user_id')::uuid, 'rule',
                coalesce(v_action->>'title', v_rule.name), v_action->>'body',
                p_entity->>'entity_type', nullif(p_entity->>'entity_id','')::uuid);
      else
        for v_member in
          select user_id from public.org_members where org_id = p_org and is_active
        loop
          insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id)
          values (p_org, v_member.user_id, 'rule',
                  coalesce(v_action->>'title', v_rule.name), v_action->>'body',
                  p_entity->>'entity_type', nullif(p_entity->>'entity_id','')::uuid);
        end loop;
      end if;

    elsif v_type = 'create_task' then
      insert into public.tasks (org_id, title, description, assignee_id, due_at, source,
                                source_entity_type, source_entity_id)
      values (
        p_org,
        coalesce(v_action->>'title', v_rule.name),
        v_action->>'description',
        nullif(v_action->>'assignee_id','')::uuid,
        case when (v_action->>'due_in_days') is not null
             then now() + ((v_action->>'due_in_days')::int || ' days')::interval end,
        'automation',
        p_entity->>'entity_type',
        nullif(p_entity->>'entity_id','')::uuid
      );

    else
      -- Unbekannter Aktionstyp: Regel überspringen (kein Fehler im Trigger-Pfad)
      continue;
    end if;

    v_executed := v_executed + 1;
    insert into public.audit_log (org_id, actor_type, action, entity_type, entity_id, detail)
    values (p_org, 'system', 'rule.executed', 'org_rule', v_rule.id,
            jsonb_build_object('event', p_event, 'action_type', v_type));
  end loop;

  return v_executed;
end $$;
revoke execute on function public.evaluate_org_rules(uuid, text, jsonb) from public, anon, authenticated;
