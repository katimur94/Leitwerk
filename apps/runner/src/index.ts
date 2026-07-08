import { configPath, loadConfig } from "./config";
import { runInit } from "./pairing";
import { runLoop } from "./poll-loop";
import { runServiceCommand } from "./service";
import { log } from "./util/log";
import { VERSION } from "./version";

const HELP = `
leitwerk-runner ${VERSION} — lokaler KI-Agent-Runner für Leitwerk (BYO Claude Max)

Befehle:
  init [--url <functions-url>]   Runner mit deinem Leitwerk-Konto verbinden (Pairing)
  start                          Job-Verarbeitung starten
  status                         Aktuelle Konfiguration anzeigen
  service install|uninstall|status
                                 Als Autostart-Dienst einrichten
                                 (Linux: systemd · macOS: launchd · Windows: schtasks)
  help                           Diese Hilfe

Die Functions-URL kommt aus --url oder der Umgebungsvariable LEITWERK_FUNCTIONS_URL,
z. B. http://127.0.0.1:54321/functions/v1 (lokal) oder
https://<project-ref>.supabase.co/functions/v1 (hosted).
`;

function getFunctionsUrl(args: string[]): string {
  const flagIndex = args.indexOf("--url");
  const fromFlag = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
  const url = fromFlag ?? process.env.LEITWERK_FUNCTIONS_URL;
  if (!url) {
    throw new Error(
      "Keine Functions-URL. Nutze --url oder setze LEITWERK_FUNCTIONS_URL.",
    );
  }
  return url.replace(/\/+$/, "");
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "init":
      await runInit(getFunctionsUrl(args));
      break;

    case "start": {
      const config = loadConfig();
      if (!config) {
        log.error(
          `Keine Konfiguration gefunden (${configPath()}). Zuerst pairen: leitwerk-runner init`,
        );
        process.exitCode = 1;
        return;
      }
      await runLoop(config);
      break;
    }

    case "service":
      runServiceCommand(args[0]);
      break;

    case "status": {
      const config = loadConfig();
      if (!config) {
        console.log("Nicht gepairt. Starte mit: leitwerk-runner init");
        return;
      }
      console.log(`Runner-ID:  ${config.runnerId}`);
      console.log(`Org-ID:     ${config.orgId}`);
      console.log(`Provider:   ${config.provider}`);
      console.log(`Broker:     ${config.functionsUrl}/runner-broker`);
      console.log(`Config:     ${configPath()}`);
      break;
    }

    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      break;

    default:
      console.log(HELP);
      log.error(`Unbekannter Befehl: ${command}`);
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
