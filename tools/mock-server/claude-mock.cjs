#!/usr/bin/env node
// Mock der Claude-CLI für lokale Tests: liest den Prompt von stdin und
// antwortet im Format von `claude -p --output-format json`, ohne echte KI.
// Deterministische Antworten pro Skill (erkannt an Prompt-Markern).
// Verwendung: LEITWERK_CLAUDE_BIN=<pfad>/claude-mock.cjs leitwerk-runner start
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  // --version-Aufruf (Provider-Erkennung im Pairing)
  if (process.argv.includes("--version")) {
    process.stdout.write("claude-mock 0.1.0\n");
    return;
  }
  process.stdout.write(
    JSON.stringify({
      type: "result",
      is_error: false,
      result: JSON.stringify(answerFor(input)),
    }),
  );
});

function answerFor(prompt) {
  // classify_email — nur Betreff + Inhalt auswerten (nicht die Kategorienliste!)
  if (prompt.includes("Klassifiziere die folgende")) {
    const subject = (prompt.match(/^Betreff: (.*)$/m) || [])[1] || "";
    const body = prompt.split("---")[1] || "";
    const hay = `${subject} ${body}`.toLowerCase();
    let category = "sonstiges";
    if (hay.includes("mahnung")) category = "mahnung";
    else if (hay.includes("newsletter")) category = "newsletter";
    else if (hay.includes("rechnung")) category = "rechnung";
    else if (hay.includes("termin")) category = "termin";
    else if (hay.includes("auftrag") || hay.includes("bestätig")) category = "auftrag";
    else if (hay.includes("angebot") || hay.includes("anfrage")) category = "anfrage";
    return {
      category,
      urgency: category === "mahnung" ? 1 : 3,
      confidence: 0.95,
      reason: "Mock-Klassifikation anhand von Schlüsselwörtern",
    };
  }

  // case_match
  if (prompt.includes("Ordne den folgenden")) {
    const candidate = prompt.match(/case_id: ([0-9a-f-]{36})/);
    const subject = (prompt.match(/Thread-Betreff: (.*)/) || [])[1] || "Neues Anliegen";
    const caseNumber = prompt.match(/\| (V-\d{4}-\d+) \|/);
    // Deterministisch: Vorgangsnummer im Betreff → existing, sonst neu.
    if (candidate && caseNumber && subject.includes(caseNumber[1])) {
      return {
        decision: "existing",
        case_id: candidate[1],
        confidence: 0.94,
        reason: "Mock: Vorgangsnummer im Betreff erkannt",
      };
    }
    if (/newsletter|spam/i.test(subject)) {
      return { decision: "none", confidence: 0.9, reason: "Mock: kein Vorgang nötig" };
    }
    return {
      decision: "new",
      title: subject.replace(/^\s*(re|aw|fwd?):\s*/i, "").trim() || "Neues Anliegen",
      confidence: 0.93,
      reason: "Mock: neues Anliegen erkannt",
    };
  }

  // draft_reply
  if (prompt.includes("entwirfst eine Antwort-E-Mail")) {
    const replyTo = (prompt.match(/Antwort an: (\S+@\S+)/) || [])[1] || "kontakt@example.com";
    const subject = (prompt.match(/Betreff des Threads: (.*)/) || [])[1] || "Ihre Nachricht";
    const signature = prompt.includes("Hänge EXAKT diese Signatur")
      ? ((prompt.split("Hänge EXAKT diese Signatur ans Ende von body_html an:\n")[1] || "").split(
          "\nBisheriger Verlauf",
        )[0] || "").trim()
      : "";
    return {
      subject: /^(re|aw):/i.test(subject) ? subject : `Re: ${subject}`,
      body_html:
        "<p>Guten Tag,</p><p>vielen Dank für Ihre Nachricht. Gern melden wir uns " +
        "mit den gewünschten Informationen — wir kommen bis Ende der Woche auf Sie zu.</p>" +
        "<p>Mit freundlichen Grüßen</p>" +
        (signature || ""),
      to_addrs: [{ email: replyTo }],
      confidence: 0.9,
    };
  }

  // thread_summary
  if (prompt.includes("Fasse den folgenden E-Mail-Thread")) {
    return {
      summary:
        "Der Kontakt hat eine Anfrage gestellt und wartet auf unsere Rückmeldung. " +
        "Der nächste Schritt liegt bei uns: Antwort mit den gewünschten Details senden. (Mock)",
    };
  }

  // echo (P0-Testjob)
  const match = input.match(/Testtext: "([^"]*)"/);
  const text = match ? match[1] : "dein Testtext";
  return {
    reply: `Hallo! Dein Test „${text}“ ist angekommen — die Kette PWA → Queue → Runner → KI funktioniert. (Mock-Antwort)`,
  };
}
