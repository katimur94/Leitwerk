// ============================================================
// Baut die Leitwerk-Vermarktungspräsentation:
//   1. selbst-enthaltendes HTML (Leitwerk-Design, Inter eingebettet)
//   2. daraus ein PDF (A4 quer) via Chromium/Playwright
// Start: node docs/praesentation/build.mjs
// ============================================================
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "../..");
const IMG = join(ROOT, "docs/testing-tutorial/img");
const OUT_HTML = join(ROOT, "docs/praesentation/Leitwerk-Praesentation.html");
const OUT_PDF = join(ROOT, "docs/Leitwerk-Praesentation.pdf");

// Inter (variabel, latin) base64-eingebettet → Typografie unabhängig vom System
const interB64 = readFileSync(
  join(ROOT, "apps/pwa/dist/assets/inter-latin-wght-normal-Dx4kXJAl.woff2"),
).toString("base64");

// Screenshot als data-URI (self-contained, überall renderbar)
const dataUri = (file) =>
  `data:image/png;base64,${readFileSync(join(IMG, file)).toString("base64")}`;

// Fettdruck-Markup in Callouts: **Label** → <b>
const bold = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

// ---------------------------------------------------------
// Inhalt
// ---------------------------------------------------------
const DECK = [
  { type: "cover" },
  { type: "intro" },
  { type: "how" },

  { type: "divider", num: "01", title: "Zugang & Registrierung",
    sub: "Ruhiger, präziser Einstieg — deutsche Texte, klare Zustände." },
  { type: "feature", img: "01-login.png", module: "Auth", title: "Anmelden",
    lead: "E-Mail/Passwort über Supabase Auth, Google-Login vorbereitet. Kein Admin-Template — Referenzklasse Linear/Superhuman.",
    points: [
      "**E-Mail & Passwort** — validiert im Client, final geprüft von Supabase.",
      "**Fehlermeldungen deutsch** — jede Eingabe hat einen klaren, ruhigen Zustand.",
      "**Google-Login** — als Alternative vorbereitet (ein Klick statt Passwort).",
    ],
    tech: "Auth in der EU (Supabase Frankfurt), Sessions verschlüsselt." },
  { type: "feature", img: "02-registrierung.png", module: "Auth", title: "Registrieren",
    lead: "Legt zunächst nur das Nutzerkonto an — die Organisation entsteht im nächsten Schritt.",
    points: [
      "**Name, E-Mail, Passwort** — Passwortregeln greifen sofort.",
      "**Ein Konto, viele Organisationen** — Nutzer und Firma sind getrennt.",
      "**Direkt weiter** in den geführten Onboarding-Wizard.",
    ] },

  { type: "divider", num: "02", title: "Onboarding in 5 Schritten",
    sub: "Von der leeren Firma zum arbeitsfähigen Büro — inklusive KI-Runner." },
  { type: "feature", img: "03-onboarding-organisation.png", module: "Onboarding · 1/5", title: "Organisation anlegen",
    lead: "Nur der Firmenname ist nötig. Im Hintergrund bootstrapped ein Datenbank-Trigger die komplette Org.",
    points: [
      "**Owner-Rolle** — der Ersteller wird automatisch Inhaber.",
      "**7 Standard-Automationen** — alle starten auf Stufe 1 (nur Vorschlag).",
      "**4 Nummernkreise** — Angebot, AB, Rechnung, Gutschrift vorbereitet.",
      "**Multi-Tenant ab Sekunde 1** — jede Zeile trägt org_id, RLS überall.",
    ] },
  { type: "feature", img: "04-onboarding-stammdaten.png", module: "Onboarding · 2/5", title: "Firmen-Stammdaten",
    lead: "Einmal erfasst, überall korrekt: Diese Daten fließen unverändert in Dokumente und Signaturen.",
    points: [
      "**Anschrift & Kontakt** — Kopf jeder Rechnung und jedes Angebots.",
      "**Steuernummer / USt-IdNr.** — pflichtgemäß auf allen Belegen.",
      "**Bankverbindung** — landet automatisch auf Rechnungen (auch als XRechnung).",
    ] },
  { type: "feature", img: "05-onboarding-postfach.png", module: "Onboarding · 3/5", title: "Postfach (optional)",
    lead: "Gmail lässt sich hier oder später verbinden — der Wizard blockiert nie.",
    points: [
      "**Jetzt verbinden** — sofort loslegen mit dem eigenen Posteingang.",
      "**Überspringen** — Dogfooding beginnt auch ohne Postfach.",
      "**OAuth-Sicherheit** — Token wandert direkt in den Tresor, nie in den Browser.",
    ] },
  { type: "feature", img: "06-onboarding-runner-pairing.png", module: "Onboarding · 4/5", title: "Runner-Pairing — das BYO-KI-Herzstück",
    lead: "Der Nutzer startet den Runner lokal, dieser zeigt einen 8-stelligen Code, der in die PWA getippt wird.",
    points: [
      "**Klartext-Token genau einmal** — in der DB liegt nur der Hash.",
      "**Rate-Limit** — max. 10 Pairing-Versuche pro IP und Minute.",
      "**Fehlversuchszähler** — nach 5 falschen Codes ist der Code gesperrt.",
    ],
    tech: "BYO-KI: Jeder bringt sein eigenes Claude-Max-Abo mit — keine KI-Kosten beim Betreiber." },
  { type: "feature", img: "07-onboarding-runner-freigabe.png", module: "Onboarding · 4/5", title: "Zwei-Stufen-Freigabe",
    lead: "Ein frisch gepairter Runner darf noch nichts — erst die ausdrückliche Bestätigung schaltet ihn frei.",
    points: [
      "**Status pending_approval** — Runner claimt keine Jobs, bis freigegeben.",
      "**Owner/Admin bestätigt** — ein erratener Code allein reicht nie für Datenzugriff.",
      "**Bestätigen / Ablehnen** — volle Kontrolle über jedes Gerät.",
    ] },
  { type: "feature", img: "08-onboarding-runner-verbunden.png", module: "Onboarding · 4/5", title: "Runner verbunden",
    lead: "Nach der Freigabe erscheint der Runner mit Live-Status und Herkunfts-Badge.",
    points: [
      "**Grüner Heartbeat** — Signal jünger als 3 Minuten = online.",
      "**Provider-Badge** — claude_cli, codex_cli oder anthropic_api.",
      "**Server-Watchdog** — erkennt tote Runner und stellt Jobs zurück.",
    ] },
  { type: "feature", img: "09-onboarding-nummernkreise.png", module: "Onboarding · 5/5", title: "Nummernkreise",
    lead: "Jeder Belegtyp bekommt einen Zähler mit Präfix und Vorschau der nächsten Nummer.",
    points: [
      "**Präfix & Startwert** frei wählbar (z. B. RE-2026-####).",
      "**Atomare Vergabe** über next_number() — keine Lücken, keine Dubletten.",
      "**Vorschau** der nächsten Nummer direkt im Wizard.",
    ] },
  { type: "feature", img: "10-onboarding-fertig.png", module: "Onboarding · Fertig", title: "Startklar",
    lead: "Der Wizard fasst zusammen und übergibt in die App — die Org ist voll arbeitsfähig.",
    points: [
      "**Zusammenfassung** aller Einrichtungsschritte.",
      "**Zur App** — direkter Sprung auf die Startfläche „Heute“.",
      "**Alles vorbereitet** — Postfach, Runner, Nummernkreise, Automationen.",
    ] },

  { type: "divider", num: "03", title: "Das Grundgerüst",
    sub: "Eine ruhige Oberfläche, jederzeit per Tastatur steuerbar." },
  { type: "feature", img: "11-app-shell-heute.png", module: "App-Shell", title: "Startfläche „Heute“",
    lead: "Icon-Rail → Kontext-Sidebar → Hauptfläche. Von hier ist jedes Modul erreichbar.",
    points: [
      "**Icon-Rail (56 px)** — Heute, Posteingang, Vorgänge, Aufgaben, Finanzen, Notizen, Meetings, Kalender, Büro.",
      "**Kontext-Sidebar** — passt sich dem aktuellen Bereich an.",
      "**Hauptfläche** — der eigentliche Arbeitsbereich, ruhig und fokussiert.",
    ] },
  { type: "feature", img: "12-finanzen-leer.png", module: "Design-Prinzip", title: "Empty-States als Feature",
    lead: "Kein leerer Bildschirm: Jede Ansicht erklärt, was als Nächstes passiert.",
    points: [
      "**Erklärung statt Leere** — der Nutzer weiß immer, was zu tun ist.",
      "**Pflicht laut DESIGN.md** — jede Ansicht hat Empty-, Loading- und Fehler-Zustand.",
      "**Konsistent** über alle Module hinweg.",
    ] },
  { type: "feature", img: "13-commandbar.png", module: "CommandBar", title: "Globale Steuerung (Strg/Cmd + K)",
    lead: "Die Tastatur-Zentrale: springt zu Modulen, öffnet Aktionen und ist der Einstieg in die Suche.",
    points: [
      "**Ein Kürzel** — überall in der App verfügbar.",
      "**Navigieren & Handeln** — Module, Vorgänge, Aktionen aus einem Feld.",
      "**Tastatur-first** — schneller als jede Maus-Navigation.",
    ] },

  { type: "divider", num: "04", title: "Der KI-Runner",
    sub: "Lokaler Agent, serverseitig kontrolliert — Abo-Schutz inklusive." },
  { type: "feature", img: "14-runner-einstellungen.png", module: "Runner", title: "Kommandozentrale",
    lead: "Verbundene Runner mit Heartbeat und Provider, Pairing weiterer Geräte, Testlauf der ganzen Kette.",
    points: [
      "**Runner-Liste** mit Live-Heartbeat und Provider-Badge.",
      "**Weiteren Runner pairen** — mehrere Geräte pro Nutzer möglich.",
      "**Offline-Banner** — dezent; der Rest der App bleibt voll benutzbar.",
    ] },
  { type: "feature", img: "15-runner-limits.png", module: "Runner · Abo-Schutz", title: "Limits & Nachtfenster",
    lead: "Das mitgebrachte Claude-Abo bleibt im Rahmen — serverseitig erzwungen, nicht nur im UI.",
    points: [
      "**Stunden- & Tageslimit** — pro Runner einstellbar.",
      "**Nachtfenster** — Batch-Jobs (z. B. Wächter) nur im gewählten Zeitraum.",
      "**Interaktiv hat Vorrang** — dringende Jobs (Priorität ≤ 2) laufen immer.",
    ],
    tech: "Erzwungen direkt in claim_next_job — der Client kann die Grenze nicht umgehen." },
  { type: "feature", img: "16-testjob-gesendet.png", module: "Runner · Test", title: "Test-Job in der Queue",
    lead: "Ein Klick legt einen echo-Job ab und beweist die komplette Verarbeitungskette.",
    points: [
      "**claim_next_job** — prioritätssortiert, SKIP LOCKED, kein Job doppelt.",
      "**Kontext vom Server** — build-job-context; der Runner baut keine Prompts aus Rohdaten.",
      "**Strenges Parsen** — Zod-validiert, mit Idempotenz-Hash gegen Doppelverarbeitung.",
    ] },
  { type: "feature", img: "17-testjob-ki-antwort.png", module: "Runner · Test", title: "KI-Antwort — live",
    lead: "Der Status läuft in Echtzeit durch: Wartet → Läuft → Erledigt. Die Antwort trägt das KI-Badge.",
    points: [
      "**Realtime-Update** — kein Neuladen nötig.",
      "**Violettes KI-Badge** — die eiserne Regel: Violett = Maschine.",
      "**Ganze Kette bewiesen** — PWA → Queue → Runner → KI → zurück in die PWA.",
    ] },

  { type: "divider", num: "05", title: "E-Mail-Hub & Vorgangsakte",
    sub: "Gmail bleibt Gmail — Leitwerk sortiert, verknüpft und denkt mit." },
  { type: "feature", img: "18-postfach-verbinden.png", module: "Mail", title: "Postfach verbinden",
    lead: "Google-OAuth mit sofortiger Tresor-Ablage des Refresh-Tokens.",
    points: [
      "**OAuth-Consent** — Leitwerk fragt nur die nötigen Scopes an.",
      "**Refresh-Token in den Vault** — nie in den Client, nie ins Log.",
      "**Klebeschicht, kein Ersatz** — dein Gmail bleibt unverändert nutzbar.",
    ] },
  { type: "feature", img: "19-postfach-verbunden.png", module: "Mail", title: "Konto verbunden",
    lead: "Die PWA zeigt das verbundene Konto samt Sync-Status.",
    points: [
      "**Initial 90 Tage** — der Runner holt die jüngste Historie.",
      "**Delta alle 2 Minuten** — neue Mails erscheinen fast in Echtzeit.",
      "**Mehrere Postfächer** — pro Nutzer und Team möglich.",
    ] },
  { type: "feature", img: "20-inbox.png", module: "Mail", title: "Inbox mit KI-Kategorien",
    lead: "Jede neue Mail wird klassifiziert und automatisch einem Vorgang zugeordnet.",
    points: [
      "**classify_email** — Kategorie direkt in der Liste sichtbar.",
      "**case_match** — Zuordnung zu bestehendem oder neuem Vorgang.",
      "**Konfidenz-Gate** — unsichere Zuordnungen prüft der Mensch.",
    ] },
  { type: "feature", img: "21-thread-vorgang.png", module: "Mail", title: "Thread mit Auto-Vorgang",
    lead: "Öffnet man einen Thread, hängt bereits eine Vorgangsakte mit Nummer daran.",
    points: [
      "**Nachrichten links, Kontext rechts** — alles auf einen Blick.",
      "**Automatischer Vorgang** — inklusive Nummernkreis.",
      "**Ein Fall, eine Akte** — kein Springen zwischen Apps.",
    ] },
  { type: "feature", img: "22-ki-entwurf.png", module: "Mail", title: "KI-Antwortentwurf",
    lead: "draft_reply schlägt eine Antwort im gelernten Schreibstil vor — als Entwurf, nie automatisch.",
    points: [
      "**Im eigenen Ton** — der Runner lernt den Stil aus gesendeten Mails.",
      "**Violett markiert** — klar als KI-Vorschlag erkennbar.",
      "**Frei editierbar** — übernehmen, ändern oder verwerfen.",
    ] },
  { type: "feature", img: "23-senden-undo.png", module: "Mail", title: "Senden mit 30-Sekunden-Rückholen",
    lead: "Jeder Versand hat ein serverseitig erzwungenes Undo-Fenster.",
    points: [
      "**30 Sekunden Rückhol-Zeit** — bevor die Mail wirklich rausgeht.",
      "**Ein Klick stoppt** — Tippfehler oder falscher Empfänger? Zurückgeholt.",
      "**Server erzwingt es** — nicht bloß eine UI-Animation.",
    ] },
  { type: "feature", img: "24-gesendet.png", module: "Mail", title: "Gesendet & abgelegt",
    lead: "Die Nachricht erscheint als gesendet im Thread und in der Vorgangs-Timeline.",
    points: [
      "**Inbound + Outbound** an einem Ort.",
      "**Timeline-Eintrag** — lückenlose Historie pro Vorgang.",
      "**Nichts geht verloren** — jede Aktion ist nachvollziehbar.",
    ] },

  { type: "divider", num: "06", title: "Proaktivität",
    sub: "Aufgaben, Nacht-Wächter, Morgen-Briefing — Leitwerk denkt voraus." },
  { type: "feature", img: "25-aufgaben.png", module: "Aufgaben", title: "Aufgaben-Compiler",
    lead: "extract_commitments übersetzt Zusagen aus Mails in konkrete Aufgaben-Vorschläge.",
    points: [
      "**Automatische Vorschläge** (violett) aus dem Mailverlauf.",
      "**Feedback-Schleife** — Annehmen/Verwerfen speist die Trefferquote.",
      "**Fälligkeiten** — mit Datum und Vorgangsbezug.",
    ] },
  { type: "feature", img: "26-heute-briefing.png", module: "Briefing", title: "Morgen-Briefing & Nacht-Wächter",
    lead: "Der Tag startet mit den wichtigsten Punkten — der nächtliche Lauf findet Liegengebliebenes.",
    points: [
      "**morning_briefing** — „Diese Dinge brauchen dich heute“ mit Direkt-Aktion.",
      "**gap_scan** — meldet z. B. seit 3 Tagen unbeantwortete Mails.",
      "**Follow-up-Engine** — fasst automatisch nach, wenn Antworten ausbleiben.",
    ] },
  { type: "feature", img: "27-benachrichtigungen.png", module: "Benachrichtigungen", title: "Notification-Center & Web-Push",
    lead: "Benachrichtigungen sammeln sich zentral und kommen aufs Gerät.",
    points: [
      "**Zentrales Center** — alles Wichtige an einem Ort.",
      "**Web-Push** — erreicht dich auch bei geschlossener App.",
      "**Aktionierbar** — direkt aus der Benachrichtigung springen.",
    ] },
  { type: "feature", img: "28-automationen.png", module: "Vertrauen", title: "Automationen mit TrustMeter",
    lead: "Jede Automation zeigt ihre gemessene Trefferquote — die Basis fürs Hochstufen.",
    points: [
      "**TrustMeter** — sichtbare Quote pro Automation.",
      "**Verdientes Vertrauen** — Hochstufen nur bei guter Bilanz.",
      "**Transparenz** — der Nutzer sieht, wie gut die KI wirklich ist.",
    ] },

  { type: "divider", num: "07", title: "Vorgänge",
    sub: "Die zentrale Einheit: Mail, Datei, Termin, Rechnung, Notiz, Aufgabe — an einem Fall." },
  { type: "feature", img: "29-vorgaenge.png", module: "Vorgänge", title: "Vorgangsliste",
    lead: "Alle Fälle mit Status, Nummer und letzter Aktivität — das Rückgrat des Systems.",
    points: [
      "**Statusspalten** — offen, in Arbeit, erledigt auf einen Blick.",
      "**Nummernkreis** — jeder Vorgang eindeutig referenzierbar.",
      "**Filter & Sortierung** — nach Aktivität, Status, Zuständigkeit.",
    ] },
  { type: "feature", img: "30-vorgang-detail.png", module: "Vorgänge", title: "Vorgangsakte",
    lead: "Die komplette Timeline eines Falls mit allen verknüpften Objekten.",
    points: [
      "**CaseTimeline** — Ereignisse chronologisch, KI-Einträge mit violettem Punkt.",
      "**Alles verknüpft** — Mails, Dateien, Termine, Rechnungen, Aufgaben.",
      "**Status-Workflow** — sauber geführt vom Eingang bis zum Abschluss.",
    ] },

  { type: "divider", num: "08", title: "Finanzen",
    sub: "E-Rechnung lesen, XRechnung erzeugen, Mahnwesen mit Augenmaß." },
  { type: "feature", img: "31-finanzen-eingang.png", module: "Finanzen", title: "Eingangsrechnungen",
    lead: "Der Runner erfasst Rechnungen direkt aus dem Mail-Anhang.",
    points: [
      "**E-Rechnungs-XML ohne KI** — ZUGFeRD/XRechnung wird deterministisch gelesen.",
      "**PDF/Text per KI** — wenn kein Strukturformat vorliegt.",
      "**Prüf-Workflow** — erfasst → geprüft → freigegeben → bezahlt, mit Dubletten-Check.",
    ] },
  { type: "feature", img: "32-rechnung-editor.png", module: "Finanzen", title: "Rechnungs-Editor & XRechnung",
    lead: "Angebote und Rechnungen mit Positionsliste — Summen rechnet die Datenbank, Nummern kommen atomar.",
    points: [
      "**Positionen & Steuersätze** — Summen serverseitig berechnet.",
      "**XRechnung 3.0 (UBL 2.1, EN 16931)** — Golden-File-getestet.",
      "**B2G-Leitweg-ID** — serverseitig erzwungen für Behördenrechnungen.",
    ] },
  { type: "feature", img: "33-mahnwesen.png", module: "Finanzen", title: "Mahnwesen mit KI-Entwurf",
    lead: "Bei Überfälligkeit schlägt der Runner bis zu drei Stufen mit fertigem Entwurf vor.",
    points: [
      "**3 Mahnstufen** — Ton passend zur Eskalation.",
      "**Nur nach Freigabe** — nichts geht ohne Kontrolle raus.",
      "**Gleicher Undo-Versand** — 30-Sekunden-Rückholen wie bei jeder Mail.",
    ] },

  { type: "divider", num: "09", title: "Autonomie & Wissen",
    sub: "Vertrauen, das sich messbar verdient — plus Gedächtnis und Meetings." },
  { type: "feature", img: "34-automationen-regler.png", module: "Autonomie", title: "Regler 1–4 mit Server-Gate",
    lead: "Jede Automation hat einen Autonomie-Regler. Das Hochstufen prüft der Server.",
    points: [
      "**Stufe 1** nur Vorschlag · **Stufe 4** autonom, meldet nur Ausnahmen.",
      "**set_autonomy_level** — Stufe 3/4 erst ab nachgewiesener Trefferquote.",
      "**Nicht nur UI** — die Datenbank erzwingt die Voraussetzung.",
    ] },
  { type: "feature", img: "35-halte-zone.png", module: "Autonomie", title: "Halte-Zone (Stufe 3)",
    lead: "Aktionen mit Außenwirkung laufen sichtbar durch eine Wartezone — ein Klick stoppt sie.",
    points: [
      "**Countdown** — jederzeit sichtbar im violetten Banner der App-Shell.",
      "**Ein Klick stoppt** — stop_automation_run, Draft zurück auf Entwurf.",
      "**Human-in-the-loop** — nichts verlässt das Haus ohne Chance zum Eingreifen.",
    ] },
  { type: "feature", img: "36-notizen.png", module: "Wissen", title: "Notizen & Sprachnotizen",
    lead: "Markdown-Notizen und Sprachnotizen — lokal transkribiert.",
    points: [
      "**Markdown-Editor** — anlegen, bearbeiten, löschen.",
      "**Sprachnotiz** — aufnehmen per MediaRecorder.",
      "**Whisper lokal** — transcribe_note läuft im Runner, keine Cloud.",
    ] },
  { type: "feature", img: "37-wissen.png", module: "Wissen", title: "Institutionelles Wissen",
    lead: "knowledge_distill destilliert dauerhafte Firmenfakten aus Mails und Meetings.",
    points: [
      "**Vorschläge** — geprüft, bevor sie ins Gedächtnis wandern.",
      "**Bestätigen / Ablehnen** — der Mensch kuratiert das Wissen.",
      "**Speist draft_reply & Suche** — das System wird mit der Zeit klüger.",
    ] },
  { type: "feature", img: "38-meetings.png", module: "Meetings", title: "Meetings: Audio → Protokoll",
    lead: "Audio hochladen, lokal transkribieren, KI-Protokoll erhalten.",
    points: [
      "**transcribe_meeting** — Whisper lokal, keine Cloud.",
      "**summarize_meeting** — Protokoll mit Entscheidungen und Aufgaben.",
      "**Mit Vorgang verknüpft** — Ergebnisse landen am richtigen Fall.",
    ] },

  { type: "divider", num: "10", title: "Suche",
    sub: "Volltext sofort, Semantik auf Knopfdruck — Embedding lokal gerechnet." },
  { type: "feature", img: "39-suche.png", module: "Suche", title: "Volltext + Semantik",
    lead: "Ein Feld über Mails, Vorgänge, Notizen und Wissen.",
    points: [
      "**Volltext (tsvector)** — sofortige Treffer beim Tippen.",
      "**Semantisch (pgvector)** — findet Sinnverwandtes auf Knopfdruck.",
      "**Query-Embedding lokal** — der Runner rechnet es, nie der Client.",
    ] },

  { type: "divider", num: "11", title: "Team & Kalender",
    sub: "Geteilte Postfächer, Kalender-Briefing, Wochenreport, Datenexport." },
  { type: "feature", img: "40-zuweisung-kommentar.png", module: "Team", title: "Zuweisung & interne Kommentare",
    lead: "Threads zuweisen und intern besprechen — ohne Weiterleiten-Chaos.",
    points: [
      "**assign_thread** — einem Mitglied zuweisen (Member-Check serverseitig).",
      "**@Mentions** — thread_comments benachrichtigen die Erwähnten.",
      "**Intern bleibt intern** — Notizen verlassen nie das Postfach.",
    ] },
  { type: "feature", img: "41-kalender.png", module: "Kalender", title: "Kalender mit KI-Kontext-Briefing",
    lead: "Termine per Google-Sync, davor ein automatisches Briefing aus dem Vorgangs-Kontext.",
    points: [
      "**Google-Sync** über den Runner (kurzlebiges Token aus dem Vault).",
      "**calendar_briefing** — Kontext ≤ 24 h vor dem Termin (violett = KI).",
      "**Fristenkalender** — wiederkehrende Pflichten als Aufgaben.",
    ] },
  { type: "feature", img: "42-datenexport.png", module: "Export", title: "Datenexport — kein Lock-in",
    lead: "Ein Klick erzeugt einen kompletten JSON-Snapshot aller Org-Daten.",
    points: [
      "**Vollständiger Export** aller org-scoped Tabellen.",
      "**Signierte URL** im Bucket exports — nur Owner/Admin.",
      "**Die Daten gehören dir** — jederzeit vollständig entnehmbar.",
    ] },
  { type: "feature", img: "43-wochenreport.png", module: "Report", title: "Wochenreport",
    lead: "Freitags fasst weekly_report die Woche zusammen.",
    points: [
      "**Kennzahlen** — Mails, Aufgaben, Rechnungen, Pipeline, Trefferquote.",
      "**briefings kind='weekly'** — als eigene Karte auf „Heute“.",
      "**Automatisch** — kein manuelles Zusammenklauben.",
    ] },

  { type: "divider", num: "12", title: "Komplett-Büro",
    sub: "Zeit, Bank, DATEV, Verträge und Anrufe — der Papierkram an einem Ort." },
  { type: "feature", img: "44-buero-zeiten.png", module: "Büro · Zeit", title: "Zeiterfassung",
    lead: "Zeiten manuell erfassen oder vom Runner vorschlagen lassen — abrechenbar direkt in die Rechnung.",
    points: [
      "**time_suggest** — Vorschläge aus Vorgängen/Mails (violett, bestätigen).",
      "**Wochensumme** — Soll/Ist auf einen Blick.",
      "**bill_time_entries** — abrechenbare Stunden werden Rechnungspositionen und gesperrt.",
    ] },
  { type: "feature", img: "45-buero-bank.png", module: "Büro · Bank", title: "Zahlungsabgleich",
    lead: "payment_match ordnet Bankumsätze offenen Rechnungen zu.",
    points: [
      "**Vorschlag mit Konfidenz** (violett) — Rechnung + Umsatz zusammengeführt.",
      "**Bestätigen** setzt die Rechnung auf bezahlt und **stoppt die Mahnung**.",
      "**Zugangsdaten im Vault** — nie im Client.",
    ] },
  { type: "feature", img: "46-buero-datev.png", module: "Büro · DATEV", title: "DATEV-EXTF-Export",
    lead: "Buchungsstapel (EXTF Format 700) für den Steuerberater — byte-genau abgesichert.",
    points: [
      "**Golden-File-Test** — der Export ist bytegenau reproduzierbar geprüft.",
      "**Kontenrahmen (SKR03/04)** — bleibt in der Hoheit des Beraters.",
      "**Sperre gegen Doppel-Export** — exportierte Belege werden markiert.",
    ] },
  { type: "feature", img: "47-buero-vertraege.png", module: "Büro · Verträge", title: "Verträge & Kündigungs-Wächter",
    lead: "Verträge werden per KI erfasst, Fristen automatisch überwacht.",
    points: [
      "**extract_contract** — Laufzeit, Frist, Kosten aus dem PDF (violett).",
      "**contract_watch** — Warnung gestaffelt 90/60/30 Tage vor der Frist.",
      "**Nichts läuft unbemerkt aus** — als Risiko-Finding am Vorgang.",
    ] },
  { type: "feature", img: "48-buero-anrufe.png", module: "Büro · Anrufe", title: "Anrufnotizen",
    lead: "Anrufe schnell festhalten — Sprachnotizen lokal transkribiert und zusammengefasst.",
    points: [
      "**Schnellnotiz** — Nummer, Richtung, Stichwort in Sekunden.",
      "**transcribe_call** — Whisper lokal, keine Cloud.",
      "**summarize_call** — Zusammenfassung + Folge-Aufgabe + Case-Event.",
    ] },

  { type: "divider", num: "13", title: "Regeln & Erscheinungsbild",
    sub: "Eigene Wenn-Dann-Logik und ein vollwertiges dunkles Theme." },
  { type: "feature", img: "49-regel-builder.png", module: "Regeln", title: "Regel-Builder",
    lead: "Eigene Automatisierungen ohne Code: „Wenn Ereignis und Bedingungen, dann Aktion“.",
    points: [
      "**Ereignisse** — mail_received, invoice_captured, quote_sent, payment_matched …",
      "**Bedingungen** — Felder der Entity, UND-verknüpft.",
      "**Aktionen** — Benachrichtigung, Aufgabe oder KI-Job; Auswertung serverseitig.",
    ] },
  { type: "feature", img: "50-regel-liste.png", module: "Regeln", title: "Regeln verwalten",
    lead: "Angelegte Regeln jederzeit pausieren oder löschen — jede Ausführung im Audit-Log.",
    points: [
      "**Pausieren / Löschen** — volle Kontrolle jederzeit.",
      "**Audit-Log** — jede Ausführung als rule.executed protokolliert.",
      "**Sofort aktiv** — greift ab dem nächsten passenden Ereignis.",
    ] },
  { type: "feature", img: "51-dark-mode.png", module: "Design", title: "Dark Mode",
    lead: "Ein Klick schaltet das vollwertige dunkle Theme um.",
    points: [
      "**Alle Design-Tokens** — auch Marken- und KI-Farben angepasst.",
      "**Gespeichert** — die Wahl bleibt erhalten.",
      "**System-Default** — ohne Wahl gilt die Systemeinstellung.",
    ] },

  { type: "closing" },
];

// ---------------------------------------------------------
// Rendering
// ---------------------------------------------------------
const CSS = `
:root{
  --bg:#FAFAF8; --surface:#FFFFFF; --surface2:#F4F4F1; --border:#E7E6E1; --border-strong:#D6D4CD;
  --ink:#1A1D23; --ink-soft:#5B6068; --ink-faint:#9AA0A8;
  --brand:#1E2A4A; --brand-2:#2A3A63; --accent:#3D5AFE; --ai:#6D4AC9;
  --success:#1D7A4C; --warning:#B45309;
}
@font-face{font-family:"Inter";font-weight:100 900;font-style:normal;font-display:block;
  src:url(data:font/woff2;base64,${interB64}) format("woff2");}
*{margin:0;padding:0;box-sizing:border-box;}
html{font-family:"Inter",system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;}
.slide{position:relative;width:297mm;height:209.6mm;overflow:hidden;background:var(--bg);
  page-break-after:always;break-after:page;display:flex;flex-direction:column;}
.slide:last-child{page-break-after:auto;break-after:auto;}

/* ---- Logo-Glyph ---- */
.glyph{display:inline-flex;flex-direction:column;gap:2.4px;}
.glyph i{display:block;height:3px;border-radius:2px;background:currentColor;}
.glyph i:nth-child(1){width:26px;} .glyph i:nth-child(2){width:19px;} .glyph i:nth-child(3){width:12px;}

/* ---- Cover ---- */
.cover{background:radial-gradient(120% 100% at 15% 0%,#2A3A63 0%,#1E2A4A 55%,#141d33 100%);color:#fff;
  padding:24mm 26mm;justify-content:space-between;}
.cover .top{display:flex;align-items:center;gap:14px;color:#fff;}
.cover .top .wm{font-size:23px;font-weight:650;letter-spacing:.2px;}
.cover h1{font-size:74px;font-weight:720;line-height:1.02;letter-spacing:-1.5px;margin-top:2mm;}
.cover h1{max-width:150mm;}
.cover .tag{font-size:23px;font-weight:400;color:#C7D0E8;margin-top:9mm;max-width:130mm;line-height:1.35;}
.cover .pills{display:flex;gap:10px;margin-top:11mm;flex-wrap:wrap;max-width:132mm;}
.cover .pill{border:1px solid rgba(255,255,255,.26);color:#DCE3F4;border-radius:999px;
  padding:8px 16px;font-size:14px;font-weight:500;}
.cover .hero{position:absolute;right:16mm;top:50%;width:120mm;border-radius:14px;
  box-shadow:0 30px 80px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.12);opacity:.97;
  transform:translateY(-33%) rotate(-1.6deg);z-index:1;}
.cover .foot{display:flex;justify-content:space-between;align-items:flex-end;color:#93A0C4;font-size:14px;z-index:3;position:relative;}

/* ---- Text slides (intro/how/closing) ---- */
.pad{padding:20mm 24mm;flex:1;display:flex;flex-direction:column;}
.kick{color:var(--accent);font-weight:650;font-size:15px;letter-spacing:1.5px;text-transform:uppercase;}
.h2{font-size:44px;font-weight:700;letter-spacing:-.8px;margin-top:6px;line-height:1.05;}
.lead-lg{font-size:20px;color:var(--ink-soft);line-height:1.5;margin-top:10mm;max-width:230mm;}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-top:auto;}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px 20px 22px;}
.card h3{font-size:19px;font-weight:640;margin-bottom:7px;}
.card p{font-size:15px;color:var(--ink-soft);line-height:1.5;}
.card .ic{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;
  margin-bottom:12px;font-size:18px;font-weight:700;color:#fff;background:var(--brand);}
.card.ai .ic{background:var(--ai);} .card.acc .ic{background:var(--accent);} .card.ok .ic{background:var(--success);}

/* how-it-works flow */
.flow{display:flex;align-items:stretch;gap:0;margin-top:auto;}
.flow .node{flex:1;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;}
.flow .node h3{font-size:17px;font-weight:640;margin-bottom:6px;}
.flow .node p{font-size:13.5px;color:var(--ink-soft);line-height:1.45;}
.flow .node .t{font-size:12px;font-weight:650;color:var(--accent);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;}
.flow .arrow{display:flex;align-items:center;padding:0 10px;color:var(--ink-faint);font-size:26px;}
.note{margin-top:9mm;background:#F1EEFA;border:1px solid #E0D8F4;border-left:4px solid var(--ai);
  border-radius:10px;padding:16px 18px;font-size:15.5px;color:#3B2E63;line-height:1.5;}

/* ---- Divider ---- */
.divider{background:linear-gradient(135deg,#1E2A4A 0%,#26335A 100%);color:#fff;justify-content:center;padding:0 26mm;}
.divider .num{font-size:20px;font-weight:650;color:var(--accent);letter-spacing:3px;}
.divider h2{font-size:60px;font-weight:720;letter-spacing:-1px;margin-top:10px;line-height:1.04;}
.divider p{font-size:22px;color:#C1CBE4;margin-top:16px;max-width:210mm;line-height:1.4;}
.divider .bar{width:64px;height:6px;border-radius:3px;background:var(--accent);margin-bottom:26px;}

/* ---- Feature ---- */
.fhead{display:flex;align-items:center;justify-content:space-between;padding:12mm 16mm 0;}
.chip{display:inline-flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);
  color:var(--ink-soft);border-radius:999px;padding:7px 15px;font-size:13.5px;font-weight:600;}
.fhead .wm{display:flex;align-items:center;gap:9px;color:var(--brand);font-weight:640;font-size:16px;}
.fbody{flex:1;display:grid;grid-template-columns:1.15fr 1fr;gap:14mm;padding:8mm 16mm 6mm;align-items:center;}
.shot{border:1px solid var(--border-strong);border-radius:14px;overflow:hidden;
  box-shadow:0 18px 46px rgba(30,42,74,.16);background:#fff;}
.shot img{display:block;width:100%;}
.ftext h2{font-size:33px;font-weight:710;letter-spacing:-.5px;line-height:1.08;}
.ftext .lead{font-size:16.5px;color:var(--ink-soft);line-height:1.5;margin-top:12px;}
.points{list-style:none;margin-top:16px;display:flex;flex-direction:column;gap:11px;}
.points li{position:relative;padding-left:30px;font-size:15px;line-height:1.45;color:var(--ink);}
.points li .n{position:absolute;left:0;top:1px;width:21px;height:21px;border-radius:6px;background:var(--brand);
  color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;}
.points li b{font-weight:660;}
.tech{margin-top:16px;display:flex;gap:9px;align-items:flex-start;background:var(--surface2);
  border:1px solid var(--border);border-radius:10px;padding:11px 13px;font-size:13.5px;color:var(--ink-soft);line-height:1.4;}
.tech .lbl{color:var(--accent);font-weight:700;font-size:11px;letter-spacing:.6px;text-transform:uppercase;flex-shrink:0;padding-top:1px;}
.ffoot{display:flex;justify-content:space-between;align-items:center;padding:0 16mm 8mm;
  color:var(--ink-faint);font-size:12.5px;border-top:1px solid var(--border);margin:0 16mm;padding-top:6mm;}
.ffoot b{color:var(--ink-soft);font-weight:600;}

/* ---- Closing ---- */
.closing{background:radial-gradient(120% 120% at 85% 100%,#2A3A63 0%,#1E2A4A 60%,#141d33 100%);color:#fff;
  padding:26mm;justify-content:center;}
.closing h2{font-size:52px;font-weight:720;letter-spacing:-1px;line-height:1.06;max-width:220mm;}
.closing .sub{font-size:20px;color:#C7D0E8;margin-top:12mm;line-height:1.5;max-width:210mm;}
.closing .kv{display:flex;gap:40px;margin-top:14mm;}
.closing .kv div .n{font-size:40px;font-weight:730;color:#fff;}
.closing .kv div .l{font-size:14.5px;color:#93A0C4;margin-top:2px;}
.closing .cta{margin-top:16mm;font-size:16px;color:#DCE3F4;}
.badge-ai{display:inline-block;background:var(--ai);color:#fff;font-size:12px;font-weight:600;
  border-radius:999px;padding:3px 10px;vertical-align:middle;}
`;

function coverSlide() {
  return `<section class="slide cover">
    <div class="top"><span class="glyph" style="color:#7C93FF"><i></i><i></i><i></i></span><span class="wm">Leitwerk</span></div>
    <div>
      <h1>Das Leitwerk<br>für dein Büro.</h1>
      <p class="tag">Ein Büro-Betriebssystem, in dem E-Mails, Vorgänge, Aufgaben, Rechnungen,
      Termine, Notizen und Meetings zusammenlaufen — verbunden durch einen KI-Kern, der sich
      sein Vertrauen messbar verdient.</p>
      <div class="pills">
        <span class="pill">BYO-KI · eigenes Claude-Abo</span>
        <span class="pill">DSGVO · Daten in der EU</span>
        <span class="pill">Autonomie-Regler 1–4</span>
        <span class="pill">Multi-Tenant · RLS überall</span>
      </div>
    </div>
    <div class="foot"><span>Produkt- & Funktionsvorstellung</span><span>leitwerk · Stand 2026</span></div>
    <img class="hero" src="${dataUri("11-app-shell-heute.png")}" alt="Leitwerk App">
  </section>`;
}

function introSlide() {
  return `<section class="slide"><div class="pad">
    <span class="kick">Was ist Leitwerk</span>
    <h2 class="h2">Die Klebeschicht fürs Büro —<br>kein weiteres Silo.</h2>
    <p class="lead-lg">Gmail bleibt Gmail, der Kalender bleibt der Kalender. Leitwerk synchronisiert,
    verknüpft und denkt mit. Die zentrale Einheit ist der <b>Vorgang</b>: Mail, Datei, Termin,
    Rechnung, Notiz und Aufgabe hängen an einem Fall — zugeordnet durch KI, freigegeben vom Menschen.</p>
    <div class="grid3">
      <div class="card acc"><div class="ic">€</div><h3>Keine KI-Kosten beim Betreiber</h3>
        <p>Jeder Nutzer bringt sein eigenes Claude-Max-Abo mit (BYO-KI). Die KI läuft in einem lokalen Runner — kein zentraler API-Schlüssel.</p></div>
      <div class="card ai"><div class="ic">◆</div><h3>Vertrauen, das man sieht</h3>
        <p>Jede Automatisierung startet als bloßer Vorschlag und wird erst nach messbar guter Trefferquote hochgestuft — bis zu autonom.</p></div>
      <div class="card ok"><div class="ic">⛨</div><h3>Sicher & DSGVO-freundlich</h3>
        <p>Daten in der EU, Token im Tresor, RLS auf jeder Tabelle, vollständiges Audit-Log. Human-in-the-loop als Standard.</p></div>
    </div>
  </div></section>`;
}

function howSlide() {
  return `<section class="slide"><div class="pad">
    <span class="kick">So funktioniert's</span>
    <h2 class="h2">Drei Schichten, eine klare Regel:<br>der Runner schreibt nie direkt in die Datenbank.</h2>
    <p class="lead-lg" style="margin-top:7mm">Die PWA zeigt an und gibt frei. Supabase hält Daten, Regeln und
    Gates. Der lokale Runner rechnet die KI — kontrolliert über Broker und Token-Hash.</p>
    <div class="flow">
      <div class="node"><div class="t">1 · PWA</div><h3>Oberfläche & Freigabe</h3>
        <p>React-PWA: Module, Vorgänge, Freigaben. Zeigt Vorschläge (violett) und lässt den Menschen entscheiden.</p></div>
      <div class="arrow">→</div>
      <div class="node"><div class="t">2 · Supabase</div><h3>Daten, Regeln, Gates</h3>
        <p>Postgres + pgvector, RLS überall. Edge Functions bauen den Job-Kontext und verifizieren den Runner.</p></div>
      <div class="arrow">→</div>
      <div class="node"><div class="t">3 · Runner</div><h3>KI, lokal beim Nutzer</h3>
        <p>Poll-Loop → claim_next_job → KI-Provider → striktes Parsen. Idempotent, jede Aktion im Audit-Log.</p></div>
    </div>
    <div class="note"><span class="badge-ai">Design-Regel</span> &nbsp;Violett markiert in ganz Leitwerk
    ausschließlich, was von der KI stammt — in jedem folgenden Screenshot. Alles andere hat der Mensch ausgelöst.</div>
  </div></section>`;
}

function dividerSlide(s) {
  return `<section class="slide divider">
    <div class="bar"></div>
    <div class="num">KAPITEL ${s.num}</div>
    <h2>${s.title}</h2>
    <p>${s.sub}</p>
  </section>`;
}

function featureSlide(s, pageNo) {
  const pts = s.points.map((p, i) =>
    `<li><span class="n">${i + 1}</span>${bold(p)}</li>`).join("");
  const tech = s.tech
    ? `<div class="tech"><span class="lbl">Technik</span><span>${s.tech}</span></div>` : "";
  return `<section class="slide">
    <div class="fhead">
      <span class="chip">${s.module}</span>
      <span class="wm"><span class="glyph" style="color:var(--brand)"><i></i><i></i><i></i></span>Leitwerk</span>
    </div>
    <div class="fbody">
      <div class="shot"><img src="${dataUri(s.img)}" alt="${s.title}"></div>
      <div class="ftext">
        <h2>${s.title}</h2>
        <p class="lead">${s.lead}</p>
        <ul class="points">${pts}</ul>
        ${tech}
      </div>
    </div>
    <div class="ffoot"><span><b>${s.module}</b> · Leitwerk Funktionsvorstellung</span><span>${pageNo}</span></div>
  </section>`;
}

function closingSlide() {
  return `<section class="slide closing">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12mm;">
      <span class="glyph" style="color:#7C93FF"><i></i><i></i><i></i></span>
      <span style="font-size:20px;font-weight:640;">Leitwerk</span>
    </div>
    <h2>Ein Büro, das mitdenkt —<br>und sich dein Vertrauen verdient.</h2>
    <p class="sub">Von der ersten Mail bis zum DATEV-Export: alle Fäden laufen im Vorgang zusammen,
    die KI arbeitet lokal über dein eigenes Abo, und nichts verlässt das Haus ohne deine Freigabe.</p>
    <div class="kv">
      <div><div class="n">7</div><div class="l">Phasen fertig (0.5 – 6)</div></div>
      <div><div class="n">20+</div><div class="l">KI-Skills im Runner</div></div>
      <div><div class="n">51</div><div class="l">Funktionen im Detail</div></div>
      <div><div class="n">EU</div><div class="l">Datenhaltung · DSGVO</div></div>
    </div>
    <p class="cta">Bereit für eine Demo? Alle Screens stammen aus einem reproduzierbaren Ende-zu-Ende-Lauf.</p>
  </section>`;
}

let page = 0;
const body = DECK.map((s) => {
  if (s.type === "cover") return coverSlide();
  if (s.type === "intro") return introSlide();
  if (s.type === "how") return howSlide();
  if (s.type === "divider") return dividerSlide(s);
  if (s.type === "closing") return closingSlide();
  page += 1;
  return featureSlide(s, String(page).padStart(2, "0"));
}).join("\n");

const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>Leitwerk — Funktionsvorstellung</title><style>${CSS}</style></head>
<body>${body}</body></html>`;

writeFileSync(OUT_HTML, html);
console.log(`HTML geschrieben: ${OUT_HTML} (${(html.length / 1e6).toFixed(1)} MB)`);

// ---- PDF rendern ----
const browser = await chromium.launch({
  executablePath: process.env.LEITWERK_E2E_CHROMIUM || undefined,
});
const pageObj = await browser.newPage();
await pageObj.goto("file://" + OUT_HTML, { waitUntil: "networkidle" });
await pageObj.pdf({
  path: OUT_PDF,
  width: "297mm",
  height: "210mm",
  printBackground: true,
  preferCSSPageSize: false,
  margin: { top: "0", bottom: "0", left: "0", right: "0" },
});
await browser.close();
console.log(`PDF geschrieben: ${OUT_PDF}`);
