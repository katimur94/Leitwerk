# Changelog

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
