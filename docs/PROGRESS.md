# PROGRESS.md — Etappen-Stand

> Für Folge-Sessions: „mach bei Etappe X weiter“ — hier steht, was fertig ist.

| Etappe | Status | Bemerkung |
|---|---|---|
| Phase 0 — Fundament | ✅ abgeschlossen | inkl. Mock-Umgebung + Screenshot-Tutorial |
| Etappe 0.5 — Security- & Robustheits-Fixes | ✅ abgeschlossen (2026-07-08) | Migration 017; Details im CHANGELOG |
| Etappe 1 — E-Mail-Hub + Vorgangsakte | ✅ abgeschlossen (2026-07-08) | Migration 018; `mail_received`/`mail_sent` an org_rules angebunden |
| Etappe 2 — Aufgaben-Compiler, Wächter, Briefing | ✅ abgeschlossen (2026-07-08) | Migration 019; E2E grün |
| Etappe 3 — Finanzen | ✅ abgeschlossen (2026-07-08) | Migration 020; XRechnung-Golden-File; E2E grün |
| **Etappe 4 — Autonomie & Wissen** | ✅ abgeschlossen (2026-07-08) | Migration 021; Autonomie-Gate + Halte-Zone serverseitig; E2E 42 Screenshots grün |
| Etappe 5 — Team & Ausbau | ⬜ offen | |
| Etappe 6 — Komplett-Büro | ⬜ offen | |

## Wartet auf manuellen Deploy (Betreiber)

Die Etappen 0.5, 1, 2, 3 und 4 sind im Code fertig, aber auf dem echten Supabase-Projekt
noch NICHT eingespielt. Bitte in dieser Reihenfolge ausführen (Details im CHANGELOG
unter „Manuelle Schritte“ der jeweiligen Etappe):

```bash
# Etappe 0.5
supabase db push                              # Migrationen 017–021
supabase functions deploy runner-broker

# Etappe 1 (zusätzlich)
# 1. Google-OAuth-App registrieren (tutorials/02), Bucket 'attachments' + Policies
# 2. Secrets: GOOGLE_CLIENT_ID/SECRET, OAUTH_STATE_SECRET, PWA_URL, PUBLIC_FUNCTIONS_URL
supabase functions deploy oauth-gmail mail-sync send-mail build-job-context
# 3. Cron: mail-sync (*/2) + send-due-mail (pg_net) — SQL im CHANGELOG

# Etappe 2 (zusätzlich)
# 4. VAPID-Keys (npx web-push generate-vapid-keys) → Secrets + VITE_VAPID_PUBLIC_KEY
supabase functions deploy send-push
# 5. Cron: gap-scan, morning-brief, followup-check, send-push — SQL im CHANGELOG

# Etappe 3 (zusätzlich)
# 6. Storage-Bucket 'exports' anlegen (SQL im CHANGELOG)
supabase functions deploy export-xrechnung
# 7. Cron: overdue-invoices (process_overdue_invoices) — SQL im CHANGELOG

# Etappe 4 (zusätzlich)
# 8. Storage-Bucket 'audio' anlegen + Policies; pgvector-Extension prüfen (SQL im CHANGELOG)
# 9. Cron: holding-runs (jede Minute), knowledge, style-profiles, embed-backlog
# 10. Runner-Env pro Nutzer: LEITWERK_WHISPER_BIN + LEITWERK_EMBED_BIN (tutorials/06)

pnpm --filter @leitwerk/pwa build             # PWA deployen
```

Etappe 5 kann lokal gegen den Mock-Server weitergebaut werden — der Mock bildet
die Migrationen 017–021 bereits ab (Demo-Postfach, Mini-Gmail-API, Trigger, RPCs,
Watchdog-/Mahn-/Wissens-Cron-Ersatz, XRechnung-Export-Stub, Whisper-/Embed-Mocks,
Autonomie-Gate + Halte-Zone).

## Notizen für Etappe 5 (Team & Ausbau)

- Phase-5-Prompt aus ROADMAP_PROMPTS.md:
  1. Geteilte Postfächer (`mail_accounts.is_shared`) mit Thread-Zuweisung an Mitglieder,
     interne Kommentare + @Mentions (`notifications` kind='mention').
  2. Kalender: gcal-sync im Runner (bidirektional, wie gmail-sync mit Vault-Token),
     Termin↔Vorgang, ai_briefing vor Terminen, Terminvorschlags-Antworten (3 freie Slots).
  3. IMAP/SMTP-Connector als Gmail-Alternative (neuer Connector im Runner + mail-sync-Pfad).
  4. Fristenkalender (wiederkehrende Pflichten als `tasks` mit `recurrence`) + Dokument-Ablage.
  5. Skill `weekly_report` (freitags, `briefings` kind='weekly').
  6. Datenexport der Org (JSON + Storage-Dateien als ZIP über `exports`-Bucket).
- Migrationen 003 (`calendar_accounts`/`calendar_events`) + 007 (`documents`) existieren
  bereits — Schema-Ergänzungen NUR als Migration 022 aufwärts.
- Mock (`mail-hub.mjs`, `claude-mock.cjs`) + E2E mitziehen; neue Skills brauchen
  `schemaDescription`. Rollenmatrix beachten (Viewer, geteilte Postfächer).
