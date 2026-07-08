# PROGRESS.md — Etappen-Stand

> Für Folge-Sessions: „mach bei Etappe X weiter“ — hier steht, was fertig ist.

| Etappe | Status | Bemerkung |
|---|---|---|
| Phase 0 — Fundament | ✅ abgeschlossen | inkl. Mock-Umgebung + Screenshot-Tutorial |
| Etappe 0.5 — Security- & Robustheits-Fixes | ✅ abgeschlossen (2026-07-08) | Migration 017; Details im CHANGELOG |
| Etappe 1 — E-Mail-Hub + Vorgangsakte | ✅ abgeschlossen (2026-07-08) | Migration 018; `mail_received`/`mail_sent` an org_rules angebunden |
| Etappe 2 — Aufgaben-Compiler, Wächter, Briefing | ✅ abgeschlossen (2026-07-08) | Migration 019; E2E grün |
| **Etappe 3 — Finanzen** | ✅ abgeschlossen (2026-07-08) | Migration 020; XRechnung-Golden-File; E2E 36 Screenshots grün |
| Etappe 4 — Autonomie & Wissen | ⬜ offen | |
| Etappe 5 — Team & Ausbau | ⬜ offen | |
| Etappe 6 — Komplett-Büro | ⬜ offen | |

## Wartet auf manuellen Deploy (Betreiber)

Die Etappen 0.5, 1, 2 und 3 sind im Code fertig, aber auf dem echten Supabase-Projekt
noch NICHT eingespielt. Bitte in dieser Reihenfolge ausführen (Details im CHANGELOG
unter „Manuelle Schritte“ der jeweiligen Etappe):

```bash
# Etappe 0.5
supabase db push                              # Migrationen 017–020
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

pnpm --filter @leitwerk/pwa build             # PWA deployen
```

Etappe 4 kann lokal gegen den Mock-Server weitergebaut werden — der Mock bildet
die Migrationen 017–020 bereits ab (Demo-Postfach, Mini-Gmail-API, Trigger, RPCs,
Watchdog- und Mahn-Cron-Ersatz, XRechnung-Export-Stub).

## Notizen für Etappe 4 (Autonomie & Wissen)

- Phase-4-Prompt aus ROADMAP_PROMPTS.md: Automationen-Seite mit Autonomie-Regler
  1–4 (Hochstufen-Gate: `trust_stats`-Quote ≥ `promote_threshold` UND explizite
  Nutzer-Aktion — serverseitig prüfen), Stufe-3-Halte-Zone: `automation_runs`
  status='holding' + `hold_until`, HoldBanner in der PWA, Ausführung nach Ablauf
  über den bestehenden send-mail-due-Mechanismus.
- Notizen-Modul (`notes`), Skills `knowledge_distill` + `build_style_profile`
  (Stil-Profil speist draft_reply bereits — Feld existiert in build-job-context).
- Embeddings-Pipeline (pgvector) + kombinierte Suche (Volltext + semantisch)
  in der CommandBar.
- Meetings: Whisper lokal im Runner (AiProvider-Adapter erweitern? Nein —
  Whisper ist ein lokaler Sync-Job ohne KI-Provider, `buildPrompt: null`).
- Schema-Änderungen NUR als Migration 021 aufwärts; Mock (`mail-hub.mjs`,
  `claude-mock.cjs`) + E2E mitziehen; neue Skills brauchen `schemaDescription`.
