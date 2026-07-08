-- ============================================================
-- 022_p5_team_calendar.sql — Etappe 5: Team & Ausbau
-- 1) Geteilte Postfächer: Thread-Zuweisung an Mitglieder (mail_threads.assignee_id)
-- 2) Interne Kommentare + @Mentions (thread_comments, notify_user)
-- 3) Kalender: Termin↔Vorgang, calendar_briefing-Job vor Terminen
-- 4) apply_job_result_p5 (Supplement): calendar_briefing, suggest_slots, weekly_report
--    — als ZUSÄTZLICHER Trigger, apply_job_result aus 021 bleibt unangetastet
-- 5) Fristenkalender = wiederkehrende tasks (kein neues Schema)
-- Datenexport: Edge Function export-org (kein DB-Schema nötig).
-- ============================================================

-- ---------- Benachrichtigung an EINEN Nutzer (Ergänzung zu notify_org) ----------
create or replace function public.notify_user(
  p_org uuid, p_user uuid, p_kind text, p_title text, p_body text,
  p_entity_type text default null, p_entity_id uuid default null
) returns void language sql security definer set search_path = public as $$
  insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id)
  select p_org, p_user, p_kind, p_title, p_body, p_entity_type, p_entity_id
   where exists (select 1 from public.org_members m
                  where m.org_id = p_org and m.user_id = p_user and m.is_active);
$$;
revoke execute on function public.notify_user(uuid, uuid, text, text, text, text, uuid)
  from public, anon, authenticated;

-- ---------- 1) Thread-Zuweisung ----------
alter table public.mail_threads
  add column if not exists assignee_id uuid references auth.users(id) on delete set null;
create index if not exists idx_threads_assignee on public.mail_threads(org_id, assignee_id)
  where assignee_id is not null;

create or replace function public.assign_thread(p_thread uuid, p_assignee uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_thread public.mail_threads;
begin
  select * into v_thread from public.mail_threads where id = p_thread;
  if v_thread.id is null then raise exception 'Thread nicht gefunden'; end if;
  if not public.has_org_role(v_thread.org_id, array['owner','admin','member']::public.org_role[]) then
    raise exception 'Keine Berechtigung';
  end if;
  -- Zuweisungsziel muss aktives Mitglied sein (oder null = Zuweisung aufheben)
  if p_assignee is not null and not exists (
    select 1 from public.org_members m
     where m.org_id = v_thread.org_id and m.user_id = p_assignee and m.is_active
  ) then raise exception 'Zuweisung nur an aktive Mitglieder'; end if;

  update public.mail_threads set assignee_id = p_assignee where id = p_thread;

  if p_assignee is not null and p_assignee <> coalesce(v_thread.assignee_id, '00000000-0000-0000-0000-000000000000'::uuid) then
    perform public.notify_user(v_thread.org_id, p_assignee, 'thread_assigned',
      'Dir zugewiesen: ' || coalesce(v_thread.subject, 'E-Mail-Thread'),
      null, 'mail_thread', p_thread);
    if v_thread.case_id is not null then
      insert into public.case_events (org_id, case_id, event_type, title, entity_type, entity_id, actor_type, actor_id)
      values (v_thread.org_id, v_thread.case_id, 'thread_assigned',
              'Thread zugewiesen', 'mail_thread', p_thread, 'user', (select auth.uid()));
    end if;
  end if;
end $$;
grant execute on function public.assign_thread(uuid, uuid) to authenticated;

-- ---------- 2) Interne Kommentare + @Mentions ----------
create table if not exists public.thread_comments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  thread_id   uuid not null references public.mail_threads(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  body        text not null,
  mentions    uuid[] not null default '{}',      -- erwähnte user_ids
  created_at  timestamptz not null default now()
);
create index if not exists idx_thread_comments_thread on public.thread_comments(thread_id, created_at);
create index if not exists idx_thread_comments_org on public.thread_comments(org_id, created_at desc);
alter table public.thread_comments enable row level security;

create policy thread_comments_select on public.thread_comments for select
  using (public.is_org_member(org_id));
create policy thread_comments_insert on public.thread_comments for insert
  with check (public.has_org_role(org_id, array['owner','admin','member']::public.org_role[])
              and author_id = (select auth.uid()));

-- @Mentions benachrichtigen (kind='mention')
create or replace function public.on_thread_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_thread public.mail_threads;
begin
  select * into v_thread from public.mail_threads where id = new.thread_id;
  foreach v_uid in array coalesce(new.mentions, '{}') loop
    if v_uid = new.author_id then continue; end if;   -- sich selbst nicht pingen
    perform public.notify_user(new.org_id, v_uid, 'mention',
      'Erwähnt in „' || coalesce(v_thread.subject, 'Thread') || '“',
      left(new.body, 140), 'mail_thread', new.thread_id);
  end loop;
  return new;
end $$;
create trigger trg_thread_comment
  after insert on public.thread_comments
  for each row execute function public.on_thread_comment();

-- ---------- 3) Kalender: Briefing vor Terminen ----------
-- Nach dem Sync: für baldige Termine (nächste 24h) ohne Briefing einen
-- calendar_briefing-Job einreihen (Automation auto_calendar_briefing, optional).
create or replace function public.on_calendar_event_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'cancelled'
     and new.ai_briefing is null
     and new.starts_at between now() and now() + interval '24 hours'
     and (public.get_automation(new.org_id, 'auto_calendar_briefing')).id is not null
     and not exists (
       select 1 from public.agent_jobs
        where org_id = new.org_id and job_type = 'calendar_briefing'
          and payload->>'event_id' = new.id::text
          and status in ('queued','claimed','running','done')
     ) then
    insert into public.agent_jobs (org_id, job_type, priority, payload)
    values (new.org_id, 'calendar_briefing', 6, jsonb_build_object('event_id', new.id));
  end if;
  return new;
end $$;
create trigger trg_calendar_event_change
  after insert or update on public.calendar_events
  for each row execute function public.on_calendar_event_change();

-- ---------- 4) apply_job_result_p5 (Supplement-Trigger) ----------
create or replace function public.apply_job_result_p5()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_event public.calendar_events;
  v_account_id uuid;
  v_thread public.mail_threads;
  v_item jsonb;
  v_slots text;
begin
  if new.job_type = 'calendar_briefing' then
    update public.calendar_events
       set ai_briefing = new.result->>'briefing_md', ai_briefing_at = now()
     where id = (new.payload->>'event_id')::uuid and org_id = new.org_id;

  elsif new.job_type = 'suggest_slots' then
    -- Terminvorschlag: 3 freie Slots als Antwort-Entwurf am Thread
    select * into v_thread from public.mail_threads
     where id = (new.payload->>'thread_id')::uuid and org_id = new.org_id;
    if v_thread.id is null then return new; end if;
    v_slots := '';
    for v_item in select value from jsonb_array_elements(coalesce(new.result->'slots','[]'::jsonb)) loop
      v_slots := v_slots || '<li>' || (v_item->>'label') || '</li>';
    end loop;
    insert into public.mail_drafts
      (org_id, account_id, thread_id, source, job_id, to_addrs, subject, body_html, status)
    values
      (new.org_id, v_thread.account_id, v_thread.id, 'ai', new.id,
       coalesce(new.result->'to_addrs','[]'::jsonb),
       new.result->>'subject',
       coalesce(new.result->>'body_html',
         '<p>Guten Tag,</p><p>gern schlage ich folgende Termine vor:</p><ul>' || v_slots ||
         '</ul><p>Passt Ihnen einer davon?</p>'),
       'draft');

  elsif new.job_type = 'weekly_report' then
    insert into public.briefings (org_id, kind, for_date, content_md, items, job_id)
    values (new.org_id, 'weekly', current_date,
            coalesce(new.result->>'content_md',''),
            coalesce(new.result->'items','[]'::jsonb), new.id)
    on conflict do nothing;
    perform public.notify_org(new.org_id, 'weekly_report',
      'Dein Wochenreport ist da', null, 'briefing', null);
  end if;
  return new;
end $$;

create trigger trg_apply_job_result_p5
  after update on public.agent_jobs
  for each row when (old.status is distinct from 'done' and new.status = 'done' and new.result is not null)
  execute function public.apply_job_result_p5();

-- ---------- pg_cron (Betreiber — siehe CHANGELOG Etappe 5) ----------
-- select cron.schedule('weekly-report', '0 15 * * 5', $$select public.enqueue_org_jobs('weekly_report', 8)$$);
-- select cron.schedule('calendar-sync', '*/10 * * * *', $$select public.enqueue_org_jobs('sync_calendar', 6)$$);
