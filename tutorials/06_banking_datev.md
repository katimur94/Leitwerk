# Tutorial 06 — Banking (GoCardless) & DATEV-Vorbereitung (~30 Min)

## Teil A: Bankkonten anbinden (GoCardless Bank Account Data)

GoCardless Bank Account Data (ehem. Nordigen) liefert PSD2-Kontozugriff auf >2.000 EU-Banken.
Kostenloser Tarif reicht für den Start (begrenzte Konten/Abrufe); Preise vor Produktivbetrieb prüfen.

1. https://bankaccountdata.gocardless.com → Konto anlegen
2. **Developers → User secrets** → Secret-ID + Secret-Key erzeugen
3. In Supabase hinterlegen:
   ```bash
   supabase secrets set GOCARDLESS_SECRET_ID=<id>
   supabase secrets set GOCARDLESS_SECRET_KEY=<key>
   ```
4. Edge Function deployen: `supabase functions deploy oauth-bank`
5. In der App: **Finanzen → Bankkonten → Konto verbinden** → Bank wählen → Online-Banking-Freigabe
6. ⚠️ PSD2-Zustimmung läuft nach 90–180 Tagen ab (bankabhängig). Leitwerk warnt rechtzeitig
   per Finding; die Erneuerung ist derselbe 2-Minuten-Flow.

**Alternative FinTS:** Für Banken mit gutem FinTS-Zugang kann der Runner-Connector `fints`
genutzt werden (Zugangsdaten landen im Vault, Abruf läuft lokal über den Runner).
**Fallback CSV:** Jede Bank kann CSV exportieren → App: Bankkonten → CSV importieren.

## Teil B: DATEV-Export vorbereiten (mit dem Steuerberater!)

Der Export erzeugt einen **DATEV-Buchungsstapel (EXTF-Format)**, den der Steuerberater in
DATEV Kanzlei-Rechnungswesen importiert. Vorher EINMALIG klären (15-Minuten-Telefonat):

1. **Kontenrahmen:** SKR03 oder SKR04?
2. **Beraternummer + Mandantennummer** (stehen auf jeder DATEV-Auswertung)
3. **Erlöskonten** für 19 % / 7 % / steuerfrei — Defaults in Leitwerk sind SKR03-Standard,
   aber der Steuerberater kann abweichende Konten führen
4. **Debitoren/Kreditoren:** Nutzt die Kanzlei Personenkonten? Falls ja, Nummernkreise
   abstimmen (Standard: Debitoren ab 10000, Kreditoren ab 70000)
5. Gewünschtes **Übergabeformat**: EXTF-CSV per E-Mail reicht meist; Belegkopien als ZIP dazu

Dann in der App: **Einstellungen → Buchhaltung** ausfüllen → Probeexport eines Monats
erzeugen → dem Steuerberater zum Testimport geben → erst nach dessen OK produktiv nutzen.

⚠️ Leitwerk erzeugt Buchungs**vorschläge**. Die KI-Kontierung (auto_account_assign) startet
auf Stufe 1 — jeder Vorschlag wird vor dem Export von einem Menschen freigegeben.

## Teil C: Cron-Jobs ergänzen
SQL Editor (einmalig):
```sql
select cron.schedule('bank-sync',      '15 */4 * * *', $$select public.enqueue_org_jobs('bank_sync', 7)$$);
select cron.schedule('payment-match',  '30 */4 * * *', $$select public.enqueue_org_jobs('payment_match', 7)$$);
select cron.schedule('contract-watch', '0 6 * * *',    $$select public.enqueue_org_jobs('contract_watch', 8)$$);
```
