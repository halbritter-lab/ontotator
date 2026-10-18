import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatedRequest, importPackage, loginExisting, openCase, selectText, submitCase } from "./helpers";

test("one confirmation submits a two-layer negative finding", async ({ page }) => {
  await importPackage(page, "multi_editable", "pkg-scenario-c", "decision-completion");
  await openCase(page, { task: "annotate" });
  await expect(page.getByRole("button", { name: /verified/i })).toHaveCount(0);
  await submitCase(page);
});

test("defaulted warning reveals a hidden result and an explicit axis confirmation clears it", async ({ page }) => {
  await importPackage(page, "decisions", "pkg-defaulted-decisions", "defaulted-reviewer");
  await openCase(page, { task: "review" });
  const proposal = page.locator('.sidebar [data-list-key^="target:"]').first();
  await proposal.click(); await page.keyboard.press("1");
  await expect(proposal).toContainText("Confirmed");
  await page.locator('.sidebar [data-list-key^="target:"]').nth(1).click();
  await page.keyboard.press("2");
  await expect(page.locator('.sidebar [data-list-key^="target:"]').nth(1)).toContainText("Rejected");
  await page.getByRole("button", { name: /Finish & Submit Case/i }).click();
  await expect(page.getByText("1 annotations have defaulted axis values.")).toBeVisible();
  await page.getByRole("button", { name: "Review defaulted annotations" }).click();
  await expect(page.getByRole("checkbox", { name: "Visibility for Hidden findings" })).toBeChecked();
  await expect(page.getByLabel("Proposal details")).toBeFocused();
  await page.getByRole("button", { name: /Edit & Replace/i }).click();
  await page.getByRole("button", { name: "Reset decision and edit copy" }).click();
  await page.getByRole("button", { name: "Confirm Assertion value" }).click();
  await expect(page.getByText("Default value; confirm it or choose a value.")).toHaveCount(0);
  await page.getByRole("button", { name: /Finish & Submit Case/i }).click();
  await expect(page.getByRole("button", { name: "Review defaulted annotations" })).toHaveCount(0);
});

test("repeated outcome keys keep decisions and zero resets without losing the note", async ({ page }) => {
  await importPackage(page, "single", "browser-fixture", "stable-key-reviewer");
  await openCase(page, { task: "review" });
  const proposal = page.locator('.sidebar [data-list-key^="target:"]').first();
  await proposal.click();
  await page.getByRole("textbox", { name: "Reviewer note" }).fill("Initial reviewer note");
  await page.locator(".review-actions__title").click();
  for (const [key, label] of [["1", "Confirmed"], ["2", "Rejected"], ["4", "Unresolved"]]) {
    await page.keyboard.press(key); await expect(proposal).toContainText(label);
    await page.keyboard.press(key); await expect(proposal).toContainText(label);
  }
  const note = page.getByRole("textbox", { name: "Reviewer note" });
  await note.fill("Preserve this note");
  await note.press("1"); await expect(proposal).toContainText("Unresolved");
  await note.fill("Preserve this note");
  await page.locator(".review-actions__title").click();
  await page.keyboard.press("0"); await expect(proposal).toContainText("open");
  await expect(note).toHaveValue("Preserve this note");
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", isComposing: true, bubbles: true })));
  await expect(proposal).toContainText("open");
  await page.getByRole("button", { name: /Finish & Submit Case/i }).click();
  await expect(page.getByRole("dialog", { name: "Submit case" })).toBeVisible();
  await page.keyboard.press("1"); await page.keyboard.press("Escape");
  await expect(proposal).toContainText("open");
});


test("unresolved notes are required, survive reload and block submission when locally cleared", async ({ page }) => {
  await importPackage(page, "single", "pkg-unresolved-export", "unresolved-note-reviewer");
  const openedResponse = page.waitForResponse(r => /assignments\/\d+\/open$/.test(r.url()) && r.request().method() === "POST");
  await openCase(page, { task: "review" });
  const opened = await (await openedResponse).json();
  const proposals = page.locator('.sidebar [data-list-key^="target:"]');
  await proposals.first().click();
  const note = page.getByRole("textbox", { name: "Reviewer note" });
  await page.getByRole("button", { name: /Unresolved/ }).click();
  await expect(proposals.first()).toContainText("open"); await expect(note).toBeFocused();
  await expect(note).toHaveAttribute("aria-invalid", "true");
  await page.screenshot({ path: "../.superpowers/sdd/2026-10-17-phase0-priorities/b02-unresolved-note-required.png", fullPage: true });
  await page.locator(".review-actions__title").click(); await page.keyboard.press("4");
  await expect(note).toBeFocused(); await expect(proposals.first()).toContainText("open");
  await note.fill("Needs specialist review"); await page.locator(".review-actions__title").click();
  await page.keyboard.press("4"); await expect(proposals.first()).toContainText("Unresolved");
  await proposals.nth(1).click(); await page.keyboard.press("1");
  await expect(proposals.nth(1)).toContainText("Confirmed");
  await proposals.first().click(); await note.fill("  "); await proposals.nth(1).click();
  await page.getByRole("button", { name: /Finish & Submit Case/ }).click();
  await expect(page.getByRole("dialog", { name: "Submit case" })).toHaveCount(0);
  await expect(note).toBeFocused(); await expect(note).toHaveValue("  ");
  await expect(page.locator(".status-badge")).toHaveText("Reviewer note required – changes not saved");
  await page.getByRole("button", { name: "← My tasks" }).click();
  await expect(page.getByRole("dialog", { name: "Changes not saved" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(note).toBeFocused(); await expect(note).toHaveValue("  ");
  const savedNote = page.waitForResponse(r => r.url().endsWith("/decisions") && r.request().method() === "POST");
  await note.fill("Corrected reviewer reason"); await page.locator(".review-actions__title").click();
  const savedResponse = await savedNote; expect(savedResponse.ok()).toBeTruthy();
  const saved = await savedResponse.json();
  const unresolved = saved.decisions.find((d: { outcome: string }) => d.outcome === "uncertain");
  const bypass = await authenticatedRequest(page, new URL(savedResponse.url()).pathname, "POST", {
    mutation_id: "blank-note-bypass", expected_revision: saved.revision,
    payload: { target: unresolved.target, outcome: "uncertain", note: " " },
  });
  expect(bypass.status()).toBe(422); expect((await bypass.json()).code).toBe("REVIEW_NOTE_REQUIRED");
  await page.reload(); await proposals.first().click();
  await expect(note).toHaveValue("Corrected reviewer reason"); await expect(proposals.first()).toContainText("Unresolved");
  const submitted = page.waitForResponse(r => r.url().endsWith("/submit") && r.request().method() === "POST");
  await submitCase(page);
  const submission = await (await submitted).json();
  expect(submission.decisions.find((d: { outcome: string }) => d.outcome === "uncertain").note).toBe("Corrected reviewer reason");
  expect(submission.snapshots).toHaveLength(2);
  const source = opened.view.available_inputs.find((snapshot: { annotation: { annotation_id: string }; version: string }) =>
    snapshot.annotation.annotation_id === unresolved.target.annotation_id && snapshot.version === unresolved.target.version);
  expect(source).toBeDefined();
  const originalAssertion = source.annotation.axes_values.assertion;
  expect(originalAssertion).toBe("present");
  await page.getByRole("button", { name: "Stay in case" }).click();
  await page.goto("/#/projects/pkg-unresolved-export/export");
  const bundle = page.getByRole("region", { name: "Annotation results", exact: true });
  await bundle.getByRole("button", { name: "Create export", exact: true }).click();
  await expect(bundle.getByRole("button", { name: "Download", exact: true })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), bundle.getByRole("button", { name: "Download", exact: true }).click()]);
  expect(await download.failure()).toBeNull();
  const python = process.env.E2E_PYTHON ?? (process.platform === "win32" ? "../.venv/Scripts/python.exe" : "../.venv/bin/python");
  const annotations = JSON.parse(execFileSync(python, ["-c", `import json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as bundle:
    units=[json.loads(bundle.read(name)) for name in bundle.namelist() if name.endswith('.json')]
def annotations(value):
    if isinstance(value,dict):
        if 'review_resolution' in value and value['review_resolution']:
            yield value
        else:
            for child in value.values(): yield from annotations(child)
    elif isinstance(value,list):
        for child in value: yield from annotations(child)
print(json.dumps(list(annotations(units))))`, (await download.path())!], { encoding: "utf8" }));
  const flagged = annotations.filter((annotation: { annotation_id: string }) => annotation.annotation_id === unresolved.target.annotation_id);
  expect(flagged).toHaveLength(1);
  expect(flagged[0].provenance.source_refs).toContain(`urn:ontospan:${encodeURIComponent("pkg-unresolved-export:proposals")}:${encodeURIComponent(unresolved.target.annotation_id)}`);
  expect(flagged[0].review_resolution.outcome).toBe("uncertain");
  expect(flagged[0].review_resolution.note).toBe("Corrected reviewer reason");
  expect(flagged[0].review_resolution.reviewer).toMatchObject({ actor_id: "unresolved-note-reviewer", kind: "human" });
  expect(flagged[0].axes.assertion.value).toBe(originalAssertion);
});


test("new-draft spanless findings require a reason, retain it through search and reload, and protect the last mention", async ({ page }) => {
  await importPackage(page, "single", "browser-fixture", "spanless-reason-curator");
  const openedResponse = page.waitForResponse(r => /assignments\/\d+\/open$/.test(r.url()) && r.request().method() === "POST");
  await openCase(page);
  const opened = await (await openedResponse).json();
  expect(opened.view.enforce_spanless_rules).toBe(true);
  const commands = `/api/v1/workspaces/${encodeURIComponent(opened.workspace_id)}/commands`;
  const bypass = await authenticatedRequest(page, commands, "POST", { mutation_id: "bypass-spanless-reason", expected_revision: 0, payload: {
    command: "create_annotation", annotation_id: "bypass-spanless", layer_id: "hpo-layer", type_id: "phenotype", term_id: "HP:0001252", segments: [], axes_values: {},
  } });
  expect(bypass.status()).toBe(422);
  const bypassError = await bypass.json(); expect(bypassError.code).toBe("PROJECT_RULE_VIOLATION");
  expect(bypassError.details.violations[0].rule).toBe("spanless_note_required");
  await page.getByRole("button", { name: "Add finding without a text span" }).click();
  const reason = page.getByLabel("Reason for no text span");
  await page.getByLabel(/Search ontology term/).fill("Hypotonia");
  const candidate = page.locator(".candidate-card").filter({ hasText: "HP:0001252" });
  await candidate.click();
  await expect(reason).toBeFocused(); await expect(reason).toHaveAttribute("aria-invalid", "true");
  await reason.fill("Finding recorded in the clinical summary");
  await page.route("**/search", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "SEARCH_UNAVAILABLE", message: "Search temporarily unavailable" }) }), { times: 1 });
  const failedSearch = page.waitForResponse(r => r.url().endsWith("/search") && r.status() === 503);
  await page.getByLabel(/Search ontology term/).fill("another query");
  await failedSearch;
  await expect(reason).toHaveValue("Finding recorded in the clinical summary");
  await page.getByLabel(/Search ontology term/).fill("Hypotonia");
  const savedResponse = page.waitForResponse(r => r.url().endsWith("/commands") && r.request().method() === "POST" && r.request().postDataJSON().payload.command === "create_annotation");
  await candidate.click();
  const saved = await (await savedResponse).json();
  expect(saved.annotations[0].annotation.note).toBe("Finding recorded in the clinical summary");
  await expect(page.locator(".status-badge")).toHaveText("Saved");
  await page.reload(); await page.locator('.sidebar [data-list-key^="annotation:"]').first().click();
  await expect(page.getByLabel("Reason for no text span")).toHaveValue("Finding recorded in the clinical summary");
  await page.getByRole("button", { name: "+ Add Mention", exact: true }).click();
  await selectText(page, 0, 9);
  await expect(page.getByRole("heading", { name: "Mentions (1)" })).toBeVisible();
  await page.getByLabel("Annotation note").fill("");
  const clearedNote = page.waitForResponse(r => r.url().endsWith("/commands") && r.request().postDataJSON().payload.command === "set_annotation_note");
  await page.getByRole("heading", { name: "Mentions (1)" }).click();
  expect((await clearedNote).ok()).toBeTruthy();
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toBeDisabled();
  await page.getByLabel("Annotation note").fill("Evidence span is incidental; summary supports this finding");
  const justifiedNote = page.waitForResponse(r => r.url().endsWith("/commands") && r.request().postDataJSON().payload.command === "set_annotation_note");
  await page.getByRole("heading", { name: "Mentions (1)" }).click();
  expect((await justifiedNote).ok()).toBeTruthy();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Yes, remove", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mentions (0)" })).toBeVisible();
  await expect(page.getByLabel("Reason for no text span")).toHaveValue("Evidence span is incidental; summary supports this finding");
  await page.getByLabel("Reason for no text span").fill("  ");
  await page.getByRole("button", { name: /Finish & Submit Case/ }).click();
  await expect(page.getByRole("dialog", { name: "Submit case" })).toHaveCount(0);
  await expect(page.getByLabel("Reason for no text span")).toHaveValue("  ");
});

test("a lead persists the project spanless rule and new drafts explain the prohibition", async ({ page }) => {
  await importPackage(page, "single", "browser-fixture", "spanless-settings-lead");
  await page.goto("/#/projects/browser-fixture/settings");
  const mode = page.getByRole("combobox", { name: "Findings without a text span" });
  await mode.selectOption("prohibited"); await page.getByRole("button", { name: "Save rules" }).click();
  await expect(page.getByText("Rules saved.")).toBeVisible(); await page.reload(); await expect(mode).toHaveValue("prohibited");
  await page.goto("/#/?project=browser-fixture"); await openCase(page);
  await expect(page.getByRole("button", { name: "Add finding without a text span" })).toBeDisabled();
  await expect(page.getByText("This project requires a text span for findings.")).toBeVisible();
  const restored = await authenticatedRequest(page, "/api/v1/projects/browser-fixture/settings", "PATCH", { allow_spanless_findings: true });
  expect(restored.ok()).toBeTruthy();
});


test("repairing a historical spanless proposal collects a clinical reason without changing its source", async ({ page }) => {
  await importPackage(page, "spanless", "pkg-spanless-decisions", "spanless-source-repair");
  const openedResponse = page.waitForResponse(r => /assignments\/\d+\/open$/.test(r.url()) && r.request().method() === "POST");
  await openCase(page, { task: "review" });
  const opened = await (await openedResponse).json();
  const source = opened.view.available_inputs.find((item: { annotation: { evidence_refs: unknown[] } }) => !item.annotation.evidence_refs?.length);
  const sourceBefore = JSON.stringify(source);
  const proposals = page.locator('.sidebar [data-list-key^="target:"]');
  await proposals.first().click(); await page.keyboard.press("2"); await expect(proposals.first()).toContainText("Rejected");
  await page.getByRole("button", { name: /Edit & Replace/ }).click();
  const dialog = page.getByRole("dialog", { name: "Reason for no text span" });
  await dialog.getByLabel("Reason for no text span").fill("Specialist summary supports this finding");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(proposals.first()).toContainText("Rejected");
  await page.getByRole("button", { name: /Edit & Replace/ }).click();
  await expect(dialog.getByLabel("Reason for no text span")).toHaveValue("Specialist summary supports this finding");
  const copied = page.waitForResponse(r => r.url().endsWith("/commands") && r.request().postDataJSON().payload.command === "create_annotation");
  await dialog.getByRole("button", { name: "Create editable copy" }).click();
  await page.getByRole("button", { name: "Reset decision and edit copy" }).click();
  await expect(page.getByLabel("Reason for no text span")).toHaveValue("Specialist summary supports this finding");
  await expect(proposals.first()).toContainText("open");
  const draft = await (await copied).json();
  const replacement = draft.annotations[0];
  const premature = await authenticatedRequest(page, `/api/v1/workspaces/${encodeURIComponent(opened.workspace_id)}/decisions`, "POST", {
    mutation_id: "premature-required-evidence-approval", expected_revision: draft.revision, payload: { target: { annotation_id: source.annotation.annotation_id, version: source.version }, outcome: "changed",
      replacement: { annotation_id: replacement.annotation.annotation_id, version: replacement.version } },
  });
  expect(premature.status()).toBe(422); expect((await premature.json()).code).toBe("MISSING_EVIDENCE");
  await page.getByRole("button", { name: "+ Add Mention", exact: true }).click(); await selectText(page, 0, 9);
  await expect(proposals.first()).toContainText("Replaced");
  await expect(page.getByLabel("Annotation note")).toHaveValue("Specialist summary supports this finding");
  await proposals.nth(1).click(); await page.keyboard.press("2"); await expect(proposals.nth(1)).toContainText("Rejected");
  const submitted = page.waitForResponse(r => r.url().endsWith("/submit") && r.request().method() === "POST");
  await submitCase(page);
  const submission = await (await submitted).json();
  expect(submission.snapshots).toHaveLength(1);
  expect(submission.snapshots[0].annotation.note).toBe("Specialist summary supports this finding");
  expect(submission.decisions.find((d: { outcome: string }) => d.outcome === "changed").replacement.version).toBe(submission.snapshots[0].version);
  const reopened = await authenticatedRequest(page, `/api/v1/assignments/${opened.assignment.id}/open`, "POST");
  const after = await reopened.json();
  expect(JSON.stringify(after.view.available_inputs.find((item: { version: string }) => item.version === source.version))).toBe(sourceBefore);
});


test("a project prohibiting spanless findings repairs a source only after supporting text is selected", async ({ page }) => {
  await importPackage(page, "spanless", "pkg-spanless-decisions", "spanless-prohibited-repair");
  const disabled = await authenticatedRequest(page, "/api/v1/projects/pkg-spanless-decisions/settings", "PATCH", { allow_spanless_findings: false });
  expect(disabled.ok()).toBeTruthy();
  const openedResponse = page.waitForResponse(r => /assignments\/\d+\/open$/.test(r.url()) && r.request().method() === "POST");
  await openCase(page, { task: "review" });
  const opened = await (await openedResponse).json();
  const source = opened.view.available_inputs.find((item: { annotation: { evidence_refs: unknown[] } }) => !item.annotation.evidence_refs?.length);
  const sourceBefore = JSON.stringify(source);
  const proposals = page.locator('.sidebar [data-list-key^="target:"]');
  await proposals.first().click(); await page.keyboard.press("2"); await expect(proposals.first()).toContainText("Rejected");
  const creates: unknown[] = [];
  page.on("request", request => { if (request.url().endsWith("/commands") && request.postDataJSON()?.payload?.command === "create_annotation") creates.push(request.postDataJSON()); });
  await page.getByRole("button", { name: /Edit & Replace/ }).click();
  await expect(page.getByText("Select supporting text to create an editable copy of this proposal. The current decision is kept until you confirm the replacement.")).toBeVisible();
  expect(creates).toHaveLength(0);
  await page.getByRole("button", { name: "Cancel (Esc)" }).click();
  await expect(proposals.first()).toContainText("Rejected"); expect(creates).toHaveLength(0);
  await page.getByRole("button", { name: /Edit & Replace/ }).click();
  await proposals.nth(1).click();
  await expect(page.getByRole("button", { name: "Cancel (Esc)" })).toHaveCount(0);
  await proposals.first().click(); await page.getByRole("button", { name: /Edit & Replace/ }).click();
  const copied = page.waitForResponse(r => r.url().endsWith("/commands") && r.request().postDataJSON().payload.command === "create_annotation");
  await selectText(page, 0, 9);
  await expect(page.getByRole("button", { name: "Reset decision and edit copy" })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(proposals.first()).toContainText("Rejected"); expect(creates).toHaveLength(0);
  await selectText(page, 0, 9); await page.getByRole("button", { name: "Reset decision and edit copy" }).click();
  const copyResponse = await copied; expect(copyResponse.ok()).toBeTruthy();
  const copy = (await copyResponse.json()).annotations[0];
  expect(creates).toHaveLength(1);
  expect((creates[0] as { payload: { segments: unknown[] } }).payload.segments).toEqual([{ start: 0, end: 9 }]);
  expect(copy.annotation.note).toBeUndefined(); expect(copy.annotation.evidence_refs).toHaveLength(1);
  await expect(proposals.first()).toContainText("Replaced");
  await proposals.nth(1).click(); await page.keyboard.press("2"); await expect(proposals.nth(1)).toContainText("Rejected");
  await submitCase(page);
  const reopened = await authenticatedRequest(page, `/api/v1/assignments/${opened.assignment.id}/open`, "POST");
  expect(JSON.stringify((await reopened.json()).view.available_inputs.find((item: { version: string }) => item.version === source.version))).toBe(sourceBefore);
  const restored = await authenticatedRequest(page, "/api/v1/projects/pkg-spanless-decisions/settings", "PATCH", { allow_spanless_findings: true });
  expect(restored.ok()).toBeTruthy();
});


test("a lead enables optional reasons and an annotator creates, clears and submits a note-less finding", async ({ page, browser }) => {
  await importPackage(page, "single", "browser-fixture", "optional-spanless-lead");
  await page.goto("/#/projects/browser-fixture/settings");
  const mode = page.getByRole("combobox", { name: "Findings without a text span" });
  await mode.selectOption("optional"); await page.getByRole("button", { name: "Save rules" }).click();
  await expect(page.getByText("Rules saved.")).toBeVisible(); await page.reload(); await expect(mode).toHaveValue("optional");
  await page.getByRole("form", { name: "Rules" }).screenshot({ path: "../.superpowers/sdd/2026-10-17-phase0-priorities/spanless-modes-project-rules.png" });
  const provisioned = await page.request.post("/__test_user__?username=optional-spanless-annotator&pseudonym=optional-spanless-annotator&projects=browser-fixture");
  expect(provisioned.ok()).toBeTruthy();
  const restricted = await authenticatedRequest(page, "/api/v1/projects/browser-fixture/members/optional-spanless-annotator", "PUT", { roles: ["annotator"], revoke_assignments: true });
  expect(restricted.ok()).toBeTruthy(); expect((await restricted.json()).roles).toEqual(["annotator"]);
  const annotatorContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const annotator = await annotatorContext.newPage();
    await loginExisting(annotator, "optional-spanless-annotator");
    const openedResponse = annotator.waitForResponse(r => /assignments\/\d+\/open$/.test(r.url()) && r.request().method() === "POST");
    await openCase(annotator, { projectKey: "browser-fixture" });
    const opened = await (await openedResponse).json();
    expect(opened.view.enforce_spanless_rules).toBe(true); expect(opened.view.require_spanless_note).toBe(false);
    await annotator.getByRole("button", { name: "Add finding without a text span" }).click();
    await expect(annotator.getByLabel("Reason for no text span")).not.toHaveAttribute("required", "");
    await annotator.getByLabel(/Search ontology term/).fill("Hypotonia");
    const createdResponse = annotator.waitForResponse(r => r.url().endsWith("/commands") && r.request().postDataJSON().payload.command === "create_annotation");
    await annotator.locator(".candidate-card").filter({ hasText: "HP:0001252" }).click();
    const created = await (await createdResponse).json(); expect(created.annotations[0].annotation.note).toBeUndefined();
    const note = annotator.getByLabel("Annotation note");
    await note.fill("Optional clinical context");
    const notedResponse = annotator.waitForResponse(r => r.url().endsWith("/commands") && r.request().postDataJSON().payload.command === "set_annotation_note");
    await annotator.getByRole("heading", { name: "Mentions (0)" }).click();
    const noted = await (await notedResponse).json(); expect(noted.annotations[0].annotation.note).toBe("Optional clinical context");
    expect(noted.annotations[0].version).not.toBe(created.annotations[0].version);
    await note.fill("");
    const clearedResponse = annotator.waitForResponse(r => r.url().endsWith("/commands") && r.request().postDataJSON().payload.command === "set_annotation_note");
    await annotator.getByRole("heading", { name: "Mentions (0)" }).click();
    const cleared = await (await clearedResponse).json(); expect(cleared.annotations[0].annotation.note).toBeUndefined();
    await annotator.getByRole("button", { name: "+ Add Mention", exact: true }).click(); await selectText(annotator, 0, 9);
    await expect(annotator.getByRole("heading", { name: "Mentions (1)" })).toBeVisible();
    await expect(annotator.getByRole("button", { name: "Remove", exact: true })).toBeEnabled();
    await annotator.getByRole("button", { name: "Remove", exact: true }).click(); await annotator.getByRole("button", { name: "Yes, remove" }).click();
    await expect(annotator.getByRole("heading", { name: "Mentions (0)" })).toBeVisible();
    const prohibited = await authenticatedRequest(page, "/api/v1/projects/browser-fixture/settings", "PATCH", { allow_spanless_findings: false });
    expect(prohibited.ok()).toBeTruthy();
    await annotator.reload();
    await annotator.getByRole("button", { name: /Finish & Submit Case/ }).click();
    const readiness = annotator.getByRole("dialog", { name: "Submit case" });
    await expect(readiness.getByText("1 finding(s) need evidence or a reason before submission.")).toBeVisible();
    await readiness.screenshot({ path: "../.superpowers/sdd/2026-10-17-phase0-priorities/submission-current-rules-repair.png" });
    await readiness.getByRole("button", { name: /This project requires a text span for findings/ }).click();
    await expect(annotator.getByLabel("Annotation note")).toBeFocused();
    const optionalAgain = await authenticatedRequest(page, "/api/v1/projects/browser-fixture/settings", "PATCH", { allow_spanless_findings: true, require_spanless_note: false });
    expect(optionalAgain.ok()).toBeTruthy();
    await annotator.reload();
    const submittedResponse = annotator.waitForResponse(r => r.url().endsWith("/submit") && r.request().method() === "POST");
    await submitCase(annotator);
    const submitted = await (await submittedResponse).json(); expect(submitted.snapshots).toHaveLength(1);
    expect(submitted.snapshots[0].annotation.note).toBeUndefined(); expect(submitted.snapshots[0].annotation.evidence_refs).toEqual([]);
  } finally {
    await annotatorContext.close();
    const restored = await authenticatedRequest(page, "/api/v1/projects/browser-fixture/settings", "PATCH", { allow_spanless_findings: true, require_spanless_note: true });
    expect(restored.ok()).toBeTruthy();
  }
});
