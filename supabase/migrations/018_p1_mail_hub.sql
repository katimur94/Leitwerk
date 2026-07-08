-- ============================================================
-- 018_p1_mail_hub.sql — Etappe 1: E-Mail-Hub + Vorgangsakte
-- Serverseitige Logik, damit KI-Gates und Regel-Engine NICHT nur
-- im UI leben (CLAUDE.md Regel 4):
-- 1) on_mail_received: Thread-Pflege, Kontakt-Upsert, KI-Jobs,
--    org_rules-Ereignis 'mail_received', Case-Timeline
-- 2) apply_job_result: wendet done-Job-Ergebnisse an
--    (classify_email, case_match, draft_reply, thread_summary)
-- 3) create_case: Vorgang mit Nummernkreis anlegen
-- 4) record_automation_outcome: Feedback-Schleife + trust_stats
-- 5) enqueue_mail_sync_jobs: Cron-Erzeuger für Gmail-Delta-Sync
-- 6) Realtime für mail_threads/mail_messages/mail_drafts
-- ============================================================

-- ---------- 0) Vault-Wrapper (Token-Tresor, CLAUDE.md Regel 1) ----------
-- PostgREST exponiert das vault-Schema nicht; diese definer-Wrapper sind
-- AUSSCHLIESSLICH für die Service Role (Edge Functions) aufrufbar.
create or replace function public.vault_store_secret(p_name text, p_secret text)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;
  if v_id is not null then
    perform vault.update_secret(v_id, p_secret);
  else
    v_id := vault.create_secret(p_secret, p_name);
  end if;
  return v_id;
end $$;
revoke execute on function public.vault_store_secret(text, text) from public, anon, authenticated;

create or replace function public.vault_get_secret(p_id uuid)
returns text language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_id;
$$;
revoke execute on function public.vault_get_secret(uuid) from public, anon, authenticated;

-- ---------- 3) Vorgang mit Nummernkreis anlegen ----------
create or replace function public.create_case(
  p_org uuid,
  p_title text,
  p_company uuid default null,
  p_contact uuid default null,
  p_source text default 'manual',
  p_created_by uuid default null
) returns public.cases
language plpgsql security definer set search_path = public as $$
declare v_case public.cases;
begin
  -- Client-Aufrufe brauchen Schreibrechte in der Org; Systemaufrufe
  -- (Trigger/Broker, auth.uid() ist null) sind erlaubt.
  if (select auth.uid()) is not null
     and not public.has_org_role(p_org, array['owner','admin','member']::public.org_role[]) then
    raise exception 'Keine Berechtigung';
  end if;

  insert into public.cases (org_id, case_number, title, company_id, contact_id, source, created_by)
  values (p_org, public.next_number(p_org, 'case'), p_title, p_company, p_contact, p_source, p_created_by)
  returning * into v_case;

  insert into public.case_events (org_id, case_id, event_type, title, actor_type, actor_id)
  values (p_org, v_case.id, 'created',
          'Vorgang angelegt (' || v_case.case_number || ')',
          case when p_source = 'ai_auto' then 'runner' else 'user' end,
          p_created_by);
  return v_case;
end $$;

-- ---------- Hilfsfunktion: Automation + Level nachschlagen ----------
create or replace function public.get_automation(p_org uuid, p_key text)
returns public.automations language sql stable security definer set search_path = public as $$
  select * from public.automations where org_id = p_org and key = p_key and is_enabled;
$$;

-- ---------- 1) Neue Inbound-Mail ----------
create or replace function public.on_mail_received()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_thread public.mail_threads;
  v_from_email text := lower(coalesce(new.from_addr->>'email',''));
  v_from_name  text := coalesce(new.from_addr->>'name','');
  v_contact_id uuid;
  v_auto public.automations;
begin
  -- Thread-Denormalisierung (Zähler, Snippet, ungelesen)
  update public.mail_threads
     set message_count   = message_count + 1,
         last_message_at = greatest(coalesce(last_message_at, new.sent_at), new.sent_at),
         snippet         = left(regexp_replace(coalesce(new.body_text, ''), '\s+', ' ', 'g'), 140),
         is_unread       = true
   where id = new.thread_id
   returning * into v_thread;

  -- Kontakt-Upsert aus Absender (CRM light, §4 C — Quelle mail_auto)
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

  -- Case-Timeline, falls der Thread bereits einem Vorgang zugeordnet ist
  if v_thread.case_id is not null then
    insert into public.case_events (org_id, case_id, event_type, title, entity_type, entity_id, actor_type)
    values (new.org_id, v_thread.case_id, 'mail_in',
            coalesce(nullif(new.subject,''), 'Neue E-Mail'), 'mail_message', new.id, 'system');
  end if;

  -- KI-Jobs einreihen (idempotent pro Nachricht; nur wenn Automation aktiv)
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

  -- Regel-Engine (Etappe 0.5): mail_received durchschleusen — kompakte Entity
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

create trigger trg_mail_message_received
  after insert on public.mail_messages
  for each row when (new.direction = 'inbound')
  execute function public.on_mail_received();

-- Outbound-Mails: Timeline + Zähler (ohne KI-Jobs)
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

  perform public.evaluate_org_rules(new.org_id, 'mail_sent', jsonb_build_object(
    'entity_type', 'mail_message', 'entity_id', new.id,
    'thread_id', new.thread_id, 'subject', coalesce(new.subject,'')
  ));
  return new;
end $$;

create trigger trg_mail_message_sent
  after insert on public.mail_messages
  for each row when (new.direction = 'outbound')
  execute function public.on_mail_sent_message();

-- ---------- Thread einem Vorgang zuordnen (User ODER KI, ein Codepfad) ----------
create or replace function public.assign_thread_to_case(
  p_thread uuid, p_case uuid, p_linked_by text, p_confidence real default null, p_job uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_thread public.mail_threads;
begin
  select * into v_thread from public.mail_threads where id = p_thread;
  if not found then return; end if;

  if (select auth.uid()) is not null
     and not public.has_org_role(v_thread.org_id, array['owner','admin','member']::public.org_role[]) then
    raise exception 'Keine Berechtigung';
  end if;

  update public.mail_threads set case_id = p_case where id = p_thread;

  insert into public.case_links (org_id, case_id, entity_type, entity_id, linked_by, confidence, job_id)
  values (v_thread.org_id, p_case, 'mail_thread', p_thread, p_linked_by, p_confidence, p_job)
  on conflict (case_id, entity_type, entity_id) do nothing;

  insert into public.case_events (org_id, case_id, event_type, title, entity_type, entity_id, actor_type)
  values (v_thread.org_id, p_case, 'mail_linked',
          coalesce(nullif(v_thread.subject,''), 'E-Mail-Thread verknüpft'),
          'mail_thread', p_thread,
          case when p_linked_by = 'ai' then 'runner' else 'user' end);
end $$;

-- ---------- 2) Job-Ergebnisse serverseitig anwenden ----------
create or replace function public.apply_job_result()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_auto public.automations;
  v_thread public.mail_threads;
  v_case public.cases;
  v_confidence real := coalesce((new.result->>'confidence')::real, 0);
  v_run_status text;
  v_account_id uuid;
begin
  if new.job_type = 'classify_email' then
    -- Labeln ist rein intern (keine Außenwirkung) → immer anwenden,
    -- automation_run speist die Trefferquote (Korrektur = outcome 'corrected').
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
      -- Unter der Schwelle bzw. decision='none': nur Vorschlag (AiBadge in der PWA)
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
        (new.org_id, v_account_id, (new.payload->>'thread_id')::uuid, 'ai', new.id,
         coalesce(new.result->'to_addrs','[]'::jsonb),
         new.result->>'subject', new.result->>'body_html', 'draft');
    end if;

  elsif new.job_type = 'thread_summary' then
    update public.mail_threads
       set ai_summary = new.result->>'summary'
     where id = (new.payload->>'thread_id')::uuid;
  end if;

  return new;
end $$;

create trigger trg_apply_job_result
  after update on public.agent_jobs
  for each row when (old.status is distinct from 'done' and new.status = 'done' and new.result is not null)
  execute function public.apply_job_result();

-- ---------- 4) Outcome-Feedback + trust_stats (CLAUDE.md Regel 5) ----------
create or replace function public.record_automation_outcome(p_run_id uuid, p_outcome text)
returns void language plpgsql security definer set search_path = public as $$
declare v_run public.automation_runs;
begin
  if p_outcome not in ('correct','corrected','wrong') then
    raise exception 'Ungültiges Outcome: %', p_outcome;
  end if;

  select * into v_run from public.automation_runs where id = p_run_id;
  if not found then raise exception 'automation_run nicht gefunden'; end if;
  if not public.is_org_member(v_run.org_id) then
    raise exception 'Keine Berechtigung';
  end if;

  update public.automation_runs
     set outcome = p_outcome, outcome_by = (select auth.uid()), outcome_at = now()
   where id = p_run_id;

  -- trust_stats vollständig aus den Runs neu berechnen (robust gegen Doppel-Feedback)
  insert into public.trust_stats (automation_id, org_id, total_runs, correct_runs, last_50_correct, last_50_total, updated_at)
  select v_run.automation_id, v_run.org_id,
         count(*) filter (where outcome is not null),
         count(*) filter (where outcome = 'correct'),
         (select count(*) filter (where outcome = 'correct')
            from (select outcome from public.automation_runs
                   where automation_id = v_run.automation_id and outcome is not null
                   order by outcome_at desc limit 50) last50),
         (select count(*)
            from (select outcome from public.automation_runs
                   where automation_id = v_run.automation_id and outcome is not null
                   order by outcome_at desc limit 50) last50),
         now()
    from public.automation_runs
   where automation_id = v_run.automation_id
  on conflict (automation_id) do update
    set total_runs = excluded.total_runs,
        correct_runs = excluded.correct_runs,
        last_50_correct = excluded.last_50_correct,
        last_50_total = excluded.last_50_total,
        updated_at = now();
end $$;

-- ---------- 5) Cron: Gmail-Delta-Sync alle 2 Minuten ----------
create or replace function public.enqueue_mail_sync_jobs()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.agent_jobs (org_id, job_type, priority, payload)
  select a.org_id, 'sync_mail', 6, jsonb_build_object('account_id', a.id)
    from public.mail_accounts a
   where a.provider = 'gmail'
     and a.sync_state in ('pending','ok','error')
     and exists (select 1 from public.runners r
                  where r.org_id = a.org_id
                    and r.status not in ('disabled','pending_approval'))
     and not exists (
       select 1 from public.agent_jobs j
        where j.org_id = a.org_id and j.job_type = 'sync_mail'
          and j.payload->>'account_id' = a.id::text
          and j.status in ('queued','claimed','running')
     );
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Grants ----------
revoke execute on function public.on_mail_received() from public, anon, authenticated;
revoke execute on function public.on_mail_sent_message() from public, anon, authenticated;
revoke execute on function public.apply_job_result() from public, anon, authenticated;
revoke execute on function public.enqueue_mail_sync_jobs() from public, anon, authenticated;
revoke execute on function public.get_automation(uuid, text) from public, anon, authenticated;
-- create_case / assign_thread_to_case / record_automation_outcome sind bewusst
-- für authenticated aufrufbar (RLS-/Membership-Prüfungen innen bzw. via Nummernkreis-RLS).

-- ---------- 6) Realtime für den Mail-Hub ----------
alter publication supabase_realtime add table public.mail_threads;
alter publication supabase_realtime add table public.mail_messages;
alter publication supabase_realtime add table public.mail_drafts;

-- ---------- pg_cron (Betreiber, Dashboard — siehe tutorials/01) ----------
-- select cron.schedule('mail-sync', '*/2 * * * *', $$select public.enqueue_mail_sync_jobs()$$);
-- Versand fälliger Drafts (30s-Undo / Halte-Zone) via pg_net an die Edge Function send-mail:
-- select cron.schedule('send-due-mail', '* * * * *', $$
--   select net.http_post(
--     url    := '<PROJECT_URL>/functions/v1/send-mail',
--     headers:= jsonb_build_object('Content-Type','application/json',
--                                  'Authorization','Bearer <SERVICE_ROLE_KEY>'),
--     body   := '{"mode":"due"}'::jsonb
--   )$$);
