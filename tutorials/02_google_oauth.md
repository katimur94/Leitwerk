# Tutorial 02 — Google OAuth für Gmail & Calendar (~45 Min)

Ziel: Eine Google-Cloud-OAuth-App, mit der Leitwerk-Nutzer ihr Gmail/Workspace-Postfach
und ihren Kalender verbinden.

## 1. Projekt & APIs
1. https://console.cloud.google.com → **New Project** → Name `leitwerk`
2. **APIs & Services → Library** → aktivieren:
   - Gmail API
   - Google Calendar API
   - (später optional: Cloud Pub/Sub API für Push-Benachrichtigungen)

## 2. OAuth Consent Screen
**APIs & Services → OAuth consent screen:**
1. User Type: **External**
2. App-Name: `Leitwerk`, Support-E-Mail, Logo (aus branding), Domain eintragen
3. Scopes hinzufügen:
   - `https://www.googleapis.com/auth/gmail.modify`  (lesen, labeln, Entwürfe)
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/calendar`
   - `openid`, `email`, `profile`
4. **Publishing status: Testing** lassen → bis zu 100 Testnutzer, kein Google-Review nötig.
   Testnutzer: deine E-Mail + alle Pilotnutzer unter "Test users" eintragen.
   ⚠️ Für den öffentlichen Betrieb ist später eine **Google-Verifizierung** nötig
   (sensitive Scopes → Review dauert Wochen, inkl. Datenschutzerklärung + Demo-Video).
   Früh beantragen, sobald das Produkt steht.

## 3. OAuth Client
**APIs & Services → Credentials → Create Credentials → OAuth client ID:**
- Type: **Web application**
- Name: `leitwerk-web`
- Authorized redirect URIs:
  - `https://<PROJECT_REF>.supabase.co/functions/v1/oauth-gmail/callback`
  - `http://localhost:54321/functions/v1/oauth-gmail/callback` (lokale Entwicklung)
- Client-ID + Client-Secret notieren.

## 4. Secrets in Supabase hinterlegen
```bash
supabase secrets set GOOGLE_CLIENT_ID=<id>
supabase secrets set GOOGLE_CLIENT_SECRET=<secret>
supabase secrets set OAUTH_REDIRECT_BASE=https://<PROJECT_REF>.supabase.co/functions/v1
```

## 5. Google-Login für Supabase Auth (optional, empfohlen)
Derselbe Client kann fürs Einloggen in die PWA genutzt werden:
Supabase Dashboard → **Authentication → Providers → Google** → Client-ID/Secret eintragen.
Zusätzliche Redirect-URI im Google-Client ergänzen:
`https://<PROJECT_REF>.supabase.co/auth/v1/callback`

## 6. Funktionstest (nach Deployment der Edge Functions, Tutorial 03)
1. PWA → Einstellungen → Postfach verbinden → Google-Fenster öffnet sich
2. Nach Zustimmung: Eintrag in `mail_accounts` mit `sync_state='pending'`,
   Token liegt im Vault (`vault_secret_id` gesetzt)
3. Runner starten → erster Sync-Job zieht die letzten 90 Tage

## Hinweise
- Gmail-Push (Pub/Sub) ist optional; der Runner pollt standardmäßig alle 2 Minuten
  über die History-API — reicht für den Start völlig.
- IMAP-Konten (IONOS, Strato, …) brauchen KEIN Google-Setup; dort gibt der Nutzer
  Host/Port/App-Passwort direkt in der PWA ein (Passwort geht via Edge Function in den Vault).
