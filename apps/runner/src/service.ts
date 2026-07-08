// leitwerk-runner service install|uninstall|status — richtet den Runner als
// Autostart-Dienst ein (Etappe 0.5, Tutorial 05):
//   Linux   → systemd user unit  (~/.config/systemd/user/leitwerk-runner.service)
//   macOS   → launchd agent      (~/Library/LaunchAgents/com.leitwerk.runner.plist)
//   Windows → geplanter Task     (schtasks, Start bei Anmeldung)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { configDir, loadConfig } from "./config";
import { log } from "./util/log";

export const SERVICE_NAME = "leitwerk-runner";
export const LAUNCHD_LABEL = "com.leitwerk.runner";
export const WINDOWS_TASK_NAME = "LeitwerkRunner";

/** systemd-User-Unit — reine Funktion, damit sie testbar bleibt. */
export function renderSystemdUnit(nodePath: string, scriptPath: string): string {
  return [
    "[Unit]",
    "Description=Leitwerk Runner (lokaler KI-Agent, BYO Claude Max)",
    "After=network-online.target",
    "",
    "[Service]",
    `ExecStart=${quote(nodePath)} ${quote(scriptPath)} start`,
    "Restart=always",
    "RestartSec=10",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

/** launchd-Plist für macOS — reine Funktion, damit sie testbar bleibt. */
export function renderLaunchdPlist(
  nodePath: string,
  scriptPath: string,
  logDir: string,
): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${escapeXml(nodePath)}</string>`,
    `    <string>${escapeXml(scriptPath)}</string>`,
    "    <string>start</string>",
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>StandardOutPath</key>",
    `  <string>${escapeXml(join(logDir, "runner.log"))}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${escapeXml(join(logDir, "runner.log"))}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

/** schtasks-Argumente für Windows — reine Funktion, damit sie testbar bleibt. */
export function buildSchtasksCreateArgs(nodePath: string, scriptPath: string): string[] {
  return [
    "/Create",
    "/F",
    "/SC",
    "ONLOGON",
    "/TN",
    WINDOWS_TASK_NAME,
    "/TR",
    `"${nodePath}" "${scriptPath}" start`,
  ];
}

function quote(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function run(command: string, args: string[]): { ok: boolean; output: string } {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { ok: result.status === 0, output };
}

function entryScript(): string {
  // Pfad des gerade laufenden CLI-Skripts (funktioniert für npm-global,
  // npx und lokalen Build); Symlinks (npm-bin-Shim) auflösen.
  return realpathSync(process.argv[1]);
}

function systemdUnitPath(): string {
  return join(homedir(), ".config", "systemd", "user", `${SERVICE_NAME}.service`);
}

function launchdPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

function installService(): void {
  if (!loadConfig()) {
    throw new Error(
      "Keine Konfiguration gefunden. Zuerst pairen: leitwerk-runner init",
    );
  }
  const nodePath = process.execPath;
  const scriptPath = entryScript();

  if (process.platform === "linux") {
    const unitPath = systemdUnitPath();
    mkdirSync(dirname(unitPath), { recursive: true });
    writeFileSync(unitPath, renderSystemdUnit(nodePath, scriptPath), "utf8");
    log.info(`systemd-Unit geschrieben: ${unitPath}`);
    for (const args of [
      ["--user", "daemon-reload"],
      ["--user", "enable", "--now", SERVICE_NAME],
    ]) {
      const { ok, output } = run("systemctl", args);
      if (!ok) {
        throw new Error(
          `systemctl ${args.join(" ")} fehlgeschlagen: ${output}\n` +
            "Hinweis: Auf Servern ohne Login-Session zusätzlich: loginctl enable-linger $USER",
        );
      }
    }
    log.info("Dienst installiert und gestartet ✓  (systemctl --user status leitwerk-runner)");
    return;
  }

  if (process.platform === "darwin") {
    const plistPath = launchdPlistPath();
    mkdirSync(dirname(plistPath), { recursive: true });
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(plistPath, renderLaunchdPlist(nodePath, scriptPath, configDir()), "utf8");
    log.info(`launchd-Agent geschrieben: ${plistPath}`);
    run("launchctl", ["unload", plistPath]); // alte Instanz entladen (Fehler ok)
    const { ok, output } = run("launchctl", ["load", "-w", plistPath]);
    if (!ok) throw new Error(`launchctl load fehlgeschlagen: ${output}`);
    log.info("Dienst installiert und gestartet ✓  (launchctl list | grep leitwerk)");
    return;
  }

  if (process.platform === "win32") {
    const { ok, output } = run("schtasks", buildSchtasksCreateArgs(nodePath, scriptPath));
    if (!ok) throw new Error(`schtasks /Create fehlgeschlagen: ${output}`);
    run("schtasks", ["/Run", "/TN", WINDOWS_TASK_NAME]);
    log.info(`Autostart-Task „${WINDOWS_TASK_NAME}“ angelegt und gestartet ✓`);
    return;
  }

  throw new Error(`Plattform ${process.platform} wird nicht unterstützt.`);
}

function uninstallService(): void {
  if (process.platform === "linux") {
    run("systemctl", ["--user", "disable", "--now", SERVICE_NAME]);
    const unitPath = systemdUnitPath();
    if (existsSync(unitPath)) rmSync(unitPath);
    run("systemctl", ["--user", "daemon-reload"]);
    log.info("Dienst entfernt ✓");
    return;
  }
  if (process.platform === "darwin") {
    const plistPath = launchdPlistPath();
    run("launchctl", ["unload", "-w", plistPath]);
    if (existsSync(plistPath)) rmSync(plistPath);
    log.info("Dienst entfernt ✓");
    return;
  }
  if (process.platform === "win32") {
    const { ok, output } = run("schtasks", ["/Delete", "/F", "/TN", WINDOWS_TASK_NAME]);
    if (!ok) throw new Error(`schtasks /Delete fehlgeschlagen: ${output}`);
    log.info("Autostart-Task entfernt ✓");
    return;
  }
  throw new Error(`Plattform ${process.platform} wird nicht unterstützt.`);
}

function serviceStatus(): void {
  if (process.platform === "linux") {
    const installed = existsSync(systemdUnitPath());
    console.log(`Unit installiert: ${installed ? "ja" : "nein"} (${systemdUnitPath()})`);
    if (installed) {
      const { output } = run("systemctl", ["--user", "is-active", SERVICE_NAME]);
      console.log(`Status: ${output || "unbekannt"}`);
    }
    return;
  }
  if (process.platform === "darwin") {
    const installed = existsSync(launchdPlistPath());
    console.log(`Agent installiert: ${installed ? "ja" : "nein"} (${launchdPlistPath()})`);
    if (installed) {
      const { ok, output } = run("launchctl", ["list", LAUNCHD_LABEL]);
      console.log(ok ? `Status: geladen\n${output}` : "Status: nicht geladen");
    }
    return;
  }
  if (process.platform === "win32") {
    const { ok, output } = run("schtasks", ["/Query", "/TN", WINDOWS_TASK_NAME]);
    console.log(ok ? output : `Task „${WINDOWS_TASK_NAME}“ ist nicht installiert.`);
    return;
  }
  throw new Error(`Plattform ${process.platform} wird nicht unterstützt.`);
}

export function runServiceCommand(subcommand: string | undefined): void {
  switch (subcommand) {
    case "install":
      installService();
      break;
    case "uninstall":
      uninstallService();
      break;
    case "status":
      serviceStatus();
      break;
    default:
      throw new Error(
        "Nutzung: leitwerk-runner service install|uninstall|status",
      );
  }
}
