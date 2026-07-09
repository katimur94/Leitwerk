// ============================================================
// E2E-Tutorial-Lauf: fährt die komplette Phase-0-User-Journey
// gegen das Mock-Backend (tools/mock-server) und erzeugt
// annotierte Screenshots für docs/testing-tutorial/.
//
// Voraussetzungen (laufen):
//   node tools/mock-server/server.mjs          (Port 54321, frische db)
//   pnpm --filter @leitwerk/pwa dev            (Port 5173)
//   pnpm --filter leitwerk-runner build        (dist vorhanden)
//
// Start: node tools/e2e-tutorial/run.mjs
// ============================================================
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "../..");
const BASE = "http://localhost:5173";
const FUNCTIONS_URL = "http://127.0.0.1:54321/functions/v1";
const IMG = join(ROOT, "docs/testing-tutorial/img");
const TMP = join(ROOT, "tools/mock-server/tmp/shots");
const CONFIG_DIR = join(ROOT, "tools/mock-server/tmp/runner-config");
// Direkter Pfad (Shebang + Exec-Bit) — `spawn` ohne Shell kann keine
// Kommandos mit Leerzeichen wie "node …/claude-mock.cjs" starten.
const CLAUDE_MOCK = join(ROOT, "tools/mock-server/claude-mock.cjs");
const WHISPER_MOCK = join(ROOT, "tools/mock-server/whisper-mock.cjs");

const VIEWPORT = { width: 1440, height: 900 };
const ACCENT = "#3D5AFE";

mkdirSync(IMG, { recursive: true });
mkdirSync(TMP, { recursive: true });

// ---------- Annotations-Renderer ----------

/** Rendert Screenshot + Marker (Rahmen, Nummern-Badge, Label) in ein neues PNG. */
async function compose(composePage, rawPath, marks, outPath) {
  const img = readFileSync(rawPath).toString("base64");
  const { width: W, height: H } = VIEWPORT;

  // Kollisionsvermeidung: bereits platzierte Label-Rechtecke merken,
  // neue Labels bei Überlappung nach unten schieben.
  const placedLabels = [];
  function placeLabel(x1, x2, y) {
    const overlaps = (a) =>
      placedLabels.some(
        (p) => !(a.x2 < p.x1 - 8 || a.x1 > p.x2 + 8 || a.y2 < p.y1 - 4 || a.y1 > p.y2 + 4),
      );
    let ly = Math.min(Math.max(y, 8), H - 40);
    while (overlaps({ x1, x2, y1: ly, y2: ly + 30 }) && ly < H - 40) ly += 36;
    placedLabels.push({ x1, x2, y1: ly, y2: ly + 30 });
    return ly;
  }

  const overlays = marks
    .map((m, i) => {
      const pad = 6;
      const bx = Math.max(2, m.x - pad);
      const by = Math.max(2, m.y - pad);
      const bw = Math.min(W - bx - 2, m.width + pad * 2);
      const bh = Math.min(H - by - 2, m.height + pad * 2);
      const n = i + 1;

      // Label rechts vom Rahmen, sonst links (Platzheuristik)
      const estWidth = 40 + m.label.length * 7.2;
      const labelRight = bx + bw + 14 + estWidth < W && m.side !== "left";
      const lx1 = labelRight ? bx + bw + 14 : bx - 14 - estWidth;
      const labelStyle = labelRight
        ? `left:${bx + bw + 14}px;`
        : `left:${bx - 14}px;transform:translateX(-100%);`;
      const labelY = placeLabel(lx1, lx1 + estWidth, by - 6);

      return `
        <div style="position:absolute;left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px;
          border:3px solid ${ACCENT};border-radius:10px;
          box-shadow:0 0 0 2px rgba(255,255,255,.85), inset 0 0 0 2px rgba(255,255,255,.35);"></div>
        <div style="position:absolute;left:${bx - 13}px;top:${by - 13}px;width:26px;height:26px;
          border-radius:50%;background:${ACCENT};color:#fff;font:700 14px/26px 'Segoe UI',Arial;
          text-align:center;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);z-index:10;">${n}</div>
        <div style="position:absolute;top:${labelY}px;${labelStyle}
          background:#14161b;color:#fff;font:600 13px/1 'Segoe UI',Arial;white-space:nowrap;
          padding:7px 12px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.4);z-index:10;">
          <span style="color:#9db1ff;font-weight:700;">${n}</span>&nbsp; ${m.label}
        </div>`;
    })
    .join("\n");

  await composePage.setViewportSize({ width: W, height: H });
  await composePage.setContent(
    `<body style="margin:0"><div id="c" style="position:relative;width:${W}px;height:${H}px;overflow:hidden">
       <img src="data:image/png;base64,${img}" style="display:block;width:${W}px;height:${H}px">
       ${overlays}
     </div></body>`,
  );
  await composePage.locator("#c").screenshot({ path: outPath });
}

// ---------- Helfer ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(300);
  }
  throw new Error(`Timeout: ${label}`);
}

function startProcess(args, extraEnv = {}) {
  const child = spawn("node", args, {
    cwd: ROOT,
    env: { ...process.env, LEITWERK_CONFIG_DIR: CONFIG_DIR, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d.toString()));
  child.stderr.on("data", (d) => (output += d.toString()));
  return { child, out: () => output };
}

async function clickText(page, text) {
  await page.locator(`button:has-text("${text}")`).last().click();
}

// ---------- Hauptlauf ----------

const children = [];
let browser;

try {
  rmSync(CONFIG_DIR, { recursive: true, force: true });

  // Browser-Auswahl: expliziter Pfad (CI/Container) > Chrome > Edge > Playwright-Download
  const explicitChromium = process.env.LEITWERK_E2E_CHROMIUM;
  if (explicitChromium) {
    browser = await chromium.launch({ executablePath: explicitChromium });
  } else {
    try {
      browser = await chromium.launch({ channel: "chrome" });
    } catch {
      try {
        browser = await chromium.launch({ channel: "msedge" });
      } catch {
        browser = await chromium.launch();
      }
    }
  }
  const context = await browser.newContext({ viewport: VIEWPORT, locale: "de-DE" });
  const page = await context.newPage();
  const composePage = await context.newPage();

  let step = 0;
  async function capture(name, annotations = []) {
    await sleep(400); // Transitions ausklingen lassen
    step += 1;
    const file = `${String(step).padStart(2, "0")}-${name}`;
    const rawPath = join(TMP, `${file}.png`);
    await page.screenshot({ path: rawPath });
    const marks = [];
    for (const a of annotations) {
      const locator = typeof a.at === "string" ? page.locator(a.at).first() : a.at;
      const box = await locator.boundingBox().catch(() => null);
      if (box) marks.push({ ...box, label: a.label, side: a.side });
      else console.warn(`  ⚠ Annotation nicht gefunden: ${a.label}`);
    }
    await compose(composePage, rawPath, marks, join(IMG, `${file}.png`));
    console.log(`📸 ${file}.png`);
    await page.bringToFront();
  }

  // ---- 01 Login ----
  await page.goto(`${BASE}/login`);
  await page.waitForSelector("#email");
  await capture("login", [
    { at: "#email", label: "E-Mail-Adresse eingeben" },
    { at: "#password", label: "Passwort eingeben" },
    { at: "button[type=submit]", label: "Anmelden" },
    { at: 'button:has-text("Mit Google anmelden")', label: "Alternativ: Google-Login (ab Phase 1 konfiguriert)" },
    { at: 'a[href="/registrieren"]', label: "Neues Konto erstellen", side: "left" },
  ]);

  // ---- 02 Registrierung ----
  await page.goto(`${BASE}/registrieren`);
  await page.fill("#displayName", "Timur Kalayci");
  await page.fill("#email", "timur@leitwerk.test");
  await page.fill("#password", "leitwerk-demo-2026");
  await capture("registrierung", [
    { at: "#displayName", label: "Dein Anzeigename" },
    { at: "#email", label: "E-Mail (wird dein Login)" },
    { at: "#password", label: "Mindestens 8 Zeichen" },
    { at: "button[type=submit]", label: "Konto erstellen → Onboarding startet" },
  ]);
  await page.click("button[type=submit]");

  // ---- 03 Organisation anlegen ----
  await page.waitForSelector("#org-name");
  await page.fill("#org-name", "DiTom GmbH");
  await capture("onboarding-organisation", [
    { at: "#org-name", label: "Name deiner Firma / deines Teams" },
    { at: "button[type=submit]", label: "Legt Org + Stammdaten + Nummernkreise an" },
  ]);
  await page.click("button[type=submit]");

  // ---- 04 Stammdaten ----
  await page.waitForSelector("#company-legal_name");
  const stammdaten = {
    legal_form: "GmbH",
    owner_name: "Timur Kalayci",
    street: "Musterstraße 12",
    zip: "44135",
    city: "Dortmund",
    phone: "+49 231 555 0123",
    email: "info@ditom.example",
    vat_id: "DE123456789",
    tax_number: "317/5678/9012",
    bank_name: "Sparkasse Dortmund",
    iban: "DE02 4405 0199 0000 1234 56",
  };
  for (const [key, value] of Object.entries(stammdaten)) {
    await page.fill(`#company-${key}`, value);
  }
  await capture("onboarding-stammdaten", [
    { at: "ol", label: "Fortschritt: Schritt 1 von 5" },
    { at: "#company-legal_name", label: "Vorausgefüllt aus dem Org-Namen" },
    { at: "#company-iban", label: "Bankdaten — Pflicht für Rechnungen (Phase 3)" },
    { at: 'button:has-text("Weiter")', label: "Speichert nach org_profile", side: "left" },
  ]);
  await clickText(page, "Weiter");

  // ---- 05 Postfach (Platzhalter) ----
  await page.waitForSelector('button:has-text("Überspringen")');
  await capture("onboarding-postfach", [
    { at: 'button:has-text("Gmail verbinden")', label: "Kommt in Phase 1 (E-Mail-Hub)" },
    { at: 'button:has-text("Überspringen")', label: "Jetzt überspringen", side: "left" },
  ]);
  await clickText(page, "Überspringen");

  // ---- 06 Runner-Pairing: Code vom Runner holen ----
  await page.waitForSelector("#pairing-code");
  const init = startProcess([
    "apps/runner/dist/index.js", "init", "--url", FUNCTIONS_URL,
  ]);
  children.push(init.child);
  const codeMatch = await waitFor(
    () => init.out().match(/Pairing-Code:\s+([A-Z0-9]{4})-([A-Z0-9]{4})/),
    20_000,
    "Pairing-Code des Runners",
  );
  const code = `${codeMatch[1]}-${codeMatch[2]}`;
  console.log(`   Runner-Pairing-Code: ${code}`);
  await page.fill("#pairing-code", code);
  await capture("onboarding-runner-pairing", [
    { at: "pre", label: "1. Diesen Befehl im Terminal ausführen" },
    { at: "#pairing-code", label: "2. Code aus dem Runner-Terminal eintippen" },
    { at: 'button:has-text("Verbinden")', label: "3. Verbinden — Runner löst den Code ein" },
  ]);
  await clickText(page, "Verbinden");

  // Runner pollt /pair alle 7 s — auf Erfolg warten
  await waitFor(() => init.out().includes("Pairing erfolgreich"), 40_000, "Pairing-Bestätigung");

  // ---- 07 Runner-Freigabe (Zwei-Stufen-Pairing, Etappe 0.5) ----
  // Fokus-Event → TanStack Query refetcht die Runner-Liste sofort
  // (kein Reload: der lokale Wizard-Schritt würde sonst zurückspringen)
  await waitFor(async () => {
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(700);
    return (await page.locator('button:has-text("Bestätigen")').count()) > 0;
  }, 40_000, "Freigabe-Karte im Onboarding");
  await capture("onboarding-runner-freigabe", [
    { at: 'p:has-text("Neuer Runner wartet auf Freigabe")', label: "Zwei-Stufen-Pairing: Runner ist gepairt, aber noch gesperrt" },
    { at: 'button:has-text("Bestätigen")', label: "Freigeben — erst danach darf er Jobs claimen" },
    { at: 'button:has-text("Ablehnen")', label: "Unbekannte Runner ablehnen (Token wird ungültig)", side: "left" },
  ]);
  await clickText(page, "Bestätigen");
  // Der Runner pollt /status alle 10 s und meldet die Freigabe im Terminal
  await waitFor(() => init.out().includes("Runner freigegeben"), 60_000, "Freigabe beim Runner angekommen");

  // ---- 08 Runner verbunden ----
  await waitFor(async () => {
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(700);
    return (await page.locator('li:has-text("Letzter Heartbeat")').count()) > 0;
  }, 40_000, "Runner-Zeile im Onboarding");
  await capture("onboarding-runner-verbunden", [
    { at: 'li:has-text("Letzter Heartbeat")', label: "Runner ist gepairt und freigegeben" },
    { at: 'button:has-text("Weiter")', label: "Weiter — erst aktiv, wenn ein Runner da ist", side: "left" },
  ]);
  await clickText(page, "Weiter");

  // ---- 09 Nummernkreise ----
  await page.waitForSelector('li:has-text("Rechnungen")');
  await capture("onboarding-nummernkreise", [
    { at: 'li:has-text("Vorgänge")', label: "Automatisch angelegt (V-/AN-/RE-/MA-)" },
    { at: 'button:has-text("Weiter")', label: "Bestätigen", side: "left" },
  ]);
  await clickText(page, "Weiter");

  // ---- 10 Fertig ----
  await page.waitForSelector('button:has-text("Zur App")');
  await capture("onboarding-fertig", [
    { at: 'button:has-text("Zur App")', label: "Einrichtung abgeschlossen → App-Shell" },
  ]);
  await clickText(page, "Zur App");

  // ---- 11 App-Shell / Heute ----
  await page.waitForSelector("nav");
  await capture("app-shell-heute", [
    { at: 'nav a[title="Heute"]', label: "Icon-Rail: Heute · Posteingang · Vorgänge · Aufgaben · Finanzen" },
    { at: "aside p", label: "Kontext-Sidebar mit aktiver Organisation" },
    { at: 'button:has-text("Zu den Runner-Einstellungen")', label: "Morgen-Briefing folgt in Phase 2 — erst Runner testen", side: "left" },
    { at: 'nav [title="Einstellungen"]', label: "Einstellungen" },
    { at: 'nav button[title="Design wechseln"]', label: "Hell/Dunkel umschalten" },
  ]);

  // ---- 12 Finanzen leer (Empty-States vor dem ersten Postfach) ----
  await page.click('nav [title="Finanzen"]');
  await page.waitForSelector('main p:has-text("offen")');
  await capture("finanzen-leer", [
    { at: 'nav [title="Finanzen"]', label: "Finanzen-Modul (Phase 3)" },
    { at: "main h1", label: "Noch keine Daten — Kacheln stehen auf 0,00 € (ehrlicher Empty-State)" },
  ]);

  // ---- 13 CommandBar (Cmd/Strg+K) ----
  await page.keyboard.press("Control+KeyK");
  await page.waitForSelector('input[placeholder*="Suchen"]');
  await capture("commandbar", [
    { at: 'input[placeholder*="Suchen"]', label: "Strg/Cmd+K — Suche & Befehle von überall" },
    { at: 'button:has-text("Heute")', label: "Enter springt zum ersten Treffer" },
  ]);
  await page.keyboard.press("Escape");

  // ---- 14 Runner-Einstellungen (Runner läuft) ----
  const runner = startProcess(["apps/runner/dist/index.js", "start"], {
    LEITWERK_CLAUDE_BIN: CLAUDE_MOCK,
    LEITWERK_GMAIL_API_URL: "http://127.0.0.1:54321/gmail/v1/users/me",
    LEITWERK_WHISPER_BIN: WHISPER_MOCK, // Etappe 4: lokale Transkription (Mock)
  });
  children.push(runner.child);
  await waitFor(() => runner.out().includes("Leitwerk-Runner gestartet"), 15_000, "Runner-Start");

  await page.goto(`${BASE}/einstellungen/runner`);
  await page.waitForSelector('li:has-text("Letzter Heartbeat")');
  await capture("runner-einstellungen", [
    { at: 'li:has-text("Letzter Heartbeat")', label: "Grüner Punkt = Runner online (Heartbeat < 3 min)" },
    { at: 'h3:has-text("Runner verbinden")', label: "Weitere Runner jederzeit pairbar" },
    { at: 'h3:has-text("Test-Job")', label: "Ende-zu-Ende-Test der KI-Kette" },
  ]);

  // ---- 15 Abo-Schutz: Limits & Nachtfenster (Etappe 0.5) ----
  await page.locator('button:has-text("Limits")').first().click();
  await page.waitForSelector('label:has-text("Max. Jobs pro Stunde")');
  await page.locator('label:has-text("Nachtfenster") input[type="checkbox"]').check();
  await page.waitForSelector('input[type="time"]');
  await capture("runner-limits", [
    { at: 'label:has-text("Max. Jobs pro Stunde")', label: "Stundenlimit — schont das Claude-Abo" },
    { at: 'label:has-text("Max. Jobs pro Tag")', label: "Hartes Tageslimit" },
    { at: 'label:has-text("Nachtfenster")', label: "Batch-Jobs nur im Nachtfenster, interaktive immer", side: "left" },
    { at: 'form:has(label:has-text("Max. Jobs pro Stunde")) button[type="submit"]', label: "Serverseitig erzwungen in claim_next_job", side: "left" },
  ]);
  await page.locator('form:has(label:has-text("Max. Jobs pro Stunde")) button[type="submit"]').click();
  await page.waitForSelector(':text("Gespeichert.")');
  // Fenster wieder deaktivieren — sonst blockiert der Abo-Schutz die
  // Nacht-Batch-Jobs (gap_scan) für den Rest des E2E-Laufs. (Beweis,
  // dass das Gate greift, ist der Screenshot oben.)
  await page.locator('label:has-text("Nachtfenster") input[type="checkbox"]').uncheck();
  await page.locator('form:has(label:has-text("Max. Jobs pro Stunde")) button[type="submit"]').click();
  await page.waitForSelector(':text("Gespeichert.")');

  // ---- 16 Test-Job senden ----
  await page.fill("#testjob-text", "Sag Hallo an das DiTom-Team!");
  await page.click('button:has-text("Test-Job senden")');
  await page.waitForSelector('li :text-matches("Wartet|Übernommen|Läuft")', { timeout: 5000 }).catch(() => {});
  await capture("testjob-gesendet", [
    { at: "#testjob-text", label: "Beliebiger Testtext", side: "left" },
    { at: 'button:has-text("Test-Job senden")', label: "Legt einen echo-Job in die Queue (Priorität 2)", side: "left" },
    { at: 'li:has(span:text-matches("Wartet|Übernommen|Läuft"))', label: "Job in der Queue — der Runner claimt ihn in ~5 s", side: "left" },
  ]);

  // ---- 17 Test-Job erledigt (KI-Antwort) ----
  await waitFor(async () => {
    await page.reload();
    await sleep(600);
    return (await page.locator(':text("Erledigt")').count()) > 0;
  }, 45_000, "Job-Erledigung");
  await page.waitForSelector(':text("Mock-Antwort")');
  await capture("testjob-ki-antwort", [
    { at: 'span:has-text("Erledigt")', label: "Status live: Wartet → Läuft → Erledigt" },
    { at: 'p:has-text("Mock-Antwort")', label: "KI-Antwort — violettes Badge = kommt von der KI" },
  ]);

  // ---- 18 Postfach verbinden (Etappe 1, Demo-Postfach im Mock) ----
  await page.goto(`${BASE}/einstellungen/postfaecher`);
  await page.waitForSelector('button:has-text("Gmail verbinden")');
  await capture("postfach-verbinden", [
    { at: 'button:has-text("Gmail verbinden")', label: "OAuth-Flow — Refresh-Token landet im Server-Tresor" },
    { at: 'h3:has-text("Verbundene Konten")', label: "Sync-Status pro Konto" },
  ]);
  await page.click('button:has-text("Gmail verbinden")');
  // Mock-Callback → Redirect zurück mit ?connected=…
  await page.waitForSelector(':text("demo@leitwerk.test")', { timeout: 20_000 });
  await capture("postfach-verbunden", [
    { at: 'li:has-text("demo@leitwerk.test")', label: "Konto verbunden — Runner startet den Sync" },
  ]);

  // ---- 19 Inbox mit KI-Kategorien ----
  await page.goto(`${BASE}/posteingang`);
  // Sync (Runner) + classify_email (Mock-KI) abwarten
  await waitFor(async () => {
    await page.reload();
    await sleep(1200);
    return (await page.locator('main :text("Rechnung RE-88123")').count()) > 0;
  }, 90_000, "Demo-Mails in der Inbox");
  await waitFor(async () => {
    await page.reload();
    await sleep(1200);
    return (await page.locator('span:text-is("Anfrage")').count()) > 0;
  }, 90_000, "KI-Kategorien an den Threads").catch(() => {
    console.warn("  ⚠ Kategorien noch nicht sichtbar — Screenshot trotzdem");
  });
  await page.goto(`${BASE}/posteingang`);
  await page.waitForSelector('main :text("Rechnung RE-88123")');
  await sleep(800);
  await capture("inbox", [
    { at: 'button:has-text("Rechnung RE-88123")', label: "InboxRow: Absender · Betreff · Snippet" },
    { at: 'input[placeholder*="durchsuchen"]', label: "Volltextsuche (tsvector, german)" },
    { at: 'main button[title="Neue E-Mail"]', label: "Neue E-Mail verfassen", side: "left" },
  ]);

  // ---- 20 Thread mit Auto-Vorgang ----
  await page.click('button:has-text("Anfrage: Sanierung Bürogebäude")');
  await page.waitForSelector('h2:has-text("Anfrage: Sanierung Bürogebäude")');
  await waitFor(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await sleep(800);
    return (await page.locator(':text("Vorgang öffnen")').count()) > 0;
  }, 60_000, "Auto-Vorgang am Thread").catch(() => {
    console.warn("  ⚠ case_match noch nicht durch — Screenshot trotzdem");
  });
  await capture("thread-vorgang", [
    { at: 'h2:has-text("Anfrage: Sanierung")', label: "Thread-Ansicht mit kompletter Konversation" },
    { at: 'main a:has-text("Vorgang öffnen")', label: "case_match hat automatisch einen Vorgang angelegt" },
    { at: 'button:has-text("Antworten")', label: "Antworten — oder gleich den KI-Entwurf", side: "left" },
  ]);

  // ---- 21 KI-Entwurf anfordern ----
  await page.click('button:has-text("KI-Entwurf anfordern")');
  await waitFor(async () => {
    await sleep(1000);
    return (await page.locator('span:has-text("KI-Entwurf")').count()) > 0;
  }, 60_000, "KI-Entwurf im Thread");
  await capture("ki-entwurf", [
    { at: 'div:has(> div > span:has-text("KI-Entwurf")) >> nth=0', label: "Violett = von der KI — senden erst nach Freigabe" },
    { at: 'button:has-text("Bearbeiten & senden")', label: "Entwurf übernehmen und bearbeiten", side: "left" },
  ]);

  // ---- 22 Senden mit 30s-Rückholen ----
  await page.click('button:has-text("Bearbeiten & senden")');
  // Exakter Name: has-text("Senden") würde auch Snippets wie
  // "… senden Sie uns …" in der Thread-Liste treffen.
  const sendButton = page.getByRole("button", { name: "Senden", exact: true });
  await sendButton.waitFor({ timeout: 15_000 });
  await sendButton.click();
  await page.waitForSelector(':text("Wird in")');
  await capture("senden-undo", [
    { at: ':text("Wird in")', label: "30 Sekunden Rückhol-Fenster — serverseitig erzwungen" },
    { at: 'button:has-text("Rückholen")', label: "Ein Klick stoppt den Versand", side: "left" },
  ]);
  await waitFor(async () => {
    await sleep(1000);
    return (await page.locator(':text("Gesendet ✓")').count()) > 0;
  }, 60_000, "Versand nach Ablauf des Undo-Fensters");
  await capture("gesendet", [
    { at: ':text("Gesendet ✓")', label: "Nach Ablauf: Versand über die Edge Function send-mail" },
  ]);

  // ---- 25 Aufgaben-Compiler (Etappe 2) ----
  await page.goto(`${BASE}/aufgaben`);
  await waitFor(async () => {
    await page.reload();
    await sleep(1200);
    return (await page.locator('span:has-text("aus Mail")').count()) > 0;
  }, 90_000, "KI-Aufgabenvorschläge (extract_commitments)");
  await page.goto(`${BASE}/aufgaben`);
  await page.waitForSelector('span:has-text("aus Mail")');
  // erste KI-Aufgabe aufklappen (Checkliste, Fälligkeit, Snooze)
  await page.locator('li:has(span:has-text("aus Mail")) button').first().click();
  await page.waitForSelector(':text("Checkliste")');
  await capture("aufgaben", [
    { at: 'span:has-text("aus Mail")', label: "Violett = von der KI aus einer Mail extrahiert" },
    { at: ':text("Checkliste")', label: "Checklisten, Fälligkeit, Wiederholung, Snooze" },
    { at: 'button:has-text("Verwerfen")', label: "Verwerfen = Feedback in die Trefferquote", side: "left" },
    { at: 'input[placeholder="Neue Aufgabe …"]', label: "Manuell geht immer" },
  ]);

  // ---- 26 Heute: Morgen-Briefing + Wächter ----
  await page.goto(`${BASE}/`);
  // Badge-Span, nicht der Fallback-Text „Das nächste Morgen-Briefing …“
  await waitFor(async () => {
    await page.reload();
    await sleep(1200);
    return (await page.locator('span:text-is("Morgen-Briefing")').count()) > 0;
  }, 120_000, "Morgen-Briefing auf der Heute-Seite");
  await page.goto(`${BASE}/`);
  await page.waitForSelector('span:text-is("Morgen-Briefing")');
  await sleep(600);
  await capture("heute-briefing", [
    { at: 'span:has-text("Morgen-Briefing")', label: "Vom Nacht-Lauf erzeugt — violett = KI" },
    { at: "ol li >> nth=0", label: "Nummerierte Punkte mit direkter Aktion (BriefingCard)" },
    { at: 'h3:has-text("Wächter-Findings")', label: "gap_scan: Lücken, Widersprüche, Liegengebliebenes", side: "left" },
  ]);

  // ---- 27 Notification-Center ----
  await page.click('nav button[title="Benachrichtigungen"]');
  await page.waitForSelector(':text("Benachrichtigungen")');
  await sleep(500);
  await capture("benachrichtigungen", [
    { at: 'nav button[title="Benachrichtigungen"]', label: "Glocke mit Ungelesen-Punkt" },
    { at: ':text("Web-Push aktivieren")', label: "Web-Push (VAPID) — auch außerhalb der App" },
  ]);
  await page.keyboard.press("Escape");
  await page.click("main");

  // ---- 28 Automationen mit TrustMeter ----
  await page.goto(`${BASE}/einstellungen/automationen`);
  await page.waitForSelector(':text("Trefferquote")');
  await page.waitForSelector("svg circle");
  await capture("automationen", [
    { at: 'li:has-text("Mails kategorisieren")', label: "TrustMeter: Trefferquote aus deinem Feedback" },
    { at: 'input[type="range"]', label: "Autonomie-Regler 1–4 (Details in Etappe 4)", side: "left" },
  ]);

  // ---- 29 Vorgänge (Auto-Anlage durch die KI) ----
  await page.goto(`${BASE}/vorgaenge`);
  await page.waitForSelector('main :text("V-2026-")');
  await capture("vorgaenge", [
    { at: 'a:has-text("Sanierung")', label: "Vorgang mit Nummernkreis (V-2026-…)" },
    { at: 'span:has-text("KI-angelegt")', label: "Von case_match automatisch angelegt", side: "left" },
    { at: 'input[placeholder*="Titel des neuen"]', label: "Manuell anlegen geht immer", side: "left" },
  ]);

  // ---- 30 Vorgangsakte mit Timeline ----
  await page.click('a:has-text("Sanierung")');
  await page.waitForSelector('h3:has-text("Zeitleiste")');
  await capture("vorgang-detail", [
    { at: 'h3:has-text("Zeitleiste")', label: "CaseTimeline — violetter Punkt = KI-Eintrag" },
    { at: 'h3:has-text("E-Mail-Threads")', label: "Alles hängt am Vorgang", side: "left" },
    { at: 'button:has-text("Wartet")', label: "Status: offen · wartet · erledigt · archiviert" },
  ]);

  // ---- 31 Finanzen: Eingangsrechnung (extract_invoice) ----
  await page.goto(`${BASE}/finanzen`);
  await page.waitForSelector('button:has-text("Eingang")');
  await page.click('button:has-text("Eingang")');
  await waitFor(async () => {
    await sleep(1500);
    return (await page.locator('main :text("RE-88123")').count()) > 0;
  }, 90_000, "Erfasste Eingangsrechnung (extract_invoice)");
  await capture("finanzen-eingang", [
    { at: 'p:has-text("RE-88123")', label: "Aus dem Mail-Anhang erfasst — E-Rechnungs-XML ohne KI gelesen" },
    { at: 'span:has-text("E-Rechnung")', label: "ZUGFeRD/XRechnung erkannt (Konfidenz 100 %)" },
    { at: 'button:has-text("Prüfen")', label: "Prüf-Workflow: erfasst → geprüft → freigegeben → bezahlt", side: "left" },
  ]);
  await page.click('button:has-text("Prüfen")');

  // ---- 32 Rechnungs-Editor + XRechnung-Export ----
  await page.click('button:has-text("Rechnungen")');
  await page.waitForSelector('button:has-text("Neue Rechnung")');
  await page.click('button:has-text("Neue Rechnung")');
  await page.waitForSelector('button:has-text("Position hinzufügen")');
  await page.click('button:has-text("Position hinzufügen")');
  await sleep(800);
  const descInput = page.locator("table tbody tr").last().locator("input").first();
  await descInput.fill("Wartungsvertrag Q3 — Pauschale");
  await descInput.blur();
  const priceInput = page.locator("table tbody tr").last().locator("input").nth(3);
  await priceInput.fill("450,00");
  await priceInput.blur();
  await sleep(800);
  await page.click('button:has-text("XRechnung-XML")');
  await page.waitForSelector(':text("XML exportiert ✓")');
  await capture("rechnung-editor", [
    { at: "table", label: "Positionsliste — MoneyCell: rechtsbündig, tabular-nums" },
    { at: 'button:has-text("XRechnung-XML")', label: "EN 16931 / XRechnung 3.0 — deterministisch, Golden-File-getestet", side: "left" },
    { at: ':text("XML exportiert ✓")', label: "XML im Export-Bucket + an der Rechnung" },
    { at: 'label:has-text("B2G")', label: "B2G: Leitweg-ID wird serverseitig erzwungen", side: "left" },
  ]);
  await page.click('main button:has-text("Schließen")');

  // ---- 33 Mahnwesen mit KI-Entwurf ----
  await page.click('button:has-text("Mahnwesen")');
  await waitFor(async () => {
    await sleep(2000);
    return (await page.locator('span:has-text("Mahnstufe 1")').count()) > 0;
  }, 120_000, "Mahnvorschlag (überfällige Demo-Rechnung)");
  await capture("mahnwesen", [
    { at: 'span:has-text("Mahnstufe 1")', label: "Violett = KI-Vorschlag mit Mahnentwurf" },
    { at: 'button:has-text("Freigeben & senden")', label: "Versand NUR nach Freigabe (30s-Rückholen inklusive)", side: "left" },
    { at: 'button:has-text("Überspringen")', label: "Überspringen ist immer eine Option", side: "left" },
  ]);
  await page.click('button:has-text("Freigeben & senden")');
  await sleep(1000);

  // ---- 34 Autonomie-Regler + Hochstufen-Gate (Etappe 4) ----
  await page.goto(`${BASE}/einstellungen/automationen`);
  await page.waitForSelector('input[type="range"]');
  // Versuch, eine unbewährte Automation auf Stufe 3 zu ziehen → Server lehnt ab.
  // (Pfeiltasten lösen echte React-onChange-Events aus.)
  const labelRow = page.locator('li:has-text("Mails kategorisieren")');
  await labelRow.locator('input[type="range"]').focus();
  await page.keyboard.press("ArrowRight"); // 1 → 2 (erlaubt)
  await sleep(400);
  await page.keyboard.press("ArrowRight"); // 2 → 3 (Gate greift)
  await sleep(1000);
  await capture("automationen-regler", [
    { at: 'h1:has-text("Automationen")', label: "Autonomie-Regler 1–4 pro Automation" },
    { at: labelRow.locator('input[type="range"]').first(), label: "Hochstufen prüft der Server (set_autonomy_level)", side: "left" },
    { at: ':text("Trefferquote")', label: "Stufe 3/4 erst ab nachgewiesener Trefferquote" },
  ]);

  // ---- 35 Halte-Zone: HoldBanner + Stopp (Etappe 4) ----
  await page.goto(`${BASE}/`);
  await waitFor(async () => (await page.locator(':text("geht raus in")').count()) > 0, 15_000, "HoldBanner");
  await capture("halte-zone", [
    { at: ':text("geht raus in")', label: "Stufe-3-Aktion in der Halte-Zone — mit Countdown" },
    { at: 'button:has-text("Stoppen")', label: "Ein Klick stoppt vor dem Versand", side: "left" },
  ]);
  await page.click('button:has-text("Stoppen")');
  await sleep(1000);

  // ---- 36 Notizen (Etappe 4) ----
  await page.goto(`${BASE}/notizen`);
  await page.waitForSelector("#note-body");
  await page.fill("#note-title", "Absprache Firma Zeta");
  await page.fill("#note-body", "Gewährleistung bei Firma Zeta läuft bis Ende 2027. Ansprechpartner: Herr Kern.");
  await capture("notizen", [
    { at: 'h1:has-text("Notizen")', label: "Gedächtnis der Firma: Notizen (auch als Sprachnotiz)" },
    { at: "#note-body", label: "Markdown; Sprachnotiz → Whisper LOKAL im Runner" },
    { at: 'button:has-text("Notiz anlegen")', label: "Anlegen", side: "left" },
  ]);
  await page.click('button:has-text("Notiz anlegen")');
  await page.waitForSelector('li:has-text("Absprache Firma Zeta"), p:has-text("Absprache Firma Zeta")');

  // ---- 37 Wissen: destillierte Fakten prüfen (Etappe 4) ----
  await page.click('button:has-text("Wissen")');
  await waitFor(async () => {
    await sleep(2000);
    return (await page.locator('button:has-text("Bestätigen")').count()) > 0;
  }, 120_000, "Destillierte Wissens-Vorschläge (knowledge_distill)");
  await capture("wissen", [
    { at: 'span:has-text("Vorschlag")', label: "Violett = von der KI destilliert (mit Konfidenz)" },
    { at: 'button:has-text("Bestätigen")', label: "Bestätigen übernimmt den Fakt ins Firmenwissen", side: "left" },
    { at: 'button:has-text("Ablehnen")', label: "Ablehnen verwirft (kein Wiedervorschlag)", side: "left" },
  ]);
  await page.click('button:has-text("Bestätigen")');
  await sleep(800);

  // ---- 38 Meetings: Audio → Protokoll (Etappe 4) ----
  await page.goto(`${BASE}/meetings`);
  await page.waitForSelector("#meeting-title");
  await page.fill("#meeting-title", "Baubesprechung KW 28");
  // kleine Dummy-Audiodatei hochladen (Inhalt egal — Whisper-Mock ist deterministisch)
  await page.setInputFiles("#meeting-audio", {
    name: "baubesprechung.webm",
    mimeType: "audio/webm",
    buffer: Buffer.from("RIFF....mock-audio....", "utf8"),
  });
  await waitFor(async () => {
    await sleep(2000);
    return (await page.locator('button:has-text("Protokoll fertig"), span:has-text("Protokoll fertig")').count()) > 0;
  }, 120_000, "Meeting transkribiert + zusammengefasst");
  await page.click('button:has-text("Baubesprechung KW 28")');
  await page.waitForSelector('span:has-text("KI-Protokoll")');
  await capture("meetings", [
    { at: 'span:has-text("KI-Protokoll")', label: "Whisper (lokal) → KI-Protokoll — Audio verlässt die Org nie" },
    { at: 'h4:has-text("Entscheidungen")', label: "Entscheidungen + offene Fragen strukturiert", side: "left" },
  ]);

  // ---- 39 Kombinierte Suche (Volltext + semantisch, Etappe 4) ----
  await page.goto(`${BASE}/`);
  await page.waitForSelector("nav"); // App-Shell gemountet → CommandBar-Listener aktiv
  await page.locator("main").click({ position: { x: 20, y: 20 } });
  await sleep(400);
  await waitFor(async () => {
    await page.keyboard.press("Control+KeyK");
    await sleep(300);
    return (await page.locator('input[placeholder*="Suchen"]').count()) > 0;
  }, 15_000, "CommandBar öffnen");
  await page.fill('input[placeholder*="Suchen"]', "Gewährleistung Zeta");
  await waitFor(async () => (await page.locator('button:has-text("Semantisch suchen")').count()) > 0, 8000, "Suchleiste");
  await page.click('button:has-text("Semantisch suchen")');
  await waitFor(async () => {
    await sleep(1500);
    return (await page.locator('span:has-text("semantisch")').count()) > 0 ||
      (await page.locator(':text("Semantik aktiv")').count()) > 0;
  }, 30_000, "Semantische Treffer");
  await capture("suche", [
    { at: 'input[placeholder*="Suchen"]', label: "Ein Feld über Mails, Vorgänge, Notizen, Wissen …" },
    { at: ':text("Semantik aktiv"), button:has-text("Semantisch")', label: "Semantik: Runner rechnet das Embedding LOKAL", side: "left" },
  ]);
  await page.keyboard.press("Escape");

  // ---- 40 Geteiltes Postfach: Zuweisung + interner Kommentar (Etappe 5) ----
  await page.goto(`${BASE}/posteingang`);
  await page.waitForSelector('button:has-text("Rechnung RE-88123"), li:has-text("Rechnung")');
  await page.locator('button:has-text("Rechnung RE-88123")').first().click();
  await page.waitForSelector('select[aria-label="Thread zuweisen"]');
  await page.selectOption('select[aria-label="Thread zuweisen"]', { index: 1 });
  await sleep(500);
  await page.fill("#thread-comment", "Habe ich gesehen — kümmere mich morgen darum.");
  await page.click('button:has-text("Kommentieren")');
  await sleep(800);
  await capture("zuweisung-kommentar", [
    { at: 'select[aria-label="Thread zuweisen"]', label: "Thread einem Mitglied zuweisen (assign_thread)" },
    { at: 'h4:has-text("Interne Kommentare")', label: "Intern kommentieren — @Name benachrichtigt", side: "left" },
    { at: "#thread-comment", label: "Kein Weiterleiten-Chaos (MASTERPLAN §4 Y)", side: "left" },
  ]);

  // ---- 41 Kalender mit KI-Kontext-Briefing (Etappe 5) ----
  await page.goto(`${BASE}/kalender`);
  await waitFor(async () => {
    await sleep(2000);
    return (await page.locator(':text("KI-Briefing")').count()) > 0;
  }, 120_000, "Kalender-Briefing (calendar_briefing)");
  await capture("kalender", [
    { at: 'p:has-text("Ortstermin mit Anna Meier")', label: "Termin aus dem Google-Kalender (Runner-Sync)" },
    { at: 'span:has-text("KI-Briefing")', label: "Automatisches Kontext-Briefing vor dem Termin (violett = KI)" },
    { at: 'h2:has-text("Fristenkalender")', label: "Fristenkalender = wiederkehrende Aufgaben", side: "left" },
  ]);

  // ---- 42 Datenexport (Etappe 5) ----
  await page.click('button:has-text("Export erzeugen")');
  await waitFor(async () => (await page.locator(':text("Export bereit")').count()) > 0, 15_000, "Datenexport");
  await capture("datenexport", [
    { at: 'button:has-text("Export erzeugen")', label: "Kompletter Org-Export als JSON (kein Lock-in)" },
    { at: ':text("Export bereit")', label: "Nur Owner/Admin — Datei im Export-Bucket", side: "left" },
  ]);

  // ---- 43 Wochenreport (Etappe 5) ----
  await page.goto(`${BASE}/`);
  await waitFor(async () => {
    await sleep(2000);
    return (await page.locator('span:text-is("Wochenreport")').count()) > 0;
  }, 120_000, "Wochenreport (weekly_report)");
  await capture("wochenreport", [
    { at: 'span:text-is("Wochenreport")', label: "Freitags: KI-Wochenrückblick (briefings kind='weekly')" },
  ]);

  // ---- 44 Büro: Zeiterfassung (Etappe 6) ----
  await page.goto(`${BASE}/buero`);
  await page.waitForSelector('h3:has-text("Zeit erfassen")');
  await page.fill("#time-desc", "Ortstermin Baustelle Meier vorbereitet");
  await page.fill("#time-minutes", "90");
  await page.click('button:has-text("Erfassen")');
  await sleep(800);
  await capture("buero-zeiten", [
    { at: 'h3:has-text("Zeit erfassen")', label: "Zeit manuell erfassen — oder time_suggest schlägt vor" },
    { at: 'p:has-text("Diese Woche")', label: "Abrechenbare Zeiten fließen per bill_time_entries in Rechnungen", side: "left" },
  ]);

  // ---- 45 Büro: Bank-Zahlungsabgleich (Etappe 6) ----
  await page.click('button:has-text("Bank")');
  await waitFor(async () => {
    await sleep(1500);
    return (await page.locator('button:has-text("Zuordnen")').count()) > 0;
  }, 120_000, "Zahlungsvorschlag (payment_match)");
  await capture("buero-bank", [
    { at: 'span:has-text("Vorschlag")', label: "payment_match ordnet Umsatz einer offenen Rechnung zu (violett = KI)" },
    { at: 'button:has-text("Zuordnen")', label: "Bestätigen setzt Rechnung auf bezahlt + stoppt Mahnung", side: "left" },
  ]);
  await page.click('button:has-text("Zuordnen")');
  await sleep(1000);

  // ---- 46 Büro: DATEV-Export (Etappe 6) ----
  await page.click('button:has-text("DATEV")');
  await page.waitForSelector('h3:has-text("DATEV-Export erzeugen")');
  await page.fill("#datev-start", "2020-01-01"); // Periode weit fassen (Demo-Rechnung liegt Wochen zurück)
  await page.click('button:has-text("EXTF erzeugen")');
  await waitFor(async () => (await page.locator(':text("Buchungsstapel bereit")').count()) > 0, 20_000, "DATEV-Export");
  await capture("buero-datev", [
    { at: 'h3:has-text("DATEV-Export erzeugen")', label: "EXTF-Buchungsstapel (Format 700) für den Steuerberater" },
    { at: 'p:has-text("Steuerberater")', label: "Kontenrahmen bleibt in Hoheit des Beraters" },
    { at: 'li:has-text("EXTF")', label: "Exportierte Belege werden gesperrt (kein Doppel-Export)", side: "left" },
  ]);

  // ---- 47 Büro: Verträge + Kündigungswächter (Etappe 6) ----
  await page.click('button:has-text("Verträge")');
  await page.waitForSelector('span:has-text("Kündigung bis")');
  await capture("buero-vertraege", [
    { at: 'p:has-text("Leasing")', label: "extract_contract liest Eckdaten aus dem PDF (violett = KI)" },
    { at: 'span:has-text("Kündigung bis")', label: "contract_watch warnt vor der Kündigungsfrist (90/60/30 Tage)", side: "left" },
  ]);

  // ---- 48 Büro: Anrufnotiz (Etappe 6) ----
  await page.click('button:has-text("Anrufe")');
  await page.waitForSelector('h3:has-text("Anruf notieren")');
  await page.fill("#call-phone", "+49 170 5551234");
  await page.fill("#call-summary", "Rückruf Anna Meier — Termin bestätigt");
  await page.click('button:has-text("Notieren")');
  await sleep(800);
  await capture("buero-anrufe", [
    { at: 'h3:has-text("Anruf notieren")', label: "Anrufe schnell festhalten" },
    { at: "#call-summary", label: "Sprachnotizen transkribiert der Runner lokal (transcribe_call → summarize_call)", side: "left" },
  ]);

  // ---- 49 Regel-Builder (Etappe 0.5) ----
  await page.goto(`${BASE}/einstellungen/regeln`);
  await page.waitForSelector('h3:has-text("Neue Regel")');
  await page.fill("#rule-name", "Rechnungen sofort melden");
  await page.selectOption("#rule-event", "invoice_captured");
  await page.click('button:has-text("Bedingung hinzufügen")');
  await page.fill('input[placeholder*="Feld"]', "category");
  await page.fill('input[placeholder="Wert"]', "invoice");
  await page.fill("#rule-action-title", "Neue Eingangsrechnung prüfen");
  await capture("regel-builder", [
    { at: 'h3:has-text("Neue Regel")', label: "Wenn Ereignis + Bedingungen, dann Aktion" },
    { at: "#rule-event", label: "Ereignis — ab Phase 1 von den Modulen ausgelöst" },
    { at: 'input[placeholder="Wert"]', label: "Bedingungen (UND-verknüpft)", side: "left" },
    { at: 'button:has-text("Regel anlegen")', label: "Auswertung serverseitig: evaluate_org_rules", side: "left" },
  ]);
  await page.click('button:has-text("Regel anlegen")');
  await page.waitForSelector('li:has-text("Rechnungen sofort melden")');
  await capture("regel-liste", [
    { at: 'li:has-text("Rechnungen sofort melden")', label: "Regel aktiv — pausieren oder löschen jederzeit" },
  ]);

  // ---- 51 Dark Mode ----
  await page.click('nav button[title="Design wechseln"]');
  await sleep(400);
  await capture("dark-mode", [
    { at: 'nav button[title="Design wechseln"]', label: "Ein Klick — vollwertiges dunkles Theme" },
  ]);

  console.log("\n✅ Alle Screenshots erzeugt in docs/testing-tutorial/img/");
} finally {
  for (const child of children) {
    try { child.kill(); } catch { /* schon beendet */ }
  }
  await browser?.close();
}
