# PROGRESS.md — Etappen-Stand

> Für Folge-Sessions: „mach bei Etappe X weiter“ — hier steht, was fertig ist.

| Etappe | Status | Bemerkung |
|---|---|---|
| Phase 0 — Fundament | ✅ abgeschlossen | inkl. Mock-Umgebung + Screenshot-Tutorial |
| Etappe 0.5 — Security- & Robustheits-Fixes | ✅ abgeschlossen (2026-07-08) | Migration 017; Details im CHANGELOG |
| **Etappe 1 — E-Mail-Hub + Vorgangsakte** | ✅ abgeschlossen (2026-07-08) | Migration 018; `mail_received`/`mail_sent` an org_rules angebunden; E2E 29 Screenshots grün |
| Etappe 2 — Aufgaben-Compiler, Wächter, Briefing | ⬜ offen | Phase-2-Prompt aus ROADMAP_PROMPTS.md |
| Etappe 3 — Finanzen | ⬜ offen | |
| Etappe 4 — Autonomie & Wissen | ⬜ offen | |
| Etappe 5 — Team & Ausbau | ⬜ offen | |
| Etappe 6 — Komplett-Büro | ⬜ offen | |

## Wartet auf manuellen Deploy (Betreiber)

Etappe 0.5 UND Etappe 1 sind im Code fertig, aber auf dem echten Supabase-Projekt
noch NICHT eingespielt. Bitte in dieser Reihenfolge ausführen (Details im CHANGELOG
unter „Manuelle Schritte“ der jeweiligen Etappe):

```bash
# Etappe 0.5
supabase db push                              # Migrationen 017 + 018
supabase functions deploy runner-broker

# Etappe 1 (zusätzlich)
# 1. Google-OAuth-App registrieren (tutorials/02), Bucket 'attachments' + Policies
# 2. Secrets: GOOGLE_CLIENT_ID/SECRET, OAUTH_STATE_SECRET, PWA_URL, PUBLIC_FUNCTIONS_URL
supabase functions deploy oauth-gmail mail-sync send-mail build-job-context
# 3. Cron: mail-sync (*/2) + send-due-mail (pg_net) — SQL im CHANGELOG

pnpm --filter @leitwerk/pwa build             # PWA deployen
```

Etappe 2 kann lokal gegen den Mock-Server weitergebaut werden — der Mock bildet
die Migrationen 017 + 018 bereits ab (Demo-Postfach, Mini-Gmail-API, Trigger, RPCs).

## Notizen für Etappe 2

- `extract_commitments`-Skill: Kontext-Assembly in `build-job-context` ergänzen,
  Anwendung in `apply_job_result` (tasks source='mail_extract' als Vorschlag).
- Ereignis `task_created` durch `evaluate_org_rules` schleusen (Trigger auf tasks).
- Follow-ups/gap_scan/morning_briefing: Cron-Blöcke aus 009 aktivieren (Betreiber),
  Findings/Briefings landen in bestehenden Tabellen (008).
- Neue Job-Skills brauchen `schemaDescription` (schlanker Reparatur-Retry);
  Connector-Jobs ohne KI implementieren `execute()`.
- Schema-Änderungen nur als Migration 019 aufwärts; RLS-Muster aus 009.
- Mock-Server: neue Job-Typen in `tools/mock-server/mail-hub.mjs` (buildContext +
  applyJobResult) und `claude-mock.cjs` ergänzen; E2E-Schritte anhängen.
