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
const CLAUDE_MOCK = `node ${join(ROOT, "tools/mock-server/claude-mock.cjs")}`;

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

  try {
    browser = await chromium.launch({ channel: "chrome" });
  } catch {
    try {
      browser = await chromium.launch({ channel: "msedge" });
    } catch {
      browser = await chromium.launch();
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

  // Runner pollt /pair alle 3 s — auf Erfolg warten
  await waitFor(() => init.out().includes("Pairing erfolgreich"), 30_000, "Pairing-Bestätigung");

  // ---- 07 Runner verbunden ----
  // Fokus-Event → TanStack Query refetcht die Runner-Liste sofort
  // (kein Reload: der lokale Wizard-Schritt würde sonst zurückspringen)
  await waitFor(async () => {
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(700);
    return (await page.locator('li:has-text("Letzter Heartbeat")').count()) > 0;
  }, 40_000, "Runner-Zeile im Onboarding");
  await capture("onboarding-runner-verbunden", [
    { at: 'li:has-text("Letzter Heartbeat")', label: "Runner ist gepairt und online" },
    { at: 'button:has-text("Weiter")', label: "Weiter — erst aktiv, wenn ein Runner da ist", side: "left" },
  ]);
  await clickText(page, "Weiter");

  // ---- 08 Nummernkreise ----
  await page.waitForSelector('li:has-text("Rechnungen")');
  await capture("onboarding-nummernkreise", [
    { at: 'li:has-text("Vorgänge")', label: "Automatisch angelegt (V-/AN-/RE-/MA-)" },
    { at: 'button:has-text("Weiter")', label: "Bestätigen", side: "left" },
  ]);
  await clickText(page, "Weiter");

  // ---- 09 Fertig ----
  await page.waitForSelector('button:has-text("Zur App")');
  await capture("onboarding-fertig", [
    { at: 'button:has-text("Zur App")', label: "Einrichtung abgeschlossen → App-Shell" },
  ]);
  await clickText(page, "Zur App");

  // ---- 10 App-Shell / Heute ----
  await page.waitForSelector("nav");
  await capture("app-shell-heute", [
    { at: 'nav a[title="Heute"]', label: "Icon-Rail: Heute · Posteingang · Vorgänge · Aufgaben · Finanzen" },
    { at: "aside p", label: "Kontext-Sidebar mit aktiver Organisation" },
    { at: 'button:has-text("Zu den Runner-Einstellungen")', label: "Morgen-Briefing folgt in Phase 2 — erst Runner testen", side: "left" },
    { at: 'nav [title="Einstellungen"]', label: "Einstellungen" },
    { at: 'nav button[title="Design wechseln"]', label: "Hell/Dunkel umschalten" },
  ]);

  // ---- 11 Modul-Platzhalter (Posteingang) ----
  await page.click('nav [title="Posteingang"]');
  await page.waitForSelector('main :text("Phase 1")');
  await capture("modul-platzhalter", [
    { at: 'nav [title="Posteingang"]', label: "Module sind angelegt …" },
    { at: "main p", label: "… und zeigen ehrlich ihre Phase (kein leerer Screen)" },
  ]);

  // ---- 12 CommandBar (Cmd/Strg+K) ----
  await page.keyboard.press("Control+KeyK");
  await page.waitForSelector('input[placeholder*="Suchen"]');
  await capture("commandbar", [
    { at: 'input[placeholder*="Suchen"]', label: "Strg/Cmd+K — Suche & Befehle von überall" },
    { at: 'button:has-text("Heute")', label: "Enter springt zum ersten Treffer" },
  ]);
  await page.keyboard.press("Escape");

  // ---- 13 Runner-Einstellungen (Runner läuft) ----
  const runner = startProcess(["apps/runner/dist/index.js", "start"], {
    LEITWERK_CLAUDE_BIN: CLAUDE_MOCK,
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

  // ---- 14 Test-Job senden ----
  await page.fill("#testjob-text", "Sag Hallo an das DiTom-Team!");
  await page.click('button:has-text("Test-Job senden")');
  await page.waitForSelector('li :text-matches("Wartet|Übernommen|Läuft")', { timeout: 5000 }).catch(() => {});
  await capture("testjob-gesendet", [
    { at: "#testjob-text", label: "Beliebiger Testtext", side: "left" },
    { at: 'button:has-text("Test-Job senden")', label: "Legt einen echo-Job in die Queue (Priorität 2)", side: "left" },
    { at: 'li:has(span:text-matches("Wartet|Übernommen|Läuft"))', label: "Job in der Queue — der Runner claimt ihn in ~5 s", side: "left" },
  ]);

  // ---- 15 Test-Job erledigt (KI-Antwort) ----
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

  // ---- 16 Dark Mode ----
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
