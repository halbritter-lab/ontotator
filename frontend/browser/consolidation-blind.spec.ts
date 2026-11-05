/**
 * Hidden annotator names (issue 302) end to end: a consolidator of a project that hides annotator names never reads a
 * name, username or pseudonym of the annotators, in the page or in any API answer, and no hash they could rehash to
 * recover the author (snapshot versions and the ids derived from them arrive as opaque tokens). The full editor opens
 * on the same tokens, and the consolidation resolves and submits on them. Scenario:
 * tests/browser_consolidation_scenarios.py (blind=true: consolidator "adj").
 */
import { expect, test, type Page } from "@playwright/test";
import { loginExisting } from "./helpers";

test.setTimeout(240_000);
test.use({ viewport: { width: 1280, height: 900 }, actionTimeout: 15_000 });

interface BlindScenario {
  users: Record<string, string>;
  pseudonyms: Record<string, string>;
  assignment_id: number;
}

// Hashes of author-independent content the page compares with other answers (api/blind_ids.py PUBLIC_KEYS).
const PUBLIC = new Set(["text_sha256", "ontology_sha256", "layer_config_sha256", "axes_config_sha256", "sha256", "scope_id", "csrf_token"]);
const HEX = /(?<![0-9A-Za-z])([0-9a-f]{64}|[0-9a-f]{16})(?![0-9A-Za-z])/g;

/** Hex hashes outside the public fields of an API answer (a workspace id is a base64 key). */
function bareHashes(value: unknown, key?: string): string[] {
  if (Array.isArray(value)) return value.flatMap(item => bareHashes(item, key));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [...(k.match(HEX) ?? []), ...bareHashes(v, k)]);
  }
  if (typeof value !== "string" || (key && (PUBLIC.has(key) || key === "text"))) return [];
  if (key === "workspace_id") {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
    return bareHashes(JSON.parse(Buffer.from(padded, "base64").toString("utf8")));
  }
  return value.match(HEX) ?? [];
}

async function pageText(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const parts: string[] = [document.body.innerText];
    for (const element of Array.from(document.querySelectorAll("*"))) {
      for (const attribute of Array.from(element.attributes)) {
        if (["title", "aria-label", "alt", "placeholder", "value", "href"].includes(attribute.name) || attribute.name.startsWith("data-")) {
          parts.push(`${attribute.name}=${attribute.value}`);
        }
      }
    }
    return parts.join("\n");
  });
}

const expanded = (page: Page) => page.locator(".cons-group-expanded");
const expandedGroup = (page: Page) => page.locator(".cons-group-expanded .cons-group-title");
const take = (page: Page, value: string, field: string) =>
  expanded(page).getByRole("button", { name: new RegExp(`^Take ${value} from Annotator [AB] for ${field}$`, "i") });

test("a blinded consolidator reads no annotator identity and no recomputable hash, and consolidates", async ({ page }) => {
  const response = await page.request.post("/__test_consolidation__", { params: { started: "true", blind: "true" }, timeout: 120_000 });
  expect(response.ok(), await response.text()).toBeTruthy();
  const s = await response.json() as BlindScenario;
  const secrets = ["ann-0001", "ann-0002"].flatMap(name => [s.users[name], s.pseudonyms[name]]);
  const leaks: string[] = [];
  page.on("response", async answer => {
    if (!new URL(answer.url()).pathname.startsWith("/api/")) return;
    let body: string;
    try { body = await answer.text(); } catch { return; }
    for (const secret of secrets) if (body.includes(secret)) leaks.push(`${answer.url()}: ${secret}`);
    if (!(answer.headers()["content-type"] ?? "").startsWith("application/json")) return;
    for (const hash of bareHashes(JSON.parse(body))) leaks.push(`${answer.url()}: hash ${hash}`);
  });
  await loginExisting(page, s.users.adj);
  await page.goto(`/#/tasks/${s.assignment_id}`);
  await expect(page.getByRole("heading", { level: 1, name: /^Consolidate / })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".cons-hidden-names")).toBeVisible();
  await expect(expanded(page).locator("thead th")).toHaveText(["Annotator A", "Annotator B"]);
  let text = await pageText(page);
  expect(secrets.filter(secret => text.includes(secret))).toEqual([]);

  // The full editor opens on the opaque ids and names the authors by letter.
  await page.getByRole("button", { name: "Open in full editor", exact: true }).click();
  await expect(page.getByText(/^Selected submitted findings \([1-9]\d*\)$/)).toBeVisible({ timeout: 30_000 });
  text = await pageText(page);
  expect(secrets.filter(secret => text.includes(secret))).toEqual([]);
  await page.locator("[data-consolidation-back]").click();
  await expect(expandedGroup(page)).toHaveText("muscular hypotonia", { timeout: 30_000 });

  // Every open group resolves and the consolidation submits on the opaque ids.
  await take(page, "absent", "Assertion").click();
  await expanded(page).getByRole("button", { name: "Keep", exact: true }).click();
  await expect(expandedGroup(page)).toHaveText("Absent reflexes");
  await expanded(page).getByRole("button", { name: "Keep", exact: true }).click();
  await expect(expandedGroup(page)).toHaveText("Reduced hearing");
  await page.getByRole("button", { name: /^Keep Annotator [AB]'s finding$/ }).click();
  await expect(expandedGroup(page)).toHaveText("Prolonged seizure activity");
  await take(page, "Status epilepticus", "Term").click();
  await take(page, "present", "Assertion").click();
  await expanded(page).getByRole("button", { name: "Keep", exact: true }).click();
  await expect(expandedGroup(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Submit consolidation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Submit consolidation?" });
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Consolidation submitted. The lead then accepts the result.", { exact: true })).toBeVisible();
  text = await pageText(page);
  expect(secrets.filter(secret => text.includes(secret))).toEqual([]);
  expect(leaks).toEqual([]);
});
