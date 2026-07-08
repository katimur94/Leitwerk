#!/usr/bin/env node
// Mock der Claude-CLI für lokale Tests: liest den Prompt von stdin und
// antwortet im Format von `claude -p --output-format json`, ohne echte KI.
// Verwendung: LEITWERK_CLAUDE_BIN="node <pfad>/claude-mock.cjs" leitwerk-runner start
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  // --version-Aufruf (Provider-Erkennung im Pairing)
  if (process.argv.includes("--version")) {
    process.stdout.write("claude-mock 0.1.0\n");
    return;
  }
  // Testtext aus dem Echo-Prompt ziehen (steht in Anführungszeichen)
  const match = input.match(/Testtext: "([^"]*)"/);
  const text = match ? match[1] : "dein Testtext";
  const reply = `Hallo! Dein Test „${text}“ ist angekommen — die Kette PWA → Queue → Runner → KI funktioniert. (Mock-Antwort)`;
  process.stdout.write(
    JSON.stringify({
      type: "result",
      is_error: false,
      result: JSON.stringify({ reply }),
    }),
  );
});
