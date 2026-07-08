import { spawn } from "node:child_process";

/**
 * Startet ein CLI, schreibt den Prompt auf stdin und sammelt stdout.
 * Prompt geht bewusst über stdin (kein Argument) — keine Quoting-Probleme,
 * keine Längenlimits, funktioniert mit shell:true unter Windows (.cmd-Shims).
 */
export function runCli(
  command: string,
  args: string[],
  stdin: string,
  timeoutSec: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error(`${command} Timeout nach ${timeoutSec}s`));
    }, timeoutSec * 1000);

    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    child.on("error", (err) => {
      if (settled) return;
      clearTimeout(timer);
      reject(
        new Error(
          `${command} konnte nicht gestartet werden: ${err.message}. Ist es installiert?`,
        ),
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(
          new Error(
            `${command} beendet mit Code ${code}: ${stderr.trim().slice(0, 500)}`,
          ),
        );
      }
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}
