# Changelog

## Etappe 5 — Team & Ausbau (2026-07-08)

Kompletter Phase-5-Umfang aus `docs/ROADMAP_PROMPTS.md` (Migration `022_p5_team_calendar.sql`):

- **Geteilte Postfächer:** Thread-Zuweisung an Mitglieder (`mail_threads.assignee_id`
  + RPC `assign_thread` mit Member-Check, Benachrichtigung, Case-Event). Interne
  **Kommentare mit @Mentions** (`thread_comments` + Trigger `on_thread_comment` →
  `notify_user`, kind='mention'); UI-Panel im Thread löst @Name zu user_ids auf.
  Kein Weiterleiten-Chaos (MASTERPLAN §4 Y).
- **Kalender:** Connector `sync_calendar` (Google Calendar, kurzlebiges Token aus dem
  Vault über die neue Edge Function **`calendar-sync`**, Delta per syncToken, All-Day-
  fähig), Event↔Vorgang-Verknüpfung. Skill **`calendar_briefing`** erzeugt vor baldigen
  Terminen (≤24h) automatisch ein Kontext-Briefing (`ai_briefing`) aus offenen Vorgängen
  und letzten Mails der Teilnehmer. Skill **`suggest_slots`** berechnet serverseitig
  3 freie Werktags-Slots (kollisionsgeprüft) und entwirft eine Terminvorschlags-Antwort.
- **IMAP/SMTP-Connector** als Gmail-Alternative: testbare RFC822-Normalisierung
  (`imapMessageToIngest`) speist dieselbe `/ingest`-Pipeline wie Gmail (Transport pluggbar).
- **Fristenkalender:** wiederkehrende Pflichten als `tasks` mit `recurrence` — im
  Kalender-Modul gelistet (kein neues Schema).
- **Wochenreport:** Skill `weekly_report` (freitags) → `briefings` kind='weekly' +
  Benachrichtigung; „Heute“ zeigt den Wochenrückblick als eigene Karte.
- **Datenexport (kein Lock-in):** Edge Function **`export-org`** legt einen JSON-Snapshot
  aller org-scoped Tabellen im Bucket `exports` ab (signierte URL); nur Owner/Admin.
- **Serverlogik:** `apply_job_result_p5` als **zusätzlicher** Trigger (lässt v4 aus 021
  unangetastet): `calendar_briefing`, `suggest_slots`, `weekly_report`.
- **Mock + E2E:** Mock spiegelt alle 022-RPCs/Trigger (assign_thread,
  thread_comments-@Mentions, calendar-sync, export-org, apply_job_result_p5), seedet
  einen verbundenen Kalender mit baldigem Termin. E2E auf 46 Screenshots erweitert
  (Zuweisung + Kommentar, Kalender-Briefing, Datenexport, Wochenreport).

### Manuelle Schritte für den Betreiber (Deploy Etappe 5)

1. **Migration einspielen:** `supabase db push` (neu: `022_p5_team_calendar.sql`).
2. **Google-OAuth-Scope für Kalender** ergänzen (`calendar.readonly` bzw. `calendar`)
   und pro Nutzer ein `calendar_accounts`-Konto anlegen (gleicher Vault-Refresh-Token
   wie Gmail möglich). Siehe `tutorials/02_google_oauth.md`.
3. **Edge Functions deployen:**
   `supabase functions deploy calendar-sync export-org build-job-context`.
4. **pg_cron-Jobs anlegen** (SQL-Editor):
   ```sql
   select cron.schedule('weekly-report', '0 15 * * 5', $$select public.enqueue_org_jobs('weekly_report', 8)$$);
   -- Kalender-Sync pro verbundenem Konto (Beispiel; enqueue je calendar_account):
   -- select cron.schedule('calendar-sync', '*/10 * * * *', $$
   --   insert into public.agent_jobs (org_id, job_type, priority, payload)
   --   select org_id, 'sync_calendar', 6, jsonb_build_object('account_id', id)
   --     from public.calendar_accounts$$);
   ```
5. **PWA neu bauen/deployen:** `pnpm --filter @leitwerk/pwa build`.
6. **Runner aktualisieren** (alle Nutzer): `npm update -g leitwerk-runner`
   (neue Skills `sync_calendar`, `calendar_briefing`, `suggest_slots`, `weekly_report`;
   IMAP-Connector optional).

## Etappe 4 — Autonomie & Wissen (2026-07-08)

Kompletter Phase-4-Umfang aus `docs/ROADMAP_PROMPTS.md` (Migration `021_p4_autonomy_knowledge.sql`):

- **Autonomie-Regler serverseitig:** RPC `set_autonomy_level` mit **Hochstufen-Gate** —
  Stufe 3/4 gibt es erst ab `promote_threshold` Trefferquote über `promote_min_runs`
  Läufe (aus `trust_stats`, erzwungen in der DB, nicht nur UI). Der Client verliert
  per Spalten-Grant das Recht, `autonomy_level` direkt zu schreiben (nur noch
  `is_enabled`, `min_confidence`, `hold_minutes`). Automationen-Seite mit Regler 1–4,
  Erklärtexten pro Stufe, TrustMeter und Pausieren.
- **Stufe-3-Halte-Zone (Regel 4):** `maybe_autoschedule_draft` plant automatische
  Entwürfe (Nachfassen, Mahnungen) mit `send_after = jetzt + hold_minutes`, legt einen
  `automation_runs`-Lauf mit `status='holding'` an und benachrichtigt. HoldBanner
  (violett) in der App-Shell mit Sekunden-Countdown und **1-Klick-Stopp**
  (`stop_automation_run` → Draft zurück auf Entwurf, Outcome `corrected`). Cron
  `process_holding_runs` schließt abgelaufene Halte-Zonen ab; der Versand selbst
  läuft über den bestehenden `send-mail {mode:'due'}`-Pfad. Stufe 4 sendet sofort.
- **Notizen-Modul:** `notes` mit Markdown-Editor (Anlage/Bearbeiten/Löschen) und
  **Sprachnotiz** (MediaRecorder → Bucket `audio` → Job `transcribe_note`, Whisper
  **lokal** im Runner).
- **Institutionelles Wissen:** Skill `knowledge_distill` (wöchentlich) destilliert
  dauerhafte Fakten aus Mails/Meetings → `knowledge_items` (status `proposed`, Dedupe);
  Review-UI (Bestätigen/Ablehnen). Skill `build_style_profile` lernt den Schreibstil
  aus gesendeten Mails → `ai_style_profiles` (speist bereits `draft_reply`).
- **Meetings:** Audio-Upload → Skill `transcribe_meeting` (whisper.cpp **lokal**, keine
  Cloud) → Segmente + Folgejob `summarize_meeting` (KI-Protokoll, Entscheidungen,
  offene Fragen, Aufgaben `source='meeting'`). Meeting-Detail mit Protokoll und
  Case-Verknüpfung.
- **Kombinierte Suche:** RPC `search_combined` (Volltext `tsvector` + semantisch
  `pgvector`) über Mails, Vorgänge, Kontakte, Dokumente, Notizen, Wissen. CommandBar
  zeigt Volltext-Treffer sofort; „Semantisch suchen“ startet einen interaktiven
  `semantic_search`-Job (Priorität 1) — das Query-Embedding rechnet der **Runner
  lokal** (Embedder-Adapter `LEITWERK_EMBED_BIN`, sonst deterministischer
  Hash-Fallback), nie der Client. Backlog-Embeddings über Skill `embed_backlog`.
- **Mock + E2E:** Mock spiegelt alle 021-RPCs/Trigger (Autonomie-Gate,
  Halte-Zone + Stopp, `apply_job_result` v4, `search_combined`), seedet eine
  Stufe-3-Aktion in der Halte-Zone; Mock-Binaries `whisper-mock.cjs` (deterministisches
  Transkript) und Hash-Embeddings. E2E auf 42 Screenshots erweitert (Regler + Gate,
  Halte-Zone + Stopp, Notizen, Wissen bestätigen, Meeting → Protokoll, kombinierte Suche).

### Manuelle Schritte für den Betreiber (Deploy Etappe 4)

1. **Migration einspielen:** `supabase db push` (neu: `021_p4_autonomy_knowledge.sql`).
2. **Storage-Bucket anlegen** (einmalig, für Sprachnotizen + Meetings):
   ```sql
   insert into storage.buckets (id, name, public) values ('audio', 'audio', false)
   on conflict (id) do nothing;
   ```
   RLS-Policies für `audio` analog zu `attachments` (nur eigene Org; siehe tutorials/).
3. **pgvector aktivieren** (falls noch nicht): `create extension if not exists vector;`
   (die Tabelle `embeddings` aus Migration 007 nutzt `vector(1024)`).
4. **Edge Functions deployen:** `supabase functions deploy build-job-context mail-sync`.
5. **pg_cron-Jobs anlegen** (SQL-Editor):
   ```sql
   select cron.schedule('holding-runs',   '* * * * *',  $$select public.process_holding_runs()$$);
   select cron.schedule('knowledge',      '0 4 * * 6',  $$select public.enqueue_org_jobs('knowledge_distill', 9)$$);
   select cron.schedule('style-profiles', '0 4 * * 0',  $$select public.enqueue_org_jobs('build_style_profile', 9)$$);
   select cron.schedule('embed-backlog',  '30 2 * * *', $$select public.enqueue_org_jobs('embed_backlog', 9)$$);
   ```
6. **Runner-Setup für lokale KI-Nebenläufe** (pro Nutzer, optional aber empfohlen —
   siehe `tutorials/05_runner_installation.md (Abschnitt 6)`):
   - `LEITWERK_WHISPER_BIN` → Wrapper um whisper.cpp (Meetings/Sprachnotizen).
   - `LEITWERK_EMBED_BIN` → lokales Embedding-Modell (1024-dim, z. B. bge-m3);
     ohne Konfiguration nutzt der Runner ein deterministisches Hash-Embedding
     (grobe Ähnlichkeit, offline — für Produktion Modell setzen).
7. **PWA neu bauen/deployen:** `pnpm --filter @leitwerk/pwa build`.
8. **Runner aktualisieren** (alle Nutzer): `npm update -g leitwerk-runner`
   (neue Skills `transcribe_note`, `transcribe_meeting`, `summarize_meeting`,
   `knowledge_distill`, `build_style_profile`, `embed_backlog`, `semantic_search`).

## Etappe 3 — Finanzen: E-Rechnung, XRechnung, Mahnwesen (2026-07-08)

Kompletter Phase-3-Umfang aus `docs/ROADMAP_PROMPTS.md` (Migration `020_p3_finance.sql`):

- **Eingangsrechnungs-Erfassung (Skill `extract_invoice`, hybrid):** Liegt der Mail ein
  E-Rechnungs-XML bei (ZUGFeRD/Factur-X CII oder XRechnung UBL), liest der Runner es
  **deterministisch ohne KI** (Konfidenz 1.0); sonst naive PDF-Text-Extraktion
  (unkomprimierte Tj-Streams) bzw. Mail-Text → KI-Extraktion mit striktem Zod-Parsing.
  Anhang-Download läuft über `mail-sync /download` (Org-Pfad-Check). Anwendung
  serverseitig in `apply_job_result`: idempotent über `source_message_id`,
  Firmen-Upsert nach Ausstellername, Dubletten-Markierung (gleiche Nummer + Brutto),
  Ereignis `invoice_captured` durch die Regel-Engine.
- **Prüf-Workflow Eingang:** erfasst → in Prüfung → freigegeben → bezahlt (+ abgelehnt),
  `reviewed_by`/`approved_by`/`paid_at` protokolliert; „E-Rechnung“-Badge (violett)
  zeigt Format + KI-/Direktparser-Herkunft, Dubletten werden rot markiert.
- **Angebote & Ausgangsrechnungen:** gemeinsamer Beleg-Editor mit Positionsliste
  (MoneyCell: rechtsbündig, tabular-nums, Cent-Rechnung); **Summen berechnet die DB**
  (Trigger `recalc_invoice_totals`/`recalc_quote_totals` bei jeder Positionsänderung),
  Nummern atomar aus `next_number()`. Status-Workflows (Entwurf → freigegeben →
  versendet → bezahlt bzw. angenommen/abgelehnt), `quote_sent`/`quote_accepted`/
  `invoice_paid` laufen durch die Regel-Engine; versendete Angebote bekommen
  automatisch ein 7-Tage-Follow-up.
- **XRechnung-Export (`export-xrechnung`):** deterministischer UBL-2.1-Builder
  (`_shared/xrechnung.ts`, EN 16931 / CustomizationID xrechnung_3.0) mit cent-genauen
  USt-Gruppen und Kleinunternehmer-Kategorie E; **B2G erzwingt die Leitweg-ID
  serverseitig** (422 ohne `buyer_reference`); XML landet im Storage-Bucket `exports`
  + `xml_storage_path` an der Rechnung. Nur JWT-Mitglieder, **Viewer abgelehnt**
  (Rollenmatrix; das Finanzmodul ist für Viewer auch im UI unsichtbar).
  Golden-File-Test in `packages/shared` (Builder ist Deno-frei importierbar).
- **Mahnwesen (3 Stufen):** täglicher Cron `process_overdue_invoices` findet
  überfällige Ausgangsrechnungen, legt `dunning_runs` als **Vorschläge** an
  (Gebühren aus `org_profile.dunning_fees`, 7 Tage Abstand zwischen Stufen,
  max. Stufe 3) und reiht `draft_dunning`-Jobs ein (KI-Mahntext). Versand NUR nach
  Freigabe in der PWA — der Entwurf geht durch den geplanten Versand mit
  30-Sekunden-Rückholen (Regel 4). Überspringen wird protokolliert.
- **Finanz-Übersicht:** Kacheln „Offene Forderungen / Offene Eingangsrechnungen /
  Angebots-Pipeline“ (cent-genau summiert), Tabs Eingang · Rechnungen · Angebote ·
  Mahnwesen.
- **Mock + E2E:** Mock spiegelt alle 020-Trigger (Summen-Trigger, Mahn-Cron,
  `apply_job_result` v3, `export-xrechnung` inkl. B2G-Validierung); Demo-Mail #2
  trägt jetzt ein CII-XML als Anhang, „Gmail verbinden“ seedet zusätzlich eine
  10 Tage überfällige Ausgangsrechnung. E2E auf 36 Screenshots erweitert
  (Eingang → Prüfen, Rechnungs-Editor → XRechnung-Export, Mahnstufe 1 →
  Freigeben & senden). Fix im Mock: `mail-sync /download` verlangt wie die echte
  Edge Function kein `accountId` mehr.

### Manuelle Schritte für den Betreiber (Deploy Etappe 3)

1. **Migration einspielen:** `supabase db push` (neu: `020_p3_finance.sql`).
2. **Storage-Bucket anlegen** (einmalig, Dashboard → Storage oder SQL):
   ```sql
   insert into storage.buckets (id, name, public) values ('exports', 'exports', false)
   on conflict (id) do nothing;
   ```
3. **Edge Functions deployen:**
   `supabase functions deploy export-xrechnung mail-sync send-mail build-job-context`.
4. **pg_cron-Job für das Mahnwesen** (SQL-Editor):
   ```sql
   select cron.schedule('overdue-invoices', '15 6 * * *',
     $$select public.process_overdue_invoices()$$);
   ```
5. **PWA neu bauen/deployen:** `pnpm --filter @leitwerk/pwa build`.
6. **Runner aktualisieren** (alle Nutzer): `npm update -g leitwerk-runner`
   (neue Skills `extract_invoice`, `draft_dunning`).

## Etappe 2 — Aufgaben-Compiler, Wächter, Briefing (2026-07-08)

Kompletter Phase-2-Umfang aus `docs/ROADMAP_PROMPTS.md` (Migration `019_p2_tasks_watchdog.sql`):

- **Aufgaben-Compiler:** Skill `extract_commitments` (Verpflichtungen/Fristen aus jeder
  Inbound-Mail, Dubletten-Hinweis über bestehende Aufgaben derselben Quelle) →
  `tasks` source='mail_extract' mit AiBadge-Annahme-UI; „Verwerfen“ meldet
  `outcome='wrong'` in die Trefferquote. Job wird vom Trigger `on_mail_received`
  eingereiht (Automation `auto_extract_tasks`).
- **Aufgabenmodul komplett:** Liste mit Filtern, Anlage, Erledigen, Checklisten
  (`task_checklist_items`), Fälligkeit, Zuweisungs-Benachrichtigung
  (`task_assigned`), einfache Wiederholung (`recurrence.every_days` → Folgeaufgabe
  beim Erledigen), 3-Tage-Snooze (`snoozes`).
- **Follow-up-Engine:** `on_mail_sent_message` legt pro ausgehender Mail ein
  Follow-up an (Automation `auto_followup`, Standardfrist 4 Tage, Upsert);
  eingehende Antwort setzt es auf `answered`. Skill `followup_check` (stündlicher
  Cron) bewertet Überfälliges: `escalate` → Finding (dedupe `followup:<id>`) +
  automatischer Nachfass-Entwurf über die bestehende draft_reply-Pipeline
  (mail_drafts source='automation'). Kein Überfälliges = kein KI-Aufruf.
- **Nacht-Wächter:** Skill `gap_scan` — Kontext liefert inaktive Vorgänge (≥5 Tage),
  unbeantwortete Mails (≥2 Tage), überfällige Follow-ups/Aufgaben; Findings landen
  dedupliziert in `agent_findings`, Severity ≤ 2 benachrichtigt sofort (notify_org),
  `finding_created` läuft durch die Regel-Engine.
- **Morgen-Briefing:** Skill `morning_briefing` → `briefings` (kind='morning',
  einmal pro Tag) + Benachrichtigung; „Heute“-Seite zeigt BriefingCards
  (nummerierte Punkte mit direkter Aktion), offene Findings (Erledigt/Verwerfen)
  und überfällige Follow-ups.
- **Web-Push + Notification-Center:** Glocke in der Icon-Rail (Ungelesen-Punkt,
  Panel, Auto-Gelesen), Web-Push-Abo (VAPID, `push_subscriptions`); Service-Worker-
  Handler via workbox.importScripts (`public/push-sw.js`); neue Edge Function
  **`send-push`** (npm:web-push) stellt ungepushte `notifications` zu
  (`pushed_at`-Queue, Cron + pg_net) und räumt tote Subscriptions ab.
- **TrustMeter:** neue Design-System-Komponente (Fortschrittsring, grün ab
  promote_threshold); Einstellungen → Automationen zeigt alle Automationen mit
  Trefferquote aus `trust_stats`.
- **Mock + E2E:** Mock bildet alle 019-Trigger/-Anwendungen ab (inkl. Watchdog-Cron-
  Ersatz mit echten Prioritäten 6/7/8); Demo-Postfach enthält jetzt eine 3 Tage
  alte unbeantwortete Mail für den Wächter. E2E auf 33 Screenshots erweitert —
  komplett grün; nebenbei bewiesen: das Nachtfenster blockiert Priority-8-Jobs
  tagsüber (Abo-Schutz aus Etappe 0.5 greift serverseitig).

### Manuelle Schritte für den Betreiber (Deploy Etappe 2)

1. **Migration einspielen:** `supabase db push` (neu: `019_p2_tasks_watchdog.sql`).
2. **VAPID-Schlüsselpaar erzeugen** (einmalig): `npx web-push generate-vapid-keys`.
   Secrets setzen:
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=…
   supabase secrets set VAPID_PRIVATE_KEY=…
   supabase secrets set VAPID_SUBJECT=mailto:<deine-mail>
   ```
   Und in der PWA-Umgebung: `VITE_VAPID_PUBLIC_KEY=<Public Key>` (`.env`).
3. **Edge Functions deployen:** `supabase functions deploy build-job-context send-push`.
4. **pg_cron-Jobs anlegen** (SQL-Editor):
   ```sql
   select cron.schedule('gap-scan',       '0 3 * * *',    $$select public.enqueue_org_jobs('gap_scan', 8)$$);
   select cron.schedule('morning-brief',  '30 5 * * 1-5', $$select public.enqueue_org_jobs('morning_briefing', 6)$$);
   select cron.schedule('followup-check', '0 * * * *',    $$select public.enqueue_org_jobs('followup_check', 7)$$);
   select cron.schedule('send-push', '* * * * *', $$
     select net.http_post(
       url    := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-push',
       headers:= jsonb_build_object('Content-Type','application/json',
                                    'Authorization','Bearer <SERVICE_ROLE_KEY>'),
       body   := '{"mode":"due"}'::jsonb)$$);
   ```
5. **PWA neu bauen/deployen:** `pnpm --filter @leitwerk/pwa build`.
6. **Runner aktualisieren** (alle Nutzer): `npm update -g leitwerk-runner`.

## Etappe 1 — E-Mail-Hub + Vorgangsakte (2026-07-08)

Kompletter Phase-1-Umfang aus `docs/ROADMAP_PROMPTS.md` (Migration `018_p1_mail_hub.sql`):

- **Gmail-OAuth (`oauth-gmail`):** /start (Nutzer-JWT + Org-Check, HMAC-signierter State)
  und /callback (Code→Tokens, **Refresh-Token → Supabase Vault** über die neuen
  Service-Role-Wrapper `vault_store_secret`/`vault_get_secret`, `mail_accounts`-Upsert,
  Redirect zur PWA). Der Browser sieht nie ein Token.
- **Runner-Connector `gmail-sync` (Job `sync_mail`):** Initial-Sync 90 Tage (gedeckelt
  auf 500 Nachrichten/Lauf), Delta über die History-API (Cursor = historyId, bei 404
  automatischer Re-Initial), MIME-/Adress-Parser mit Tests, Anhänge → Bucket
  `attachments`. Der Runner schreibt NIE direkt in die DB: neue Edge Function
  **`mail-sync`** (Runner-Token-Auth) mit /token (kurzlebiges Access-Token aus dem
  Vault-Refresh-Token), /ingest (Batch-Upsert, Dedupe über Unique-Constraints) und
  /attachment (Storage-Upload). Neuer Skill-Vertrag: optionales `execute()` für
  Connector-Skills ohne KI-Aufruf.
- **Serverseitige Mail-Logik (Migration 018):** Trigger `on_mail_received`
  (Thread-Zähler/Snippet, Kontakt-Upsert aus Absender, KI-Jobs classify_email +
  case_match idempotent einreihen, **org_rules-Ereignis `mail_received`**) und
  `on_mail_sent_message` (Timeline + `mail_sent`); Trigger `apply_job_result`
  wendet done-Jobs an: classify → Thread-Kategorie/Dringlichkeit + automation_run,
  case_match → Zuordnung/Neuanlage NUR ab `min_confidence` (sonst Vorschlag),
  draft_reply → `mail_drafts` source='ai', thread_summary → `ai_summary`.
  `create_case` (Nummernkreis + Timeline), `assign_thread_to_case`,
  `record_automation_outcome` (+ trust_stats-Neuberechnung),
  `enqueue_mail_sync_jobs` (Cron alle 2 min), Realtime für Mail-Tabellen.
- **Skills im Runner:** `classify_email`, `case_match`, `draft_reply` (erzwingt den
  Reply-To-Empfänger gegen halluzinierte Adressen), `thread_summary` — JSON-only,
  striktes Zod-Parsing, Kontexte datenminimiert aus `build-job-context`.
- **Inbox-UI:** InboxRow nach DESIGN.md, Thread-Ansicht, gelesen/ungelesen, Archiv,
  tsvector-Suche (websearch, german), j/k/e-Tastatur, Kategorie-Korrektur und
  Vorgangs-Umhängen mit **outcome-Feedback** (Regel 5), case_match-Vorschlags-Banner
  (AiBadge + Übernehmen/Ablehnen).
- **Composer (Tiptap):** Neu/Antworten, Signaturen aus `mail_accounts`, Anhänge
  (Upload in Bucket `attachments`, neue Spalte `mail_drafts.attachments`),
  **Senden mit 30s-Rückholen** (`status='scheduled'` + `send_after`; serverseitig
  erzwungen). Edge Function **`send-mail`**: MIME-Bau (multipart, RFC-2047-Header,
  Reply-Header, Gmail-threadId), Nutzer-Pfad {draftId} + Cron-Pfad {mode:'due'}
  (pg_net) — derselbe Mechanismus trägt später die Stufe-3-Halte-Zone.
- **Vorgangsakte v1:** Liste (Filter, manuelle Anlage per `create_case`), Detail mit
  **CaseTimeline** (neue Design-System-Komponente, violetter Punkt = KI-Eintrag),
  verknüpfte Threads, Status-Workflow; KI-angelegte Vorgänge mit AiBadge.
- **Einstellungen → Postfächer:** Gmail verbinden, Sync-Status live, Signatur-Editor.
- **Mock + E2E:** Mock-Server emuliert oauth-gmail (Demo-Postfach mit 5 Beispiel-Mails),
  eine Mini-Gmail-API für den Runner (`LEITWERK_GMAIL_API_URL`), mail-sync, send-mail,
  alle 018-Trigger und -RPCs; claude-mock beantwortet alle 4 Skills deterministisch.
  E2E-Journey erweitert auf 29 annotierte Screenshots — komplett grün: Verbinden →
  Sync → Kategorien → Auto-Vorgang → KI-Entwurf → Senden mit Undo → Vorgangsakte.

### Manuelle Schritte für den Betreiber (Deploy Etappe 1)

1. **Google-OAuth-App** nach `tutorials/02_google_oauth.md` registrieren
   (Scopes: `gmail.modify`, `gmail.send`; Redirect-URI:
   `https://<PROJECT_REF>.supabase.co/functions/v1/oauth-gmail/callback`).
2. **Migration einspielen:** `supabase db push` (neu: `018_p1_mail_hub.sql`).
3. **Storage-Bucket anlegen** (Dashboard → Storage): `attachments` (privat).
   Danach RLS-Policies für Client-Uploads im SQL-Editor:
   ```sql
   create policy "attachments_member_insert" on storage.objects for insert to authenticated
     with check (bucket_id = 'attachments'
       and (storage.foldername(name))[1] = 'org'
       and public.has_org_role(((storage.foldername(name))[2])::uuid,
             array['owner','admin','member']::public.org_role[]));
   create policy "attachments_member_select" on storage.objects for select to authenticated
     using (bucket_id = 'attachments'
       and (storage.foldername(name))[1] = 'org'
       and public.is_org_member(((storage.foldername(name))[2])::uuid));
   ```
4. **Function-Secrets setzen:**
   ```bash
   supabase secrets set GOOGLE_CLIENT_ID=…
   supabase secrets set GOOGLE_CLIENT_SECRET=…
   supabase secrets set OAUTH_STATE_SECRET=$(openssl rand -hex 32)
   supabase secrets set PWA_URL=https://<deine-pwa-domain>
   supabase secrets set PUBLIC_FUNCTIONS_URL=https://<PROJECT_REF>.supabase.co/functions/v1
   ```
5. **Edge Functions deployen:**
   `supabase functions deploy oauth-gmail mail-sync send-mail build-job-context runner-broker`
   (`verify_jwt = false` für mail-sync/oauth-gmail kommt aus `supabase/config.toml`).
6. **pg_cron-Jobs anlegen** (SQL-Editor; pg_net-Extension aktivieren für send-due-mail):
   ```sql
   select cron.schedule('mail-sync', '*/2 * * * *', $$select public.enqueue_mail_sync_jobs()$$);
   select cron.schedule('send-due-mail', '* * * * *', $$
     select net.http_post(
       url    := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-mail',
       headers:= jsonb_build_object('Content-Type','application/json',
                                    'Authorization','Bearer <SERVICE_ROLE_KEY>'),
       body   := '{"mode":"due"}'::jsonb)$$);
   ```
7. **PWA neu bauen/deployen:** `pnpm --filter @leitwerk/pwa build`.
8. **Runner aktualisieren** (alle Nutzer): `npm update -g leitwerk-runner`.

## Etappe 0.5 — Security- & Robustheits-Fixes (2026-07-08)

Härtung VOR dem Feature-Ausbau (Migration `017_security_hardening.sql`):

- **Pairing gehärtet:**
  - Rate-Limit auf `/pair`: Tabelle `pairing_attempts` (IP-Hash, Minutenfenster),
    max. 10 Versuche pro IP/Minute → HTTP 429 mit `Retry-After`. IPs landen nur
    gehasht (SHA-256 mit Pepper) in der DB. Der Runner pollt deshalb alle 7 s
    (statt 3 s) und behandelt 429 mit Backoff.
  - Fehlversuche pro Code: `runner_pairing_codes.failed_attempts` — ein Einlöse-Versuch
    auf einen existierenden, aber abgelaufenen/verbrauchten Code zählt hoch; ab 5
    ist der Code dauerhaft gesperrt (HTTP 410). Unbekannte Codes bleiben der normale
    Poll-Zustand (kein Fehlversuch), Brute-Force fängt das IP-Limit ab.
  - **Zwei-Stufen-Pairing:** Runner werden mit `status='pending_approval'` angelegt
    und dürfen NICHTS claimen (`claim_next_job`, Broker-Auth und `build-job-context`
    lehnen ab). Die PWA (Einstellungen → Runner) zeigt Hostname, Provider und
    Zeitpunkt mit „Bestätigen“/„Ablehnen“ — RPCs `approve_runner`/`reject_runner`
    (nur Owner/Admin, mit Audit-Log). Neuer Broker-Endpunkt `/status`, damit der
    Runner auf seine Freigabe warten kann (`init` und `start` zeigen den Zustand an).
- **Abo-Schutz serverseitig:** `claim_next_job` prüft `max_jobs_per_hour` und
  `daily_job_limit` (Zählung über `agent_job_events` `'claimed'`, neue indexierte
  Spalte `runner_id`, rollierende Fenster 60 min/24 h) und respektiert das neue Feld
  `runners.quiet_hours` (jsonb `{start,end,timezone?}`): interaktive Jobs
  (priority ≤ 2) laufen immer, normale Jobs (3–7) nur außerhalb, Batch-Jobs
  (priority ≥ 8) NUR im Nachtfenster, wenn eines konfiguriert ist. UI dafür unter
  Einstellungen → Runner → Limits.
- **Grants nachgezogen:** Runner-RPCs (`claim_next_job` & Co.) sind für
  `anon`/`authenticated` nicht mehr aufrufbar (nur Service Role/Broker); auf `runners`
  darf der Client nur noch `name`, `max_jobs_per_hour`, `daily_job_limit`,
  `quiet_hours` ändern (Spalten-Grants) — Status/Token laufen ausschließlich über
  Broker bzw. Freigabe-RPCs.
- **Reparatur-Retry verschlankt:** Beim JSON-Reparatur-Versuch geht nur noch die
  Schema-Beschreibung des Skills (`Skill.schemaDescription`, neues Pflichtfeld) +
  die fehlerhafte Antwort (max. 2000 Zeichen) an die KI — nicht mehr der komplette
  Original-Prompt (`apps/runner/src/repair.ts`, mit Tests).
- **Ein Roundtrip beim Claim:** Das `runners`-Update (Heartbeat/online) ist in die
  RPC `claim_next_job` gewandert; der Broker macht kein separates Update mehr.
- **`leitwerk-runner service install|uninstall|status`:** Autostart-Dienst für
  Linux (systemd user unit), macOS (launchd-Agent) und Windows (schtasks ONLOGON);
  Tutorial 05 entsprechend verifiziert/aktualisiert.
- **Regel-Engine light:** Tabelle `org_rules` (org-scoped, RLS: Mitglieder lesen,
  Owner/Admin schreiben) + Postgres-Funktionen `rule_condition_matches` und
  `evaluate_org_rules(org, event, entity)` — wertet aktive Regeln aus und erzeugt
  Jobs, Benachrichtigungen oder Aufgaben (Audit-Eintrag `rule.executed`).
  UI: einfacher Regel-Builder („Wenn 〈Ereignis〉 und 〈Bedingungen〉 dann 〈Aktion〉“)
  unter Einstellungen → Regeln. JS-Spiegel der Bedingungslogik in
  `packages/shared/src/rules.ts` (mit Tests) für Vorschau + Mock-Server.
  P1–P6 schleusen ihre Ereignisse (`mail_received`, `invoice_captured`, `quote_sent`,
  `payment_matched`, …) durch die Engine.
- **Mock-Server + E2E nachgezogen:** Zwei-Stufen-Pairing, Rate-Limit, Limits,
  quiet_hours, `org_rules` und die RPCs im Mock; E2E-Lauf erweitert (jetzt 20
  annotierte Screenshots inkl. Freigabe, Limits, Regel-Builder) und komplett grün
  durchlaufen; `claude-mock.cjs` jetzt direkt ausführbar (Exec-Bit).

### Manuelle Schritte für den Betreiber (Deploy Etappe 0.5)

1. **Migration einspielen:** `supabase db push` (neu: `017_security_hardening.sql`).
   ⚠️ Bestehende Runner behalten ihren Status; nur NEUE Pairings landen in
   `pending_approval`.
2. **Edge Function neu deployen:** `supabase functions deploy runner-broker`
   (neuer `/status`-Endpunkt, Rate-Limit, Zwei-Stufen-Pairing).
   `build-job-context` unverändert — kein Redeploy nötig.
3. **PWA neu bauen/deployen:** `pnpm --filter @leitwerk/pwa build`
   (Freigabe-UI, Limits-UI, Einstellungen → Regeln).
4. **Runner aktualisieren** (alle Nutzer): `npm update -g leitwerk-runner`, danach
   optional `leitwerk-runner service install` für den Autostart-Dienst.
5. Keine neuen Secrets, keine neuen Cron-Jobs, keine Buckets in dieser Etappe.

## Lokale Test-Umgebung + Screenshot-Tutorial (2026-07-08)

- **`tools/mock-server/`** — lokales Mock-Backend (Port 54321), das das in P0 genutzte
  Supabase-Subset emuliert (Auth, PostgREST, runner-broker, build-job-context, Trigger,
  Job-Queue-Logik aus 009) — komplett ohne Docker/Supabase, Daten in `data/db.json`.
  Dazu `claude-mock.cjs` als deterministischer Ersatz für die Claude CLI.
  **Nur für Tests/Demos — Produktion bleibt Supabase.**
- **`tools/e2e-tutorial/run.mjs`** — Playwright-Lauf über die komplette User-Journey
  (Registrierung → Onboarding → Pairing → Echo-Job → Dark Mode) inkl. Annotations-Renderer,
  der nummerierte Marker + Labels direkt in die Screenshots zeichnet.
- **`docs/testing-tutorial/`** — Tutorial mit 16 annotierten Screenshots zu jedem
  Phase-0-Feature + Anleitung zum Starten der Mock-Umgebung.
- E2E manuell und automatisiert verifiziert: komplette Kette
  PWA → Queue → Runner → KI → Ergebnis läuft lokal durch.

## Phase 0 — Fundament (2026-07-08)

Monorepo-Setup und kompletter Phase-0-Umfang gemäß `docs/ROADMAP_PROMPTS.md`:

- **Monorepo:** pnpm + Turborepo, TypeScript strict, ESLint 9 (flat config), CI (lint + test + build).
- **Supabase:** Migrationen 001–015 aus `/migrations` übernommen; neue Migration
  `016_p0_bootstrap.sql` (Org-Ersteller wird automatisch Owner; Realtime-Publikation
  für `agent_jobs`, `runners`, `notifications`).
- **Edge Functions:** `runner-broker` (/pair, /claim, /heartbeat, /complete, /fail —
  Runner-Token-Verifikation via SHA-256(pepper:token) gegen `runners.token_hash`),
  `build-job-context` (Kontext für `echo`), Skeletons für `oauth-gmail`,
  `mail-webhook`, `send-mail`, `export-xrechnung`.
- **packages/shared:** Zod-Schemas (Jobs, Broker-API, echo-Kontext/-Ergebnis),
  Konstanten (Prioritäten, Pairing-Code), Geld-Utils (Cent-Integer, de-DE),
  DB-Typen-Platzhalter (durch `pnpm gen:types` ersetzen).
- **packages/ui:** Design-Tokens aus `docs/DESIGN.md` (Light + Dark), Button, Input/Field,
  Card, Badge, AiBadge (Violett = KI-Herkunft), EmptyState, Skeleton, StatusDot.
- **apps/runner (`leitwerk-runner`):** `init` (Pairing-Code anzeigen + Polling),
  `start` (Poll-Loop mit Prioritäts-Sortierung, Heartbeat, Backoff), `status`;
  `AiProvider`-Interface mit Adaptern `claude_cli` (Standard, `claude -p --output-format json`),
  `codex_cli` (experimentell), `anthropic_api` (fetch, eigener Key); Skill `echo`
  mit striktem Zod-Parsing + 1× Reparatur-Retry; `result_hash` für Idempotenz.
  Vitest-Tests für Skill, JSON-Extraktion, Hash und CLI-Parsing.
- **apps/pwa:** Supabase-Auth (E-Mail/Passwort + Google-Button), Registrierung,
  Org-Anlage, Onboarding-Wizard (5 Schritte aus `org_profile.onboarding`),
  App-Shell (Icon-Rail, Sidebar, CommandBar-Skeleton Cmd/Strg+K, Light/Dark),
  Einstellungen → Runner (Pairing-UI, Live-Status via Realtime, Test-Job `echo`
  mit Live-Ergebnis), Offline-Banner, alle Views mit Loading/Empty/Error-Zuständen.

### Manuelle Schritte für den Betreiber (Deploy)

1. **Supabase-Projekt** anlegen (Region eu-central-1/Frankfurt, siehe `tutorials/01_supabase_setup.md`)
   und Migrationen einspielen: `supabase db push` (016 ist neu!).
2. **Function-Secrets setzen:** `RUNNER_TOKEN_PEPPER` generieren (`openssl rand -hex 32`)
   und via `supabase secrets set RUNNER_TOKEN_PEPPER=…` hinterlegen.
   ⚠️ Pepper nie ändern — sonst werden alle gepairten Runner ungültig.
3. **Edge Functions deployen:** `supabase functions deploy runner-broker build-job-context
   oauth-gmail mail-webhook send-mail export-xrechnung`
   (`verify_jwt = false` für runner-broker/build-job-context/mail-webhook kommt aus `supabase/config.toml`).
4. **PWA-Env setzen** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) und deployen
   (`pnpm --filter @leitwerk/pwa build`, siehe `tutorials/04_pwa_deployment.md`).
5. Optional **Google-Login:** OAuth-App nach `tutorials/02_google_oauth.md` registrieren
   und in Supabase Auth aktivieren (für P0 optional, Pflicht ab Phase 1).
6. **DB-Typen generieren:** `pnpm supabase gen types typescript --project-id <ID> >
   packages/shared/src/db.ts` (ersetzt den handgepflegten Platzhalter).
7. pg_cron-Jobs aus `009_rls_functions.sql` (auskommentierter Block) im Dashboard
   anlegen — für P0 reicht der `watchdog`-Job (`release_stale_jobs`).
