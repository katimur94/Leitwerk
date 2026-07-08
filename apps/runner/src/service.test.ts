import { describe, expect, it } from "vitest";
import {
  buildSchtasksCreateArgs,
  LAUNCHD_LABEL,
  renderLaunchdPlist,
  renderSystemdUnit,
  WINDOWS_TASK_NAME,
} from "./service";

describe("renderSystemdUnit", () => {
  it("erzeugt eine valide Unit mit ExecStart und Restart", () => {
    const unit = renderSystemdUnit("/usr/bin/node", "/opt/leitwerk/cli.js");
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("[Service]");
    expect(unit).toContain("[Install]");
    expect(unit).toContain("ExecStart=/usr/bin/node /opt/leitwerk/cli.js start");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("WantedBy=default.target");
  });

  it("quotet Pfade mit Leerzeichen", () => {
    const unit = renderSystemdUnit("/usr/bin/node", "/home/a b/cli.js");
    expect(unit).toContain('ExecStart=/usr/bin/node "/home/a b/cli.js" start');
  });
});

describe("renderLaunchdPlist", () => {
  it("erzeugt ein Plist mit Label, ProgramArguments und KeepAlive", () => {
    const plist = renderLaunchdPlist("/usr/local/bin/node", "/opt/cli.js", "/tmp/logs");
    expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect(plist).toContain("<string>/usr/local/bin/node</string>");
    expect(plist).toContain("<string>/opt/cli.js</string>");
    expect(plist).toContain("<string>start</string>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<key>RunAtLoad</key>");
  });

  it("escapet XML-Sonderzeichen in Pfaden", () => {
    const plist = renderLaunchdPlist("/usr/bin/node", "/a&b/cli.js", "/tmp");
    expect(plist).toContain("/a&amp;b/cli.js");
  });
});

describe("buildSchtasksCreateArgs", () => {
  it("legt einen ONLOGON-Task mit korrektem Kommando an", () => {
    const args = buildSchtasksCreateArgs("C:\\node.exe", "C:\\cli.js");
    expect(args).toContain("/Create");
    expect(args).toContain("ONLOGON");
    expect(args).toContain(WINDOWS_TASK_NAME);
    expect(args[args.length - 1]).toBe('"C:\\node.exe" "C:\\cli.js" start');
  });
});
