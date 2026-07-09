# PROGRESS.md — Etappen-Stand

> Für Folge-Sessions: „mach bei Etappe X weiter“ — hier steht, was fertig ist.

| Etappe | Status | Bemerkung |
|---|---|---|
| Phase 0 — Fundament | ✅ abgeschlossen | inkl. Mock-Umgebung + Screenshot-Tutorial |
| Etappe 0.5 — Security- & Robustheits-Fixes | ✅ abgeschlossen (2026-07-08) | Migration 017; Details im CHANGELOG |
| Etappe 1 — E-Mail-Hub + Vorgangsakte | ✅ abgeschlossen (2026-07-08) | Migration 018; `mail_received`/`mail_sent` an org_rules angebunden |
| Etappe 2 — Aufgaben-Compiler, Wächter, Briefing | ✅ abgeschlossen (2026-07-08) | Migration 019; E2E grün |
| Etappe 3 — Finanzen | ✅ abgeschlossen (2026-07-08) | Migration 020; XRechnung-Golden-File; E2E grün |
| Etappe 4 — Autonomie & Wissen | ✅ abgeschlossen (2026-07-08) | Migration 021; Autonomie-Gate + Halte-Zone serverseitig; E2E grün |
| Etappe 5 — Team & Ausbau | ✅ abgeschlossen (2026-07-08) | Migration 022; geteilte Postfächer, Kalender-Briefing, Wochenreport, Export; E2E 46 Screenshots grün |
| **Etappe 6 — Komplett-Büro** | ✅ abgeschlossen (2026-07-09) | Migration 023; Zeiterfassung, payment_match, DATEV-EXTF (Golden-File), Verträge/Wächter, Anrufe, Abwesenheiten; E2E 51 Screenshots grün |

**Alle Etappen (0.5 – 6) sind im Code abgeschlossen.** Es folgt nur noch der manuelle
Deploy auf das echte Supabase-Projekt (siehe unten + CHANGELOG).

## Wartet auf manuellen Deploy (Betreiber)

Alle Etappen (0.5, 1, 2, 3, 4, 5 und 6) sind im Code fertig, aber auf dem echten
Supabase-Projekt noch NICHT eingespielt. Bitte in dieser Reihenfolge ausführen (Details
im CHANGELOG unter „Manuelle Schritte“ der jeweiligen Etappe):

```bash
# Etappe 0.5
supabase db push                              # Migrationen 017–022
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
# 10. Runner-Env pro Nutzer: LEITWERK_WHISPER_BIN + LEITWERK_EMBED_BIN (tutorials/05 §6)

# Etappe 5 (zusätzlich)
# 11. Google-OAuth-Scope Kalender ergänzen; calendar_accounts pro Nutzer anlegen
supabase functions deploy calendar-sync export-org
# 12. Cron: weekly-report (freitags) + calendar-sync je calendar_account (SQL im CHANGELOG)

# Etappe 6 (zusätzlich)
# 13. accounting_settings pro Org füllen (Berater-/Mandantennummer, SKR, Konten) —
#     vom Steuerberater bestätigen lassen; Banking-Import (CSV/FinTS) je bank_connection
supabase functions deploy export-datev
# 14. Cron: contract-watch (täglich), payment-match (täglich), time-suggest (optional)

pnpm --filter @leitwerk/pwa build             # PWA deployen
```

## Fertig

Alle Etappen aus `docs/ROADMAP_PROMPTS.md` (0.5 → 6) sind implementiert, getestet
(`pnpm lint && pnpm test && pnpm build` grün, Golden-File-Tests für XRechnung **und**
DATEV-EXTF) und im E2E-Tutorial (51 annotierte Screenshots) durchgespielt. Der Mock-Server
bildet die Migrationen 017–023 vollständig ab (Postfach, Gmail-API, Trigger/RPCs,
Watchdog-/Mahn-/Wissens-/Wochenreport-/Kündigungswächter-Cron-Ersatz, XRechnung- und
DATEV-Export-Stubs, Whisper-/Embed-Mocks, Autonomie-Gate + Halte-Zone, Kalender-Seed +
Briefing, geteilte Postfächer, Banking-Seed + payment_match, Vertrags-Seed). Nächster
Schritt liegt beim Betreiber: der manuelle Deploy oben.
