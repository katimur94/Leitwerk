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
In der Leitwerk-App: **Einstellungen → Runner → Runner koppeln** → Code eingeben.
Der Runner bestätigt: `✓ Gekoppelt mit <Workspace> als <Nutzer>`.

## 3. Als Dienst starten (dauerhaft)
**Windows:** `leitwerk-runner service install` (legt einen Autostart-Task an,
Tray-Icon zeigt Status). 
**Linux/VPS:**
```bash
leitwerk-runner service install   # erzeugt systemd-Unit leitwerk-runner.service
systemctl --user enable --now leitwerk-runner
```
**macOS:** `leitwerk-runner service install` (launchd-Agent).

## 4. Limits einstellen (Max-Abo schonen)
In der App unter **Einstellungen → Runner**:
- Max. KI-Jobs pro Stunde (Standard 60) und pro Tag (Standard 500)
- Nachtfenster für Batch-Jobs (Standard 02:00–06:00)
- Priorität: interaktive Anfragen laufen immer sofort, Batch wartet

Die App zeigt live: Runner online/offline, Jobs heute, Fehlerquote, letzte Aktivität.

## 5. Alternativen zum Claude-Max-Abo
Beim `init` wählbar (oder später via `leitwerk-runner config`):
- `claude_cli` — Standard, nutzt das eigene Claude-Abo (empfohlen)
- `codex_cli` — OpenAI Codex CLI mit eigenem OpenAI-Login
- `anthropic_api` — eigener API-Key (pay-per-token), für Server ohne Browser-Login

## Fehlerbehebung
| Problem | Lösung |
|---|---|
| App zeigt "Runner offline" | Dienststatus prüfen: `leitwerk-runner status`; Rechner an? Internet? |
| Jobs schlagen fehl mit "not logged in" | `claude login` erneut ausführen (Session abgelaufen) |
| "Rate limit" Meldungen | Stundenlimit senken; Max-Abo-Nutzung durch andere Tools prüfen |
| Runner neu koppeln | App → Einstellungen → Runner → Entkoppeln, dann `leitwerk-runner init` |

## Sicherheit (für den Nutzer transparent machen)
- Der Runner spricht ausschließlich mit dem Leitwerk-Server und den vom Nutzer selbst
  verbundenen Konten (z. B. eigenes Gmail).
- Das Claude-Login bleibt lokal auf dem Rechner; Leitwerk sieht es nie.
- Der Runner kann jederzeit in der App entkoppelt/deaktiviert werden (Token wird ungültig).
