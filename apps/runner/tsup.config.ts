import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
  // Workspace-Paket wird als TS-Quelle mitgebündelt
  noExternal: ["@leitwerk/shared"],
});
