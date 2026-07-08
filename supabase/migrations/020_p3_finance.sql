-- ============================================================
-- 020_p3_finance.sql — Etappe 3: Finanzen
-- 1) Positions-Summen-Trigger (invoice_items/quote_items → Beläge)
-- 2) extract_invoice: Job bei als 'rechnung' klassifizierter Mail
--    mit Anhang + Anwendung (invoices_in captured, Dubletten-Check)
-- 3) Status-Ereignisse: invoice_paid / quote_sent / quote_accepted
--    durch die Regel-Engine + Case-Timeline + Follow-ups für Angebote
-- 4) Mahnwesen: mark_overdue_invoices + propose_dunning_runs (Cron),
--    KI-Mahnentwürfe über draft_dunning-Jobs (Automation auto_dunning)
-- ============================================================

-- ---------- 1) Summen aus Positionen ----------
create or replace function public.recalc_invoice_totals()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update public.invoices_out i
     set net_amount = t.net,
         vat_amount = t.vat,
         gross_amount = t.net + t.vat
    from (
      select coalesce(sum(net_total), 0) as net,
             coalesce(sum(round(net_total * vat_rate / 100, 2)), 0) as vat
        from public.invoice_items where invoice_id = v_invoice
    ) t
   where i.id = v_invoice;
  return coalesce(new, old);
end $$;
create trigger trg_invoice_items_totals
  after insert or update or delete on public.invoice_items
  for each row execute function public.recalc_invoice_totals();

create or replace function public.recalc_quote_totals()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_quote uuid := coalesce(new.quote_id, old.quote_id);
begin
  update public.quotes q
     set net_amount = t.net,
         vat_amount = t.vat,
         gross_amount = t.net + t.vat
    from (
      select coalesce(sum(net_total), 0) as net,
             coalesce(sum(round(net_total * vat_rate / 100, 2)), 0) as vat
        from public.quote_items where quote_id = v_quote
    ) t
   where q.id = v_quote;
  return coalesce(new, old);
end $$;
create trigger trg_quote_items_totals
  after insert or update or delete on public.quote_items
  for each row execute function public.recalc_quote_totals();

-- ---------- 2) extract_invoice einreihen (aus classify_email heraus) ----------
-- Erweiterung von apply_job_result: siehe unten (komplette Neufassung).

-- ---------- 3) Status-Ereignisse ----------
create or replace function public.on_invoice_out_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    new.paid_at := coalesce(new.paid_at, current_date);
    new.paid_amount := case when new.paid_amount = 0 then new.gross_amount else new.paid_amount end;
    perform public.evaluate_org_rules(new.org_id, 'invoice_paid', jsonb_build_object(
      'entity_type', 'invoice_out', 'entity_id', new.id,
      'invoice_number', new.invoice_number, 'gross_amount', new.gross_amount));
    if new.case_id is not null then
      insert into public.case_events (org_id, case_id, event_type, title, entity_type, entity_id, actor_type)
      values (new.org_id, new.case_id, 'invoice_paid',
              'Rechnung ' || new.invoice_number || ' bezahlt', 'invoice_out', new.id, 'user');
    end if;
  end if;
  if new.status = 'sent' and old.status is distinct from 'sent' then
    new.sent_at := coalesce(new.sent_at, now());
    if new.case_id is not null then
      insert into public.case_events (org_id, case_id, event_type, title, entity_type, entity_id, actor_type)
      values (new.org_id, new.case_id, 'invoice_sent',
              'Rechnung ' || new.invoice_number || ' versendet', 'invoice_out', new.id, 'user');
    end if;
  end if;
  return new;
end $$;
create trigger trg_invoice_out_change
  before update on public.invoices_out
  for each row execute function public.on_invoice_out_change();

create or replace function public.on_quote_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sent' and old.status is distinct from 'sent' then
    new.sent_at := coalesce(new.sent_at, now());
    perform public.evaluate_org_rules(new.org_id, 'quote_sent', jsonb_build_object(
      'entity_type', 'quote', 'entity_id', new.id,
      'quote_number', new.quote_number, 'gross_amount', new.gross_amount));
    -- Follow-up-Engine: Angebot nachfassen (7 Tage)
    if (public.get_automation(new.org_id, 'auto_followup')).id is not null then
      insert into public.followups (org_id, case_id, entity_type, entity_id, expected_by, reason, created_by)
      values (new.org_id, new.case_id, 'quote', new.id, now() + interval '7 days',
              'Angebot ' || new.quote_number || ' nachfassen', 'ai')
      on conflict (entity_type, entity_id) do update
        set expected_by = excluded.expected_by, status = 'waiting', answered_at = null;
    end if;
    if new.case_id is not null then
      insert into public.case_events (org_id, case_id, event_type, title, entity_type, entity_id, actor_type)
      values (new.org_id, new.case_id, 'quote_sent',
              'Angebot ' || new.quote_number || ' versendet', 'quote', new.id, 'user');
      update public.cases set expected_value = new.gross_amount where id = new.case_id;
    end if;
  end if;
  if new.status in ('accepted','rejected') and old.status is distinct from new.status then
    new.decided_at := coalesce(new.decided_at, now());
    update public.followups set status = 'done'
     where entity_type = 'quote' and entity_id = new.id and status in ('waiting','escalated');
    if new.status = 'accepted' then
      perform public.evaluate_org_rules(new.org_id, 'quote_accepted', jsonb_build_object(
        'entity_type', 'quote', 'entity_id', new.id,
        'quote_number', new.quote_number, 'gross_amount', new.gross_amount));
    end if;
  end if;
  return new;
end $$;
create trigger trg_quote_change
  before update on public.quotes
  for each row execute function public.on_quote_change();

-- ---------- 4) Mahnwesen ----------
-- Überfällige Rechnungen markieren + Mahnvorschläge erzeugen (Cron täglich).
create or replace function public.process_overdue_invoices()
returns int language plpgsql security definer set search_path = public as $$
declare v_invoice public.invoices_out; v_level smallint; v_fee numeric; v_auto public.automations; n int := 0;
begin
  update public.invoices_out
     set status = 'overdue'
   where status = 'sent' and due_date is not null and due_date < current_date;

  for v_invoice in
    select * from public.invoices_out
     where status in ('overdue','partially_paid')
       and due_date is not null and due_date < current_date
  loop
    v_auto := public.get_automation(v_invoice.org_id, 'auto_dunning');
    if v_auto.id is null then continue; end if;

    select coalesce(max(level), 0) + 1 into v_level
      from public.dunning_runs
     where invoice_id = v_invoice.id and status in ('approved','sent');
    if v_level > 3 then continue; end if;
    -- Zwischen zwei Mahnstufen mindestens 7 Tage
    if exists (
      select 1 from public.dunning_runs
       where invoice_id = v_invoice.id
         and (status = 'proposed'
              or (status in ('approved','sent') and created_at > now() - interval '7 days'))
    ) then continue; end if;

    select coalesce((op.dunning_fees->>v_level::text)::numeric, 0) into v_fee
      from public.org_profile op where op.org_id = v_invoice.org_id;

    insert into public.dunning_runs (org_id, invoice_id, level, fee, status, proposed_by)
    values (v_invoice.org_id, v_invoice.id, v_level, coalesce(v_fee, 0), 'proposed', 'ai')
    on conflict (invoice_id, level) do nothing;
    if found then
      n := n + 1;
      -- KI-Mahnentwurf über die Job-Queue
      insert into public.agent_jobs (org_id, job_type, priority, payload)
      values (v_invoice.org_id, 'draft_dunning', 7, jsonb_build_object(
        'invoice_id', v_invoice.id, 'level', v_level));
      perform public.notify_org(v_invoice.org_id, 'dunning_proposed',
        'Mahnvorschlag: Rechnung ' || v_invoice.invoice_number || ' (Stufe ' || v_level || ')',
        null, 'invoice_out', v_invoice.id);
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.process_overdue_invoices() from public, anon, authenticated;

-- ---------- apply_job_result v3: extract_invoice + draft_dunning ----------
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

    -- Etappe 3: Rechnungs-Mail mit Anhang → Rechnungs-Erfassung anstoßen
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
         new.result->>'subject', new.result->>'body_html', 'draft');
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

  -- ---------- Etappe 3 ----------
  elsif new.job_type = 'extract_invoice' then
    if coalesce(new.result->>'found','false') <> 'true' then return new; end if;
    v_auto := public.get_automation(new.org_id, 'auto_capture_invoice');
    select * into v_message from public.mail_messages
     where id = (new.payload->>'message_id')::uuid;

    -- Idempotenz: dieselbe Quelle nur einmal erfassen
    if exists (
      select 1 from public.invoices_in
       where org_id = new.org_id
         and extraction->>'source_message_id' = v_message.id::text
    ) then return new; end if;

    -- Aussteller-Firma anlegen/finden
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

    -- Dubletten-Erkennung (Nummer + Betrag)
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
  end if;

  return new;
end $$;

-- ---------- pg_cron (Betreiber — siehe CHANGELOG Etappe 3) ----------
-- select cron.schedule('overdue-invoices', '15 6 * * *', $$select public.process_overdue_invoices()$$);
