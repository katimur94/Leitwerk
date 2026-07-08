-- ============================================================
-- 007_knowledge.sql — Dokumente, Notizen, Wissen, Embeddings, Meetings
-- ============================================================

-- ---------- Dokumente (zentraler Dateibereich) ----------
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  case_id       uuid references public.cases(id) on delete set null,
  contact_id    uuid references public.contacts(id) on delete set null,
  title         text not null,
  storage_path  text not null,                     -- Bucket 'documents'
  mime_type     text,
  size_bytes    bigint,
  version       int not null default 1,
  previous_version_id uuid references public.documents(id) on delete set null,
  source        text not null default 'upload'
                check (source in ('upload','mail_attachment','generated','scan')),
  ocr_text      text,                              -- via ocr_document-Job
  ocr_done_at   timestamptz,
  ai_kind       text,                              -- 'rechnung','vertrag','plan','protokoll',...
  search_tsv    tsvector generated always as (
                  to_tsvector('german', coalesce(title,'') || ' ' || coalesce(ocr_text,''))
                ) stored,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_docs_org on public.documents(org_id, created_at desc);
create index idx_docs_case on public.documents(case_id);
create index idx_docs_contact on public.documents(contact_id);
create index idx_docs_tsv on public.documents using gin(search_tsv);
create trigger trg_docs_updated before update on public.documents
  for each row execute function public.set_updated_at();

-- FKs aus 003/006 nachziehen:
alter table public.mail_attachments
  add constraint fk_attach_document foreign key (document_id)
  references public.documents(id) on delete set null;
create index idx_attach_document on public.mail_attachments(document_id);

alter table public.invoices_in
  add constraint fk_inv_in_document foreign key (document_id)
  references public.documents(id) on delete set null;
create index idx_inv_in_document on public.invoices_in(document_id);

-- ---------- Notizen ----------
create table public.notes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  case_id     uuid references public.cases(id) on delete set null,
  contact_id  uuid references public.contacts(id) on delete set null,
  title       text,
  body_md     text not null,
  source      text not null default 'manual' check (source in ('manual','voice','ai')),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_notes_org on public.notes(org_id, created_at desc);
create index idx_notes_case on public.notes(case_id);
create index idx_notes_contact on public.notes(contact_id);
create trigger trg_notes_updated before update on public.notes
  for each row execute function public.set_updated_at();

-- ---------- Institutionelles Wissen (destillierte Fakten) ----------
create table public.knowledge_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  fact         text not null,                      -- "Stadt X verlangt immer Formular Y"
  category     text,                               -- 'kunde','lieferant','prozess','behörde'
  company_id   uuid references public.companies(id) on delete set null,
  contact_id   uuid references public.contacts(id) on delete set null,
  source_type  text,                               -- 'mail_message','meeting','note','manual'
  source_id    uuid,
  confidence   real not null default 0.8,
  status       text not null default 'proposed' check (status in ('proposed','confirmed','rejected','outdated')),
  confirmed_by uuid references auth.users(id) on delete set null,
  job_id       uuid references public.agent_jobs(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_knowledge_org on public.knowledge_items(org_id, status);
create index idx_knowledge_company on public.knowledge_items(company_id);
create index idx_knowledge_contact on public.knowledge_items(contact_id);
create trigger trg_knowledge_updated before update on public.knowledge_items
  for each row execute function public.set_updated_at();

-- ---------- Embeddings (semantische Suche über alles) ----------
-- Dimension 1024 als Default (z.B. multilingual-e5-large / bge-m3, lokal im Runner erzeugbar).
create table public.embeddings (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  entity_type  text not null check (entity_type in
                ('mail_message','document','note','knowledge_item','meeting_segment','case')),
  entity_id    uuid not null,
  chunk_index  int not null default 0,
  content      text not null,                      -- der eingebettete Textausschnitt
  embedding    vector(1024) not null,
  created_at   timestamptz not null default now(),
  unique (entity_type, entity_id, chunk_index)
);
create index idx_embeddings_org on public.embeddings(org_id);
create index idx_embeddings_vec on public.embeddings
  using hnsw (embedding vector_cosine_ops);

-- ---------- Meetings ----------
create table public.meetings (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  case_id       uuid references public.cases(id) on delete set null,
  title         text not null,
  held_at       timestamptz not null default now(),
  audio_storage_path text,                         -- Bucket 'audio'
  transcript    text,                              -- via Runner (whisper lokal)
  transcript_done_at timestamptz,
  protocol_md   text,                              -- KI-Protokoll
  decisions     jsonb not null default '[]'::jsonb,
  open_questions jsonb not null default '[]'::jsonb,
  participants  jsonb not null default '[]'::jsonb,
  job_id        uuid references public.agent_jobs(id) on delete set null,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_meetings_org on public.meetings(org_id, held_at desc);
create index idx_meetings_case on public.meetings(case_id);
create trigger trg_meetings_updated before update on public.meetings
  for each row execute function public.set_updated_at();

-- Segmente (für Sprecher/Zeitmarken + Embeddings)
create table public.meeting_segments (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings(id) on delete cascade,
  org_id      uuid not null references public.orgs(id) on delete cascade,
  speaker     text,
  starts_sec  real,
  ends_sec    real,
  content     text not null
);
create index idx_meeting_segments_meeting on public.meeting_segments(meeting_id);
create index idx_meeting_segments_org on public.meeting_segments(org_id);
