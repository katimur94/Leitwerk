# Leitwerk

**Das Leitwerk für dein Büro.** Multi-Tenant-Büro-Betriebssystem (PWA) mit lokalem
KI-Agent-Runner pro Nutzer — jeder bringt sein eigenes Claude-Max-Abo mit (BYO-KI).

## Repo-Struktur

| Pfad | Inhalt |
|---|---|
| `apps/pwa` | React 18 + Vite + TS (strict) + Tailwind + TanStack Query + Zustand, PWA |
| `apps/runner` | `leitwerk-runner` — Node-20-CLI-Daemon (Pairing, Poll-Loop, Skills) |
| `packages/shared` | Zod-Schemas, Job-/Broker-Typen, Konstanten, Geld-Utils |
| `packages/ui` | Design-System-Komponenten nach `docs/DESIGN.md` |
| `supabase/` | Migrationen (aus `/migrations` übernommen) + Edge Functions |
| `migrations/` | Verbindliche Datenmodell-Wahrheit (16 SQL-Migrationen) |
| `docs/` | `MASTERPLAN.md`, `DESIGN.md`, `ROADMAP_PROMPTS.md`, `CHANGELOG.md` |
| `tutorials/` | Manuelle Setup-Schritte für den Betreiber |

## Dev-Quickstart (Phase 0)

Voraussetzungen: Node ≥ 20, [pnpm](https://pnpm.io) ≥ 9,
[Supabase CLI](https://supabase.com/docs/guides/local-development) + Docker.

```bash
# 1. Abhängigkeiten
pnpm install

# 2. Lokalen Supabase starten (führt alle Migrationen aus)
supabase start
#    → API URL und anon key aus der Ausgabe kopieren

# 3. PWA konfigurieren
cp apps/pwa/.env.example apps/pwa/.env
#    → VITE_SUPABASE_ANON_KEY eintragen

# 4. Edge Functions lokal bereitstellen (eigenes Terminal)
cp supabase/functions/.env.example supabase/functions/.env
#    → RUNNER_TOKEN_PEPPER setzen, z. B.: openssl rand -hex 32
supabase functions serve --env-file supabase/functions/.env

# 5. PWA + Runner-Watch starten
pnpm dev
#    → PWA: http://localhost:5173

# 6. Runner pairen (eigenes Terminal)
pnpm --filter leitwerk-runner build
node apps/runner/dist/index.js init --url http://127.0.0.1:54321/functions/v1
#    → Code in der PWA eingeben (Einstellungen → Runner), dann:
node apps/runner/dist/index.js start
```

Ende-zu-Ende-Test: In der PWA registrieren → Organisation anlegen →
Onboarding durchlaufen → Runner pairen → unter **Einstellungen → Runner**
einen Test-Job senden. Die KI-Antwort erscheint live in der Job-Liste.

Nützliche Befehle: `pnpm lint` · `pnpm test` · `pnpm build` ·
`pnpm gen:types` (Supabase-Typen nach `packages/shared/src/db.ts`).

## Startreihenfolge (Betrieb)

1. Tutorial 01 — Supabase-Projekt + Migrationen
2. Phase 0 (dieses Repo) — Fundament: Auth, Orgs, Runner-Pairing, Echo-Job
3. Tutorial 02+03 — Google OAuth + Edge Functions deployen
4. Phase 1 (E-Mail-Hub) → ab hier täglich selbst nutzen
5. Tutorial 04 — PWA deployen, Tutorial 05 als Nutzer-Doku für den Runner
6. Phase 6 (Komplett-Büro) → Tutorial 06 — Banking & DATEV mit dem Steuerberater abstimmen
