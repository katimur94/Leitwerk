# DESIGN.md — Leitwerk Design-System

Ziel: Leitwerk sieht aus wie ein Premium-B2B-Produkt (Referenzklasse: Linear, Superhuman, Height) —
nicht wie ein Admin-Template. Ruhig, präzise, dicht ohne eng zu wirken. Deutsch, professionell,
kein Spielzeug-Look.

## Markenkern

- Name: **Leitwerk** — das Steuerungselement. Die Marke verspricht Kontrolle, nicht Magie.
- Logo-Richtung: Wortmarke in Schriftschnitt Semibold + abstraktes Glyph: drei Linien, die in
  einem Punkt zusammenlaufen (Höhenruder-Silhouette / zusammenlaufende Vorgänge). Kein Roboter,
  kein Funke, kein "AI-Sparkle" im Logo.
- Ton der UI-Texte: klar, knapp, respektvoll. Die KI spricht als "Leitwerk" ("Leitwerk schlägt vor…"),
  nie als "Ich". Keine Ausrufezeichen-Euphorie.

## Farben (CSS Custom Properties, Light ist Default, Dark vollwertig)

```css
:root {
  /* Fundament — warmes Grau, kein reines Weiß */
  --lw-bg:          #FAFAF8;
  --lw-surface:     #FFFFFF;
  --lw-surface-2:   #F4F4F1;   /* Sidebar, Zebra, Wells */
  --lw-border:      #E7E6E1;
  --lw-border-strong:#D6D4CD;

  /* Text */
  --lw-ink:         #1A1D23;
  --lw-ink-soft:    #5B6068;
  --lw-ink-faint:   #9AA0A8;

  /* Marke: "Tinte" — tiefes Indigo-Blau, sparsam einsetzen */
  --lw-brand:       #1E2A4A;
  --lw-brand-hover: #16203A;
  --lw-accent:      #3D5AFE;   /* Interaktion: Links, aktive Zustände, Fokus */

  /* Semantik */
  --lw-success:     #1D7A4C;
  --lw-warning:     #B45309;
  --lw-danger:      #B3261E;
  --lw-ai:          #6D4AC9;   /* ALLES was von der KI kommt trägt diese Farbe als Kennung */

  --lw-radius-sm: 6px;  --lw-radius-md: 10px;  --lw-radius-lg: 16px;
  --lw-shadow-1: 0 1px 2px rgb(20 22 26 / .05);
  --lw-shadow-2: 0 4px 16px rgb(20 22 26 / .08);
}
[data-theme="dark"] {
  --lw-bg: #101216; --lw-surface: #16191F; --lw-surface-2: #1C2028;
  --lw-border: #262B33; --lw-border-strong: #333A45;
  --lw-ink: #ECEDEF; --lw-ink-soft: #A6ACB6; --lw-ink-faint: #6B717C;
  --lw-brand: #8FA3E8; --lw-accent: #7C93FF; --lw-ai: #A78BE8;
}
```

**Eiserne Regel:** Violett (`--lw-ai`) ist reserviert für KI-Herkunft — Badges "Vorschlag",
KI-Entwürfe, Wächter-Findings, Konfidenz-Anzeigen. Nutzer erkennt auf einen Blick, was von
der Maschine kommt. Nirgendwo sonst Violett verwenden.

## Typografie

- UI-Schrift: **Inter** (variable), Fallback system-ui. Zahlen in Tabellen/Beträgen: `font-variant-numeric: tabular-nums`.
- Mono (Beträge in Belegen, IDs, Nummernkreise): **JetBrains Mono**.
- Skala: 12 / 13 / 14 (Basis) / 16 / 20 / 24 / 32. Zeilenhöhe 1.5 im Fließtext, 1.2 in Headlines.
- Gewichte: 400 Text, 500 UI-Labels, 600 Headlines. Nie 700+ in Flächen.

## Layout

- App-Shell: schmale Icon-Rail links (56px) → Kontext-Sidebar (240–280px, kollabierbar) →
  Hauptfläche → optionales Detail-Panel rechts (z. B. Vorgangsakte neben der Mail).
- 8-pt-Grid. Max. Inhaltsbreite Lesetexte 720px.
- Dichte: Listen 40px Zeilenhöhe (komfortabel), 32px (kompakt, umschaltbar).
- Mobile (PWA): Bottom-Tab-Bar mit 5 Zielen: Heute · Posteingang · Vorgänge · Aufgaben · Mehr.

## Kernkomponenten (packages/ui)

1. **CommandBar (Cmd+K):** globale Suche + Aktionen. Erste Anlaufstelle, prominent onboarden.
2. **AiBadge:** violetter Pill mit Konfidenz ("Vorschlag · 96 %"). Klick öffnet Begründung + Quelle.
3. **HoldBanner:** Stufe-3-Aktionen zeigen Countdown ("Wird in 12:40 gesendet — Stoppen").
   Bernstein-Hintergrund, immer sichtbar oben im betroffenen Objekt.
4. **TrustMeter:** Fortschrittsring pro Automation ("49/50 korrekt") mit Hochstufen-CTA erst ab Schwelle.
5. **CaseTimeline:** vertikale Timeline, Icons pro Ereignistyp, KI-Einträge mit violettem Punkt.
6. **InboxRow:** Absender (500) · Betreff (400) · Snippet (faint) · rechts Kategorie-Chip + Zeit.
   Ungelesen = 2px Akzent-Balken links, KEIN Fettdruck-Chaos.
7. **MoneyCell:** rechtsbündig, tabular-nums, negative Beträge in `--lw-danger`.
8. **EmptyState:** Illustration (einfarbige Linien-Illustration in `--lw-ink-faint`), ein Satz,
   eine Aktion. Nie leere weiße Fläche.
9. **BriefingCard:** Morgen-Briefing als nummerierte Karten mit direkter Aktion pro Punkt
   ("Entwurf ansehen", "Rechnung öffnen").

## Interaktion & Motion

- Transitions 150–200ms ease-out, nur opacity/transform. Keine Bounce-Effekte.
- Optimistic UI überall (Mail archivieren, Task abhaken) mit Undo-Toast (5 s) unten links.
- Fokus-Ringe: 2px `--lw-accent`, immer sichtbar bei Tastatur-Navigation.
- Tastatur-First: j/k Navigation in Listen, e = archivieren, r = antworten, Cmd+Enter = senden/freigeben.
- Destruktives (Mail an extern senden auf Stufe 3/4, Mahnung, Löschen) NIE nur ein Klick ohne
  sichtbaren Zustand (Halte-Zone, Undo oder Confirm).

## Zustände (Pflicht pro View)

Jede Ansicht liefert: Loading (Skeleton, keine Spinner-Wüste) · Empty (EmptyState-Komponente) ·
Error (Ursache + Retry) · Offline (Banner "Offline — Änderungen werden synchronisiert") ·
Runner-offline (dezenter Hinweis nur bei KI-Funktionen, Rest der App unbeeinträchtigt).

## Was Premium killt (verboten)

- Bunte Dashboard-Kacheln mit 6 Farben, Gradient-Buttons, Emojis in der UI-Chrome.
- Mehr als eine Akzentfarbe pro Fläche. Schatten-Stapelei. Modals für alles (Detail-Panel bevorzugen).
- "KI-Sparkles"-Icons auf jedem Button. KI-Kennzeichnung läuft ausschließlich über `--lw-ai` + AiBadge.
- Lorem-Ipsum-Reste, englische Fragmente in deutscher UI, inkonsistente Datumsformate.
