-- ============================================================
-- 023_p6_office.sql — Etappe 6: Komplett-Büro
-- 1) apply_job_result_p6 (Supplement-Trigger): time_suggest, payment_match,
--    account_assign, transcribe_call, summarize_call, extract_contract, contract_watch
-- 2) Mahnwesen prüft ab jetzt den Zahlungs-Match-Status (process_overdue_invoices v2)
-- 3) Zeit → Rechnung: abrechenbare Zeiten als Positionen übernehmen (RPC)
-- Migrationen 011–015 (Zeit/Banking/DATEV/Anrufe/Verträge) sind bereits eingespielt.
-- DATEV-EXTF-Erzeugung: Edge Function export-datev (Builder in packages/shared).
-- ============================================================

-- ---------- 2) Mahnwesen: Match-Status berücksichtigen ----------
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

    -- Etappe 6: kein Mahnvorschlag, wenn bereits ein bestätigter Zahlungs-Match
    -- vorliegt (Banking-Abgleich hat die Zahlung erkannt).
    if exists (
      select 1 from public.payment_matches pm
       where pm.invoice_out_id = v_invoice.id and pm.status = 'confirmed'
    ) then continue; end if;

    select coalesce(max(level), 0) + 1 into v_level
      from public.dunning_runs
     where invoice_id = v_invoice.id and status in ('approved','sent');
    if v_level > 3 then continue; end if;
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

-- ---------- 3) Abrechenbare Zeiten → Rechnungspositionen ----------
-- Übernimmt offene billable time_entries eines Vorgangs als Positionen in eine
-- (Entwurfs-)Ausgangsrechnung; sperrt die Zeiten (locked_at) mit hourly_rate-Snapshot.
create or replace function public.bill_time_entries(p_invoice uuid, p_entry_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_invoice public.invoices_out; v_entry public.time_entries; v_pos int; v_rate numeric; n int := 0;
begin
  select * into v_invoice from public.invoices_out where id = p_invoice;
  if v_invoice.id is null then raise exception 'Rechnung nicht gefunden'; end if;
  if not public.has_org_role(v_invoice.org_id, array['owner','admin','member']::public.org_role[]) then
    raise exception 'Keine Berechtigung';
  end if;
  if v_invoice.status <> 'draft' then raise exception 'Nur Entwürfe können bebucht werden'; end if;

  select coalesce(max(position), 0) into v_pos from public.invoice_items where invoice_id = p_invoice;

  for v_entry in
    select * from public.time_entries
     where id = any(p_entry_ids) and org_id = v_invoice.org_id
       and is_billable and invoice_id is null and locked_at is null
  loop
    -- Stundensatz-Snapshot: Satz am Eintrag, sonst 0 (Nutzer editiert die Position).
    v_rate := coalesce(v_entry.hourly_rate, 0);
    v_pos := v_pos + 1;
    insert into public.invoice_items (invoice_id, position, description, quantity, unit, unit_price, vat_rate)
    values (p_invoice, v_pos,
            coalesce(v_entry.description, 'Arbeitszeit') || ' (' || v_entry.work_date || ')',
            round(v_entry.minutes / 60.0, 2), 'Std', v_rate, 19);
    update public.time_entries
       set invoice_id = p_invoice, hourly_rate = v_rate, locked_at = now()
     where id = v_entry.id;
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.bill_time_entries(uuid, uuid[]) to authenticated;

-- ---------- 1) apply_job_result_p6 (Supplement-Trigger) ----------
create or replace function public.apply_job_result_p6()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb;
  v_call public.call_logs;
  v_contract public.contracts;
  v_task_id uuid;
  v_count int := 0;
begin
  if new.job_type = 'time_suggest' then
    v_item := null;
    for v_item in select value from jsonb_array_elements(coalesce(new.result->'entries','[]'::jsonb)) loop
      -- Vorschlag als ai_suggested time_entry (Nutzer bestätigt/verwirft in der UI)
      insert into public.time_entries
        (org_id, user_id, case_id, work_date, minutes, description, is_billable, source, job_id)
      values
        (new.org_id, (new.payload->>'user_id')::uuid,
         nullif(v_item->>'case_id','')::uuid,
         coalesce(nullif(v_item->>'work_date','')::date, current_date),
         greatest(1, least(1440, coalesce((v_item->>'minutes')::int, 30))),
         v_item->>'description', coalesce((v_item->>'is_billable')::boolean, false),
         'ai_suggested', new.id);
    end loop;

  elsif new.job_type = 'payment_match' then
    for v_item in select value from jsonb_array_elements(coalesce(new.result->'matches','[]'::jsonb)) loop
      if (v_item->>'transaction_id') is null then continue; end if;
      insert into public.payment_matches
        (org_id, transaction_id, invoice_out_id, invoice_in_id, matched_amount, confidence, matched_by, status, job_id)
      values
        (new.org_id, (v_item->>'transaction_id')::uuid,
         nullif(v_item->>'invoice_out_id','')::uuid,
         nullif(v_item->>'invoice_in_id','')::uuid,
         coalesce((v_item->>'matched_amount')::numeric, 0),
         (v_item->>'confidence')::real, 'ai', 'suggested', new.id)
      on conflict do nothing;
      update public.bank_transactions set match_status = 'suggested'
       where id = (v_item->>'transaction_id')::uuid and match_status = 'unmatched';
    end loop;

  elsif new.job_type = 'account_assign' then
    update public.invoices_in
       set extraction = coalesce(extraction, '{}'::jsonb)
         || jsonb_build_object('suggested_account', new.result->>'account',
                               'account_confidence', new.result->>'confidence')
     where id = (new.payload->>'invoice_in_id')::uuid and org_id = new.org_id;

  elsif new.job_type = 'transcribe_call' then
    update public.call_logs
       set transcript = new.result->>'transcript', job_id = new.id, updated_at = now()
     where id = (new.payload->>'call_id')::uuid and org_id = new.org_id
     returning * into v_call;
    if v_call.id is not null and not exists (
      select 1 from public.agent_jobs where org_id = new.org_id and job_type = 'summarize_call'
        and payload->>'call_id' = v_call.id::text and status in ('queued','claimed','running','done')
    ) then
      insert into public.agent_jobs (org_id, job_type, priority, payload)
      values (new.org_id, 'summarize_call', 4, jsonb_build_object('call_id', v_call.id));
    end if;

  elsif new.job_type = 'summarize_call' then
    update public.call_logs
       set summary = new.result->>'summary', outcome = nullif(new.result->>'outcome','')
     where id = (new.payload->>'call_id')::uuid and org_id = new.org_id
     returning * into v_call;
    if v_call.id is not null and (new.result->>'follow_up_title') is not null then
      insert into public.tasks (org_id, case_id, title, description, source, source_entity_type, source_entity_id, job_id)
      values (new.org_id, v_call.case_id, new.result->>'follow_up_title', 'Aus Anruf', 'manual', 'call_log', v_call.id, new.id)
      returning id into v_task_id;
      update public.call_logs set follow_up_task_id = v_task_id where id = v_call.id;
    end if;
    if v_call.id is not null and v_call.case_id is not null then
      insert into public.case_events (org_id, case_id, event_type, title, entity_type, entity_id, actor_type, job_id)
      values (new.org_id, v_call.case_id, 'call_logged',
              'Anruf zusammengefasst', 'call_log', v_call.id, 'ai', new.id);
    end if;

  elsif new.job_type = 'extract_contract' then
    update public.contracts
       set extraction = new.result, extraction_confidence = (new.result->>'confidence')::real,
           title = coalesce(nullif(new.result->>'title',''), title),
           category = coalesce(nullif(new.result->>'category',''), category),
           amount = coalesce(nullif(new.result->>'amount','')::numeric, amount),
           billing_cycle = coalesce(nullif(new.result->>'billing_cycle',''), billing_cycle),
           notice_period_months = coalesce(nullif(new.result->>'notice_period_months','')::int, notice_period_months),
           notice_deadline = coalesce(nullif(new.result->>'notice_deadline','')::date, notice_deadline),
           ends_on = coalesce(nullif(new.result->>'ends_on','')::date, ends_on),
           updated_at = now()
     where id = (new.payload->>'contract_id')::uuid and org_id = new.org_id;

  elsif new.job_type = 'contract_watch' then
    for v_item in select value from jsonb_array_elements(coalesce(new.result->'findings','[]'::jsonb)) loop
      insert into public.agent_findings
        (org_id, kind, severity, title, description, suggested_action, dedupe_key, job_id, entity_type, entity_id)
      values
        (new.org_id, 'risk', coalesce((v_item->>'severity')::smallint, 3),
         v_item->>'title', v_item->>'description', v_item->'suggested_action',
         coalesce(v_item->>'dedupe_key', v_item->>'title'), new.id,
         'contract', nullif(v_item->>'contract_id','')::uuid)
      on conflict (org_id, dedupe_key) do nothing;
      v_count := v_count + 1;
    end loop;
    if v_count > 0 then
      perform public.notify_org(new.org_id, 'contract_watch',
        v_count || ' Vertrags-Fristen im Blick', null, 'contract', null);
    end if;
  end if;
  return new;
end $$;

create trigger trg_apply_job_result_p6
  after update on public.agent_jobs
  for each row when (old.status is distinct from 'done' and new.status = 'done' and new.result is not null)
  execute function public.apply_job_result_p6();

-- ---------- pg_cron (Betreiber — siehe CHANGELOG Etappe 6) ----------
-- select cron.schedule('contract-watch', '0 5 * * 1', $$select public.enqueue_org_jobs('contract_watch', 9)$$);
-- select cron.schedule('time-suggest',   '0 17 * * 1-5', $$select public.enqueue_org_jobs('time_suggest', 7)$$);
