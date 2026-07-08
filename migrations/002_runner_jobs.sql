-- ============================================================
-- 002_runner_jobs.sql — Agent-Runner (BYO Claude Max) & Job-Queue
-- ============================================================

-- ---------- Runner (lokaler Daemon pro Nutzer) ----------
create type public.ai_provider as enum ('claude_cli','codex_cli','anthropic_api');

create table public.runners (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text not null default 'Mein Runner',       -- z.B. "Büro-PC", "VPS"
  token_hash     text not null unique,                      -- Hash des Runner-Tokens (Klartext nur einmal beim Pairing)
  provider       public.ai_provider not null default 'claude_cli',
  capabilities   jsonb not null default '{}'::jsonb,        -- {"whisper":true,"ocr":true,...}
  max_jobs_per_hour int not null default 60,                -- Selbst-Drosselung (Max-Abo schonen)
  daily_job_limit   int not null default 500,
  status         text not null default 'offline' check (status in ('online','offline','disabled')),
  last_heartbeat timestamptz,
  version        text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_runners_org on public.runners(org_id);
create index idx_runners_user on public.runners(user_id);
create trigger trg_runners_updated before update on public.runners
  for each row execute function public.set_updated_at();

-- ---------- Pairing-Codes (kurzlebig) ----------
create table public.runner_pairing_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  org_id      uuid not null references public.orgs(id) on delete cascade,
  code        text not null unique,                         -- 8-stellig, wird vom Runner angezeigt
  expires_at  timestamptz not null default now() + interval '10 minutes',
  claimed_at  timestamptz,
  runner_id   uuid references public.runners(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index idx_pairing_user on public.runner_pairing_codes(user_id);

-- ---------- Job-Queue ----------
create type public.job_status as enum ('queued','claimed','running','done','failed','cancelled','expired');

create table public.agent_jobs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  created_by     uuid references auth.users(id) on delete set null,  -- null = System/Cron
  job_type       text not null,          -- 'classify_email','case_match','draft_reply','gap_scan',...
  priority       int  not null default 5,        -- 1 = interaktiv (Nutzer wartet) ... 9 = Nacht-Batch
  payload        jsonb not null default '{}'::jsonb,   -- Referenzen (IDs), KEINE Volltexte — Kontext baut Edge Function
  context_hint   jsonb not null default '{}'::jsonb,   -- Steuerung für build-job-context
  status         public.job_status not null default 'queued',
  claimed_by     uuid references public.runners(id) on delete set null,
  claimed_at     timestamptz,
  heartbeat_at   timestamptz,
  max_runtime_sec int not null default 300,
  attempts       int not null default 0,
  max_attempts   int not null default 3,
  run_after      timestamptz not null default now(),    -- geplante Jobs / Backoff
  result         jsonb,
  result_hash    text,                                   -- Idempotenz
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_jobs_claim on public.agent_jobs(org_id, status, priority, run_after)
  where status in ('queued','claimed');
create index idx_jobs_runner on public.agent_jobs(claimed_by) where status in ('claimed','running');
create index idx_jobs_type_time on public.agent_jobs(org_id, job_type, created_at desc);
create trigger trg_jobs_updated before update on public.agent_jobs
  for each row execute function public.set_updated_at();

-- ---------- Job-Ereignisprotokoll ----------
create table public.agent_job_events (
  id         bigint generated always as identity primary key,
  job_id     uuid not null references public.agent_jobs(id) on delete cascade,
  event      text not null,               -- 'claimed','started','retry','done','failed','timeout'
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_job_events_job on public.agent_job_events(job_id);

-- ---------- Stilprofile (gelernter Schreibstil pro Nutzer) ----------
create table public.ai_style_profiles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  profile     jsonb not null default '{}'::jsonb,   -- Anrede, Tonalität, Länge, Floskeln, Sprachen
  sample_count int not null default 0,
  built_at    timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, user_id)
);
create trigger trg_style_updated before update on public.ai_style_profiles
  for each row execute function public.set_updated_at();
