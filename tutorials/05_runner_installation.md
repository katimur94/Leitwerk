# Tutorial 05 — Agent-Runner installieren (für Endnutzer, ~10 Min)

Dieses Tutorial ist die Vorlage für die Nutzer-Doku. Jeder Nutzer betreibt seinen eigenen
Runner mit seinem eigenen Claude-Max-Abo — auf Büro-PC, Laptop, Mini-PC oder VPS.

## Voraussetzungen
- Node.js 20+ (https://nodejs.org, LTS)
- Ein Claude-Konto mit Pro/Max-Abo
- Der Rechner sollte laufen, wenn Leitwerk arbeiten soll (idealerweise dauerhaft;
  ein Mini-PC/NUC oder kleiner VPS ist perfekt)

## 1. Claude CLI einrichten (einmalig)
```bash
npm install -g @anthropic-ai/claude-code
claude login        # Browser öffnet sich → mit dem eigenen Claude-Konto anmelden
claude -p "Sag nur: bereit"   # Test — muss antworten
```

## 2. Runner installieren & koppeln
```bash
npm install -g leitwerk-runner
leitwerk-runner init
```
Der Runner zeigt einen 8-stelligen **Pairing-Code**.
In der Leitwerk-App: **Einstellungen → Runner → Runner verbinden** → Code eingeben.

**Wichtig (Zwei-Stufen-Pairing):** Nach dem Einlösen des Codes wartet der Runner auf
deine **Freigabe**. Die App zeigt unter Einstellungen → Runner den neuen Runner mit
Rechnername, Provider und Zeitpunkt — erst **„Bestätigen“** schaltet ihn frei
(„Ablehnen“ sperrt ihn dauerhaft). Der Runner meldet im Terminal
`Runner freigegeben ✓`, sobald du bestätigt hast.

Sicherheitsnetz im Hintergrund: max. 10 Pairing-Versuche pro Minute und IP;
nach 5 Fehlversuchen ist ein Code dauerhaft ungültig (Pairing dann neu starten).

## 3. Als Dienst starten (dauerhaft)
Ein Befehl auf allen Plattformen — vorher einmal gepairt haben (Schritt 2):
```bash
leitwerk-runner service install     # richtet Autostart ein und startet sofort
leitwerk-runner service status      # Dienststatus prüfen
leitwerk-runner service uninstall   # Dienst wieder entfernen
```
- **Windows:** geplanter Task `LeitwerkRunner` (schtasks, Start bei Anmeldung).
- **Linux/VPS:** systemd-User-Unit `leitwerk-runner.service`
  (`systemctl --user status leitwerk-runner`). Auf Servern ohne Login-Session
  zusätzlich einmalig: `loginctl enable-linger $USER`.
- **macOS:** launchd-Agent `com.leitwerk.runner`
  (Log: `~/.leitwerk-runner/runner.log`).

## 4. Limits einstellen (Max-Abo schonen)
In der App unter **Einstellungen → Runner → Limits** (pro Runner):
- Max. KI-Jobs pro Stunde (Standard 60) und pro Tag (Standard 500)
- Optionales Nachtfenster für Batch-Jobs (z. B. 22:00–06:00)
- Interaktive Anfragen (Priorität ≤ 2) laufen immer sofort; normale Jobs nur
  außerhalb, Nacht-Batch (z. B. Wächter-Lauf) nur innerhalb des Fensters

Die Limits werden **serverseitig** beim Job-Claim erzwungen — nicht nur in der UI.
Die App zeigt live: Runner online/offline, letzte Aktivität, Limits.

## 5. Alternativen zum Claude-Max-Abo
Beim `init` automatisch erkannt (Wechsel: `leitwerk-runner init` erneut ausführen):
- `claude_cli` — Standard, nutzt das eigene Claude-Abo (empfohlen)
- `codex_cli` — OpenAI Codex CLI mit eigenem OpenAI-Login
- `anthropic_api` — eigener API-Key (pay-per-token), für Server ohne Browser-Login

## Fehlerbehebung
| Problem | Lösung |
|---|---|
| App zeigt "Runner offline" | Dienststatus prüfen: `leitwerk-runner service status`; Rechner an? Internet? |
| Runner meldet "wartet auf Freigabe" | App → Einstellungen → Runner → „Bestätigen“ klicken (Owner/Admin) |
| "Pairing-Code gesperrt" | Zu viele Fehlversuche — `leitwerk-runner init` neu starten (neuer Code) |
| Jobs schlagen fehl mit "not logged in" | `claude login` erneut ausführen (Session abgelaufen) |
| "Rate limit" Meldungen | Stundenlimit senken; Max-Abo-Nutzung durch andere Tools prüfen |
| Runner neu koppeln | App → Einstellungen → Runner → Ablehnen/Deaktivieren, dann `leitwerk-runner init` |

## Sicherheit (für den Nutzer transparent machen)
- Der Runner spricht ausschließlich mit dem Leitwerk-Server und den vom Nutzer selbst
  verbundenen Konten (z. B. eigenes Gmail).
- Das Claude-Login bleibt lokal auf dem Rechner; Leitwerk sieht es nie.
- Der Runner kann jederzeit in der App entkoppelt/deaktiviert werden (Token wird ungültig).

## 6. Lokale KI-Nebenläufe: Whisper & Embeddings (Etappe 4)
Meetings/Sprachnotizen und die semantische Suche laufen **lokal** auf dem Runner —
keine Cloud. Beide sind optional konfigurierbar über Umgebungsvariablen:

- **`LEITWERK_WHISPER_BIN`** — Pfad zu einem Programm, das eine Audiodatei transkribiert.
  Vertrag: Argument = Audiodatei-Pfad, stdout = JSON
  `{"transcript": "…", "segments": [{"speaker": null, "starts_sec": 0, "ends_sec": 4.2, "content": "…"}]}`.
  Typisch ein kleiner Wrapper um [whisper.cpp](https://github.com/ggerganov/whisper.cpp).
  Ohne diese Variable schlagen `transcribe_note`/`transcribe_meeting` mit einer klaren
  Meldung fehl (bewusst KEIN Cloud-Fallback).

- **`LEITWERK_EMBED_BIN`** — Pfad zu einem Programm für lokale Embeddings (1024-dim).
  Vertrag: stdin = JSON `{"texts": ["…"]}`, stdout = JSON
  `{"embeddings": [[…1024 Zahlen…]], "model": "<name>"}`. Empfohlen ein Modell wie
  `bge-m3` oder `multilingual-e5-large` (z. B. via llama.cpp `llama-embedding`).
  **Ohne** diese Variable nutzt der Runner ein deterministisches **Hash-Embedding**
  (grobe Wortähnlichkeit, offline) — die semantische Suche funktioniert damit, ist aber
  weniger treffsicher als mit echtem Modell. Für Produktion ein Modell setzen.

Beide Programme müssen ausführbar sein (`chmod +x`). Nach dem Setzen der Variablen den
Runner neu starten.
