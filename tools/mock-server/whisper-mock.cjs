#!/usr/bin/env node
// Mock für whisper.cpp (Etappe 4): der Runner ruft LEITWERK_WHISPER_BIN mit
// dem Pfad zur Audiodatei auf und erwartet JSON auf stdout. Dieser Mock
// ignoriert den Inhalt der Datei und liefert ein deterministisches Transkript
// (nur Tests/Demos — die echte Transkription läuft lokal via whisper.cpp).
const transcript =
  "Guten Morgen zusammen. Wir starten die Baubesprechung. " +
  "Der Terminplan steht, wir ziehen den Gerüstbau vor. " +
  "Die Materialbestellung klären wir bis Freitag. " +
  "Nächster Termin in zwei Wochen.";

process.stdout.write(
  JSON.stringify({
    transcript,
    segments: [
      { speaker: "Sprecher 1", starts_sec: 0, ends_sec: 6.5, content: "Guten Morgen zusammen. Wir starten die Baubesprechung." },
      { speaker: "Sprecher 1", starts_sec: 6.5, ends_sec: 12, content: "Der Terminplan steht, wir ziehen den Gerüstbau vor." },
      { speaker: "Sprecher 2", starts_sec: 12, ends_sec: 18, content: "Die Materialbestellung klären wir bis Freitag." },
      { speaker: "Sprecher 1", starts_sec: 18, ends_sec: 22, content: "Nächster Termin in zwei Wochen." },
    ],
  }) + "\n",
);
