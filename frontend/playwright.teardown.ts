import { execFileSync } from "node:child_process";

/**
 * Remove the PostgreSQL test container of this run's browser fixture server.
 *
 * Playwright kills the server hard, so it cannot stop its container itself;
 * Ryuk usually does, but not always on Docker Desktop. The run label is unique
 * per run, so containers of other runs (or other worktrees) never match.
 */
export default function globalTeardown(): void {
  const run = process.env.ONTOCURATOR_E2E_RUN;
  if (!run) return;
  try {
    const ids = execFileSync(
      "docker",
      ["ps", "-aq", "--filter", `label=ontocurator.e2e-run=${run}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length > 0) {
      execFileSync("docker", ["rm", "-f", ...ids], { stdio: "ignore" });
    }
  } catch {
    // No Docker, or the server used ONTOCURATOR_TEST_PG_URL: nothing to remove.
  }
}
