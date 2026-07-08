# ROADMAP_PROMPTS.md — Fertige Prompts für Claude Code

Pro Phase eine Claude-Code-Session (oder mehrere). Vorher immer: Repo auf sauberem Stand,
`CLAUDE.md` + `docs/` aktuell. Prompts kopierbar; Ergänzungen in [Klammern].

---

## Phase 0 — Fundament

```
Lies CLAUDE.md, docs/MASTERPLAN.md und docs/DESIGN.md vollständig.

Setze das Monorepo auf: pnpm + Turborepo, apps/pwa (React 18 + Vite + TS strict + Tailwind +
TanStack Query + Zustand + vite-plugin-pwa), apps/runner (Node 20, tsup), packages/shared,
packages/ui, supabase/ (Migrationen aus /migrations übernehmen, Functions-Skeleton).

Implementiere Phase 0 gemäß Definition of Done in CLAUDE.md:
1. Supabase-Client-Setup + Auth (E-Mail/Passwort + Google), Login/Registrierung nach DESIGN.md
2. Org-Anlage + Onboarding-Wizard (5 Schritte aus org_profile.onboarding: Firma/Stammdaten,
   Postfach [nur UI-Platzhalter], Runner-Pairing, Nummernkreise prüfen, fertig)
3. App-Shell: Icon-Rail, Sidebar, CommandBar-Skeleton, Theme light/dark
4. Edge Function runner-broker: /pair (Pairing-Code einlösen → Runner + Token),
   /claim, /heartbeat, /complete, /fail — Token-Verifikation via Hash + RUNNER_TOKEN_PEPPER
5. Runner: init-Flow (Pairing-Code anzeigen, Polling bis eingelöst), Poll-Loop,
   AiProvider-Interface mit claude-cli-Adapter, Skill 'echo' (KI antwortet auf Testtext)
6. PWA-Seite Einstellungen→Runner: Pairing-UI, Live-Status via Realtime, Test-Job-Button
7. .env.example für pwa/runner/functions, README mit Dev-Quickstart, CI (lint+test+build)

Halte dich strikt an die 10 Regeln in CLAUDE.md. Am Ende: docs/CHANGELOG.md-Eintrag +
Liste der manuellen Deploy-Schritte für mich.
```

---

## Phase 1 — E-Mail-Hub + Vorgangsakte

```
Lies CLAUDE.md, docs/MASTERPLAN.md (§4 B, C, V), docs/DESIGN.md. Phase 0 ist abgeschlossen.

Implementiere:
1. Edge Function oauth-gmail (Start + Callback, Refresh-Token → Vault, mail_accounts anlegen)
2. Runner-Connector gmail-sync: Initial-Sync (90 Tage), Delta via History-API alle 2 Min,
   Threads/Messages/Attachments in DB, Anhänge nach Storage 'attachments'
3. Inbox-UI nach DESIGN.md (InboxRow, Thread-Ansicht, Lesen/Ungelesen, Archiv, Suche via tsvector)
4. Composer (Tiptap): Neu/Antworten/Weiterleiten, Signaturen aus mail_accounts, Anhänge,
   Senden mit 30s-Undo (mail_drafts status='scheduled', send_after=now()+30s), Edge Function send-mail
5. Skills im Runner: classify_email, case_match, draft_reply, thread_summary —
   Kontext via build-job-context (implementieren), striktes Zod-Parsing
6. Vorgangsakte v1: cases-Liste + Detail mit CaseTimeline, Auto-Anlage durch case_match
   (Konfidenz >= min_confidence, sonst Vorschlag mit AiBadge), case_links + case_events
7. Automation-Verdrahtung: auto_label_mail / auto_case_match als automation_runs mit
   outcome-Feedback bei Nutzerkorrektur (Kategorie ändern, Vorgang umhängen)

Definition of Done P1 aus CLAUDE.md gilt. Jeder View mit allen 5 Zuständen.
```

---

## Phase 2 — Aufgaben-Compiler, Wächter, Briefing

```
Lies CLAUDE.md + MASTERPLAN §4 E, H, I, L, N, T. Phase 1 läuft produktiv.

Implementiere:
1. Skill extract_commitments → Aufgaben-Vorschläge (tasks source='mail_extract') mit AiBadge-Annahme-UI
2. Aufgabenmodul komplett (Liste, Detail, Checklisten, Zuweisung, Wiederholung, Snooze)
3. Follow-up-Engine: followups bei gesendeten Angeboten/Mails (KI schlägt expected_by vor),
   Skill followup_check (stündlich via Cron-Job-Erzeuger), Nachfass-Drafts
4. Skill gap_scan: Findings (gap/contradiction/stale) mit dedupe_key, Severity, suggested_action
5. Skill morning_briefing: BriefingCard-Feed als Startseite "Heute" nach DESIGN.md
6. Web-Push (VAPID) + Notification-Center, notifications-Verdrahtung für Findings/Follow-ups
7. TrustMeter-Komponente + trust_stats-Pflege aus automation_runs.outcome
```

---

## Phase 3 — Finanzen

```
Lies CLAUDE.md + MASTERPLAN §4 F, X. 

Implementiere:
1. Skill extract_invoice (ZUGFeRD/XRechnung-XML direkt parsen; sonst KI-Extraktion aus PDF-Text/OCR),
   Dubletten-Check, invoices_in Prüf-Workflow-UI (captured→review→approved→paid)
2. Ausgangsrechnungen + Angebote: Editor mit Positionslisten (MoneyCell, tabular-nums),
   Stammdaten aus org_profile, Nummernkreis via next_number()
3. Edge Function export-xrechnung: XRechnung 3.x XML (EN16931) + ZUGFeRD-PDF (PDF/A-3),
   buyer_reference-Pflichtfeld-Validierung bei B2G
4. Versand von Angeboten/Rechnungen als Mail mit Anhang über den bestehenden Draft-Flow
5. Mahnwesen: dunning_runs 3 Stufen, Gebühren aus org_profile.dunning_fees, KI-Entwürfe,
   Freigabe-Flow (automation auto_dunning)
6. Finanz-Übersicht: offene Posten Ein/Aus, Fälligkeiten, Pipeline aus Angeboten
Viewer-Rolle darf NICHTS davon sehen (RLS existiert, UI ebenfalls absichern).
```

---

## Phase 4 — Autonomie & Wissen

```
Lies CLAUDE.md + MASTERPLAN §4 G, J, M, Q, S, U.

Implementiere:
1. Automationen-Seite: alle automations mit Autonomie-Regler (1–4), TrustMeter,
   Hochstufen-Gate (promote_threshold + promote_min_runs), Erklärtexte
2. Stufe-3-Ausführung: HoldBanner mit Countdown, automation_runs status='holding',
   Ausführung nach hold_until durch send-mail/Broker, Stopp-Aktion
3. Notizen-Modul (Markdown, Sprachnotiz→Whisper-Transkript)
4. Skills knowledge_distill + build_style_profile; knowledge_items-Review-UI (proposed→confirmed)
5. Embeddings-Pipeline im Runner (lokales Modell, 1024-dim, bge-m3 o. ä.) für Messages/Docs/Notes;
   CommandBar-Suche: tsvector + Vektor-Ähnlichkeit kombiniert
6. Meetings: Audio-Upload/Aufnahme, whisper.cpp im Runner, summarize_meeting →
   Protokoll + decisions + Aufgaben (source='meeting')
```

---

## Phase 5 — Team & Ausbau

```
Lies CLAUDE.md + MASTERPLAN §4 K, P, W, Y.

Implementiere:
1. Geteilte Postfächer (mail_accounts.is_shared) mit Zuweisung von Threads an Mitglieder,
   interne Kommentare + @Mentions (notifications kind='mention')
2. Kalender: gcal-sync im Runner (bidirektional), Termin↔Vorgang, ai_briefing vor Terminen,
   Terminvorschlags-Antworten (3 freie Slots)
3. IMAP/SMTP-Connector als Gmail-Alternative
4. Fristenkalender (wiederkehrende Pflichten als tasks mit recurrence) + Dokument-Ablage
5. Skill weekly_report (freitags, briefings kind='weekly')
6. Datenexport der Org (JSON + Storage-Dateien als ZIP über exports-Bucket)
```

---

## Dauerhafte Review-Anweisung (an jede Session anhängen)

```
Bevor du fertig meldest: (1) pnpm lint && pnpm test && pnpm build grün,
(2) alle neuen Views gegen DESIGN.md prüfen (5 Zustände, Farben, keine verbotenen Muster),
(3) keine Secrets im Client-Bundle (grep nach SERVICE_ROLE), (4) neue manuelle Schritte
in tutorials/ ergänzt, (5) CHANGELOG.md-Eintrag mit Deploy-Liste.
```

---

## Phase 6 — Komplett-Büro

```
Lies CLAUDE.md + MASTERPLAN §4b (Z1–Z5). Migrationen 011–015 sind eingespielt.

Implementiere:
1. Zeiterfassung: Timer + manuelle Erfassung + Wochenansicht, Soll/Ist aus work_profiles,
   abrechenbare Zeiten als Positionen in Ausgangsrechnungen übernehmen (Snapshot hourly_rate),
   Skill time_suggest (Vorschläge aus Kalender/Vorgangsaktivität, automation auto_time_suggest)
2. Abwesenheiten: Antrag/Genehmigung-Flow, Urlaubskonto (leave_balances-Pflege per Trigger
   oder Funktion), Team-Abwesenheitskalender, AU-Upload an absences, Feiertags-Import
   (Bundesland-Auswahl im Onboarding, statische Datei in packages/shared)
3. Banking: Runner-Connector gocardless (Consent-Flow via Edge Function oauth-bank,
   Token → Vault, consent_expires_at-Warnung als Finding), CSV-Import-Fallback,
   Umsatzliste mit Match-Status
4. Skill payment_match: Vorschläge als payment_matches (AiBadge + Konfidenz),
   Bestätigung nutzt bestehenden Trigger apply_payment_match; Mahnwesen prüft ab jetzt
   IMMER match-Status vor Mahnvorschlag
5. DATEV-Export: Einstellungs-Seite accounting_settings (mit deutlichem Hinweis
   "vom Steuerberater bestätigen lassen"), Skill account_assign (Kontierungsvorschläge
   für invoices_in), Edge Function export-datev (EXTF-Buchungsstapel, deterministisch,
   Header nach DATEV-Spezifikation, CRLF, CP1252), Batch-UI mit Periodenwahl,
   exported_in-Sperre, ZIP inkl. Belegkopien in Bucket exports
6. Anrufe: Schnellerfassungs-Dialog (globaler Shortcut), Sprachnotiz → transcribe_call +
   summarize_call, Anrufe in CaseTimeline + Kontakt-Dossier, Follow-up-Task-Erzeugung
7. Verträge: Register-UI mit Jahreskosten-Summen pro Kategorie, Upload → extract_contract
   (Vorschlag der Eckdaten, Nutzer bestätigt), Skill contract_watch (Findings mit dedupe_key,
   Vorlauf konfigurierbar: 90/60/30 Tage vor notice_deadline), Kündigungs-Entwurf als Mail-Draft
8. Cron-Ergänzungen aus 012/015 in tutorials/01 dokumentieren, tutorials/06 (Banking + DATEV) prüfen/ergänzen

Definition of Done: alle 5 Module mit 5 Zuständen nach DESIGN.md, Tests für payment_match-Trigger,
Urlaubskonto-Berechnung, EXTF-Generierung (Golden-File-Test), keine Finanzdaten für Viewer.
```
