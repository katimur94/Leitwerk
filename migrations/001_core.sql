-- ============================================================
-- 001_core.sql — Extensions, Organisationen, Profile, Audit
-- BüroOS (Arbeitstitel) — eigenständiges Projekt, KEIN SanDoku
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists vector;      -- pgvector für Embeddings
create extension if not exists pg_trgm;     -- Fuzzy-Suche
-- pg_cron wird über das Supabase-Dashboard aktiviert (Migration 009 legt Jobs an)

-- ---------- Utility: updated_at Trigger ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- Organisationen ----------
create table public.orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  locale      text not null default 'de-DE',
  timezone    text not null default 'Europe/Berlin',
  settings    jsonb not null default '{}'::jsonb,
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create trigger trg_orgs_updated before update on public.orgs
  for each row execute function public.set_updated_at();

-- ---------- Profile (1:1 zu auth.users) ----------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  avatar_url    text,
  locale        text not null default 'de-DE',
  timezone      text not null default 'Europe/Berlin',
  active_org_id uuid references public.orgs(id) on delete set null,
  prefs         jsonb not null default '{}'::jsonb,  -- Benachrichtigungen, UI etc.
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_profiles_active_org on public.profiles(active_org_id);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-Profil bei Registrierung
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  return new;
end $$;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Mitgliedschaften & Rollen ----------
create type public.org_role as enum ('owner','admin','member','viewer');

create table public.org_members (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        public.org_role not null default 'member',
  is_active   boolean not null default true,
  joined_at   timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index idx_org_members_user on public.org_members(user_id);

-- ---------- Einladungen ----------
create table public.org_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  email       text not null,
  role        public.org_role not null default 'member',
  token_hash  text not null unique,            -- Hash des Einladungs-Tokens
  invited_by  uuid not null references auth.users(id),
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index idx_org_invites_org on public.org_invites(org_id);
create index idx_org_invites_email on public.org_invites(lower(email));

-- ---------- Audit-Log (append-only) ----------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.orgs(id) on delete cascade,
  actor_type  text not null check (actor_type in ('user','runner','system')),
  actor_id    uuid,                             -- user_id oder runner_id
  action      text not null,                    -- z.B. 'mail.sent','invoice.approved','automation.executed'
  entity_type text,                             -- 'mail_message','invoice_out',...
  entity_id   uuid,
  job_id      uuid,                             -- Referenz auf agent_jobs (Migration 002), bewusst ohne FK (append-only)
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index idx_audit_org_time on public.audit_log(org_id, created_at desc);
create index idx_audit_entity on public.audit_log(entity_type, entity_id);
-- Kein UPDATE/DELETE: wird in 009 per Policy + fehlenden Grants erzwungen
