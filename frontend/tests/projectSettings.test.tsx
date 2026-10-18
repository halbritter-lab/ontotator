import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/api/client";
import { ProjectNewPage } from "../src/admin/ProjectNewPage";
import { ProjectSettingsPage } from "../src/admin/ProjectSettingsPage";
import { currentUser, deferred, ontologies, profile, settings } from "./projectFixtures";

beforeEach(() => {
  vi.spyOn(api, "listTemplates").mockResolvedValue([{ id: "template", label: "Template", required_ontology_ids: ["HP"] }]);
  vi.spyOn(api, "listOntologies").mockResolvedValue(ontologies);
  vi.spyOn(api, "getProjectSettings").mockResolvedValue(settings);
  vi.spyOn(api, "createProject").mockResolvedValue(settings);
  vi.spyOn(api, "updateProjectSettings").mockResolvedValue(settings);
  vi.spyOn(api, "updatePins").mockResolvedValue(settings);
  vi.spyOn(api, "updateProjectProfile").mockResolvedValue(settings);
  vi.spyOn(api, "listMembers").mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("project creation", () => {
  it("creates from authoritative template IDs and the explicitly selected ontology version", async () => {
    const navigate = vi.fn();
    render(<ProjectNewPage onNavigate={navigate} />);
    fireEvent.change(await screen.findByLabelText(/^Built-in template/), { target: { value: "template" } });
    fireEvent.change(screen.getByLabelText(/^Project key/), { target: { value: "project-1" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Research" } });
    const select = screen.getByLabelText(/^Ontology file for HP/);
    expect(within(select).getAllByRole("option")).toHaveLength(3);
    fireEvent.change(select, { target: { value: "b".repeat(64) } });
    fireEvent.change(screen.getByLabelText("Allowed roots for HP"), { target: { value: "HP:1, HP:2" } });
    fireEvent.change(screen.getByLabelText("T1 profile for HP"), { target: { value: "hpo-phenotype" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByLabelText(/^Built-in template/);
    expect(api.createProject).toHaveBeenCalledWith({ key: "project-1", name: "Research", description: null, languages: [], template: "template", pins: [{ ontology_id: "HP", sha256: "b".repeat(64), allowed_roots: ["HP:1", "HP:2"], t1_profile: "hpo-phenotype" }] });
    expect(navigate).toHaveBeenCalledWith({ name: "projectSettings", key: settings.project_key });
  });

  it("retains the uploaded JSON object while previewing actual layer labels", async () => {
    render(<ProjectNewPage onNavigate={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Profile source"), { target: { value: "upload" } });
    const uploaded = { ...profile, extension: { untouched: true } };
    const file = new File([JSON.stringify(uploaded)], "profile.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Profile JSON"), { target: { files: [file] } });
    expect(await screen.findByText("Findings (findings)")).toBeDefined();
    fireEvent.change(screen.getByLabelText(/^Project key/), { target: { value: "project-1" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Research" } });
    fireEvent.change(screen.getByLabelText(/^Ontology file for HP/), { target: { value: "a".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(vi.mocked(api.createProject).mock.calls[0][0].profile).toEqual(uploaded);
    expect(vi.mocked(api.createProject).mock.calls[0][0]).not.toHaveProperty("template");
  });

  it("blocks native pending-language validation and duplicate submits", async () => {
    const pending = deferred<typeof settings>();
    vi.mocked(api.createProject).mockReturnValue(pending.promise);
    render(<ProjectNewPage onNavigate={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/^Built-in template/), { target: { value: "template" } });
    fireEvent.change(screen.getByLabelText(/^Project key/), { target: { value: "project-1" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Research" } });
    fireEvent.change(screen.getByLabelText(/^Ontology file for HP/), { target: { value: "a".repeat(64) } });
    const languages = screen.getByLabelText("Document languages");
    fireEvent.change(languages, { target: { value: "en" } });
    const form = screen.getByRole("button", { name: "Create project" }).closest("form")!;
    fireEvent.submit(form);
    expect(api.createProject).not.toHaveBeenCalled();
    fireEvent.keyDown(languages, { key: "Enter" });
    fireEvent.submit(form); fireEvent.submit(form);
    expect(api.createProject).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(settings); });
  });
});

describe("project settings sections", () => {
  it("saves only one section and preserves another section's unsaved draft", async () => {
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} />);
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: "New name" } });
    fireEvent.change(screen.getByLabelText("Guideline URL"), { target: { value: "https://example.test/guide" } });
    fireEvent.click(screen.getByRole("button", { name: "Save general" }));
    await screen.findByText("General saved.");
    expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, { name: "New name", description: "Original", languages: ["de"] });
    expect((screen.getByLabelText("Guideline URL") as HTMLInputElement).value).toBe("https://example.test/guide");
  });

  it("preserves null clearing and false rule values in section-only PATCH bodies", async () => {
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} />);
    await screen.findByLabelText("Guideline URL");
    fireEvent.click(screen.getByRole("button", { name: "Save guideline" }));
    expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, { guideline_url: null, guideline_version: null });
    await screen.findByText("Guideline saved.");
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    await screen.findByText("Rules saved.");
    expect(api.updateProjectSettings).toHaveBeenLastCalledWith(settings.project_key, { require_chosen_axes: false, adjudicator_not_annotator: false, contiguous_mentions_only: false, annotate_accepted_translations_only: true, allow_spanless_findings: true, require_spanless_note: true, hidden_axis_values: {} });
  });

  it.each([
    ["prohibited", false, true], ["required", true, true], ["optional", true, false],
  ] as const)("persists the %s spanless mode through one setting", async (mode, allow, requireNote) => {
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} />);
    const control = await screen.findByRole("combobox", { name: "Findings without a text span" });
    expect((control as HTMLSelectElement).value).toBe("required");
    expect(within(control).getAllByRole("option")).toHaveLength(3);
    fireEvent.change(control, { target: { value: mode } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    await waitFor(() => expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, expect.objectContaining({ allow_spanless_findings: allow, require_spanless_note: requireNote })));
    expect(screen.getByText(/Applies to every future submission/)).toBeDefined();
  });

  it("loads the saved optional mode and preserves its flag when prohibiting spanless findings", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue({ ...settings, require_spanless_note: false });
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} />);
    const control = await screen.findByRole("combobox", { name: "Findings without a text span" });
    expect((control as HTMLSelectElement).value).toBe("optional");
    fireEvent.change(control, { target: { value: "prohibited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    await waitFor(() => expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, expect.objectContaining({ allow_spanless_findings: false, require_spanless_note: false })));
  });

  it("uses the real server defaults and every annotation type without guessing", async () => {
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} />);
    const actual = await screen.findByRole("checkbox", { name: "present" }) as HTMLInputElement;
    expect(actual.disabled).toBe(true);
    expect(actual.title).toBe("The default value cannot be hidden");
    expect((screen.getByRole("checkbox", { name: "absent" }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByRole("checkbox", { name: "uncertain" })).toBeDefined();
  });

  it("uses separate pin/profile PUTs and keeps locked structures read-only", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue({ ...settings, locked: true });
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} />);
    expect(await screen.findByText("Locked because work has been submitted. Start a new project for another ontology version.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Save pins" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save profile" })).toBeNull();
    expect(screen.getByText("a".repeat(64))).toBeDefined();
    expect(screen.getByRole("button", { name: "Save general" })).toBeDefined();
  });

  it("shows guideline server refusal without losing edited values", async () => {
    vi.mocked(api.updateProjectSettings).mockRejectedValue(new ApiError(422, "Both required", "GUIDELINE_INCOMPLETE"));
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} />);
    fireEvent.change(await screen.findByLabelText("Guideline URL"), { target: { value: "https://example.test/guide" } });
    fireEvent.click(screen.getByRole("button", { name: "Save guideline" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect((screen.getByLabelText("Guideline URL") as HTMLInputElement).value).toBe("https://example.test/guide");
  });

  it("ignores stale project loads and discards responses after unmount", async () => {
    const older = deferred<typeof settings>();
    vi.mocked(api.getProjectSettings).mockReturnValueOnce(older.promise).mockResolvedValueOnce({ ...settings, project_key: "new", name: "Current" });
    const view = render(<ProjectSettingsPage projectKey="old" currentUser={currentUser} />);
    view.rerender(<ProjectSettingsPage projectKey="new" currentUser={currentUser} />);
    expect((await screen.findByLabelText(/^Name/) as HTMLInputElement).value).toBe("Current");
    await act(async () => { older.resolve({ ...settings, name: "Stale" }); });
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("Current");
    view.unmount();
  });

  it("saves the selected pin with a PUT and adopts returned axis-default metadata", async () => {
    vi.mocked(api.updatePins).mockResolvedValue({ ...settings, pins: [{ ...settings.pins[0], sha256: "b".repeat(64), release: "2027", t1_profile: "generic" }], axis_defaults: {} });
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} />);
    fireEvent.change(await screen.findByLabelText(/^Ontology file for HP/), { target: { value: "b".repeat(64) } });
    fireEvent.change(screen.getByLabelText("T1 profile for HP"), { target: { value: "generic" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pins" }));
    await screen.findByText("Pins saved.");
    expect(api.updatePins).toHaveBeenCalledWith(settings.project_key, [{ ontology_id: "HP", sha256: "b".repeat(64), allowed_roots: ["HP:1"], t1_profile: "generic" }]);
    expect(api.updateProjectSettings).not.toHaveBeenCalled();
    expect((screen.getByRole("checkbox", { name: "present" }) as HTMLInputElement).disabled).toBe(false);
  });

  it("sends an uploaded profile unchanged through the distinct profile PUT", async () => {
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} />);
    const uploaded = { ...profile, profile_id: "replacement", custom_metadata: { keep: true } };
    fireEvent.change(await screen.findByLabelText("Profile JSON"), { target: { files: [new File([JSON.stringify(uploaded)], "replacement.json")] } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Save profile" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByText("Profile saved.");
    expect(api.updateProjectProfile).toHaveBeenCalledWith(settings.project_key, uploaded);
    expect(api.updateProjectSettings).not.toHaveBeenCalled();
    expect(api.updatePins).not.toHaveBeenCalled();
  });

  it("preserves dirty pin selections across a compatible profile save and submits them afterward", async () => {
    const pending = deferred<typeof settings>();
    vi.mocked(api.updateProjectProfile).mockReturnValue(pending.promise);
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} />);
    fireEvent.change(await screen.findByLabelText(/^Ontology file for HP/), { target: { value: "b".repeat(64) } });
    fireEvent.change(screen.getByLabelText("Allowed roots for HP"), { target: { value: "HP:2, HP:3" } });
    fireEvent.change(screen.getByLabelText("T1 profile for HP"), { target: { value: "generic" } });
    fireEvent.change(screen.getByLabelText("Profile JSON"), { target: { files: [new File([JSON.stringify(profile)], "compatible.json")] } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Save profile" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await act(async () => { pending.resolve({ ...settings, axis_defaults: {} }); });
    await screen.findByText("Profile saved.");
    expect((screen.getByLabelText(/^Ontology file for HP/) as HTMLSelectElement).value).toBe("b".repeat(64));
    expect((screen.getByLabelText("Allowed roots for HP") as HTMLInputElement).value).toBe("HP:2, HP:3");
    expect((screen.getByLabelText("T1 profile for HP") as HTMLSelectElement).value).toBe("generic");
    expect((screen.getByRole("checkbox", { name: "present" }) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Save profile" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save pins" }));
    await screen.findByText("Pins saved.");
    expect(api.updatePins).toHaveBeenCalledWith(settings.project_key, [{ ontology_id: "HP", sha256: "b".repeat(64), allowed_roots: ["HP:2", "HP:3"], t1_profile: "generic" }]);
    expect((screen.getByLabelText(/^Ontology file for HP/) as HTMLSelectElement).value).toBe(settings.pins[0].sha256);
  });

  it("does not overwrite a newer pin draft when a pin save response arrives", async () => {
    const pending = deferred<typeof settings>();
    vi.mocked(api.updatePins).mockReturnValue(pending.promise);
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} />);
    fireEvent.change(await screen.findByLabelText("Allowed roots for HP"), { target: { value: "HP:2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pins" }));
    // A late draft event must survive even while normal UI controls are disabled.
    fireEvent.change(screen.getByLabelText("Allowed roots for HP"), { target: { value: "HP:3" } });
    await act(async () => { pending.resolve(settings); });
    await screen.findByText("Pins saved.");
    expect((screen.getByLabelText("Allowed roots for HP") as HTMLInputElement).value).toBe("HP:3");
    expect(api.updatePins).toHaveBeenCalledWith(settings.project_key, [{ ontology_id: "HP", sha256: settings.pins[0].sha256, allowed_roots: ["HP:2"], t1_profile: settings.pins[0].t1_profile }]);
  });

  it("lets unsaved rules be explicitly discarded after pin metadata introduces a protected default", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue({ ...settings, axis_defaults: {}, pins: [{ ...settings.pins[0], t1_profile: "generic" }] });
    vi.mocked(api.updatePins).mockResolvedValue(settings);
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "present" }));
    fireEvent.change(screen.getByLabelText("T1 profile for HP"), { target: { value: "hpo-phenotype" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pins" }));
    await screen.findByText("Pins saved.");
    expect((screen.getByRole("checkbox", { name: "present" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Discard rule changes" }));
    const defaultValue = screen.getByRole("checkbox", { name: "present" }) as HTMLInputElement;
    expect(defaultValue.checked).toBe(false);
    expect(defaultValue.disabled).toBe(true);
    expect(api.updateProjectSettings).not.toHaveBeenCalled();
  });

  it("blocks repeated section writes and suppresses onSaved after unmount", async () => {
    const pending = deferred<typeof settings>();
    vi.mocked(api.updateProjectSettings).mockReturnValue(pending.promise);
    const onSaved = vi.fn();
    const view = render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} onSaved={onSaved} />);
    const form = (await screen.findByRole("button", { name: "Save general" })).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(api.updateProjectSettings).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => { pending.resolve(settings); });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows load errors and retries without requesting administrator-only inventories", async () => {
    vi.mocked(api.getProjectSettings).mockRejectedValueOnce(new ApiError(404, "No project", "PROJECT_NOT_FOUND")).mockResolvedValueOnce(settings);
    const adminInventory = vi.spyOn(api, "adminListOntologies");
    const adminUsers = vi.spyOn(api, "adminListUsers");
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} />);
    expect(await screen.findByRole("alert")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByLabelText(/^Name/);
    expect(api.getProjectSettings).toHaveBeenCalledTimes(2);
    expect(adminInventory).not.toHaveBeenCalled();
    expect(adminUsers).not.toHaveBeenCalled();
  });
});

describe("creation recovery and lifetime", () => {
  it("keeps invalid uploaded profiles local and allows a corrected file", async () => {
    render(<ProjectNewPage onNavigate={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Profile source"), { target: { value: "upload" } });
    fireEvent.change(screen.getByLabelText("Profile JSON"), { target: { files: [new File(["not JSON"], "bad.json")] } });
    await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "Create project" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.createProject).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Profile JSON"), { target: { files: [new File([JSON.stringify(profile)], "good.json")] } });
    await screen.findByText("Findings (findings)");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not navigate for a creation response after unmount", async () => {
    const pending = deferred<typeof settings>();
    vi.mocked(api.createProject).mockReturnValue(pending.promise);
    const navigate = vi.fn();
    const view = render(<ProjectNewPage onNavigate={navigate} />);
    fireEvent.change(await screen.findByLabelText(/^Built-in template/), { target: { value: "template" } });
    fireEvent.change(screen.getByLabelText(/^Project key/), { target: { value: "project-1" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Research" } });
    fireEvent.change(screen.getByLabelText(/^Ontology file for HP/), { target: { value: "a".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    view.unmount();
    await act(async () => { pending.resolve(settings); });
    expect(navigate).not.toHaveBeenCalled();
  });
});
