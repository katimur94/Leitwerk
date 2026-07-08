-- ============================================================
-- 016_p0_bootstrap.sql — Phase-0-Bootstrap
-- 1) Org-Ersteller wird automatisch Owner (sonst kann nach dem
--    Anlegen einer Org niemand die Mitgliedschafts-Policies erfüllen).
-- 2) Realtime-Publikation für Live-Status in der PWA
--    (agent_jobs, runners, notifications).
-- ============================================================

-- ---------- Owner-Mitgliedschaft bei Org-Anlage ----------
create or replace function public.handle_new_org_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.org_members (org_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (org_id, user_id) do nothing;
  return new;
end $$;

create trigger trg_on_org_created_owner
  after insert on public.orgs
  for each row execute function public.handle_new_org_owner();

-- ---------- Realtime (RLS-gefiltert via WALRUS) ----------
alter publication supabase_realtime add table public.agent_jobs;
alter publication supabase_realtime add table public.runners;
alter publication supabase_realtime add table public.notifications;
