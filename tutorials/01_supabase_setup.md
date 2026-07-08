# Tutorial 01 — Supabase-Projekt aufsetzen (manuell, ~30 Min)

Ziel: Ein frisches, leeres Supabase-Projekt für Leitwerk. NICHT das SanDoku-Projekt verwenden.

## 1. Projekt anlegen
1. https://supabase.com/dashboard → **New project**
2. Name: `leitwerk-prod` (später zusätzlich `leitwerk-dev` nach gleichem Muster)
3. Region: **eu-central-1 (Frankfurt)** — wichtig für DSGVO
4. Datenbank-Passwort generieren lassen und im Passwort-Manager sichern

## 2. Extensions aktivieren
Dashboard → **Database → Extensions**, aktivieren:
- `vector` (pgvector)
- `pg_trgm`
- `pg_cron`
- `pgcrypto` (meist schon aktiv)

## 3. Migrationen einspielen
Lokal (einmalig `npm i -g supabase`):
```bash
cd leitwerk
supabase login
supabase link --project-ref <PROJECT_REF>   # Ref steht in der Projekt-URL
# Migrationen liegen in supabase/migrations/ (001…010, Reihenfolge zwingend)
supabase db push
```
Prüfen: Dashboard → Table Editor → es müssen u. a. `orgs`, `agent_jobs`, `mail_threads`,
`cases`, `invoices_out`, `automations`, `org_profile` existieren.

## 4. Storage-Buckets anlegen
Dashboard → **Storage → New bucket**, alle **privat** (kein public):
| Bucket | Zweck | Size Limit |
|---|---|---|
| `attachments` | Mail-Anhänge | 25 MB |
| `documents` | Dokumentenablage | 50 MB |
| `audio` | Meeting-Aufnahmen | 200 MB |
| `exports` | Rechnungs-PDFs/XMLs, Datenexporte | 50 MB |
| `branding` | Logos der Workspaces | 5 MB |

Storage-Policies: Claude Code liefert dazu eine Migration `011_storage_policies.sql`
(org-scoped über Pfadpräfix `org_id/…`) — nach Erhalt ebenfalls per `db push` einspielen.

## 5. Vault prüfen
Dashboard → **Database → Vault**: muss verfügbar sein (Standard bei neuen Projekten).
Hier landen später Gmail-Refresh-Tokens & IMAP-Passwörter — automatisch durch die
Edge Function `oauth-gmail`, du musst nichts manuell eintragen.

## 6. Auth konfigurieren
Dashboard → **Authentication → Providers**:
- Email: an (Confirm email: an)
- Google: erst nach Tutorial 02 (Client-ID/Secret dort erzeugt)

**Authentication → URL Configuration:**
- Site URL: `https://app.<deine-domain>.de` (dev: `http://localhost:5173`)
- Redirect URLs: beide eintragen

## 7. pg_cron-Jobs anlegen
Dashboard → **SQL Editor**, die auskommentierten `cron.schedule`-Zeilen aus
`migrations/009_rls_functions.sql` (unterster Block) einfügen und ausführen.
Prüfen: `select * from cron.job;` → 7 Einträge.

## 8. Keys notieren (für .env)
Dashboard → **Settings → API**:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (PWA)
- `SUPABASE_SERVICE_ROLE_KEY` (NUR Edge Functions / niemals in die PWA!)

Fertig. Weiter mit Tutorial 02 (Google OAuth).
