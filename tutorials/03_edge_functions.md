# Tutorial 03 — Edge Functions deployen & Secrets (~20 Min)

Die Edge Functions liegen nach der Entwicklung in `supabase/functions/`. Deployment ist
manuell (du), Code kommt von Claude Code.

## 1. Übersicht der Functions

| Function | Zweck | Auth |
|---|---|---|
| `runner-broker` | Pairing einlösen, Job-Claim/Heartbeat/Complete/Fail, Ergebnis-Ingest | Runner-Token (Header `x-runner-token`) |
| `oauth-gmail` | OAuth-Start + Callback, Token → Vault, `mail_accounts` anlegen | Supabase-Session |
| `build-job-context` | Baut Prompt-Kontext für einen Job (zugeschnitten, PII-Redaction-Option) | Runner-Token |
| `send-mail` | Versendet freigegebene Drafts (Gmail API / SMTP), setzt `sent_at`, Audit | Service-intern (Cron/Broker) |
| `mail-webhook` | Optional: Gmail Pub/Sub Push | Google-Signatur |
| `export-xrechnung` | Erzeugt XRechnung-XML + ZUGFeRD-PDF für `invoices_out` | Supabase-Session |

## 2. Deployen
```bash
cd leitwerk
supabase functions deploy runner-broker
supabase functions deploy oauth-gmail
supabase functions deploy build-job-context
supabase functions deploy send-mail
supabase functions deploy export-xrechnung
# mail-webhook nur bei Pub/Sub-Nutzung
```

## 3. Secrets (einmalig, zusätzlich zu Tutorial 02)
```bash
supabase secrets set APP_BASE_URL=https://app.<deine-domain>.de
supabase secrets set RUNNER_TOKEN_PEPPER=<64 Zeichen Zufall>   # openssl rand -hex 32
supabase secrets set VAPID_PUBLIC_KEY=<web-push>               # npx web-push generate-vapid-keys
supabase secrets set VAPID_PRIVATE_KEY=<web-push>
```
`SUPABASE_SERVICE_ROLE_KEY` und `SUPABASE_URL` sind in Edge Functions automatisch verfügbar.

## 4. Verifizieren
```bash
curl -i https://<PROJECT_REF>.supabase.co/functions/v1/runner-broker/health
# → 200 {"ok":true}
```

## 5. Update-Routine
Nach jeder Phase von Claude Code: `supabase db push` (falls neue Migration) und
`supabase functions deploy <geänderte>` — Claude Code listet am Phasenende auf,
was deployt werden muss (steht dann auch in docs/CHANGELOG.md).
