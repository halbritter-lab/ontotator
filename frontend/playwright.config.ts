import { randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";

// Labels the PostgreSQL container of this run's fixture server (inherited by
// the webServer process), so the global teardown removes exactly that one.
process.env.ONTOCURATOR_E2E_RUN ??= randomUUID();

const port = process.env.HPO_E2E_PORT ?? "18765";
const python = process.env.E2E_PYTHON ?? (process.platform === "win32"
  ? "../.venv/Scripts/python.exe" : "../.venv/bin/python");

export default defineConfig({
  testDir: "./browser",
  // Three workers by default (PLAYWRIGHT_WORKERS or `--workers=N` override;
  // CHECK_PLAYWRIGHT_WORKERS in scripts/check.sh passes the flag). Spec files
  // run in parallel against the one fixture server: no two spec files change
  // the same project (tests/browser_server.py seeds one fixture project per
  // spec; scenario routes build fresh ones). Tests inside a file stay serial
  // (no fullyParallel): some change their project's settings and restore them.
  workers: Number(process.env.PLAYWRIGHT_WORKERS ?? 3),
  globalTeardown: "./playwright.teardown.ts",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  webServer: {
    command: `"${python}" ../tests/browser_server.py`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
