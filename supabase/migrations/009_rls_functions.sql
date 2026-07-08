-- ============================================================
-- 009_rls_functions.sql — RLS, Helper, Job-Claim-RPC, Cron
-- Muster: (select auth.uid()) statt auth.uid() direkt,
-- damit Postgres den Wert EINMAL pro Query auswertet (Initplan-Problem vermeiden).
-- ============================================================

-- ---------- Helper ----------
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org
      and m.user_id = (select auth.uid())
      and m.is_active
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_roles public.org_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org
      and m.user_id = (select auth.uid())
      and m.is_active
      and m.role = any(p_roles)
  );
$$;

-- ---------- RLS aktivieren ----------
do $$
declare t text;
begin
  foreach t in array array[
    'orgs','profiles','org_members','org_invites','audit_log',
    'runners','runner_pairing_codes','agent_jobs','agent_job_events','ai_style_profiles',
    'mail_accounts','mail_threads','mail_messages','mail_attachments','mail_drafts','mail_templates',
    'companies','contacts','cases','case_links','case_events',
    'tasks','task_checklist_items','calendar_accounts','calendar_events',
    'notifications','push_subscriptions','snoozes',
    'number_ranges','invoices_in','invoices_out','invoice_items','quotes','quote_items','dunning_runs',
    'documents','notes','knowledge_items','embeddings','meetings','meeting_segments',
    'automations','automation_runs','trust_stats','agent_findings','briefings','followups'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------- Kern-Policies ----------
-- orgs: Mitglieder lesen; Owner/Admin ändern; jeder Authentifizierte darf anlegen
create policy orgs_select on public.orgs for select
  using (public.is_org_member(id));
create policy orgs_insert on public.orgs for insert
  with check ((select auth.uid()) = created_by);
create policy orgs_update on public.orgs for update
  using (public.has_org_role(id, array['owner','admin']::public.org_role[]));
create policy orgs_delete on public.orgs for delete
  using (public.has_org_role(id, array['owner']::public.org_role[]));

-- profiles: nur eigenes Profil
create policy profiles_select on public.profiles for select
  using (id = (select auth.uid()));
create policy profiles_update on public.profiles for update
  using (id = (select auth.uid()));

-- org_members
create policy members_select on public.org_members for select
  using (public.is_org_member(org_id));
create policy members_write on public.org_members for all
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- org_invites: nur Admin/Owner
create policy invites_all on public.org_invites for all
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));

-- audit_log: Mitglieder lesen, INSERT nur über definer-Funktionen/Service-Role — kein direktes Schreiben
create policy audit_select on public.audit_log for select
  using (public.is_org_member(org_id));
revoke insert, update, delete on public.audit_log from authenticated;

-- ---------- Generische org-scoped Policies für Standard-Tabellen ----------
-- (SELECT für alle Mitglieder; Schreibrechte für owner/admin/member — viewer nur lesen)
do $$
declare t text;
begin
  foreach t in array array[
    'mail_accounts','mail_threads','mail_messages','mail_attachments','mail_drafts','mail_templates',
    'companies','contacts','cases','case_links','case_events',
    'tasks','calendar_accounts','calendar_events','snoozes',
    'documents','notes','knowledge_items','meetings','meeting_segments',
    'automations','agent_findings','followups','runners','ai_style_profiles'
  ] loop
    execute format($f$
      create policy %1$s_select on public.%1$I for select
        using (public.is_org_member(org_id));
      create policy %1$s_insert on public.%1$I for insert
        with check (public.has_org_role(org_id, array['owner','admin','member']::public.org_role[]));
      create policy %1$s_update on public.%1$I for update
        using (public.has_org_role(org_id, array['owner','admin','member']::public.org_role[]));
      create policy %1$s_delete on public.%1$I for delete
        using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
    $f$, t);
  end loop;
end $$;

-- ---------- Finanzen: Viewer sieht KEINE Finanzdaten ----------
do $$
declare t text;
begin
  foreach t in array array['invoices_in','invoices_out','quotes','dunning_runs','number_ranges'] loop
    execute format($f$
      create policy %1$s_select on public.%1$I for select
        using (public.has_org_role(org_id, array['owner','admin','member']::public.org_role[]));
      create policy %1$s_write on public.%1$I for all
        using (public.has_org_role(org_id, array['owner','admin','member']::public.org_role[]))
        with check (public.has_org_role(org_id, array['owner','admin','member']::public.org_role[]));
    $f$, t);
  end loop;
end $$;

-- Positions-Tabellen erben über Parent (kein org_id): über EXISTS auf Parent
create policy inv_items_all on public.invoice_items for all
  using (exists (select 1 from public.invoices_out i where i.id = invoice_id
                 and public.has_org_role(i.org_id, array['owner','admin','member']::public.org_role[])));
create policy quote_items_all on public.quote_items for all
  using (exists (select 1 from public.quotes q where q.id = quote_id
                 and public.has_org_role(q.org_id, array['owner','admin','member']::public.org_role[])));
create policy checklist_all on public.task_checklist_items for all
  using (exists (select 1 from public.tasks t where t.id = task_id
                 and public.is_org_member(t.org_id)));

-- ---------- Persönliche Tabellen ----------
create policy notif_select on public.notifications for select
  using (user_id = (select auth.uid()));
create policy notif_update on public.notifications for update
  using (user_id = (select auth.uid()));
create policy push_all on public.push_subscriptions for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy pairing_all on public.runner_pairing_codes for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------- Jobs, Runs, Stats, Briefings, Embeddings ----------
create policy jobs_select on public.agent_jobs for select
  using (public.is_org_member(org_id));
create policy jobs_insert on public.agent_jobs for insert
  with check (public.has_org_role(org_id, array['owner','admin','member']::public.org_role[]));
-- UPDATE (claim/result) läuft NUR über Edge Function (Service Role) bzw. RPCs unten.
create policy job_events_select on public.agent_job_events for select
  using (exists (select 1 from public.agent_jobs j where j.id = job_id and public.is_org_member(j.org_id)));
create policy auto_runs_select on public.automation_runs for select
  using (public.is_org_member(org_id));
create policy auto_runs_update on public.automation_runs for update
  using (public.has_org_role(org_id, array['owner','admin','member']::public.org_role[]));
create policy trust_select on public.trust_stats for select
  using (public.is_org_member(org_id));
create policy briefings_select on public.briefings for select
  using (public.is_org_member(org_id) and (user_id is null or user_id = (select auth.uid())));
create policy briefings_update on public.briefings for update
  using (user_id = (select auth.uid()));
create policy embeddings_select on public.embeddings for select
  using (public.is_org_member(org_id));
-- embeddings-Schreibzugriff nur via Runner/Service Role

-- ============================================================
-- RPCs für den Runner (aufgerufen durch Edge Function `runner-broker`
-- mit Service Role; p_runner_id wurde dort bereits gegen Token verifiziert)
-- ============================================================

create or replace function public.claim_next_job(p_runner_id uuid)
returns public.agent_jobs
language plpgsql security definer set search_path = public as $$
declare v_runner public.runners; v_job public.agent_jobs;
begin
  select * into v_runner from public.runners
   where id = p_runner_id and status <> 'disabled';
  if not found then raise exception 'Runner unbekannt oder deaktiviert'; end if;

  select * into v_job
    from public.agent_jobs
   where org_id = v_runner.org_id
     and status = 'queued'
     and run_after <= now()
     and attempts < max_attempts
   order by priority asc, created_at asc
   for update skip locked
   limit 1;

  if not found then return null; end if;

  update public.agent_jobs
     set status = 'claimed', claimed_by = p_runner_id,
         claimed_at = now(), heartbeat_at = now(), attempts = attempts + 1
   where id = v_job.id
   returning * into v_job;

  insert into public.agent_job_events (job_id, event, detail)
  values (v_job.id, 'claimed', jsonb_build_object('runner', p_runner_id));

  return v_job;
end $$;

create or replace function public.job_heartbeat(p_runner_id uuid, p_job_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.agent_jobs set heartbeat_at = now(), status = 'running'
   where id = p_job_id and claimed_by = p_runner_id and status in ('claimed','running');
  update public.runners set last_heartbeat = now(), status = 'online'
   where id = p_runner_id;
$$;

create or replace function public.complete_job(
  p_runner_id uuid, p_job_id uuid, p_result jsonb, p_result_hash text
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.agent_jobs
     set status = 'done', result = p_result, result_hash = p_result_hash, error = null
   where id = p_job_id and claimed_by = p_runner_id;
  insert into public.agent_job_events (job_id, event) values (p_job_id, 'done');
end $$;

create or replace function public.fail_job(p_runner_id uuid, p_job_id uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare v_job public.agent_jobs;
begin
  select * into v_job from public.agent_jobs where id = p_job_id and claimed_by = p_runner_id;
  if not found then return; end if;
  if v_job.attempts >= v_job.max_attempts then
    update public.agent_jobs set status = 'failed', error = p_error where id = p_job_id;
    insert into public.agent_job_events (job_id, event, detail)
    values (p_job_id, 'failed', jsonb_build_object('error', p_error));
  else
    -- Backoff: 2^attempts Minuten
    update public.agent_jobs
       set status = 'queued', claimed_by = null, claimed_at = null,
           run_after = now() + (power(2, v_job.attempts)::text || ' minutes')::interval,
           error = p_error
     where id = p_job_id;
    insert into public.agent_job_events (job_id, event, detail)
    values (p_job_id, 'retry', jsonb_build_object('error', p_error));
  end if;
end $$;

-- Watchdog: hängende Jobs freigeben (Heartbeat > 2× max_runtime)
create or replace function public.release_stale_jobs()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with released as (
    update public.agent_jobs
       set status = 'queued', claimed_by = null, claimed_at = null
     where status in ('claimed','running')
       and heartbeat_at < now() - (max_runtime_sec * 2 || ' seconds')::interval
     returning id
  )
  select count(*) into n from released;

  update public.runners set status = 'offline'
   where status = 'online' and last_heartbeat < now() - interval '3 minutes';
  return n;
end $$;

-- ---------- Job-Erzeuger für Cron ----------
create or replace function public.enqueue_org_jobs(p_job_type text, p_priority int default 8)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.agent_jobs (org_id, job_type, priority, payload)
  select o.id, p_job_type, p_priority, jsonb_build_object('scope','org')
    from public.orgs o
   where o.deleted_at is null
     and exists (select 1 from public.runners r where r.org_id = o.id and r.status <> 'disabled')
     and not exists (
       select 1 from public.agent_jobs j
        where j.org_id = o.id and j.job_type = p_job_type
          and j.status in ('queued','claimed','running')
     );
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- pg_cron (Extension im Dashboard aktivieren) ----------
-- select cron.schedule('watchdog',        '* * * * *',    $$select public.release_stale_jobs()$$);
-- select cron.schedule('gap-scan',        '0 3 * * *',    $$select public.enqueue_org_jobs('gap_scan', 8)$$);
-- select cron.schedule('morning-brief',   '30 5 * * 1-5', $$select public.enqueue_org_jobs('morning_briefing', 6)$$);
-- select cron.schedule('followup-check',  '0 * * * *',    $$select public.enqueue_org_jobs('followup_check', 7)$$);
-- select cron.schedule('weekly-report',   '0 15 * * 5',   $$select public.enqueue_org_jobs('weekly_report', 8)$$);
-- select cron.schedule('style-profiles',  '0 4 * * 0',    $$select public.enqueue_org_jobs('build_style_profile', 9)$$);
-- select cron.schedule('knowledge',       '0 4 * * 6',    $$select public.enqueue_org_jobs('knowledge_distill', 9)$$);
