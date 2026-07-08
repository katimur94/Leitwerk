# Changelog

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
