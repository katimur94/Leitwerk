-- ============================================================
-- 019_p2_tasks_watchdog.sql — Etappe 2: Aufgaben-Compiler,
-- Follow-up-Engine, Nacht-Wächter, Morgen-Briefing, Web-Push
-- 1) extract_commitments: Job bei neuer Inbound-Mail + Anwendung
-- 2) Ereignisse task_created / finding_created durch die Regel-Engine
-- 3) Follow-up-Engine: Anlage bei Outbound, Erledigung bei Antwort,
--    Eskalation durch followup_check
-- 4) gap_scan → agent_findings (dedupe_key), morning_briefing → briefings
-- 5) Web-Push: notifications.pushed_at + Benachrichtigungs-Fanout
-- ============================================================

-- ---------- 5) Web-Push-Versand-Queue ----------
alter table public.notifications add column pushed_at timestamptz;
create index idx_notif_unpushed on public.notifications(created_at)
  where pushed_at is null;

-- Fanout-Helfer: Benachrichtigung an alle aktiven Mitglieder einer Org
create or replace function public.notify_org(
  p_org uuid, p_kind text, p_title text, p_body text,
  p_entity_type text default null, p_entity_id uuid default null
) returns void language sql security definer set search_path = public as $$
  insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id)
  select p_org, m.user_id, p_kind, p_title, p_body, p_entity_type, p_entity_id
    from public.org_members m
   where m.org_id = p_org and m.is_active;
$$;
revoke execute on function public.notify_org(uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- ---------- 2) Ereignisse durch die Regel-Engine + Benachrichtigungen ----------
create or replace function public.on_task_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.evaluate_org_rules(new.org_id, 'task_created', jsonb_build_object(
    'entity_type', 'task', 'entity_id', new.id,
    'title', new.title, 'source', new.source,
    'assignee_id', new.assignee_id, 'due_at', new.due_at
  ));
  -- Zuweisung benachrichtigt die zugewiesene Person (nicht den Ersteller selbst)
  if new.assignee_id is not null and new.assignee_id is distinct from new.created_by then
    insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id)
    values (new.org_id, new.assignee_id, 'task_assigned',
            'Aufgabe zugewiesen: ' || new.title, null, 'task', new.id);
  end if;
  return new;
end $$;
create trigger trg_task_created after insert on public.tasks
  for each row execute function public.on_task_created();

create or replace function public.on_finding_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.evaluate_org_rules(new.org_id, 'finding_created', jsonb_build_object(
    'entity_type', 'agent_finding', 'entity_id', new.id,
    'kind', new.kind, 'severity', new.severity, 'title', new.title
  ));
  -- Kritische Findings (Severity 1–2) sofort melden, Rest kommt ins Briefing
  if new.severity <= 2 then
    perform public.notify_org(new.org_id, 'finding', new.title, new.description,
                              'agent_finding', new.id);
  end if;
  return new;
end $$;
create trigger trg_finding_created after insert on public.agent_findings
  for each row execute function public.on_finding_created();

-- ---------- 1+3) on_mail_received v2: extract_commitments + Follow-up-Erledigung ----------
create or replace function public.on_mail_received()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_thread public.mail_threads;
  v_from_email text := lower(coalesce(new.from_addr->>'email',''));
  v_from_name  text := coalesce(new.from_addr->>'name','');
  v_contact_id uuid;
  v_auto public.automations;
begin
  update public.mail_threads
     set message_count   = message_count + 1,
         last_message_at = greatest(coalesce(last_message_at, new.sent_at), new.sent_at),
         snippet         = left(regexp_replace(coalesce(new.body_text, ''), '\s+', ' ', 'g'), 140),
         is_unread       = true
   where id = new.thread_id
   returning * into v_thread;

  if v_from_email <> '' then
    select id into v_contact_id from public.contacts
     where org_id = new.org_id and lower(email) = v_from_email limit 1;
    if v_contact_id is null then
      insert into public.contacts (org_id, first_name, last_name, email, source, confidence)
      values (
        new.org_id,
        nullif(split_part(v_from_name, ' ', 1), ''),
        nullif(nullif(regexp_replace(v_from_name, '^\S+\s*', ''), v_from_name), ''),
        v_from_email, 'mail_auto', 0.6
      );
    end if;
  end if;

  if v_thread.case_id is not null then
    insert into public.case_events (org_id, case_id, event_type, title, entity_type, entity_id, actor_type)
    values (new.org_id, v_thread.case_id, 'mail_in',
            coalesce(nullif(new.subject,''), 'Neue E-Mail'), 'mail_message', new.id, 'system');
  end if;

  -- Etappe 2: Antwort eingetroffen → wartende Follow-ups des Threads erledigen
  update public.followups
     set status = 'answered', answered_at = now()
   where org_id = new.org_id and entity_type = 'mail_thread'
     and entity_id = new.thread_id and status = 'waiting';

  v_auto := public.get_automation(new.org_id, 'auto_label_mail');
  if v_auto.id is not null and not exists (
    select 1 from public.agent_jobs
     where org_id = new.org_id and job_type = 'classify_email'
       and payload->>'message_id' = new.id::text
  ) then
    insert into public.agent_jobs (org_id, job_type, priority, payload)
    values (new.org_id, 'classify_email', 5,
            jsonb_build_object('message_id', new.id, 'thread_id', new.thread_id));
  end if;

  v_auto := public.get_automation(new.org_id, 'auto_case_match');
  if v_auto.id is not null and v_thread.case_id is null and not exists (
    select 1 from public.agent_jobs
     where org_id = new.org_id and job_type = 'case_match'
       and payload->>'thread_id' = new.thread_id::text
       and status in ('queued','claimed','running')
  ) then
    insert into public.agent_jobs (org_id, job_type, priority, payload)
    values (new.org_id, 'case_match', 5,
            jsonb_build_object('thread_id', new.thread_id, 'message_id', new.id));
  end if;

  -- Etappe 2: Verpflichtungen/Fristen extrahieren (Aufgaben-Compiler)
  v_auto := public.get_automation(new.org_id, 'auto_extract_tasks');
  if v_auto.id is not null and not exists (
    select 1 from public.agent_jobs
     where org_id = new.org_id and job_type = 'extract_commitments'
       and payload->>'message_id' = new.id::text
  ) then
    insert into public.agent_jobs (org_id, job_type, priority, payload)
    values (new.org_id, 'extract_commitments', 6,
            jsonb_build_object('message_id', new.id, 'thread_id', new.thread_id));
  end if;

  perform public.evaluate_org_rules(new.org_id, 'mail_received', jsonb_build_object(
    'entity_type', 'mail_message',
    'entity_id',   new.id,
    'thread_id',   new.thread_id,
    'subject',     coalesce(new.subject,''),
    'from',        v_from_email,
    'has_attachments', new.has_attachments
  ));

  return new;
end $$;

-- ---------- 3) on_mail_sent v2: Follow-up anlegen ----------
create or replace function public.on_mail_sent_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_thread public.mail_threads;
begin
  update public.mail_threads
     set message_count   = message_count + 1,
         last_message_at = greatest(coalesce(last_message_at, new.sent_at), new.sent_at)
   where id = new.thread_id
   returning * into v_thread;

  if v_thread.case_id is not null then
    insert into public.case_events (org_id, case_id, event_type, title, entity_type, entity_id, actor_type)
    values (new.org_id, v_thread.case_id, 'mail_out',
            coalesce(nullif(new.subject,''), 'E-Mail gesendet'), 'mail_message', new.id, 'user');
  end if;

  -- Follow-up-Engine: auf jede gesendete Mail eine Standard-Nachfassfrist
  -- (4 Werktage ≈ jetzt + 4 Tage); die KI kann sie später präzisieren.
  -- Newsletter-/Massenmails entstehen hier nicht (nur eigene Sends).
  if (public.get_automation(new.org_id, 'auto_followup')).id is not null then
    insert into public.followups (org_id, case_id, entity_type, entity_id, expected_by, reason, created_by)
    values (new.org_id, v_thread.case_id, 'mail_thread', new.thread_id,
            now() + interval '4 days', 'Standard-Nachfassfrist nach ausgehender Mail', 'ai')
    on conflict (entity_type, entity_id) do update
      set expected_by = excluded.expected_by,
          status = 'waiting', answered_at = null;
  end if;

  perform public.evaluate_org_rules(new.org_id, 'mail_sent', jsonb_build_object(
    'entity_type', 'mail_message', 'entity_id', new.id,
    'thread_id', new.thread_id, 'subject', coalesce(new.subject,'')
  ));
  return new;
end $$;

-- ---------- 1+3+4) apply_job_result v2: neue Job-Typen anwenden ----------
create or replace function public.apply_job_result()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_auto public.automations;
  v_thread public.mail_threads;
  v_case public.cases;
  v_confidence real := coalesce((new.result->>'confidence')::real, 0);
  v_run_status text;
  v_account_id uuid;
  v_item jsonb;
  v_task_id uuid;
  v_followup public.followups;
begin
  if new.job_type = 'classify_email' then
    update public.mail_threads
       set category = new.result->>'category',
           urgency  = nullif(new.result->>'urgency','')::smallint
     where id = (new.payload->>'thread_id')::uuid
     returning * into v_thread;

    v_auto := public.get_automation(new.org_id, 'auto_label_mail');
    if v_auto.id is not null and v_thread.id is not null then
      insert into public.automation_runs
        (org_id, automation_id, job_id, entity_type, entity_id, action, autonomy_level, confidence, status, executed_at, detail)
      values
        (new.org_id, v_auto.id, new.id, 'mail_thread', v_thread.id,
         'Kategorie: ' || coalesce(new.result->>'category','—'),
         v_auto.autonomy_level, v_confidence, 'executed', now(),
         jsonb_build_object('category', new.result->>'category', 'urgency', new.result->>'urgency'));
    end if;

  elsif new.job_type = 'case_match' then
    v_auto := public.get_automation(new.org_id, 'auto_case_match');
    select * into v_thread from public.mail_threads
     where id = (new.payload->>'thread_id')::uuid;
    if v_thread.id is null or v_thread.case_id is not null then return new; end if;

    if new.result->>'decision' = 'existing'
       and (new.result->>'case_id') is not null
       and v_confidence >= coalesce(v_auto.min_confidence, 0.9) then
      perform public.assign_thread_to_case(
        v_thread.id, (new.result->>'case_id')::uuid, 'ai', v_confidence, new.id);
      v_run_status := 'executed';
    elsif new.result->>'decision' = 'new'
       and v_confidence >= coalesce(v_auto.min_confidence, 0.9) then
      v_case := public.create_case(
        new.org_id,
        coalesce(nullif(new.result->>'title',''), coalesce(v_thread.subject, 'Neuer Vorgang')),
        null, null, 'ai_auto', null);
      perform public.assign_thread_to_case(v_thread.id, v_case.id, 'ai', v_confidence, new.id);
      v_run_status := 'executed';
    else
      v_run_status := 'proposed';
    end if;

    if v_auto.id is not null then
      insert into public.automation_runs
        (org_id, automation_id, job_id, entity_type, entity_id, action, autonomy_level, confidence, status,
         executed_at, detail)
      values
        (new.org_id, v_auto.id, new.id, 'mail_thread', v_thread.id,
         case when v_run_status = 'executed' then 'Vorgang zugeordnet' else 'Vorgangs-Vorschlag' end,
         v_auto.autonomy_level, v_confidence, v_run_status,
         case when v_run_status = 'executed' then now() end,
         new.result);
    end if;

  elsif new.job_type = 'draft_reply' then
    select account_id into v_account_id from public.mail_threads
     where id = (new.payload->>'thread_id')::uuid;
    if v_account_id is not null then
      insert into public.mail_drafts
        (org_id, account_id, thread_id, source, job_id, to_addrs, subject, body_html, status)
      values
        (new.org_id, v_account_id, (new.payload->>'thread_id')::uuid,
         case when new.payload->>'source' = 'automation' then 'automation' else 'ai' end,
         new.id, coalesce(new.result->'to_addrs','[]'::jsonb),
         new.result->>'subject', new.result->>'body_html', 'draft');
    end if;

  elsif new.job_type = 'thread_summary' then
    update public.mail_threads
       set ai_summary = new.result->>'summary'
     where id = (new.payload->>'thread_id')::uuid;

  -- ---------- Etappe 2 ----------
  elsif new.job_type = 'extract_commitments' then
    select * into v_thread from public.mail_threads
     where id = (new.payload->>'thread_id')::uuid;
    v_auto := public.get_automation(new.org_id, 'auto_extract_tasks');
    for v_item in select value from jsonb_array_elements(coalesce(new.result->'commitments','[]'::jsonb)) loop
      -- Idempotenz: gleiche Quelle + gleicher Titel nur einmal
      if not exists (
        select 1 from public.tasks
         where org_id = new.org_id and source = 'mail_extract'
           and source_entity_id = (new.payload->>'message_id')::uuid
           and title = v_item->>'title'
      ) then
        insert into public.tasks
          (org_id, case_id, title, description, due_at, source, source_entity_type, source_entity_id, job_id)
        values
          (new.org_id, v_thread.case_id, v_item->>'title', v_item->>'reason',
           nullif(v_item->>'due_at','')::timestamptz, 'mail_extract',
           'mail_message', (new.payload->>'message_id')::uuid, new.id)
        returning id into v_task_id;
        if v_auto.id is not null then
          insert into public.automation_runs
            (org_id, automation_id, job_id, entity_type, entity_id, action, autonomy_level, confidence, status, executed_at, detail)
          values
            (new.org_id, v_auto.id, new.id, 'task', v_task_id,
             'Aufgabe vorgeschlagen: ' || (v_item->>'title'),
             v_auto.autonomy_level, coalesce((v_item->>'confidence')::real, v_confidence), 'executed', now(), v_item);
        end if;
      end if;
    end loop;

  elsif new.job_type = 'gap_scan' then
    for v_item in select value from jsonb_array_elements(coalesce(new.result->'findings','[]'::jsonb)) loop
      insert into public.agent_findings
        (org_id, case_id, kind, severity, title, description, suggested_action, dedupe_key, job_id)
      values
        (new.org_id,
         nullif(v_item->>'case_id','')::uuid,
         coalesce(v_item->>'kind','gap')::public.finding_kind,
         coalesce((v_item->>'severity')::smallint, 3),
         v_item->>'title', v_item->>'description',
         v_item->'suggested_action',
         coalesce(v_item->>'dedupe_key', v_item->>'title'),
         new.id)
      on conflict (org_id, dedupe_key) do nothing;
    end loop;

  elsif new.job_type = 'morning_briefing' then
    insert into public.briefings (org_id, kind, for_date, content_md, items, job_id)
    values (new.org_id, 'morning', current_date,
            coalesce(new.result->>'content_md',''),
            coalesce(new.result->'items','[]'::jsonb), new.id)
    on conflict do nothing;
    perform public.notify_org(new.org_id, 'briefing',
      'Dein Morgen-Briefing ist da', null, 'briefing', null);

  elsif new.job_type = 'followup_check' then
    for v_item in select value from jsonb_array_elements(coalesce(new.result->'followups','[]'::jsonb)) loop
      select * into v_followup from public.followups
       where id = nullif(v_item->>'followup_id','')::uuid and org_id = new.org_id;
      if v_followup.id is null or v_followup.status <> 'waiting' then continue; end if;

      if v_item->>'action' = 'escalate' then
        update public.followups set status = 'escalated' where id = v_followup.id;
        insert into public.agent_findings
          (org_id, case_id, kind, severity, title, description, dedupe_key, job_id, entity_type, entity_id)
        values
          (new.org_id, v_followup.case_id, 'stale', 2,
           coalesce(v_item->>'title', 'Antwort überfällig'),
           v_item->>'description',
           'followup:' || v_followup.id, new.id, 'mail_thread', v_followup.entity_id)
        on conflict (org_id, dedupe_key) do nothing;
        -- Nachfass-Entwurf über die bestehende draft_reply-Pipeline
        if (v_item->>'draft_instructions') is not null then
          insert into public.agent_jobs (org_id, job_type, priority, payload)
          values (new.org_id, 'draft_reply', 6, jsonb_build_object(
            'thread_id', v_followup.entity_id,
            'instructions', v_item->>'draft_instructions',
            'source', 'automation'));
        end if;
      end if;
    end loop;
  end if;

  return new;
end $$;

-- ---------- 4) Cron-Kontext: followup_check braucht Org-Scope ----------
-- (enqueue_org_jobs aus 009/017 erzeugt die Jobs; Kontext baut build-job-context)

-- ---------- Grants ----------
revoke execute on function public.on_task_created() from public, anon, authenticated;
revoke execute on function public.on_finding_created() from public, anon, authenticated;

-- ---------- Realtime ----------
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.agent_findings;
alter publication supabase_realtime add table public.briefings;

-- ---------- pg_cron (Betreiber, Dashboard — siehe CHANGELOG Etappe 2) ----------
-- select cron.schedule('gap-scan',       '0 3 * * *',    $$select public.enqueue_org_jobs('gap_scan', 8)$$);
-- select cron.schedule('morning-brief',  '30 5 * * 1-5', $$select public.enqueue_org_jobs('morning_briefing', 6)$$);
-- select cron.schedule('followup-check', '0 * * * *',    $$select public.enqueue_org_jobs('followup_check', 7)$$);
-- Web-Push-Versand (pg_net an die Edge Function send-push):
-- select cron.schedule('send-push', '* * * * *', $$
--   select net.http_post(
--     url    := '<PROJECT_URL>/functions/v1/send-push',
--     headers:= jsonb_build_object('Content-Type','application/json',
--                                  'Authorization','Bearer <SERVICE_ROLE_KEY>'),
--     body   := '{"mode":"due"}'::jsonb)$$);
