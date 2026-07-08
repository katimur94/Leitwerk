# Leitwerk — Masterplan v1.0

> Eigenständiges Produkt. Kein Bezug zu SanDoku. Eigenes Supabase-Projekt, eigene Codebase, eigenes Branding.
> Kernidee: Die Klebeschicht über den bestehenden Büro-Tools — E-Mail, Vorgänge, Aufgaben, Rechnungen, Termine,
> Notizen, Meetings — mit einem KI-Kern, den **jeder Nutzer mit seinem eigenen Claude-Max-Abo betreibt**.

---

## 1. Vision & Leitprinzipien

**Das Produkt in einem Satz:** Ein Büro-Betriebssystem, das E-Mails, Vorgänge, Aufgaben, Rechnungen,
Termine, Notizen und Meetings in einer PWA vereint — und dessen KI-Arbeit von einem lokalen Agent-Runner
erledigt wird, der mit dem Claude-Max-Abo des jeweiligen Nutzers läuft.

**Leitprinzipien:**

1. **BYO-KI (Bring Your Own AI):** Kein zentraler API-Schlüssel, keine Token-Kosten für den Betreiber.
   Jeder Nutzer installiert den Runner auf seinem Rechner und loggt sich dort mit seinem eigenen
   Claude-Account ein (`claude` CLI OAuth). Alternativ: Codex CLI oder eigener API-Key. Der Runner ist
   ein austauschbarer Adapter.
2. **Klebeschicht, kein Ersatz:** Gmail bleibt Gmail, der Kalender bleibt der Kalender. Das Tool
   synchronisiert, verknüpft und denkt mit — es zwingt niemanden, sein Postfach aufzugeben.
3. **Vorgänge statt Apps:** Die zentrale Einheit ist die **Vorgangsakte** (Case). Alles — Mail, Datei,
   Termin, Rechnung, Notiz, Aufgabe — hängt an einem Vorgang. Zuordnung passiert automatisch durch KI.
4. **Proaktivität:** Das System wartet nicht auf Fragen. Nächtlicher Wächter-Lauf + Morgen-Briefing
   ("Diese 5 Dinge brauchen dich heute").
5. **Autonomie-Regler:** Jede Automatisierung startet auf Stufe 1 (nur Vorschlag). Der Nutzer schiebt
   pro Prozess hoch bis Stufe 4 (autonom, meldet nur Ausnahmen). Das System zeigt seine Trefferquote
   und verdient sich Vertrauen messbar.
6. **Human-in-the-loop by default:** Nichts verlässt das Haus (Mail senden, Rechnung verschicken)
   ohne Freigabe — außer der Nutzer hat den Regler für genau diesen Prozess bewusst hochgeschoben.
7. **DSGVO-freundlich:** Daten in EU-Region (Supabase Frankfurt), KI-Verarbeitung über das Konto des
   Nutzers, Verschlüsselung von OAuth-Tokens, vollständiges Audit-Log.

---

## 2. Das BYO-Claude-Max-Modell (der wichtigste Baustein)

### 2.1 Warum so?

- Eine PWA kann `claude -p` nicht aufrufen — das ist ein CLI-Prozess auf einer Maschine mit eingeloggtem Account.
- Lösung: **Jeder Nutzer betreibt seinen eigenen Agent-Runner** (Node-Daemon) auf seinem PC, Laptop,
  Mini-Server oder VPS. Der Runner ist mit *seinem* Claude-Login authentifiziert.
- Damit nutzt jeder sein eigenes Abo für seine eigenen Daten. Es gibt kein Subscription-Sharing,
  kein Proxy fremder Abos — jeder Runner arbeitet nur Jobs des Nutzers/der Organisation ab, zu der
  der Runner gehört. Das ist die saubere Variante des Modells.

### 2.2 Ablauf aus Nutzersicht (Onboarding)

1. Registrierung in der PWA (Supabase Auth, E-Mail + Passwort oder Google-Login).
2. Organisation anlegen oder per Einladung beitreten.
3. **Runner installieren:** `npx leitwerk-runner init` (oder Installer-Download).
4. Runner zeigt Pairing-Code → Nutzer gibt ihn in der PWA ein → Runner ist mit dem Konto verknüpft
   (Tabelle `runners`, Token-Hash, Scopes).
5. Runner prüft lokal: Ist `claude` CLI installiert & eingeloggt? Falls nein → geführtes Setup
   (`npm i -g @anthropic-ai/claude-code`, dann `claude login`). Fallback-Optionen: Codex CLI, API-Key.
6. PWA zeigt Runner-Status live (online/offline, letzte Heartbeat, verarbeitete Jobs, Fehlerquote).

### 2.3 Runner-Architektur

```
leitwerk-runner (Node 20+, läuft als Dienst/Tray-App)
├── auth/            Pairing, Token-Refresh gegen Edge Function
├── queue/           Long-Polling / Realtime auf agent_jobs (claim via RPC, SKIP LOCKED)
├── providers/
│   ├── claude-cli.ts    →  claude -p --output-format json  (Standard, Max-Abo)
│   ├── codex-cli.ts     →  codex exec … (optional)
│   └── api-key.ts       →  Anthropic Messages API (optional, eigener Key)
├── skills/          Prompt-Templates pro Job-Typ (classify_email, draft_reply,
│                    case_match, gap_scan, extract_invoice, summarize_meeting, …)
├── connectors/
│   ├── gmail-sync.ts    Gmail API (History-Sync, Push optional)
│   ├── imap-sync.ts     IMAP/SMTP für Nicht-Google-Postfächer
│   ├── gcal-sync.ts     Google Calendar
│   └── whisper.ts       Lokale Transkription (whisper.cpp) für Meetings
├── watchdog/        Heartbeat, Job-Timeout, Retry mit Backoff, Crash-Recovery
└── telemetry/       Nur lokal + auf Wunsch anonymisierte Fehlermeldungen
```

**Wichtige Runner-Regeln:**
- Ein Job hat `max_runtime_sec`; hängt der Runner, gibt der Watchdog den Job frei (Heartbeat-Timeout).
- Jobs sind **idempotent** designt (jeder Job schreibt Ergebnis + `result_hash`; Doppelverarbeitung ist harmlos).
- Der Runner sieht nur Jobs seiner Org (Job-Claim-RPC prüft `org_id` gegen Runner-Registrierung).
- Prompts + Kontexte werden serverseitig zusammengebaut (Edge Function `build_job_context`), damit
  Prompt-Logik zentral versionierbar bleibt — der Runner ist "dumm" und führt nur aus.
- Rate-Limit-Respekt: Runner drosselt sich selbst (konfigurierbare Jobs/Stunde), damit das Max-Abo
  des Nutzers nicht durch Hintergrund-Jobs leergesaugt wird. Prioritäten: interaktive Jobs
  (Nutzer wartet) > Sync-Jobs > Nacht-Wächter.

### 2.4 Was passiert, wenn kein Runner online ist?

- Die PWA bleibt voll benutzbar (Mails lesen, schreiben, Aufgaben pflegen) — nur KI-Funktionen
  zeigen "Runner offline, Job in Warteschlange".
- Optionaler späterer Ausbau: gehosteter Runner mit API-Key-Abrechnung für Nutzer ohne eigenen Rechner
  (Phase 6, bewusst NICHT im MVP).

---

## 3. Gesamtarchitektur

```
┌──────────────────────────────────────────────────────────────┐
│ PWA  (React + Vite + TS, Tailwind, Workbox-Offline-Shell)    │
│  Module: Inbox · Vorgänge · Aufgaben · Finanzen · Kalender · │
│  Notizen/Wissen · Meetings · Automationen · Briefing · Admin │
└───────────────┬──────────────────────────────────────────────┘
                │ supabase-js (Auth, Realtime, Storage, RPC)
┌───────────────▼──────────────────────────────────────────────┐
│ Supabase (NEUES Projekt, Region eu-central / Frankfurt)      │
│  Postgres 15 + pgvector + pg_cron                            │
│  Edge Functions:                                             │
│   · runner-broker      (Pairing, Job-Claim, Ergebnis-Ingest) │
│   · oauth-gmail        (OAuth-Flow, Token-Tresor)            │
│   · mail-webhook       (Gmail Pub/Sub Push, optional)        │
│   · build-job-context  (Prompt/Kontext-Assembly)             │
│   · export-xrechnung   (E-Rechnung XML-Erzeugung)            │
│  Storage-Buckets: attachments, documents, audio, exports     │
└───────────────▲──────────────────────────────────────────────┘
                │ HTTPS (Runner-Token) + Realtime
┌───────────────┴──────────────────────────────────────────────┐
│ Agent-Runner (pro Nutzer, lokal)  →  claude -p (eigenes Max) │
└──────────────────────────────────────────────────────────────┘
```

**Tech-Stack-Festlegungen:**
- Frontend: React 18, Vite, TypeScript, Tailwind, TanStack Query, Zustand; PWA via `vite-plugin-pwa`.
- E-Mail-Editor: Tiptap (Rich Text) + Klartext-Fallback.
- Backend: ausschließlich Supabase (kein eigener Server außer den Runnern der Nutzer).
- Secrets: OAuth-Refresh-Tokens verschlüsselt via Supabase Vault; niemals im Client.
- Realtime: Postgres Changes auf `agent_jobs`, `notifications`, `mail_messages`.

---

## 4. Module von A bis Z (vollständiger Funktionsumfang)

### A — Auth, Organisationen & Team
- Multi-Tenant von Tag 1: `orgs`, `org_members` mit Rollen `owner | admin | member | viewer`.
- Einladungen per E-Mail-Link, Rollenwechsel, Mitglied deaktivieren.
- Jeder Nutzer kann mehreren Orgs angehören (Freelancer-Fall). Aktive Org im UI umschaltbar.
- Persönliche Einstellungen: Sprache, Zeitzone, Signaturen, Benachrichtigungskanäle.

### B — E-Mail-Hub (Herzstück Nr. 1)
**Sync:**
- Gmail via OAuth 2.0 (Scopes: `gmail.modify`, `gmail.send`), Delta-Sync über History-API,
  optional Push via Pub/Sub. Mehrere Konten pro Nutzer möglich.
- IMAP/SMTP-Fallback für alle anderen Anbieter (IONOS, Strato, Outlook via IMAP).
- Threads, Labels/Ordner, Anhänge (in Storage gespiegelt), Gelesen-Status bidirektional.

**Lesen & Schreiben:**
- Vollwertiger Client: Thread-Ansicht, Suche (Volltext + semantisch via Embeddings),
  Verfassen/Antworten/Weiterleiten, Anhänge, Signaturen, Senden-Rückholen (30 s Verzögerung),
  geplantes Senden, Vorlagen/Textbausteine.

**KI-Schicht auf jeder Mail (Jobs für den Runner):**
1. `classify_email` — Kategorie (Anfrage, Auftrag, Rechnung, Termin, Mahnung, Newsletter, Spam-Verdacht),
   Dringlichkeit, Stimmung.
2. `case_match` — Zuordnung zu bestehendem Vorgang oder Vorschlag "neuen Vorgang anlegen"
   (Signale: Absender, Betreff-Kette, Aktenzeichen, Adressen, Beträge).
3. `extract_commitments` — Verpflichtungen & Fristen herausziehen → Aufgaben-Vorschläge
   ("Kunde erwartet Rückruf bis Freitag").
4. `draft_reply` — Antwortentwurf im Ton des Nutzers (lernt aus dessen gesendeten Mails, Stilprofil in `ai_style_profiles`).
5. `thread_summary` — Ein-Absatz-Zusammenfassung langer Threads.

### C — CRM light / Kontakte
- Kontakte & Firmen werden **automatisch** aus dem Mailverkehr aufgebaut und gepflegt
  (Signaturen-Parsing: Name, Firma, Telefon, Adresse) — Nutzer korrigiert nur.
- Kontakt-Dossier: alle Vorgänge, Mails, Rechnungen, Notizen, offene Beträge auf einen Blick.
- Beziehungswissen ("tickt so", "immer schriftlich bestätigen") als KI-lesbare Hinweise am Kontakt.

### D — Dokumente & Dateien
- Zentraler Dokumentenbereich (Storage), automatisch befüllt aus Mail-Anhängen.
- OCR-Job für Scans/PDFs (Runner: `ocr_document`), Volltext + Embeddings.
- Jedes Dokument hängt an Vorgang und/oder Kontakt. Versionierung einfach (neue Version ersetzt, alte bleibt abrufbar).

### E — Erinnerungen & Benachrichtigungen
- Kanäle: In-App, Web-Push (PWA), E-Mail-Digest.
- Regeln: "Angebot X unbeantwortet seit N Tagen", "Rechnung Y überfällig", "Frist Z in 3 Tagen".
- Snooze auf allem (Mail, Aufgabe, Vorgang): "Zeig mir das Donnerstag wieder".

### F — Finanzen: Eingangsrechnungen, Ausgangsrechnungen, Angebote, Mahnwesen
**Eingang:**
- Rechnungs-Erkennung in Mail-Anhängen (`extract_invoice`): Aussteller, Betrag, Fälligkeit,
  IBAN, Positionen; ZUGFeRD/XRechnung-XML wird direkt geparst, sonst KI-Extraktion aus PDF.
- Prüf-Workflow: erfasst → geprüft → freigegeben → bezahlt. Dubletten-Erkennung (Betrag+Aussteller+Datum).
- Export: CSV/DATEV-kompatible Buchungsliste (Phase 4).

**Ausgang:**
- Angebote & Rechnungen erstellen (Positionsliste, MwSt., Zahlungsziele, Nummernkreise pro Org).
- **E-Rechnung-Pflicht abgedeckt:** Ausgabe als ZUGFeRD-PDF und XRechnung-XML (Edge Function `export-xrechnung`).
- Angebots-Pipeline: Entwurf → gesendet → nachgefasst → angenommen/abgelehnt; automatische
  Nachfass-Vorschläge (Autonomie-Regler!).
- Mahnwesen: 3 Stufen, Textvorlagen, KI-Entwurf, Versand nach Freigabe oder autonom (Stufe 4).

### G — Gedächtnis: Notizen & institutionelles Wissen
- Notizen (Markdown) an Vorgang/Kontakt/frei; schnelle Erfassung (auch Sprachnotiz → Transkript).
- **Wissensextraktion:** Runner destilliert aus Mails/Meetings dauerhafte Fakten
  ("Stadt X verlangt immer Formular Y") in `knowledge_items` — mit Quelle, Datum, Konfidenz.
- Semantische Suche über alles (pgvector): "Was war damals mit der Gewährleistung bei Firma Z?"
- Onboarding-Modus: neuer Mitarbeiter fragt das System statt die Kollegin.

### H — Heute: Briefing & Dashboard
- Startbildschirm = Morgen-Briefing: die 5 wichtigsten Punkte, generiert vom Nacht-Wächter.
- Kacheln: unbeantwortete Mails mit Frist, überfällige Rechnungen (Ein-/Ausgang), heutige Termine
  mit Kontext-Links, festgefahrene Vorgänge, Runner-Status.

### I — Inbox Zero: der Aufgaben-Compiler
- Jede Mail wird in **Entscheidungen** übersetzt: Antworten (Entwurf liegt bei) · Aufgabe anlegen ·
  Termin vorschlagen · An Vorgang heften · Ignorieren/Archivieren.
- Ziel-UX: Posteingang morgens in 10 Minuten leer, weil jede Mail nur noch 1 Klick ist.

### J — Jobs & Automationen (Autonomie-Regler)
- Jede Automatisierung ist ein Datensatz in `automations` mit `autonomy_level 1–4`:
  1 = KI schlägt vor, Mensch klickt · 2 = KI bereitet vor, Mensch gibt frei ·
  3 = KI führt aus, Mensch kann 15 Min. stoppen · 4 = KI führt aus, meldet nur Ausnahmen.
- Trefferquoten-Anzeige pro Automation (`trust_stats`): "Letzte 50 Rechnungszuordnungen: 49 korrekt."
  Hochstufen wird erst ab konfigurierbarer Quote (z. B. 95 % über 30 Läufe) angeboten.
- Vollständiges Protokoll jeder autonomen Aktion (`automation_runs` + `audit_log`), 1-Klick-Rückgängig wo möglich.

### K — Kalender & Termine
- Google Calendar Sync (bidirektional), ICS-Import für andere.
- Terminvorschläge aus Mails ("passt Ihnen Mittwoch?") → 3 freie Slots als Antwortentwurf.
- Termin ↔ Vorgang-Verknüpfung; vor jedem Termin: automatisches Kontext-Briefing
  ("Mit Herrn Meier offen: Angebot 2026-041, letzte Mail vor 9 Tagen, offener Betrag 1.240 €").

### L — Lücken-Wächter (Herzstück Nr. 2)
- Nächtlicher Lauf (pg_cron legt Job an, Runner arbeitet ab): scannt alle offenen Vorgänge auf
  **Lücken** (fehlende Antworten, fehlende Dokumente, fehlende Rechnung zu geliefertem Auftrag),
  **Widersprüche** (Termin vereinbart, aber nicht im Kalender; Betrag in Mail ≠ Betrag im Angebot)
  und **Liegengebliebenes** (Vorgang ohne Aktivität > N Tage).
- Ergebnis in `agent_findings` mit Priorität und vorgeschlagener Aktion → speist das Morgen-Briefing.

### M — Meetings
- Audio-Upload oder Aufnahme in der PWA → Runner transkribiert lokal (whisper.cpp, keine Cloud) →
  `summarize_meeting`: Protokoll, Entscheidungen, Aufgaben (mit Zuständigen), offene Fragen.
- Aufgaben landen direkt im Aufgabenmodul, Protokoll am Vorgang.

### N — Nachverfolgung (Follow-up-Engine)
- Jede gesendete Mail/jedes Angebot kann "erwartete Antwort bis X" tragen (KI schlägt Frist vor).
- Kein Eingang bis X → Nachfass-Entwurf erscheint im Briefing (oder geht autonom raus, Stufe 4).

### O — Offline & PWA
- Installierbar (Desktop + Mobil), Offline-Shell: gelesene Mails, Aufgaben, Vorgänge und Notizen
  offline verfügbar; Schreiben landet in Outbox-Queue und synct bei Verbindung.

### P — Papierkram: Formulare & Fristen (Phase 5)
- Fristenkalender für wiederkehrende Pflichten (frei konfigurierbar: Meldungen, Nachweise, Ablauf
  von Bescheinigungen) mit Dokument-Ablage und Erinnerungskette.
- Formular-Vorausfüllung aus Stammdaten (PDF-Formfelder), Nutzer prüft und reicht ein.

### Q — Qualität & Suche
- Globale Suche (Cmd+K): ein Feld über Mails, Vorgänge, Kontakte, Dokumente, Notizen —
  kombiniert Volltext (tsvector, german) + semantisch (pgvector) + Filter.

### R — Rollen, Rechte & Audit
- RLS auf jeder Tabelle (org-scoped), Rollenmatrix (z. B. `viewer` sieht keine Finanzen).
- `audit_log` für jede schreibende KI-Aktion und jede Freigabe: wer/was/wann/warum (Job-Referenz).

### S — Stil & Persönlichkeit
- `ai_style_profiles`: pro Nutzer gelernter Schreibstil (Anrede, Länge, Floskeln, Sprache) aus
  gesendeten Mails; Entwürfe klingen nach dem Nutzer, nicht nach KI.

### T — Aufgaben (Tasks)
- Eigenes Modul: Status, Fälligkeit, Zuständiger, Vorgangs-Bezug, Checklisten, wiederkehrende Aufgaben.
- Quellen-Kennzeichnung: manuell · aus Mail · aus Meeting · vom Wächter.

### U — Undo & Sicherheit der Aktionen
- Ausgehende autonome Aktionen (Stufe 3) haben eine Halte-Zone (Standard 15 Min.) — sichtbar im UI,
  ein Klick stoppt. Sende-Verzögerung auch für manuelle Mails (30 s Rückholen).

### V — Vorgangsakte (Herzstück Nr. 3)
- Vorgang = Klammer über allem: Titel, Kontakt/Firma, Status (offen · wartet · erledigt · archiviert),
  Zeitleiste aller Ereignisse, Beteiligte, Beträge (Summe Angebote/Rechnungen), Tags.
- Auto-Zuordnung neuer Objekte per `case_match`-Job; Konfidenz < Schwelle → Vorschlag statt Zuordnung.
- Vorgangs-Zusammenfassung auf Knopfdruck ("Erzähl mir den Stand in 5 Sätzen").

### W — Wächter-Berichte & Wochenrückblick
- Freitags: Wochenreport pro Org (erledigt, neu, Umsatzpipeline, Antwortzeiten, KI-Trefferquoten).

### X — XRechnung/ZUGFeRD & Exporte
- Siehe F; zusätzlich: kompletter Datenexport der Org (JSON + Dateien) — kein Lock-in.

### Y — Ihr eigener Stil der Zusammenarbeit (Team-Features)
- Mail/Vorgang intern kommentieren & zuweisen ("@Anna übernimmst du?") ohne Weiterleiten-Chaos.
- Geteilte Postfächer (info@) mit Zuweisungs-Logik.

### Z — Zahlen: Metriken & Selbstbeobachtung
- KI-Nutzungsstatistik pro Runner (Jobs/Tag, Latenz, Fehlerrate) — auch damit der Nutzer sieht,
  wie stark sein Max-Abo belastet wird, inkl. Tageslimit-Einstellung.

---

## 4b. Erweiterung "Komplett-Büro" (Phase 6) — damit wirklich kein Zweittool nötig ist

### Z1 — Zeiterfassung & Abwesenheiten (Migration 011)
- Zeiteinträge manuell, per Timer oder KI-Vorschlag (aus Terminen/Vorgangsaktivität), abrechenbar
  markierbar und direkt in Ausgangsrechnungen überführbar (Stundensatz-Snapshot).
- Arbeitszeitprofile (Soll-Stunden, Arbeitstage), Urlaubskonto pro Jahr mit Übertrag,
  Abwesenheits-Workflow (beantragt → genehmigt), Team-Abwesenheitskalender, AU-Upload,
  Feiertage pro Org (Bundesland-Import).

### Z2 — Banking & Zahlungsabgleich (Migration 012)
- Bankkonten via GoCardless Bank Account Data (PSD2) oder FinTS-Connector im Runner; CSV-Import
  als Fallback. Umsätze automatisch synchronisiert.
- KI-Job `payment_match`: Umsatz ↔ offene Rechnung (Betrag, Rechnungsnummer/Name im
  Verwendungszweck, Fälligkeitsnähe), Teilzahlungen möglich, Bestätigung setzt Rechnungsstatus
  automatisch auf bezahlt/teilbezahlt. Erst damit wird das Mahnwesen wirklich verlässlich:
  gemahnt wird nur, was nachweislich nicht bezahlt ist.

### Z3 — Buchhaltungs-Export DATEV (Migration 013)
- Monatlicher Export-Stapel (DATEV EXTF Buchungsstapel oder CSV) aus Ausgangs-/Eingangsrechnungen
  und Bankumsätzen; Kontierungs-Vorschläge per KI (`auto_account_assign`), Freigabe durch Menschen,
  deterministisch generierte Datei (kein LLM in der Dateierzeugung).
- Debitoren-/Kreditoren-Nummern an Firmen, Doppel-Export-Sperre, SKR03/SKR04.
- Wichtig: Kontenrahmen vor erstem Export vom Steuerberater bestätigen lassen — Leitwerk liefert
  Buchungsvorschläge, keine Steuerberatung.

### Z4 — Anrufprotokolle (Migration 014)
- Schnellerfassung nach jedem Telefonat (30 Sekunden, auch als Sprachnotiz → Whisper → KI-Kurzfassung
  + Ergebnis + Aufgaben-Vorschlag), automatische Vorgangs-/Kontakt-Zuordnung, Anrufe in der
  Vorgangs-Timeline. Ausbaustufe: Telefonanlagen-/AB-Anbindung.

### Z5 — Verträge & Abos (Migration 015)
- Vertragsregister mit Laufzeit, automatischer Verlängerung, Kündigungsfrist und berechnetem
  spätestem Kündigungstermin; Jahreskosten-Übersicht ("Was kostet uns Software/Leasing/Versicherung?").
- KI-Extraktion der Eckdaten aus dem Vertragsdokument (`extract_contract`), täglicher
  `contract_watch`-Job speist Findings ins Morgen-Briefing ("Vertrag X kündbar bis 30.09 — 
  Jahreskosten 2.340 €").

---

## 5. Job-Typen-Katalog (Runner-Skills, initial)

| Job-Typ | Auslöser | Autonomie-fähig |
|---|---|---|
| classify_email | neue Mail | ja (ab Stufe 2 Auto-Label) |
| case_match | neue Mail/Dokument/Termin | ja |
| extract_commitments | neue Mail | Vorschlag |
| draft_reply | Nutzer-Klick oder Follow-up-Engine | ja (Stufe 4 = Auto-Send) |
| thread_summary | Nutzer-Klick / lange Threads | — |
| extract_invoice | Anhang erkannt als Rechnung | ja (Erfassung) |
| ocr_document | neues Dokument ohne Textlayer | ja |
| gap_scan | pg_cron nachts | erzeugt Findings |
| morning_briefing | pg_cron 06:30 | erzeugt Briefing |
| summarize_meeting | Audio-Upload | — |
| build_style_profile | wöchentlich | ja |
| knowledge_distill | wöchentlich | Vorschlag |
| followup_check | pg_cron stündlich | ja |
| weekly_report | pg_cron freitags | ja |

---

## 6. Sicherheit & DSGVO

1. **Token-Tresor:** Gmail/GCal-Refresh-Tokens nur serverseitig, verschlüsselt (Supabase Vault),
   Zugriff ausschließlich durch Edge Functions. Der Browser sieht nie ein Token.
2. **Runner-Auth:** Pairing-Code → langlebiges Runner-Token (nur Hash in DB), Scopes pro Runner,
   Widerruf jederzeit in der PWA. Runner spricht nur mit der Broker-Edge-Function, nie direkt mit Fremd-APIs
   außer den vom Nutzer verbundenen (Gmail des Nutzers).
3. **Datenminimierung Richtung KI:** `build-job-context` schneidet Kontext zu (nur relevanter Thread,
   nicht das ganze Postfach); PII-Redaction-Option für besonders vorsichtige Orgs.
4. **RLS überall**, Policies mit `(select auth.uid())`-Muster (Initplan-Problem von Anfang an vermeiden),
   Indexe auf allen FK- und org_id-Spalten von Tag 1.
5. **Audit-Log** unveränderlich (nur INSERT), 2 Jahre Aufbewahrung, Export für AV-Vertrag-Nachweise.
6. **Löschkonzept:** Org-Löschung = kaskadierendes Löschen inkl. Storage; Mail-Konto trennen =
   lokale Kopien löschen optional.

---

## 7. Datenmodell — Überblick

9 Migrationen (siehe `/migrations`), grob:

- **001_core:** Extensions (pgcrypto, pgvector, pg_trgm), orgs, profiles, org_members, invites, settings, audit_log
- **002_runner_jobs:** runners, runner_pairing_codes, agent_jobs, agent_job_events, ai_style_profiles
- **003_mail:** mail_accounts, mail_threads, mail_messages, mail_attachments, mail_drafts, mail_templates
- **004_cases_contacts:** contacts, companies, cases, case_links (polymorph), case_events (Timeline)
- **005_tasks_calendar:** tasks, task_checklist_items, calendar_accounts, calendar_events, notifications, snoozes
- **006_finance:** invoices_in, invoices_out, invoice_items, quotes, quote_items, dunning_runs, number_ranges
- **007_knowledge:** notes, documents, knowledge_items, embeddings (pgvector), meetings, meeting_tasks
- **008_automation:** automations, automation_runs, trust_stats, agent_findings, briefings, followups
- **009_rls_functions:** Helper-Funktionen, sämtliche RLS-Policies, Job-Claim-RPC, pg_cron-Jobs

Konventionen: UUID-PKs (`gen_random_uuid()`), `org_id` auf jeder fachlichen Tabelle, `created_at/updated_at`
(Trigger), Soft-Delete via `deleted_at` nur wo fachlich nötig (Mails, Vorgänge), sonst hartes Löschen.

---

## 8. Roadmap

**Phase 0 — Fundament (1–2 Wochen)**
Repo-Setup (Monorepo: `apps/pwa`, `apps/runner`, `supabase/`), CI, Migrationen 001+002 live,
Auth + Org-Verwaltung, Runner-Pairing Ende-zu-Ende (Dummy-Job "echo").

**Phase 1 — E-Mail-Hub (3–4 Wochen)**
Gmail-OAuth + Sync, Inbox-UI (lesen, schreiben, senden), classify_email + case_match + draft_reply,
Vorgangsakte v1 (Auto-Anlage, Timeline). → **Ab hier täglich selbst nutzbar (Dogfooding).**

**Phase 2 — Aufgaben-Compiler & Briefing (2–3 Wochen)**
extract_commitments, Aufgabenmodul, Follow-up-Engine, Nacht-Wächter v1 (gap_scan), Morgen-Briefing,
Web-Push.

**Phase 3 — Finanzen (3–4 Wochen)**
extract_invoice (Eingang), Prüf-Workflow, Ausgangsrechnungen + Angebote, XRechnung/ZUGFeRD-Export,
Mahnwesen, Nummernkreise.

**Phase 4 — Autonomie & Wissen (2–3 Wochen)**
Autonomie-Regler UI + trust_stats, Stufe-3/4-Ausführung mit Halte-Zone, Notizen, knowledge_distill,
semantische Suche, Meetings (whisper).

**Phase 5 — Team & Papierkram (2–3 Wochen)**
Geteilte Postfächer, Kommentare/Zuweisungen, Fristenkalender, Formular-Vorausfüllung, Wochenreport,
IMAP-Fallback, Kalender-Sync bidirektional.

**Phase 6 — Komplett-Büro (3–4 Wochen)**
Zeiterfassung + Abwesenheiten (011), Banking-Sync + Zahlungsabgleich (012), DATEV-Export (013),
Anrufprotokolle (014), Vertragsregister mit Kündigungs-Wächter (015). Danach gilt:
ein Büro braucht neben Leitwerk nur noch Bank, Steuerberater und Telefon.

**Phase 7 — Produktisierung (offen)**
Onboarding-Polish, Landing Page, Preismodell (Software-Abo, KI zahlt der Nutzer selbst via Max — 
das ist das Verkaufsargument: "keine KI-Kosten beim Anbieter"), gehosteter Runner als Option,
Mandanten-Trennung härten, Pen-Test.

---

## 9. Risiken & offene Entscheidungen

| Risiko | Einschätzung / Gegenmaßnahme |
|---|---|
| Anthropic ändert CLI-/Abo-Bedingungen | Provider-Adapter: API-Key & Codex als Fallback sind ab Tag 1 eingebaut |
| Gmail-OAuth-Verifizierung (Google App Review für sensitive Scopes) | Früh beantragen; bis dahin Testnutzer-Modus (100 Nutzer) reicht für MVP |
| Runner-Betrieb überfordert Nicht-Techniker | Tray-App mit 1-Klick-Installer als Ziel; `npx` nur für Early Adopters |
| Max-Abo-Limits bei viel Mailverkehr | Job-Drosselung, Batching (mehrere Mails pro classify-Aufruf), Tageslimit-Regler |
| KI-Fehlzuordnungen zerstören Vertrauen | Autonomie-Stufen + sichtbare Trefferquote + 1-Klick-Korrektur, die als Feedback zurückfließt |
| Scope-Explosion | Phasen strikt; jede Phase endet mit etwas täglich Nutzbarem |

Offen zu entscheiden: Produktname · Monorepo-Tooling (pnpm + Turborepo empfohlen) ·
Whisper lokal vs. optional Cloud · Preismodell Phase 6.
