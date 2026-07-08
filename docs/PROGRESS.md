# PROGRESS.md — Etappen-Stand

> Für Folge-Sessions: „mach bei Etappe X weiter“ — hier steht, was fertig ist.

| Etappe | Status | Bemerkung |
|---|---|---|
| Phase 0 — Fundament | ✅ abgeschlossen | inkl. Mock-Umgebung + Screenshot-Tutorial |
| **Etappe 0.5 — Security- & Robustheits-Fixes** | ✅ abgeschlossen (2026-07-08) | Migration 017; Details im CHANGELOG |
| Etappe 1 — E-Mail-Hub + Vorgangsakte | ⬜ offen | Phase-1-Prompt aus ROADMAP_PROMPTS.md + `mail_received` an org_rules anbinden |
| Etappe 2 — Aufgaben-Compiler, Wächter, Briefing | ⬜ offen | |
| Etappe 3 — Finanzen | ⬜ offen | |
| Etappe 4 — Autonomie & Wissen | ⬜ offen | |
| Etappe 5 — Team & Ausbau | ⬜ offen | |
| Etappe 6 — Komplett-Büro | ⬜ offen | |

## Wartet auf manuellen Deploy (Betreiber)

Etappe 0.5 ist im Code fertig, aber auf dem echten Supabase-Projekt noch NICHT
eingespielt. Vor bzw. parallel zu Etappe 1 bitte ausführen (Details im CHANGELOG
unter „Manuelle Schritte für den Betreiber (Deploy Etappe 0.5)“):

```bash
supabase db push                              # Migration 017
supabase functions deploy runner-broker       # /status, Rate-Limit, Zwei-Stufen-Pairing
pnpm --filter @leitwerk/pwa build             # PWA mit Freigabe-/Limits-/Regeln-UI
```

Etappe 1 kann lokal gegen den Mock-Server weitergebaut werden — der Mock bildet
Migration 017 bereits ab.

## Notizen für Etappe 1

- Jedes relevante Ereignis durch `evaluate_org_rules` schleusen — Ereignisliste in
  `packages/shared/src/constants.ts` (`ORG_RULE_EVENTS`).
- Neue Job-Skills brauchen das Pflichtfeld `schemaDescription` (schlanker
  Reparatur-Retry).
- Neue Tabellen: RLS-Muster aus 009 (`(select auth.uid())`) + Indexe auf org_id/FKs;
  Schema-Änderungen nur als Migration 018 aufwärts.
