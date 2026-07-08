# Tutorial 04 — PWA deployen (Vercel oder Netlify, ~15 Min)

## Variante A: Vercel (empfohlen, du hast den MCP schon)
1. Repo zu GitHub pushen
2. https://vercel.com → **Add New → Project** → Repo importieren
3. Framework: Vite · Root Directory: `apps/pwa`
4. Build Command: `pnpm turbo build --filter=pwa` · Output: `apps/pwa/dist`
5. Environment Variables:
   ```
   VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   VITE_APP_NAME=Leitwerk
   VITE_VAPID_PUBLIC_KEY=<aus Tutorial 03>
   ```
   ⚠️ NIEMALS den Service-Role-Key als VITE_-Variable setzen.
6. Deploy → Domain zuweisen: `app.<deine-domain>.de` (CNAME auf Vercel)
7. Supabase → Authentication → URL Configuration: Produktions-URL nachtragen (Tutorial 01 §6)

## Variante B: Netlify
Analog: Base directory `apps/pwa`, Build `pnpm turbo build --filter=pwa`,
Publish `apps/pwa/dist`, gleiche Env-Variablen. `_redirects` mit `/* /index.html 200`
liegt im Repo (SPA-Fallback).

## PWA-Check nach Deploy
1. Chrome → DevTools → Lighthouse → PWA-Audit: installierbar, Service Worker aktiv
2. Mobil öffnen → "Zum Startbildschirm hinzufügen" testen
3. Offline-Test: Flugmodus → App öffnet Shell, zeigt Offline-Banner, gecachte Vorgänge lesbar

## Staging
Zweites Vercel-Projekt `leitwerk-staging` gegen das `leitwerk-dev`-Supabase-Projekt,
Branch `develop` auto-deployt. Produktions-Deploys nur von `main`.
