import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiClient, ApiError, type AdminUser, type ImportPlan, type ProjectDocumentSummary, type VariantSummary, type UploadView } from "../src/api/client";
import { parseRoute, routeHref } from "../src/app/router";
import { DocumentsPage } from "../src/admin/DocumentsPage";
import { ExportPage } from "../src/admin/ExportPage";
import { ProjectSettingsPage } from "../src/admin/ProjectSettingsPage";
import { UploadPreview } from "../src/admin/UploadPreview";
import { UsersPage } from "../src/admin/UsersPage";
import { UploadPanel } from "../src/admin/UploadPanel";
import { AssignDialog } from "../src/admin/AssignDialog";
import { DistributionDialog } from "../src/admin/DistributionDialog";
import { reviewLanguages } from "../src/admin/variantMetadata";
import * as downloads from "../src/api/download";
import { currentUser, ontologies, settings } from "./projectFixtures";
import { documents, members, assignment, deferred } from "./assignmentFixtures";

const target: ProjectDocumentSummary = { ...documents[0], origin: "machine_translation", translation_status: "accepted", accepted_without_review: true, status_reason: "translation review 123" };
beforeEach(() => {
  vi.spyOn(api, "listProjectDocuments").mockResolvedValue([target]);
  vi.spyOn(api, "getProjectSettings").mockResolvedValue({ ...settings, annotate_accepted_translations_only: false });
  vi.spyOn(api, "listAssignments").mockResolvedValue([]);
  vi.spyOn(api, "listMembers").mockResolvedValue([]);
  vi.spyOn(api, "listCases").mockResolvedValue([]);
  vi.spyOn(api, "listOntologies").mockResolvedValue(ontologies);
  vi.spyOn(api, "listUploads").mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });

it("roundtrips independent opaque origin/translation-status filters alongside assignment status", () => {
  const route = { name: "projectDocuments" as const, key: "p/ß", origin: "machine_translation", translation_status: "accepted", status: "submitted", q: "x +/", select: "opaque/id" };
  expect(parseRoute(routeHref(route))).toEqual(route);
});

it("sends actual override tuples while preserving the legacy omitted body and transport", async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  const client = new ApiClient(); client.setCsrfToken("csrf");
  const overrides = [{ external_id: "external:/ß", language: "de", version: 3, reason: "  Explicit reason  " }];
  await client.commitUpload("p/key", 7, "actual-plan", overrides);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ plan_sha256: "actual-plan", status_overrides: overrides });
  expect(fetch.mock.calls[0][1].headers.get("X-CSRF-Token")).toBe("csrf");
  expect(fetch.mock.calls[0][1].credentials).toBe("same-origin");
  await client.commitUpload("p/key", 7, "actual-plan");
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ plan_sha256: "actual-plan" });
});

it("uses the server-owned override label and actual controlled filters without remounting the prefix", async () => {
  const navigate = vi.fn();
  const view = render(<DocumentsPage projectKey="p" query={{ origin: "machine_translation", translation_status: "accepted" }} onNavigate={navigate} />);
  const badge = await screen.findByText("Accepted without review");
  expect(badge.getAttribute("title")).toBe("translation review 123");
  expect(api.listProjectDocuments).toHaveBeenCalledWith("p", expect.objectContaining({ origin: "machine_translation", translation_status: "accepted" }));
  const prefix = screen.getByLabelText("ID prefix"); prefix.focus();
  fireEvent.change(prefix, { target: { value: "abc" } });
  expect(navigate).toHaveBeenLastCalledWith(expect.objectContaining({ origin: "machine_translation", translation_status: "accepted", q: "abc" }));
  view.rerender(<DocumentsPage projectKey="p" query={{ q: "abc", origin: "machine_translation", translation_status: "accepted" }} onNavigate={navigate} />);
  await screen.findByRole("link", { name: `View case for ${target.document_id}` });
  expect(screen.getByLabelText("ID prefix")).toBe(prefix);
  expect(document.activeElement).toBe(prefix);
  expect(api.getProjectSettings).toHaveBeenCalledTimes(1);
  expect(api.listCases).toHaveBeenCalledTimes(1);
});

const readyTarget: ProjectDocumentSummary = { ...target, language: "de", translation_status: "ready_for_review", accepted_without_review: false };
const source: VariantSummary = { document_id: "actual-source", external_id: "source", case_id: target.case_id, language: "en", version: 1, origin: "native", derived_from: null, translation: null, translation_status: null, status_reason: null, text_sha256: "a".repeat(64), assigned_to_me: false };
const translated: VariantSummary = { ...source, document_id: readyTarget.document_id, external_id: readyTarget.external_id, language: "de", origin: "machine_translation", derived_from: source.document_id, translation: { provider: "recorded-provider" }, translation_status: "ready_for_review" };
const inventory = [{ case_id: target.case_id, variants: [source, translated] }];

it("resolves exact correction ancestry without guessing source language or newest sibling", () => {
  const correction: VariantSummary = { ...translated, document_id: "corrected", version: 2, origin: "correction", translation: null, derived_from: translated.document_id };
  const decoy = { ...source, document_id: "new-source", language: "fr", version: 9 };
  const map = new Map([source, translated, correction, decoy].map(row => [row.document_id, row]));
  expect(reviewLanguages(correction.document_id, map)).toEqual(["en", "de"]);
  map.set(translated.document_id, { ...translated, derived_from: "missing" });
  expect(reviewLanguages(correction.document_id, map)).toBeNull();
  map.set(translated.document_id, { ...translated, origin: "native", translation: null });
  expect(reviewLanguages(correction.document_id, map)).toBeNull();
});

it("uses annotator membership for translation review, both languages and only failed-row retry", async () => {
  vi.mocked(api.listMembers).mockResolvedValue(members);
  vi.mocked(api.listCases).mockResolvedValue(inventory);
  vi.spyOn(api, "createAssignments").mockResolvedValueOnce({ created: [{ ...assignment, username: "bob", task: "translation_review" }], refused: [{ document_id: readyTarget.document_id, username: "alice", code: "LANGUAGE_CONFIRMATION_REQUIRED" }] }).mockResolvedValueOnce({ created: [{ ...assignment, username: "alice", task: "translation_review" }], refused: [] });
  render(<AssignDialog projectKey="p" documents={[readyTarget]} onClose={vi.fn()} onChanged={vi.fn()} />);
  await waitFor(() => expect((screen.getByRole("option", { name: "Translation review" }) as HTMLOptionElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("Task"), { target: { value: "translation_review" } });
  fireEvent.click(screen.getByLabelText(/^Alice \(alice\)/)); fireEvent.click(screen.getByLabelText(/^Bob \(bob\)/));
  expect(screen.getByText(/not listed in this profile: de/)).toBeTruthy();
  expect(screen.queryByLabelText(/^Lead \(lead\)/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  const confirmation = await screen.findByRole("region", { name: "Confirm document languages" });
  expect(confirmation.textContent).toContain("en, de");
  fireEvent.click(within(confirmation).getByRole("button", { name: "Assign anyway" }));
  await waitFor(() => expect(api.createAssignments).toHaveBeenCalledTimes(2));
  expect(api.createAssignments).toHaveBeenLastCalledWith("p", { task: "translation_review", confirm_language: true, rows: [{ document_id: readyTarget.document_id, username: "alice" }] });
  expect(api.listCases).toHaveBeenCalledTimes(1);
});

it("disables translation review for native corrections and accepted current rows", async () => {
  const nativeCorrection = { ...translated, origin: "correction" as const, version: 2, derived_from: source.document_id, translation: null };
  const view = render(<AssignDialog projectKey="p" documents={[readyTarget]} cases={[{ case_id: target.case_id, variants: [source, nativeCorrection] }]} onClose={vi.fn()} onChanged={vi.fn()} />);
  expect(screen.queryByRole("option", { name: "Translation review" })).toBeNull();
  view.rerender(<AssignDialog projectKey="p" documents={[target]} cases={inventory} onClose={vi.fn()} onChanged={vi.fn()} />);
  await act(async () => {});
  expect(screen.queryByRole("option", { name: "Translation review" })).toBeNull();
});

it("keeps translation distribution context exact through partial language retry", async () => {
  vi.mocked(api.listMembers).mockResolvedValue(members);
  const context = { document_ids: [readyTarget.document_id], task: "translation_review" as const, per_document: 2, seed: 42, state_sha256: "exact-state" };
  vi.spyOn(api, "proposeDistribution").mockResolvedValue({ rows: [{ document_id: readyTarget.document_id, language: "de", username: "alice", display_name: "Alice", load_before: 4 }, { document_id: readyTarget.document_id, language: "de", username: "bob", display_name: "Bob", load_before: 2 }], unassignable: [], seed: 42, per_document: 2, context });
  vi.spyOn(api, "createAssignments").mockResolvedValueOnce({ created: [{ ...assignment, username: "bob" }], refused: [{ document_id: readyTarget.document_id, username: "alice", code: "LANGUAGE_CONFIRMATION_REQUIRED" }] }).mockResolvedValueOnce({ created: [{ ...assignment, username: "alice" }], refused: [] });
  render(<DistributionDialog projectKey="p" documents={[readyTarget]} cases={inventory} onClose={vi.fn()} onChanged={vi.fn()} />);
  await screen.findByRole("option", { name: "Translation review" });
  fireEvent.change(screen.getByLabelText("Task"), { target: { value: "translation_review" } });
  fireEvent.change(screen.getByLabelText(/^People per document/), { target: { value: "2" } });
  await waitFor(() => expect((screen.getByRole("button", { name: "Propose" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Propose" }));
  await screen.findByRole("table", { name: "Proposed assignments" });
  expect(screen.getAllByText("en, de")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  fireEvent.click(await screen.findByRole("button", { name: "Assign anyway" }));
  await waitFor(() => expect(api.createAssignments).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.createAssignments).mock.calls[0][1].context).toBe(context);
  expect(vi.mocked(api.createAssignments).mock.calls[1][1]).toEqual({ task: "translation_review", seed: 42, context, confirm_language: true, rows: [{ document_id: readyTarget.document_id, username: "alice" }] });
});

const overridePlan: ImportPlan = { documents: [], duplicates: [], collisions: [], proposal_sets: [], documents_only: [], errors: [], warnings: [], normalised_count: 0, counts: {}, input_sha256: "input", state_sha256: "state", plan_sha256: "real-plan", committable: true, variants: [{ document_id: "internal", external_id: "external:/ß", case_id: "case", language: "de", version: 3, origin: "correction", derived_from: "previous", derived_in_upload: false, translation: null, status: "ready_for_review", failed_checks: [] }] };
const retained: UploadView = { id: 7, kind: "t1", language: null, files: [], status: "ready", preview: overridePlan, plan_sha256: "real-plan", commit_job_id: null, preview_job_id: null, created_at: "2026-10-16T00:00:00Z" };

it("requires an explicit per-variant reason and retains exact override after a recoverable refusal", async () => {
  vi.mocked(api.listUploads).mockResolvedValue([retained]);
  vi.spyOn(api, "getUpload").mockResolvedValue(retained);
  vi.spyOn(api, "commitUpload").mockRejectedValue(new ApiError(422, "Use a different reason", "OVERRIDE_REASON_REQUIRED"));
  render(<UploadPanel projectKey="p" languages={["de"]} canOverrideTranslationStatus onImported={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume upload 7" }));
  const accept = await screen.findByLabelText(/^Accept without review:/);
  fireEvent.click(accept);
  expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true);
  const reason = screen.getByLabelText(/^Reason:.*required/);
  fireEvent.change(reason, { target: { value: "   " } });
  expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(reason, { target: { value: "  Explicit reason  " } });
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  await waitFor(() => expect(api.commitUpload).toHaveBeenCalledWith("p", 7, "real-plan", [{ external_id: "external:/ß", language: "de", version: 3, reason: "  Explicit reason  " }]));
  await screen.findByRole("alert");
  expect((reason as HTMLInputElement).value).toBe("  Explicit reason  ");
  expect((accept as HTMLInputElement).checked).toBe(true);
});

it("defaults to no override controls and drops them on capability loss", async () => {
  vi.mocked(api.listUploads).mockResolvedValue([retained]);
  vi.spyOn(api, "getUpload").mockResolvedValue(retained);
  const view = render(<UploadPanel projectKey="p" languages={["de"]} onImported={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume upload 7" }));
  await screen.findByRole("table", { name: "Variants" });
  expect(screen.queryByLabelText(/^Accept without review:/)).toBeNull();
  view.rerender(<UploadPanel projectKey="p" languages={["de"]} canOverrideTranslationStatus onImported={vi.fn()} />);
  fireEvent.click(screen.getByLabelText(/^Accept without review:/));
  view.rerender(<UploadPanel projectKey="p" languages={["de"]} canOverrideTranslationStatus={false} onImported={vi.fn()} />);
  expect(screen.queryByLabelText(/^Reason:/)).toBeNull();
});

it("reads immutable review history for the actual internal ID and discards superseded replies", async () => {
  const old = deferred<Awaited<ReturnType<typeof api.listTranslationReviews>>>();
  vi.spyOn(api, "listTranslationReviews").mockReturnValue(old.promise);
  const view = render(<DocumentsPage projectKey="p" query={{}} onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: `Reviews for ${target.document_id}` }));
  expect(api.listTranslationReviews).toHaveBeenCalledWith("p", target.document_id);
  view.rerender(<DocumentsPage projectKey="other" query={{}} onNavigate={vi.fn()} />);
  await act(async () => old.resolve([{ reviewer_pseudonym: "Must not appear" } as never]));
  expect(screen.queryByText("Must not appear")).toBeNull();
});

it("does not infer manual acceptance from a descriptive reason", async () => {
  vi.mocked(api.listProjectDocuments).mockResolvedValue([{ ...target, accepted_without_review: false, status_reason: "Manual approval" }]);
  render(<DocumentsPage projectKey="p" query={{}} onNavigate={vi.fn()} />);
  const table = within(await screen.findByRole("table", { name: "Documents" }));
  await waitFor(() => expect(table.getByText("Accepted", { selector: "span" })).toBeTruthy());
  expect(table.queryByText("Accepted without review")).toBeNull();
});

it("shows ordered readonly reviewer snapshots, rationale and created variant", async () => {
  vi.spyOn(api, "listTranslationReviews").mockResolvedValue([{
    id: 7, project_id: 1, document_id: target.document_id, assignment_id: 3, reviewer_user_id: 2,
    reviewer_pseudonym: "Original pseudonym", reviewer_qualification: "Original qualification", reviewer_languages: ["en", "de"],
    decision: "accepted_corrected", clinical_change: true, categories: ["value"], rationale: "Original rationale",
    machine_text_sha256: "a".repeat(64), proposed_text: "Immutable proposed text", proposed_text_sha256: "b".repeat(64),
    status_before: "ready_for_review", status_after: "reviewed", created_variant_id: "actual-created-variant", review_policy: "review/v1", created_at: "2026-10-16T00:00:00Z",
  }]);
  render(<DocumentsPage projectKey="p" query={{}} onNavigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: `Reviews for ${target.document_id}` }));
  const history = within(screen.getByRole("dialog", { name: `Translation reviews: ${target.document_id}` }));
  expect((await history.findByText(/by Original pseudonym/)).textContent).toMatch(/^Accepted with corrections by Original pseudonym · \d{1,2} Oct 2026, \d{2}:\d{2}$/);
  expect(history.getByText("Original qualification · reads en, de")).toBeTruthy();
  expect(history.getByText("Translation status changed from Ready for review to Reviewed.")).toBeTruthy();
  expect(history.getByText("Clinical change: Number or unit")).toBeTruthy();
  expect(history.queryByText(/ready_for_review|→/)).toBeNull();
  expect(history.getByText("Original rationale")).toBeTruthy();
  expect(history.getByText("Created variant: actual-created-variant")).toBeTruthy();
  expect(history.queryByRole("textbox")).toBeNull();
  expect(history.queryByRole("button", { name: /Reopen|Submit/ })).toBeNull();
  fireEvent.click(within(screen.getByRole("dialog", { name: `Translation reviews: ${target.document_id}` }).querySelector(".modal-actions") as HTMLElement).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog", { name: `Translation reviews: ${target.document_id}` })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: `Reviews for ${target.document_id}` }));
  const reopened = await screen.findByRole("dialog", { name: `Translation reviews: ${target.document_id}` });
  fireEvent.keyDown(reopened, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: `Translation reviews: ${target.document_id}` })).toBeNull());
});

it("resets explicit override choices when a different persisted upload has the same logical tuple", async () => {
  const other = { ...retained, id: 8 };
  vi.mocked(api.listUploads).mockResolvedValue([retained, other]);
  vi.spyOn(api, "getUpload").mockImplementation(async (_project, id) => ({ ...retained, id }));
  render(<UploadPanel projectKey="p" languages={["de"]} canOverrideTranslationStatus onImported={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume upload 7" }));
  fireEvent.click(await screen.findByLabelText(/^Accept without review:/));
  fireEvent.change(screen.getByLabelText(/^Reason:/), { target: { value: "Specific to first upload" } });
  fireEvent.click(screen.getByRole("button", { name: "Resume upload 8" }));
  await screen.findByText("Upload 8 · Ready to import");
  expect(screen.queryByLabelText(/^Reason:/)).toBeNull();
  expect((screen.getByLabelText(/^Accept without review:/) as HTMLInputElement).checked).toBe(false);
});

it("keeps original File identity for stale Check again and does not carry its override to the new plan", async () => {
  const file = new File(["public input"], "case.zip");
  vi.spyOn(api, "createUpload").mockResolvedValueOnce({ upload_id: 7, job_id: 11 }).mockResolvedValueOnce({ upload_id: 8, job_id: 12 });
  vi.spyOn(api, "getJob").mockImplementation(async id => ({ id, kind: "upload_preview", status: "succeeded", result: null, error: null, created_at: retained.created_at, finished_at: retained.created_at }));
  vi.spyOn(api, "getUpload").mockImplementation(async (_project, id) => ({ ...retained, id }));
  vi.spyOn(api, "commitUpload").mockRejectedValue(new ApiError(409, "Project changed", "UPLOAD_STALE"));
  render(<UploadPanel projectKey="p" languages={["de"]} canOverrideTranslationStatus onImported={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/^Files/), { target: { files: [file] } });
  fireEvent.submit(screen.getByRole("button", { name: "Check" }).closest("form")!);
  fireEvent.click(await screen.findByLabelText(/^Accept without review:/));
  fireEvent.change(screen.getByLabelText(/^Reason:/), { target: { value: "Initial reason" } });
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
  await screen.findByText("Upload 8 · Ready to import");
  expect(vi.mocked(api.createUpload).mock.calls[1][2][0]).toBe(file);
  expect(screen.queryByLabelText(/^Reason:/)).toBeNull();
  expect(api.commitUpload).toHaveBeenCalledTimes(1);
});

it("retains an unsaved translation gate when another settings section is saved", async () => {
  vi.spyOn(api, "updateProjectSettings").mockResolvedValue({ ...settings, annotate_accepted_translations_only: false });
  render(<ProjectSettingsPage projectKey="p" currentUser={currentUser} />);
  const gate = await screen.findByLabelText("Annotate translations only after an accepted review");
  fireEvent.click(gate); fireEvent.click(screen.getByRole("button", { name: "Save general" }));
  await screen.findByText("General saved.");
  expect((gate as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
  await waitFor(() => expect(api.updateProjectSettings).toHaveBeenLastCalledWith("p", expect.objectContaining({ annotate_accepted_translations_only: true })));
});

it("rechecks authenticated translation-review downloads including an empty JSONL and later refusal", async () => {
  const key = `ontocurator:export:${JSON.stringify([currentUser.username, "p", "translation_reviews"])}`;
  sessionStorage.setItem(key, "33");
  vi.spyOn(api, "getJob").mockResolvedValue({ id: 33, kind: "translation_review_export", status: "succeeded", result: { sha256: "a".repeat(64), reviews: 0 }, error: null, created_at: retained.created_at, finished_at: retained.created_at });
  const payload = { blob: new Blob([], { type: "application/x-ndjson" }), filename: "actual.jsonl" };
  vi.spyOn(api, "downloadJob").mockResolvedValueOnce(payload).mockRejectedValueOnce(new ApiError(403, "Permission changed"));
  const save = vi.spyOn(downloads, "saveDownload").mockImplementation(() => {});
  render(<ExportPage projectKey="p" currentUser={currentUser} />);
  const card = within(screen.getByRole("region", { name: "Translation reviews" }));
  fireEvent.click(await card.findByRole("button", { name: "Download" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(payload, expect.stringMatching(/\.jsonl$/)));
  await waitFor(() => expect((card.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(card.getByRole("button", { name: "Download" }));
  await card.findByText("You do not have access to this page.");
  expect(api.downloadJob).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem(key)).toBeNull();
});

it("binds document state to actual user identity before accepting late replies", async () => {
  const old = deferred<ProjectDocumentSummary[]>();
  vi.mocked(api.listProjectDocuments).mockReturnValueOnce(old.promise).mockResolvedValueOnce([{ ...target, document_id: "new-user-document", external_id: "new-external" }]);
  const view = render(<DocumentsPage projectKey="p" currentUser={{ username: "first" }} query={{}} onNavigate={vi.fn()} />);
  view.rerender(<DocumentsPage projectKey="p" currentUser={{ username: "second" }} query={{}} onNavigate={vi.fn()} />);
  await screen.findByRole("link", { name: "View case for new-user-document" });
  await act(async () => old.resolve([{ ...target, document_id: "old-user-document" }]));
  expect(screen.queryByRole("link", { name: "View case for old-user-document" })).toBeNull();
});

it("renders exact preview variant lineage and every failed code", () => {
  const plan: ImportPlan = { documents: [], duplicates: [], collisions: [], proposal_sets: [], documents_only: [], errors: [], warnings: [], normalised_count: 0, counts: {}, input_sha256: "input", state_sha256: "state", plan_sha256: "plan", committable: true, variants: [{ document_id: "internal", external_id: "external", case_id: "case", language: "de", version: 3, origin: "correction", derived_from: "actual-predecessor", derived_in_upload: true, translation: null, status: "automatic_check_failed", failed_checks: ["units_added", "negation_changed"] }] };
  render(<UploadPreview plan={plan} />);
  const table = within(screen.getByRole("table", { name: "Variants" }));
  expect(table.getByText("external")).toBeTruthy();
  expect(table.getByText(/actual-predecessor.*in this upload/)).toBeTruthy();
  expect(table.getByText("units_added")).toBeTruthy();
  expect(table.getByText("negation_changed")).toBeTruthy();
});

it("loads explicit false annotation gate and saves its changed Rules value", async () => {
  vi.spyOn(api, "updateProjectSettings").mockResolvedValue({ ...settings, annotate_accepted_translations_only: true });
  render(<ProjectSettingsPage projectKey="p" currentUser={currentUser} />);
  const gate = await screen.findByLabelText("Annotate translations only after an accepted review");
  expect((gate as HTMLInputElement).checked).toBe(false);
  fireEvent.click(gate); fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
  await waitFor(() => expect(api.updateProjectSettings).toHaveBeenCalledWith("p", expect.objectContaining({ annotate_accepted_translations_only: true })));
});

it("admin edits nullable qualification without adding it to new-user creation", async () => {
  const user: AdminUser = { username: "reader", display_name: "Reader", email: null, pseudonym: "R", qualification: "Original", languages: ["de"], active: true, is_system_admin: false, projects: [] };
  vi.spyOn(api, "adminListUsers").mockResolvedValue([user]);
  vi.spyOn(api, "adminUpdateUser").mockResolvedValue({ ...user, qualification: null });
  render(<UsersPage currentUser={{ ...currentUser, is_system_admin: true }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit reader" }));
  const form = within(screen.getByRole("form", { name: "Edit user" }));
  const field = form.getByLabelText("Qualification");
  expect((field as HTMLInputElement).maxLength).toBe(200);
  fireEvent.change(field, { target: { value: "" } }); fireEvent.click(form.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(api.adminUpdateUser).toHaveBeenCalledWith("reader", { qualification: null }));
  expect(within(screen.getByRole("form", { name: "New user" })).queryByLabelText("Qualification")).toBeNull();
});

it("uses the dedicated third export endpoint and true job kind", async () => {
  vi.spyOn(api, "exportTranslationReviews").mockResolvedValue({ job_id: 33 });
  vi.spyOn(api, "startExport").mockResolvedValue({ job_id: 11 });
  vi.spyOn(api, "getJob").mockResolvedValue({ id: 33, kind: "translation_review_export", status: "succeeded", result: { sha256: "a".repeat(64), reviews: 0 }, error: null, created_at: "2026-10-16T00:00:00Z", finished_at: "2026-10-16T00:01:00Z" });
  render(<ExportPage projectKey="p" currentUser={currentUser} />);
  const card = within(screen.getByRole("region", { name: "Translation reviews" }));
  fireEvent.click(card.getByRole("button", { name: "Create export" }));
  await card.findByRole("button", { name: "Download" });
  expect(api.exportTranslationReviews).toHaveBeenCalledWith("p");
  expect(api.startExport).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(`ontocurator:export:${JSON.stringify([currentUser.username, "p", "translation_reviews"])}`)).toBe("33");
});
