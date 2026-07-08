# CLAUDE.md — Leitwerk

Du (Claude Code) baust **Leitwerk**: ein Multi-Tenant-Büro-Betriebssystem als PWA mit lokalem
KI-Agent-Runner pro Nutzer (BYO Claude Max). Lies vor JEDER Session: `docs/MASTERPLAN.md`,
`docs/DESIGN.md` und diese Datei. Die Migrationen in `/migrations` sind die verbindliche
Datenmodell-Wahrheit — Code folgt dem Schema, nicht umgekehrt. Schema-Änderungen NUR als neue
Migration (`011_...sql` aufwärts), niemals bestehende Migrationen editieren.

## Repo-Struktur (Monorepo, pnpm + Turborepo)

```
leitwerk/
├── apps/
│   ├── pwa/            React 18 + Vite + TS (strict) + Tailwind + TanStack Query + Zustand
│   └── runner/         Node 20 CLI-Daemon (leitwerk-runner), TypeScript, gebaut mit tsup
├── packages/
│   ├── shared/         Zod-Schemas, Job-Typen, TS-Typen (aus Supabase generiert), Konstanten
│   └── ui/             Design-System-Komponenten (siehe DESIGN.md)
├── supabase/
│   ├── migrations/     -> Inhalt aus /migrations übernehmen (Reihenfolge beibehalten)
│   └── functions/      Edge Functions (Deno): runner-broker, oauth-gmail, build-job-context,
│                       mail-webhook, export-xrechnung, send-mail
├── docs/               MASTERPLAN.md, DESIGN.md, diese Datei
└── tutorials/          Manuelle Setup-Schritte für den Betreiber (NICHT automatisieren)
```

## Nicht verhandelbare Regeln

1. **Security:** OAuth-/Refresh-Tokens, SMTP-Passwörter, Runner-Tokens im Klartext NIEMALS im
   Client, NIEMALS in `localStorage`, NIEMALS in Logs. Tokens leben in Supabase Vault; Zugriff
   nur durch Edge Functions mit Service Role.
2. **Queue-Disziplin:** Der Runner schreibt NIE direkt per `update` auf `agent_jobs`. Ausschließlich
   die RPCs `claim_next_job`, `job_heartbeat`, `complete_job`, `fail_job` — aufgerufen über die
   Edge Function `runner-broker`, die das Runner-Token verifiziert (Hash-Vergleich gegen `runners.token_hash`).
3. **Multi-Tenant immer:** Jede Query läuft org-scoped. Kein Feature ohne RLS-Abdeckung. Neue Tabellen
   bekommen `org_id` + Policies nach dem Muster in `009_rls_functions.sql` (inkl. `(select auth.uid())`).
4. **Autonomie-Gates:** Jede KI-Aktion mit Außenwirkung (Mail senden, Mahnung, Rechnung versenden)
   läuft durch `automations`/`automation_runs`. Stufe-3-Aktionen erzeugen `status='holding'` mit
   `hold_until`; ein Cron-/Broker-Schritt führt erst nach Ablauf aus. Stufe 4 nur wenn
   `trust_stats`-Quote ≥ `promote_threshold` UND Nutzer explizit hochgestuft hat.
5. **Human-Feedback schließen:** Jede Korrektur des Nutzers (Vorgang umgehängt, Entwurf verworfen,
   Kategorie geändert) schreibt `automation_runs.outcome` — das speist die Trefferquote.
6. **Idempotenz:** Job-Handler prüfen `result_hash`/Unique-Constraints; doppelte Verarbeitung darf
   nie doppelte Entwürfe/Rechnungen/Tasks erzeugen.
7. **Provider-Adapter:** KI-Aufrufe im Runner NUR über das Interface `AiProvider`
   (`claude-cli` Standard via `claude -p --output-format json`, `codex-cli`, `anthropic-api`).
   Kein direkter `claude`-Aufruf außerhalb des Adapters.
8. **Deutsch zuerst:** UI-Texte deutsch (i18n-Struktur vorbereiten: `de` als Default, Schlüssel englisch).
9. **Kein Feature ohne Empty-State, Loading-State und Fehler-State** (siehe DESIGN.md).
10. **Tests:** Vitest. Pflicht für: Job-Handler (Runner), Nummernkreis, Autonomie-Gates,
    RLS (pgTAP oder SQL-Tests optional), XRechnung-Generierung. UI-Tests nur für kritische Flows
    (Senden-Freigabe, Rechnungsfreigabe).

## Konventionen

- TypeScript `strict`, keine `any` ohne `// eslint-disable`-Begründung.
- Supabase-Typen generieren: `pnpm supabase gen types typescript --project-id <ID> > packages/shared/src/db.ts`.
- Datumsanzeige: `Intl.DateTimeFormat('de-DE')`, DB immer UTC.
- Geldbeträge: `numeric` in DB, im Client als Cent-Integer rechnen, Anzeige via `Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'})`.
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`), kleine PR-große Einheiten.
- Realtime-Subscriptions zentral in einem `RealtimeProvider` (Channels: notifications, agent_jobs eigener Org, mail_threads aktive Ansicht).

## Job-Handler-Vertrag (Runner)

Jeder Job-Typ hat ein Modul unter `apps/runner/src/skills/<job_type>.ts`:

```ts
export interface SkillResult { result: Json; resultHash: string; followUpJobs?: NewJob[] }
export interface Skill {
  type: string;                       // 'classify_email', ...
  buildPrompt(ctx: JobContext): string | null;   // null = kein KI-Aufruf nötig (reiner Sync-Job)
  parse(raw: string, ctx: JobContext): SkillResult;   // striktes Zod-Parsing, JSON-only-Prompts
}
```
- Prompts verlangen IMMER reines JSON (kein Markdown), Parsing mit Zod + Reparatur-Retry (1×).
- Kontext kommt von der Edge Function `build-job-context` — der Runner baut selbst KEINE Prompts
  aus DB-Rohdaten zusammen (Ausnahme: lokale Sync-/Whisper-/OCR-Jobs ohne KI).
- Interaktive Jobs (priority ≤ 2) unterbrechen die Batch-Verarbeitung (Priority-Preemption im Poll-Loop).

## Definition of Done pro Phase (aus MASTERPLAN §8)

- **P0:** `pnpm dev` startet PWA + lokalen Supabase; Registrierung → Org-Anlage → Onboarding-Wizard
  (Stammdaten aus `org_profile`) → Runner-Pairing → Dummy-Job `echo` läuft Ende-zu-Ende durch und
  erscheint live in der PWA. CI grün.
- **P1:** Gmail verbinden, Inbox lesen/schreiben/senden (mit 30s-Rückholen), classify_email +
  case_match + draft_reply produktiv, Vorgangsakte mit Timeline. Dogfooding-tauglich.
- **P2:** Aufgaben-Compiler, Follow-ups, Nacht-Wächter, Morgen-Briefing, Web-Push.
- **P3:** Eingangsrechnungs-Erfassung + Prüf-Workflow, Angebote/Rechnungen inkl. ZUGFeRD-PDF +
  XRechnung-XML, Mahnwesen.
- **P4:** Autonomie-Regler-UI mit Trefferquoten, Halte-Zone, Notizen, semantische Suche, Meetings.
- **P5:** Geteilte Postfächer, Kommentare/Zuweisungen, Fristenkalender, IMAP, Kalender-Sync.

Fertige Phase = alle States designt (DESIGN.md), Tests grün, `tutorials/` aktualisiert falls
manuelle Schritte dazukamen, kurzer Eintrag in `docs/CHANGELOG.md`.

## Was du NICHT tust

- Keine Supabase-Projekte anlegen, keine Secrets setzen, keine OAuth-Apps registrieren — das macht
  der Betreiber manuell nach `tutorials/`. Du schreibst Code, der die dort definierten
  Env-Variablen erwartet (`.env.example` immer aktuell halten!).
- Keine Zahlungs-/Abo-Logik in Phase 0–5.
- Keine Fremd-KI-Aufrufe aus der PWA heraus. KI läuft ausschließlich im Runner.
