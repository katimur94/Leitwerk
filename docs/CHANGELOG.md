# Changelog

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
