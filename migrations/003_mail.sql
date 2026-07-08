-- ============================================================
-- 003_mail.sql — E-Mail-Hub
-- ============================================================

create type public.mail_provider as enum ('gmail','imap');
create type public.mail_sync_state as enum ('pending','syncing','ok','error','revoked');

-- ---------- Verbundene Postfächer ----------
create table public.mail_accounts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,  -- Besitzer der Verbindung
  provider       public.mail_provider not null,
  email_address  text not null,
  display_name   text,
  is_shared      boolean not null default false,     -- geteiltes Postfach (info@) für die Org
  -- OAuth-Tokens liegen NICHT hier, sondern in Supabase Vault; hier nur die Referenz:
  vault_secret_id uuid,                              -- Verweis auf vault.secrets
  imap_config    jsonb,                              -- host/port/user (Passwort im Vault)
  sync_state     public.mail_sync_state not null default 'pending',
  sync_cursor    text,                               -- Gmail historyId bzw. IMAP UIDVALIDITY/UID
  last_sync_at   timestamptz,
  last_error     text,
  signature_html text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, email_address)
);
create index idx_mail_accounts_org on public.mail_accounts(org_id);
create index idx_mail_accounts_user on public.mail_accounts(user_id);
create trigger trg_mail_accounts_updated before update on public.mail_accounts
  for each row execute function public.set_updated_at();

-- ---------- Threads ----------
create table public.mail_threads (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  account_id      uuid not null references public.mail_accounts(id) on delete cascade,
  provider_thread_id text not null,                  -- Gmail threadId / synthetisch bei IMAP
  subject         text,
  snippet         text,
  participants    jsonb not null default '[]'::jsonb, -- [{name,email}]
  message_count   int not null default 0,
  last_message_at timestamptz,
  is_unread       boolean not null default true,
  labels          text[] not null default '{}',
  -- KI-Anreicherung:
  category        text,                              -- 'anfrage','auftrag','rechnung','termin','mahnung','newsletter','sonstiges'
  urgency         smallint,                          -- 1..5
  ai_summary      text,
  case_id         uuid,                               -- FK auf cases folgt in 004 (deferred, siehe unten)
  snoozed_until   timestamptz,
  archived_at     timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (account_id, provider_thread_id)
);
create index idx_threads_org_last on public.mail_threads(org_id, last_message_at desc);
create index idx_threads_case on public.mail_threads(case_id);
create index idx_threads_category on public.mail_threads(org_id, category);
create trigger trg_threads_updated before update on public.mail_threads
  for each row execute function public.set_updated_at();

-- ---------- Nachrichten ----------
create table public.mail_messages (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  thread_id        uuid not null references public.mail_threads(id) on delete cascade,
  account_id       uuid not null references public.mail_accounts(id) on delete cascade,
  provider_msg_id  text not null,
  rfc822_message_id text,
  direction        text not null check (direction in ('inbound','outbound')),
  from_addr        jsonb not null,                    -- {name,email}
  to_addrs         jsonb not null default '[]'::jsonb,
  cc_addrs         jsonb not null default '[]'::jsonb,
  bcc_addrs        jsonb not null default '[]'::jsonb,
  sent_at          timestamptz,
  subject          text,
  body_text        text,
  body_html        text,
  has_attachments  boolean not null default false,
  is_read          boolean not null default false,
  -- KI-Extraktion:
  extracted        jsonb not null default '{}'::jsonb,  -- commitments, Fristen, Beträge, erkannte Absichten
  search_tsv       tsvector generated always as (
                     to_tsvector('german', coalesce(subject,'') || ' ' || coalesce(body_text,''))
                   ) stored,
  created_at       timestamptz not null default now(),
  unique (account_id, provider_msg_id)
);
create index idx_msgs_thread on public.mail_messages(thread_id, sent_at);
create index idx_msgs_org_time on public.mail_messages(org_id, sent_at desc);
create index idx_msgs_tsv on public.mail_messages using gin(search_tsv);

-- ---------- Anhänge ----------
create table public.mail_attachments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  message_id   uuid not null references public.mail_messages(id) on delete cascade,
  filename     text not null,
  mime_type    text,
  size_bytes   bigint,
  storage_path text,                                  -- Bucket 'attachments'
  document_id  uuid,                                  -- FK auf documents (007), nachgezogen dort
  ai_kind      text,                                  -- 'rechnung','angebot','lieferschein','sonstiges'
  created_at   timestamptz not null default now()
);
create index idx_attach_msg on public.mail_attachments(message_id);
create index idx_attach_org_kind on public.mail_attachments(org_id, ai_kind);

-- ---------- Entwürfe (inkl. KI-Entwürfe, geplantes Senden, Halte-Zone) ----------
create table public.mail_drafts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  account_id    uuid not null references public.mail_accounts(id) on delete cascade,
  thread_id     uuid references public.mail_threads(id) on delete set null,
  created_by    uuid references auth.users(id) on delete set null,   -- null = KI
  source        text not null default 'user' check (source in ('user','ai','automation')),
  job_id        uuid references public.agent_jobs(id) on delete set null,
  to_addrs      jsonb not null default '[]'::jsonb,
  cc_addrs      jsonb not null default '[]'::jsonb,
  subject       text,
  body_html     text,
  status        text not null default 'draft'
                check (status in ('draft','approved','scheduled','holding','sent','discarded')),
  send_after    timestamptz,                          -- geplantes Senden / Halte-Zone (Autonomie Stufe 3)
  sent_message_id uuid references public.mail_messages(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_drafts_org_status on public.mail_drafts(org_id, status);
create index idx_drafts_thread on public.mail_drafts(thread_id);
create trigger trg_drafts_updated before update on public.mail_drafts
  for each row execute function public.set_updated_at();

-- ---------- Textbausteine / Vorlagen ----------
create table public.mail_templates (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  name       text not null,
  subject    text,
  body_html  text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_templates_org on public.mail_templates(org_id);
create trigger trg_templates_updated before update on public.mail_templates
  for each row execute function public.set_updated_at();
