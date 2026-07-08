# PROGRESS.md — Etappen-Stand

> Für Folge-Sessions: „mach bei Etappe X weiter“ — hier steht, was fertig ist.

| Etappe | Status | Bemerkung |
|---|---|---|
| Phase 0 — Fundament | ✅ abgeschlossen | inkl. Mock-Umgebung + Screenshot-Tutorial |
| Etappe 0.5 — Security- & Robustheits-Fixes | ✅ abgeschlossen (2026-07-08) | Migration 017; Details im CHANGELOG |
| Etappe 1 — E-Mail-Hub + Vorgangsakte | ✅ abgeschlossen (2026-07-08) | Migration 018; `mail_received`/`mail_sent` an org_rules angebunden |
| **Etappe 2 — Aufgaben-Compiler, Wächter, Briefing** | ✅ abgeschlossen (2026-07-08) | Migration 019; E2E 33 Screenshots grün |
| Etappe 3 — Finanzen | ⬜ offen | |
| Etappe 4 — Autonomie & Wissen | ⬜ offen | |
| Etappe 5 — Team & Ausbau | ⬜ offen | |
| Etappe 6 — Komplett-Büro | ⬜ offen | |

## Wartet auf manuellen Deploy (Betreiber)

Die Etappen 0.5, 1 und 2 sind im Code fertig, aber auf dem echten Supabase-Projekt
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

# Etappe 2 (zusätzlich)
# 4. VAPID-Keys (npx web-push generate-vapid-keys) → Secrets + VITE_VAPID_PUBLIC_KEY
supabase functions deploy send-push
# 5. Cron: gap-scan, morning-brief, followup-check, send-push — SQL im CHANGELOG

pnpm --filter @leitwerk/pwa build             # PWA deployen
```

Etappe 3 kann lokal gegen den Mock-Server weitergebaut werden — der Mock bildet
die Migrationen 017–019 bereits ab (Demo-Postfach, Mini-Gmail-API, Trigger, RPCs,
Watchdog-Cron-Ersatz).

## Notizen für Etappe 3 (Finanzen)

- Phase-3-Prompt aus ROADMAP_PROMPTS.md: extract_invoice (ZUGFeRD/XRechnung-XML
  direkt parsen, sonst KI aus PDF-Text), Prüf-Workflow invoices_in,
  Ausgangsrechnungen/Angebote mit next_number(), export-xrechnung (EN16931),
  Mahnwesen (dunning_runs, automation auto_dunning), Finanz-Übersicht.
- Ereignisse invoice_captured/quote_sent/invoice_paid durch evaluate_org_rules.
- Viewer-Rolle: RLS existiert (009) — UI ebenfalls absichern.
- Golden-File-Test für XRechnung-XML (Pflicht laut CLAUDE.md Regel 10).
- Neue Job-Skills brauchen `schemaDescription`; Schema-Änderungen nur als
  Migration 020 aufwärts; Mock (`mail-hub.mjs`, `claude-mock.cjs`) + E2E mitziehen.
