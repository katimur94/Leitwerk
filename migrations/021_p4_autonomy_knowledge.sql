-- ============================================================
-- 021_p4_autonomy_knowledge.sql — Etappe 4: Autonomie & Wissen
-- 1) Autonomie-Regler serverseitig: set_autonomy_level (Hochstufen-Gate),
--    set_automation_settings, Spalten-Grants (Client darf Level NICHT direkt setzen)
-- 2) Stufe-3-Halte-Zone: automation_runs 'holding' + hold_until,
--    stop_automation_run (1-Klick-Stopp), process_holding_runs (Cron)
-- 3) apply_job_result v4: Stufe-3/4-Wiring für automatische Entwürfe
--    (Follow-up-Nachfassen, Mahnungen) + neue Job-Typen transcribe_note,
--    transcribe_meeting, summarize_meeting, knowledge_distill,
--    build_style_profile, embed_backlog
-- 4) Kombinierte Suche: search_combined (tsvector + pgvector über Job-Embedding)
-- ============================================================

-- ---------- 1) Autonomie-Regler ----------
-- Client darf autonomy_level NICHT direkt schreiben — nur über die RPC mit Gate.
revoke update on public.automations from authenticated;
grant update (is_enabled, min_confidence, hold_minutes) on public.automations to authenticated;

create or replace function public.set_autonomy_level(p_automation uuid, p_level smallint)
returns public.automations language plpgsql security definer set search_path = public as $$
declare
  v_auto public.automations;
  v_stats public.trust_stats;
  v_quote real;
begin
  select * into v_auto from public.automations where id = p_automation;
  if v_auto.id is null then raise exception 'Automation nicht gefunden'; end if;
  if not public.has_org_role(v_auto.org_id, array['owner','admin']::public.org_role[]) then
    raise exception 'Nur Owner/Admin dürfen die Autonomie-Stufe ändern';
  end if;
  if p_level not between 1 and 4 then raise exception 'Ungültige Stufe: %', p_level; end if;

  -- Hochstufen-Gate (MASTERPLAN §4 J): Stufe 3/4 erst ab nachgewiesener
  -- Trefferquote über genügend Läufe — serverseitig erzwungen, nicht nur UI.
  if p_level >= 3 and p_level > v_auto.autonomy_level then
    select * into v_stats from public.trust_stats where automation_id = v_auto.id;
    v_quote := case when coalesce(v_stats.last_50_total, 0) = 0 then 0
                    else v_stats.last_50_correct::real / v_stats.last_50_total end;
    if coalesce(v_stats.last_50_total, 0) < v_auto.promote_min_runs
       or v_quote < v_auto.promote_threshold then
      raise exception using
        errcode = 'P0004',
        message = format(
          'Hochstufung erst ab %s %% Trefferquote über mindestens %s Läufe (aktuell: %s %% über %s Läufe)',
          round(v_auto.promote_threshold * 100), v_auto.promote_min_runs,
          round(v_quote * 100), coalesce(v_stats.last_50_total, 0));
    end if;
  end if;

  update public.automations set autonomy_level = p_level where id = v_auto.id
  returning * into v_auto;

  insert into public.audit_log (org_id, actor_type, actor_id, action, entity_type, entity_id, detail)
  values (v_auto.org_id, 'user', (select auth.uid()), 'automation.level_changed',
          'automation', v_auto.id, jsonb_build_object('level', p_level, 'key', v_auto.key));
  return v_auto;
end $$;
grant execute on function public.set_autonomy_level(uuid, smallint) to authenticated;

-- ---------- 2) Halte-Zone: Stopp + Ausführung nach Ablauf ----------
create or replace function public.stop_automation_run(p_run uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_run public.automation_runs; v_draft uuid;
begin
  select * into v_run from public.automation_runs where id = p_run;
  if v_run.id is null then raise exception 'Lauf nicht gefunden'; end if;
  if not public.has_org_role(v_run.org_id, array['owner','admin','member']::public.org_role[]) then
    raise exception 'Keine Berechtigung';
  end if;
  if v_run.status <> 'holding' then raise exception 'Lauf ist nicht in der Halte-Zone'; end if;

  update public.automation_runs
     set status = 'stopped', decided_by = (select auth.uid())
   where id = v_run.id;

  -- Geplanten Versand zurückholen
  v_draft := nullif(v_run.detail->>'draft_id','')::uuid;
  if v_draft is not null then
    update public.mail_drafts set status = 'draft', send_after = null
     where id = v_draft and status = 'scheduled';
  end if;
  if v_run.entity_type = 'dunning_run' then
    update public.dunning_runs set status = 'proposed'
     where id = v_run.entity_id and status = 'approved';
  end if;

  -- Stopp = menschliche Korrektur → speist die Trefferquote
  perform public.record_automation_outcome(v_run.id, 'corrected');

  insert into public.audit_log (org_id, actor_type, actor_id, action, entity_type, entity_id, job_id, detail)
  values (v_run.org_id, 'user', (select auth.uid()), 'automation.stopped',
          v_run.entity_type, v_run.entity_id, v_run.job_id, v_run.detail);
end $$;
grant execute on function public.stop_automation_run(uuid) to authenticated;

-- Cron (z. B. alle 5 Minuten): abgelaufene Halte-Zonen abschließen.
-- Der eigentliche Mail-Versand läuft über send-mail {mode:'due'} (send_after).
create or replace function public.process_holding_runs()
returns int language plpgsql security definer set search_path = public as $$
declare v_run public.automation_runs; v_draft public.mail_drafts; n int := 0;
begin
  for v_run in
    select * from public.automation_runs where status = 'holding' and hold_until <= now()
  loop
    select * into v_draft from public.mail_drafts
     where id = nullif(v_run.detail->>'draft_id','')::uuid;

    if v_draft.id is not null and v_draft.status in ('scheduled','sent') then
      update public.automation_runs
         set status = 'executed', executed_at = now()
       where id = v_run.id;
      if v_run.entity_type = 'dunning_run' then
        update public.dunning_runs
           set status = 'sent', sent_at = now()
         where id = v_run.entity_id and status in ('proposed','approved');
      end if;
      insert into public.audit_log (org_id, actor_type, action, entity_type, entity_id, job_id, detail)
      values (v_run.org_id, 'system', 'automation.executed',
              v_run.entity_type, v_run.entity_id, v_run.job_id, v_run.detail);
      n := n + 1;
    else
      -- Entwurf wurde manuell zurückgeholt/gelöscht → Lauf gilt als gestoppt
      update public.automation_runs set status = 'stopped' where id = v_run.id;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.process_holding_runs() from public, anon, authenticated;

-- ---------- Hilfsfunktion: automatischen Entwurf ggf. autonom planen ----------
-- Stufe 1/2: Entwurf bleibt liegen (Mensch klickt/gibt frei).
-- Stufe 3:   Entwurf wird geplant (send_after = jetzt + hold_minutes),
--            automation_run status='holding' — sichtbar, stoppbar.
-- Stufe 4:   Entwurf wird sofort geplant, Lauf 'executed'.
create or replace function public.maybe_autoschedule_draft(
  p_auto public.automations, p_job uuid, p_draft uuid,
  p_entity_type text, p_entity_id uuid, p_action text, p_confidence real
) returns void language plpgsql security definer set search_path = public as $$
declare v_hold timestamptz; v_status text; v_to jsonb;
begin
  if p_auto.id is null then return; end if;

  select to_addrs into v_to from public.mail_drafts where id = p_draft;
  if p_auto.autonomy_level >= 3
     and p_confidence >= p_auto.min_confidence
     and jsonb_array_length(coalesce(v_to, '[]'::jsonb)) > 0 then
    v_hold := case when p_auto.autonomy_level >= 4 then now()
                   else now() + make_interval(mins => greatest(p_auto.hold_minutes, 1)) end;
    v_status := case when p_auto.autonomy_level >= 4 then 'executed' else 'holding' end;
    update public.mail_drafts
       set status = 'scheduled', send_after = v_hold
     where id = p_draft;
    insert into public.automation_runs
      (org_id, automation_id, job_id, entity_type, entity_id, action, autonomy_level,
       confidence, status, hold_until, executed_at, detail)
    values
      (p_auto.org_id, p_auto.id, p_job, p_entity_type, p_entity_id, p_action,
       p_auto.autonomy_level, p_confidence, v_status,
       case when v_status = 'holding' then v_hold end,
       case when v_status = 'executed' then now() end,
       jsonb_build_object('draft_id', p_draft));
    if v_status = 'holding' then
      perform public.notify_org(p_auto.org_id, 'automation_holding',
        p_action || ' — wird in ' || p_auto.hold_minutes || ' Min. gesendet (stoppbar)',
        null, p_entity_type, p_entity_id);
    end if;
  else
    -- Stufe 1/2 (oder ohne Empfänger): Vorschlag protokollieren
    insert into public.automation_runs
      (org_id, automation_id, job_id, entity_type, entity_id, action, autonomy_level,
       confidence, status, detail)
    values
      (p_auto.org_id, p_auto.id, p_job, p_entity_type, p_entity_id, p_action,
       p_auto.autonomy_level, p_confidence, 'proposed', jsonb_build_object('draft_id', p_draft));
  end if;
end $$;
revoke execute on function public.maybe_autoschedule_draft(public.automations, uuid, uuid, text, uuid, text, real)
  from public, anon, authenticated;

-- ---------- 3) apply_job_result v4 ----------
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
  v_message public.mail_messages;
  v_company_id uuid;
  v_duplicate uuid;
  v_invoice_in_id uuid;
  v_invoice public.invoices_out;
  v_dunning public.dunning_runs;
  v_contact_email text;
  v_meeting public.meetings;
  v_user uuid;
  v_count int := 0;
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

    select * into v_message from public.mail_messages
     where id = (new.payload->>'message_id')::uuid;
    if new.result->>'category' = 'rechnung'
       and v_message.id is not null and v_message.has_attachments
       and (public.get_automation(new.org_id, 'auto_capture_invoice')).id is not null
       and not exists (
         select 1 from public.agent_jobs
          where org_id = new.org_id and job_type = 'extract_invoice'
            and payload->>'message_id' = v_message.id::text
       ) then
      insert into public.agent_jobs (org_id, job_type, priority, payload)
      values (new.org_id, 'extract_invoice', 6,
              jsonb_build_object('message_id', v_message.id, 'thread_id', v_message.thread_id));
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
         new.result->>'subject', new.result->>'body_html', 'draft')
      returning id into v_task_id;

      -- Etappe 4: automatisches Nachfassen kann ab Stufe 3 autonom raus
      if new.payload->>'source' = 'automation' then
        perform public.maybe_autoschedule_draft(
          public.get_automation(new.org_id, 'auto_followup'), new.id, v_task_id,
          'mail_thread', (new.payload->>'thread_id')::uuid,
          'Nachfass-Mail: ' || coalesce(new.result->>'subject','—'), v_confidence);
      end if;
    end if;

  elsif new.job_type = 'thread_summary' then
    update public.mail_threads
       set ai_summary = new.result->>'summary'
     where id = (new.payload->>'thread_id')::uuid;

  elsif new.job_type = 'extract_commitments' then
    select * into v_thread from public.mail_threads
     where id = (new.payload->>'thread_id')::uuid;
    v_auto := public.get_automation(new.org_id, 'auto_extract_tasks');
    for v_item in select value from jsonb_array_elements(coalesce(new.result->'commitments','[]'::jsonb)) loop
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
        if (v_item->>'draft_instructions') is not null and v_followup.entity_type = 'mail_thread' then
          insert into public.agent_jobs (org_id, job_type, priority, payload)
          values (new.org_id, 'draft_reply', 6, jsonb_build_object(
            'thread_id', v_followup.entity_id,
            'instructions', v_item->>'draft_instructions',
            'source', 'automation'));
        end if;
      end if;
    end loop;

  elsif new.job_type = 'extract_invoice' then
    if coalesce(new.result->>'found','false') <> 'true' then return new; end if;
    v_auto := public.get_automation(new.org_id, 'auto_capture_invoice');
    select * into v_message from public.mail_messages
     where id = (new.payload->>'message_id')::uuid;

    if exists (
      select 1 from public.invoices_in
       where org_id = new.org_id
         and extraction->>'source_message_id' = v_message.id::text
    ) then return new; end if;

    v_company_id := null;
    if nullif(new.result->>'issuer_name','') is not null then
      select id into v_company_id from public.companies
       where org_id = new.org_id and lower(name) = lower(new.result->>'issuer_name') limit 1;
      if v_company_id is null then
        insert into public.companies (org_id, name)
        values (new.org_id, new.result->>'issuer_name')
        returning id into v_company_id;
      end if;
    end if;

    select id into v_duplicate from public.invoices_in
     where org_id = new.org_id
       and invoice_number = new.result->>'invoice_number'
       and gross_amount = (new.result->>'gross_amount')::numeric
     limit 1;

    insert into public.invoices_in
      (org_id, case_id, company_id, source, attachment_id, status, invoice_number,
       invoice_date, due_date, net_amount, vat_amount, gross_amount, currency, iban,
       payment_reference, extraction, extraction_confidence, format_detected,
       is_einvoice, duplicate_of)
    values
      (new.org_id,
       (select case_id from public.mail_threads where id = v_message.thread_id),
       v_company_id, 'mail',
       (select id from public.mail_attachments where message_id = v_message.id limit 1),
       'captured',
       new.result->>'invoice_number',
       nullif(new.result->>'invoice_date','')::date,
       nullif(new.result->>'due_date','')::date,
       nullif(new.result->>'net_amount','')::numeric,
       nullif(new.result->>'vat_amount','')::numeric,
       nullif(new.result->>'gross_amount','')::numeric,
       coalesce(nullif(new.result->>'currency',''), 'EUR'),
       nullif(new.result->>'iban',''),
       nullif(new.result->>'payment_reference',''),
       (new.result - 'found') || jsonb_build_object('source_message_id', v_message.id),
       v_confidence,
       nullif(new.result->>'format_detected',''),
       coalesce((new.result->>'is_einvoice')::boolean, false),
       v_duplicate)
    returning id into v_invoice_in_id;

    if v_auto.id is not null then
      insert into public.automation_runs
        (org_id, automation_id, job_id, entity_type, entity_id, action, autonomy_level, confidence, status, executed_at, detail)
      values
        (new.org_id, v_auto.id, new.id, 'invoice_in', v_invoice_in_id,
         'Rechnung erfasst: ' || coalesce(new.result->>'invoice_number','—'),
         v_auto.autonomy_level, v_confidence, 'executed', now(), new.result);
    end if;

    perform public.evaluate_org_rules(new.org_id, 'invoice_captured', jsonb_build_object(
      'entity_type', 'invoice_in', 'entity_id', v_invoice_in_id,
      'invoice_number', new.result->>'invoice_number',
      'gross_amount', nullif(new.result->>'gross_amount','')::numeric,
      'issuer', new.result->>'issuer_name',
      'is_duplicate', v_duplicate is not null));

  elsif new.job_type = 'draft_dunning' then
    select * into v_dunning from public.dunning_runs
     where invoice_id = (new.payload->>'invoice_id')::uuid
       and level = (new.payload->>'level')::smallint;
    select * into v_invoice from public.invoices_out
     where id = (new.payload->>'invoice_id')::uuid;
    if v_dunning.id is null or v_invoice.id is null then return new; end if;

    select coalesce(c.email, comp_contact.email) into v_contact_email
      from public.invoices_out i
      left join public.contacts c on c.id = i.contact_id
      left join lateral (
        select email from public.contacts
         where company_id = i.company_id and email is not null limit 1
      ) comp_contact on true
     where i.id = v_invoice.id;

    select id into v_account_id from public.mail_accounts
     where org_id = new.org_id order by created_at asc limit 1;
    if v_account_id is null then return new; end if;

    insert into public.mail_drafts
      (org_id, account_id, source, job_id, to_addrs, subject, body_html, status)
    values
      (new.org_id, v_account_id, 'automation', new.id,
       case when v_contact_email is not null
            then jsonb_build_array(jsonb_build_object('email', v_contact_email))
            else '[]'::jsonb end,
       new.result->>'subject', new.result->>'body_html', 'draft')
    returning id into v_task_id;

    update public.dunning_runs set draft_id = v_task_id where id = v_dunning.id;

    -- Etappe 4: Mahnungen können ab Stufe 3 autonom raus (Halte-Zone)
    perform public.maybe_autoschedule_draft(
      public.get_automation(new.org_id, 'auto_dunning'), new.id, v_task_id,
      'dunning_run', v_dunning.id,
      'Mahnung Stufe ' || v_dunning.level || ': Rechnung ' || v_invoice.invoice_number,
      v_confidence);

  -- ---------- Etappe 4 ----------
  elsif new.job_type = 'transcribe_note' then
    update public.notes
       set body_md = coalesce(nullif(new.result->>'transcript',''), body_md),
           source = 'voice'
     where id = (new.payload->>'note_id')::uuid and org_id = new.org_id;

  elsif new.job_type = 'transcribe_meeting' then
    update public.meetings
       set transcript = new.result->>'transcript',
           transcript_done_at = now(),
           job_id = new.id
     where id = (new.payload->>'meeting_id')::uuid and org_id = new.org_id
     returning * into v_meeting;
    if v_meeting.id is null then return new; end if;

    delete from public.meeting_segments where meeting_id = v_meeting.id;
    for v_item in select value from jsonb_array_elements(coalesce(new.result->'segments','[]'::jsonb)) loop
      insert into public.meeting_segments (meeting_id, org_id, speaker, starts_sec, ends_sec, content)
      values (v_meeting.id, new.org_id, v_item->>'speaker',
              nullif(v_item->>'starts_sec','')::real, nullif(v_item->>'ends_sec','')::real,
              coalesce(v_item->>'content',''));
    end loop;

    if not exists (
      select 1 from public.agent_jobs
       where org_id = new.org_id and job_type = 'summarize_meeting'
         and payload->>'meeting_id' = v_meeting.id::text
         and status in ('queued','claimed','running','done')
    ) then
      insert into public.agent_jobs (org_id, job_type, priority, payload)
      values (new.org_id, 'summarize_meeting', 4,
              jsonb_build_object('meeting_id', v_meeting.id));
    end if;

  elsif new.job_type = 'summarize_meeting' then
    update public.meetings
       set protocol_md = new.result->>'protocol_md',
           decisions = coalesce(new.result->'decisions','[]'::jsonb),
           open_questions = coalesce(new.result->'open_questions','[]'::jsonb)
     where id = (new.payload->>'meeting_id')::uuid and org_id = new.org_id
     returning * into v_meeting;
    if v_meeting.id is null then return new; end if;

    for v_item in select value from jsonb_array_elements(coalesce(new.result->'tasks','[]'::jsonb)) loop
      if not exists (
        select 1 from public.tasks
         where org_id = new.org_id and source = 'meeting'
           and source_entity_id = v_meeting.id and title = v_item->>'title'
      ) then
        insert into public.tasks
          (org_id, case_id, title, description, due_at, source, source_entity_type, source_entity_id, job_id)
        values
          (new.org_id, v_meeting.case_id, v_item->>'title', v_item->>'assignee_hint',
           nullif(v_item->>'due_at','')::timestamptz, 'meeting', 'meeting', v_meeting.id, new.id);
      end if;
    end loop;

    if v_meeting.case_id is not null then
      insert into public.case_events (org_id, case_id, event_type, title, entity_type, entity_id, actor_type, job_id)
      values (new.org_id, v_meeting.case_id, 'meeting_summarized',
              'Protokoll: ' || v_meeting.title, 'meeting', v_meeting.id, 'ai', new.id);
    end if;
    perform public.notify_org(new.org_id, 'meeting_summarized',
      'Protokoll fertig: ' || v_meeting.title, null, 'meeting', v_meeting.id);

  elsif new.job_type = 'knowledge_distill' then
    for v_item in select value from jsonb_array_elements(coalesce(new.result->'facts','[]'::jsonb)) loop
      if nullif(v_item->>'fact','') is null then continue; end if;
      if exists (
        select 1 from public.knowledge_items
         where org_id = new.org_id and lower(fact) = lower(v_item->>'fact')
           and status <> 'rejected'
      ) then continue; end if;

      v_company_id := null;
      if nullif(v_item->>'company_name','') is not null then
        select id into v_company_id from public.companies
         where org_id = new.org_id and lower(name) = lower(v_item->>'company_name') limit 1;
      end if;

      insert into public.knowledge_items
        (org_id, fact, category, company_id, source_type, source_id, confidence, status, job_id)
      values
        (new.org_id, v_item->>'fact', nullif(v_item->>'category',''), v_company_id,
         nullif(v_item->>'source_type',''), nullif(v_item->>'source_id','')::uuid,
         coalesce((v_item->>'confidence')::real, 0.8), 'proposed', new.id);
      v_count := v_count + 1;
    end loop;
    if v_count > 0 then
      perform public.notify_org(new.org_id, 'knowledge_proposed',
        v_count || ' neue Wissens-Vorschläge zum Prüfen', null, 'knowledge_item', null);
    end if;

  elsif new.job_type = 'build_style_profile' then
    select created_by into v_user from public.mail_accounts
     where id = nullif(new.payload->>'account_id','')::uuid and org_id = new.org_id;
    if v_user is null then return new; end if;
    insert into public.ai_style_profiles (org_id, user_id, profile, sample_count, built_at)
    values (new.org_id, v_user, coalesce(new.result->'profile','{}'::jsonb),
            coalesce((new.result->>'sample_count')::int, 0), now())
    on conflict (org_id, user_id) do update
      set profile = excluded.profile,
          sample_count = excluded.sample_count,
          built_at = now();

  elsif new.job_type = 'embed_backlog' then
    for v_item in select value from jsonb_array_elements(coalesce(new.result->'items','[]'::jsonb)) loop
      begin
        insert into public.embeddings (org_id, entity_type, entity_id, chunk_index, content, embedding)
        values (new.org_id, v_item->>'entity_type', (v_item->>'entity_id')::uuid,
                coalesce((v_item->>'chunk_index')::int, 0),
                coalesce(v_item->>'content',''),
                (v_item->'embedding')::text::vector(1024))
        on conflict (entity_type, entity_id, chunk_index) do update
          set content = excluded.content, embedding = excluded.embedding;
      exception when others then
        -- einzelne fehlerhafte Vektoren überspringen statt den ganzen Job zu kippen
        null;
      end;
    end loop;
  end if;

  return new;
end $$;

-- ---------- 4) Kombinierte Suche (Volltext + semantisch) ----------
-- p_embedding_job: fertiger 'semantic_search'-Job — sein Ergebnis enthält den
-- Query-Vektor (der Runner rechnet Embeddings lokal; der Client nie).
create or replace function public.search_combined(
  p_org uuid, p_query text, p_embedding_job uuid default null, p_limit int default 20
) returns table (
  entity_type text, entity_id uuid, title text, snippet text, rank real, via text
) language plpgsql stable security definer set search_path = public as $$
declare v_vec vector(1024); v_ts tsquery;
begin
  if not public.is_org_member(p_org) then
    raise exception 'Keine Berechtigung';
  end if;
  v_ts := plainto_tsquery('german', p_query);
  if p_embedding_job is not null then
    select (j.result->>'embedding')::vector(1024) into v_vec
      from public.agent_jobs j
     where j.id = p_embedding_job and j.org_id = p_org
       and j.job_type = 'semantic_search' and j.status = 'done'
       and j.result ? 'embedding';
  end if;

  -- Spalten-Aliase r_* — vermeiden Kollisionen mit den OUT-Variablen (plpgsql)
  return query
  with fulltext as (
    select 'mail_message'::text as r_type, m.id as r_id,
           coalesce(m.subject,'(ohne Betreff)') as r_title,
           left(coalesce(m.body_text,''), 160) as r_snippet,
           ts_rank(m.search_tsv, v_ts)::real as r_rank, 'volltext'::text as r_via
      from public.mail_messages m
     where m.org_id = p_org and v_ts @@ m.search_tsv
    union all
    select 'document', d.id, d.title, left(coalesce(d.ocr_text,''), 160),
           ts_rank(d.search_tsv, v_ts)::real, 'volltext'
      from public.documents d
     where d.org_id = p_org and v_ts @@ d.search_tsv
    union all
    select 'case', c.id, c.title, coalesce(c.case_number,''), 0.5::real, 'volltext'
      from public.cases c
     where c.org_id = p_org and (c.title ilike '%'||p_query||'%' or c.case_number ilike '%'||p_query||'%')
    union all
    select 'contact', ct.id,
           coalesce(nullif(trim(coalesce(ct.first_name,'') || ' ' || coalesce(ct.last_name,'')),''), ct.email, '—'),
           coalesce(ct.email,''), 0.5::real, 'volltext'
      from public.contacts ct
     where ct.org_id = p_org
       and (ct.first_name ilike '%'||p_query||'%' or ct.last_name ilike '%'||p_query||'%'
            or ct.email ilike '%'||p_query||'%')
    union all
    select 'note', n.id, coalesce(n.title,'Notiz'), left(n.body_md, 160), 0.4::real, 'volltext'
      from public.notes n
     where n.org_id = p_org and (n.title ilike '%'||p_query||'%' or n.body_md ilike '%'||p_query||'%')
    union all
    select 'knowledge_item', k.id, k.fact, coalesce(k.category,''), 0.4::real, 'volltext'
      from public.knowledge_items k
     where k.org_id = p_org and k.status <> 'rejected' and k.fact ilike '%'||p_query||'%'
  ),
  semantic as (
    select e.entity_type as r_type, e.entity_id as r_id,
           left(e.content, 80) as r_title, left(e.content, 160) as r_snippet,
           (1 - (e.embedding <=> v_vec))::real as r_rank, 'semantisch'::text as r_via
      from public.embeddings e
     where v_vec is not null and e.org_id = p_org
     order by e.embedding <=> v_vec
     limit 12
  ),
  merged as (
    select * from fulltext
    union all
    select * from semantic s
     where not exists (
       select 1 from fulltext f
        where f.r_id = s.r_id
     )
  )
  select m.r_type, m.r_id, m.r_title, m.r_snippet, m.r_rank, m.r_via
    from merged m
   order by m.r_rank desc
   limit greatest(p_limit, 1);
end $$;
grant execute on function public.search_combined(uuid, text, uuid, int) to authenticated;

-- ---------- pg_cron (Betreiber — siehe CHANGELOG Etappe 4) ----------
-- select cron.schedule('holding-runs',   '* * * * *',  $$select public.process_holding_runs()$$);
-- select cron.schedule('knowledge',      '0 4 * * 6',  $$select public.enqueue_org_jobs('knowledge_distill', 9)$$);
-- select cron.schedule('style-profiles', '0 4 * * 0',  $$select public.enqueue_org_jobs('build_style_profile', 9)$$);
-- select cron.schedule('embed-backlog',  '30 2 * * *', $$select public.enqueue_org_jobs('embed_backlog', 9)$$);
