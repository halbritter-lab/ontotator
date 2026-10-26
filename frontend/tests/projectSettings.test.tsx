import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/api/client";
import { ProjectNewPage } from "../src/admin/ProjectNewPage";
import { ProjectSettingsPage, type ProjectSettingsPageProps } from "../src/admin/ProjectSettingsPage";
import type { RouteLeaveGuard, SettingsSection } from "../src/app/router";
import { currentUser, deferred, guidelineListing, guidelineSummary, ontologies, profile, settings } from "./projectFixtures";

beforeEach(() => {
  vi.spyOn(api, "listTemplates").mockResolvedValue([{ id: "template", label: "Template", required_ontology_ids: ["HP"] }]);
  vi.spyOn(api, "listOntologies").mockResolvedValue(ontologies);
  vi.spyOn(api, "getProjectSettings").mockResolvedValue(settings);
  vi.spyOn(api, "createProject").mockResolvedValue(settings);
  vi.spyOn(api, "updateProjectSettings").mockResolvedValue(settings);
  vi.spyOn(api, "updatePins").mockResolvedValue(settings);
  vi.spyOn(api, "updateProjectProfile").mockResolvedValue(settings);
  vi.spyOn(api, "listMembers").mockResolvedValue([]);
  vi.spyOn(api, "listGuidelines").mockResolvedValue(guidelineListing([guidelineSummary(1)]));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** Renders one settings section; `show` switches the address while the editor stays mounted. */
function renderSettings(section?: SettingsSection, extra: Partial<ProjectSettingsPageProps> = {}) {
  const page = (next?: SettingsSection) => <ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} section={next} {...extra} />;
  const view = render(page(section));
  return { ...view, show: (next?: SettingsSection) => view.rerender(page(next)) };
}

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

describe("settings section addresses", () => {
  const labels = ["General", "Guidelines", "Annotation rules", "Workflow", "Creation defaults", "Ontology and profile", "Members"];

  it("shows only General at the default address with a nav of links", async () => {
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} />);
    const navigation = await screen.findByRole("navigation", { name: "Settings sections" });
    const links = within(navigation).getAllByRole("link");
    expect(links.map(link => link.textContent)).toEqual(labels);
    expect(links.map(link => link.getAttribute("href"))).toEqual(["", "/guideline", "/rules", "/workflow", "/defaults", "/profile", "/members"].map(suffix => `#/projects/p%2Fkey/settings${suffix}`));
    expect(within(navigation).getByRole("link", { name: "General" }).getAttribute("aria-current")).toBe("page");
    expect(links.filter(link => link.hasAttribute("aria-current"))).toHaveLength(1);
    expect(screen.getByRole("form", { name: "General" })).toBeDefined();
    expect(screen.queryByRole("form", { name: "Rules" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Guidelines" })).toBeNull();
  });

  it("section Guidelines renders GuidelinesSection", async () => {
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} section="guideline" />);
    const section = await screen.findByRole("region", { name: "Guidelines" });
    expect(within(section).getByRole("heading", { level: 2, name: "Guidelines" })).toBeDefined();
    expect(await within(section).findByText(/^v1, guide-v1\.md/)).toBeDefined();
    expect(within(section).getByLabelText("Guideline file (.md or .txt, up to 256 KB)")).toBeDefined();
    expect(api.listGuidelines).toHaveBeenCalledWith(settings.project_key);
    expect(within(section).getAllByRole("heading", { level: 2, name: "Guidelines" })).toHaveLength(1);
  });

  it("shows the section of its address", async () => {
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} section="rules" />);
    expect(await screen.findByRole("form", { name: "Rules" })).toBeDefined();
    expect(screen.queryByRole("form", { name: "General" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Workflow" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Creation defaults" })).toBeNull();
    const navigation = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(navigation).getByRole("link", { name: "Annotation rules" }).getAttribute("aria-current")).toBe("page");
    expect(within(navigation).getByRole("link", { name: "General" }).hasAttribute("aria-current")).toBe(false);
  });

  it("navigates through onNavigate and focuses the new section", async () => {
    const onNavigate = vi.fn();
    const view = renderSettings(undefined, { onNavigate });
    const navigation = await screen.findByRole("navigation", { name: "Settings sections" });
    fireEvent.click(within(navigation).getByRole("link", { name: "Creation defaults" }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "projectSettings", key: settings.project_key, section: "defaults" });
    fireEvent.click(within(navigation).getByRole("link", { name: "General" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectSettings", key: settings.project_key });
    fireEvent.click(within(navigation).getByRole("link", { name: "Workflow" }), { ctrlKey: true });
    expect(onNavigate).toHaveBeenCalledTimes(2);
    view.show("defaults");
    expect(document.activeElement).toBe(screen.getByRole("form", { name: "Creation defaults" }));
  });

  it("asks Save, Discard or Cancel when leaving a section with unsaved edits", async () => {
    const routeLeaveRef = { current: null } as MutableRefObject<RouteLeaveGuard | null>;
    renderSettings(undefined, { routeLeaveRef });
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: "Edited" } });
    await waitFor(() => expect(routeLeaveRef.current).not.toBeNull());

    let cancelled: Promise<boolean> | undefined;
    act(() => { cancelled = routeLeaveRef.current!(); });
    const dialog = await screen.findByRole("dialog", { name: "Unsaved changes in General" });
    expect(within(dialog).getByRole("button", { name: "Save general" })).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Discard" })).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expect(cancelled!).resolves.toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("Edited");

    vi.mocked(api.updateProjectSettings).mockRejectedValueOnce(new ApiError(422, "Name taken", "INVALID"));
    let failed: Promise<boolean> | undefined;
    act(() => { failed = routeLeaveRef.current!(); });
    let settled = false;
    void failed!.then(() => { settled = true; });
    const again = await screen.findByRole("dialog", { name: "Unsaved changes in General" });
    fireEvent.click(within(again).getByRole("button", { name: "Save general" }));
    expect(await within(again).findByRole("alert")).toBeDefined();
    expect(screen.getByRole("dialog", { name: "Unsaved changes in General" })).toBeDefined();
    expect(settled).toBe(false);

    fireEvent.click(within(again).getByRole("button", { name: "Save general" }));
    await expect(failed!).resolves.toBe(true);
    expect(api.updateProjectSettings).toHaveBeenLastCalledWith(settings.project_key, { name: "Edited", description: "Original", languages: ["de"] });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("discards the section's edits when leaving with Discard", async () => {
    const routeLeaveRef = { current: null } as MutableRefObject<RouteLeaveGuard | null>;
    renderSettings("general", { routeLeaveRef });
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: "Edited" } });
    await waitFor(() => expect(routeLeaveRef.current).not.toBeNull());
    let leaving: Promise<boolean> | undefined;
    act(() => { leaving = routeLeaveRef.current!(); });
    const dialog = await screen.findByRole("dialog", { name: "Unsaved changes in General" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    await expect(leaving!).resolves.toBe(true);
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("Research");
    expect(api.updateProjectSettings).not.toHaveBeenCalled();
  });

  it("does not ask when nothing is unsaved", async () => {
    const routeLeaveRef = { current: null } as MutableRefObject<RouteLeaveGuard | null>;
    renderSettings("rules", { routeLeaveRef });
    await screen.findByRole("form", { name: "Rules" });
    let allowed: boolean | undefined;
    await act(async () => { allowed = await (routeLeaveRef.current?.() ?? Promise.resolve(true)); });
    expect(allowed).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("project settings sections", () => {
  it("jumps to rules with scoped save feedback at the end of the form and secondary values collapsed", async () => {
    const view = renderSettings();
    await screen.findByRole("navigation", { name: "Settings sections" });
    view.show("rules");
    const form = screen.getByRole("form", { name: "Rules" });
    expect(document.activeElement).toBe(form);
    const save = within(form).getByRole("button", { name: "Save rules" });
    const control = within(form).getByRole("combobox", { name: "Findings without a text span" });
    // Save is the primary action and comes last, after the collapsed secondary values (UX audit G).
    expect(save.className).toContain("btn-primary");
    expect(save.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    fireEvent.change(control, { target: { value: "optional" } });
    expect(within(form).getByRole("status").compareDocumentPosition(save) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    const disclosure = within(form).getByText("Hidden axis values").closest("details")!;
    expect(disclosure.open).toBe(false);
    expect(save.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    view.show("general");
    view.show("rules");
    expect(screen.getByRole("combobox", { name: "Findings without a text span" })).toHaveProperty("value", "optional");
    expect(api.updateProjectSettings).not.toHaveBeenCalled();
  });
  it("saves profile-keyed creation defaults without saving another section's rule changes", async () => {
    const updated = { ...settings, creation_defaults: { findings: { phenotype: { assertion: "present" } } }, annotation_policy_revision: 2 };
    vi.mocked(api.updateProjectSettings).mockResolvedValue(updated);
    const view = renderSettings("rules");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Every axis must be chosen before submission" }));
    view.show("defaults");
    const preset = screen.getByRole("combobox", { name: "Default Assertion (Findings / Phenotype)" });
    expect(preset).toHaveProperty("value", "");
    fireEvent.change(preset, { target: { value: "present" } });
    fireEvent.click(screen.getByRole("button", { name: "Save creation defaults" }));
    await screen.findByText("Creation defaults saved.");
    expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, { creation_defaults: { findings: { phenotype: { assertion: "present" } } } });
    expect(screen.getByRole("combobox", { name: "Default Certainty (Findings / Later type)" })).toHaveProperty("value", "");
    view.show("rules");
    expect(screen.getByRole("checkbox", { name: "Every axis must be chosen before submission" })).toHaveProperty("checked", true);
  });
  it("saves only one section and preserves another section's unsaved draft", async () => {
    const view = renderSettings();
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: "New name" } });
    view.show("rules");
    fireEvent.click(screen.getByRole("checkbox", { name: "Every axis must be chosen before submission" }));
    view.show("general");
    fireEvent.click(screen.getByRole("button", { name: "Save general" }));
    await screen.findByText("General saved.");
    expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, { name: "New name", description: "Original", languages: ["de"] });
    view.show("rules");
    expect(screen.getByRole("checkbox", { name: "Every axis must be chosen before submission" })).toHaveProperty("checked", true);
  });

  it("preserves null clearing and false rule values in section-only PATCH bodies", async () => {
    const view = renderSettings("general");
    fireEvent.change(await screen.findByLabelText("Description"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Save general" }));
    expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, { name: "Research", description: null, languages: ["de"] });
    await screen.findByText("General saved.");
    view.show("rules");
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    await screen.findByText("Rules saved.");
    expect(api.updateProjectSettings).toHaveBeenLastCalledWith(settings.project_key, { require_chosen_axes: false, adjudicator_not_annotator: false, contiguous_mentions_only: false, allow_spanless_findings: true, require_spanless_note: true, hidden_axis_values: {} });
  });

  it.each([
    ["prohibited", false, true], ["required", true, true], ["optional", true, false],
  ] as const)("persists the %s spanless mode through one setting", async (mode, allow, requireNote) => {
    renderSettings("rules");
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
    renderSettings("rules");
    const control = await screen.findByRole("combobox", { name: "Findings without a text span" });
    expect((control as HTMLSelectElement).value).toBe("optional");
    fireEvent.change(control, { target: { value: "prohibited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    await waitFor(() => expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, expect.objectContaining({ allow_spanless_findings: false, require_spanless_note: false })));
  });

  it("uses the real server defaults and every annotation type without guessing", async () => {
    renderSettings("rules");
    const actual = await screen.findByRole("checkbox", { name: "present" }) as HTMLInputElement;
    expect(actual.disabled).toBe(true);
    expect(actual.title).toBe("The default value cannot be hidden");
    expect((screen.getByRole("checkbox", { name: "absent" }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByRole("checkbox", { name: "uncertain" })).toBeDefined();
  });

  it("uses separate pin/profile PUTs and keeps locked structures read-only", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue({ ...settings, locked: true });
    const view = renderSettings("profile");
    expect(await screen.findByText("Locked because work has been submitted. Start a new project for another ontology version.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Save pins" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save profile" })).toBeNull();
    expect(screen.getByText("a".repeat(64))).toBeDefined();
    view.show("general");
    expect(screen.getByRole("button", { name: "Save general" })).toBeDefined();
  });

  it("shows a server refusal without losing edited values", async () => {
    vi.mocked(api.updateProjectSettings).mockRejectedValue(new ApiError(422, "Invalid", "SETTINGS_INVALID"));
    renderSettings("general");
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: "Edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save general" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("Edited");
    expect(within(screen.getByRole("form", { name: "General" })).getByRole("status").textContent).toContain("Unsaved changes");
    expect(screen.queryByText("General saved.")).toBeNull();
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
    const view = renderSettings("profile");
    fireEvent.change(await screen.findByLabelText(/^Ontology file for HP/), { target: { value: "b".repeat(64) } });
    fireEvent.change(screen.getByLabelText("T1 profile for HP"), { target: { value: "generic" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pins" }));
    await screen.findByText("Pins saved.");
    expect(api.updatePins).toHaveBeenCalledWith(settings.project_key, [{ ontology_id: "HP", sha256: "b".repeat(64), allowed_roots: ["HP:1"], t1_profile: "generic" }]);
    expect(api.updateProjectSettings).not.toHaveBeenCalled();
    view.show("rules");
    expect((screen.getByRole("checkbox", { name: "present" }) as HTMLInputElement).disabled).toBe(false);
  });

  it("sends an uploaded profile unchanged through the distinct profile PUT", async () => {
    renderSettings("profile");
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
    const view = renderSettings("profile");
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
    view.show("rules");
    expect((screen.getByRole("checkbox", { name: "present" }) as HTMLInputElement).disabled).toBe(false);
    view.show("profile");
    expect((screen.getByRole("button", { name: "Save profile" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save pins" }));
    await screen.findByText("Pins saved.");
    expect(api.updatePins).toHaveBeenCalledWith(settings.project_key, [{ ontology_id: "HP", sha256: "b".repeat(64), allowed_roots: ["HP:2", "HP:3"], t1_profile: "generic" }]);
    expect((screen.getByLabelText(/^Ontology file for HP/) as HTMLSelectElement).value).toBe(settings.pins[0].sha256);
  });

  it("does not overwrite a newer pin draft when a pin save response arrives", async () => {
    const pending = deferred<typeof settings>();
    vi.mocked(api.updatePins).mockReturnValue(pending.promise);
    renderSettings("profile");
    fireEvent.change(await screen.findByLabelText("Allowed roots for HP"), { target: { value: "HP:2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pins" }));
    // A late draft event must survive even while normal UI controls are disabled.
    fireEvent.change(screen.getByLabelText("Allowed roots for HP"), { target: { value: "HP:3" } });
    await act(async () => { pending.resolve(settings); });
    await screen.findByText("Pins saved. Newer changes remain unsaved.");
    expect((screen.getByLabelText("Allowed roots for HP") as HTMLInputElement).value).toBe("HP:3");
    expect(api.updatePins).toHaveBeenCalledWith(settings.project_key, [{ ontology_id: "HP", sha256: settings.pins[0].sha256, allowed_roots: ["HP:2"], t1_profile: settings.pins[0].t1_profile }]);
  });

  it("lets unsaved rules be explicitly discarded after pin metadata introduces a protected default", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue({ ...settings, axis_defaults: {}, pins: [{ ...settings.pins[0], t1_profile: "generic" }] });
    vi.mocked(api.updatePins).mockResolvedValue(settings);
    const view = renderSettings("rules");
    fireEvent.click(await screen.findByRole("checkbox", { name: "present" }));
    view.show("profile");
    fireEvent.change(screen.getByLabelText("T1 profile for HP"), { target: { value: "hpo-phenotype" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pins" }));
    await screen.findByText("Pins saved.");
    view.show("rules");
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

describe("workflow settings", () => {
  it("edits Plan for imported texts and Annotations per text under Workflow", async () => {
    const view = renderSettings();
    await screen.findByRole("navigation", { name: "Settings sections" });
    view.show("workflow");
    const form = screen.getByRole("form", { name: "Workflow" });
    expect(document.activeElement).toBe(form);
    const group = within(form).getByRole("radiogroup", { name: "Plan for imported texts" });
    const all = within(group).getByRole("radio", { name: "Review and annotate all translations" });
    expect(all).toHaveProperty("checked", true);
    expect(within(form).getByText("Applies to texts imported from now on.")).toBeTruthy();
    fireEvent.click(within(group).getByRole("radio", { name: "Nothing planned" }));
    const count = within(form).getByRole("spinbutton", { name: /Annotations per text/ });
    expect(count).toHaveProperty("min", "1");
    expect(count).toHaveProperty("max", "5");
    expect(within(form).getByText("How many people annotate each text independently.")).toBeTruthy();
    fireEvent.change(count, { target: { value: "3" } });
    vi.mocked(api.updateProjectSettings).mockResolvedValue({ ...settings, import_plan: "nothing", annotations_per_text: 3 });
    fireEvent.click(within(form).getByRole("button", { name: "Save workflow" }));
    await within(form).findByText("Workflow saved.");
    expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, { import_plan: "nothing", annotations_per_text: 3, tool_proposal_mode: "proposals", annotate_accepted_translations_only: true });
  });

  it("shows how many rows exceed a lowered target", async () => {
    const preview = vi.spyOn(api, "annotationTargetPreview").mockResolvedValue({ rows_over_target: 4 });
    vi.mocked(api.getProjectSettings).mockResolvedValue({ ...settings, annotations_per_text: 3 });
    renderSettings("workflow");
    const count = await screen.findByRole("spinbutton", { name: /Annotations per text/ });
    expect(screen.queryByText(/Nobody is removed\./)).toBeNull();
    fireEvent.change(count, { target: { value: "2" } });
    expect(await screen.findByText("4 rows have more annotators than the new target. Nobody is removed.")).toBeTruthy();
    expect(preview).toHaveBeenLastCalledWith(settings.project_key, 2);
    preview.mockResolvedValue({ rows_over_target: 0 });
    fireEvent.change(count, { target: { value: "1" } });
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith(settings.project_key, 1));
    expect(await screen.findByText("Nobody is removed.")).toBeTruthy();
    expect(screen.queryByText(/rows have more annotators/)).toBeNull();
    fireEvent.change(count, { target: { value: "4" } });
    await waitFor(() => expect(screen.queryByText(/Nobody is removed\./)).toBeNull());
  });

  it("always sends import_plan and annotations_per_text on save", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue({ ...settings, import_plan: "nothing", annotations_per_text: 2 });
    renderSettings("workflow");
    const form = await screen.findByRole("form", { name: "Workflow" });
    fireEvent.click(within(form).getByRole("button", { name: "Save workflow" }));
    await waitFor(() => expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, { import_plan: "nothing", annotations_per_text: 2, tool_proposal_mode: "proposals", annotate_accepted_translations_only: true }));
  });

  it("saves Texts with tool proposals", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue({ ...settings, tool_proposal_mode: "proposals" });
    renderSettings("workflow");
    const form = await screen.findByRole("form", { name: "Workflow" });
    const group = within(form).getByRole("radiogroup", { name: "Texts with tool proposals" });
    expect(within(group).getByRole("radio", { name: /Annotate from proposals/ })).toHaveProperty("checked", true);
    expect(within(group).getByText("Annotators go through the tool's proposals one by one, confirm, reject or correct each, and add the findings the tool missed.")).toBeTruthy();
    expect(within(group).getByText("Annotators start from the plain text and do not see the proposals.")).toBeTruthy();
    fireEvent.click(within(group).getByRole("radio", { name: /Annotate from scratch/ }));
    vi.mocked(api.updateProjectSettings).mockResolvedValue({ ...settings, tool_proposal_mode: "scratch" });
    fireEvent.click(within(form).getByRole("button", { name: "Save workflow" }));
    await within(form).findByText("Workflow saved.");
    expect(api.updateProjectSettings).toHaveBeenLastCalledWith(settings.project_key, expect.objectContaining({ tool_proposal_mode: "scratch" }));
  });

  it("the translation rule sits in Workflow below Texts with tool proposals", async () => {
    const label = "Annotate translations only after an accepted review";
    const view = renderSettings("rules");
    const rules = await screen.findByRole("form", { name: "Rules" });
    expect(within(rules).queryByRole("checkbox", { name: label })).toBeNull();
    fireEvent.click(within(rules).getByRole("button", { name: "Save rules" }));
    await screen.findByText("Rules saved.");
    expect(vi.mocked(api.updateProjectSettings).mock.lastCall![1]).not.toHaveProperty("annotate_accepted_translations_only");
    view.show("workflow");
    const form = screen.getByRole("form", { name: "Workflow" });
    const gate = within(form).getByRole("checkbox", { name: label });
    expect(gate).toHaveProperty("checked", true);
    expect(within(form).getByText("Translations can be annotated only after their review is accepted. Native source texts are never held back.")).toBeTruthy();
    const tools = within(form).getByRole("radiogroup", { name: "Texts with tool proposals" });
    expect(tools.compareDocumentPosition(gate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gate.compareDocumentPosition(within(form).getByRole("spinbutton", { name: /Annotations per text/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(gate);
    fireEvent.click(within(form).getByRole("button", { name: "Save workflow" }));
    await waitFor(() => expect(api.updateProjectSettings).toHaveBeenLastCalledWith(settings.project_key, expect.objectContaining({ annotate_accepted_translations_only: false })));
  });

  it("names the consolidator rule in D2 words", async () => {
    renderSettings("rules");
    expect(await screen.findByRole("checkbox", { name: "The consolidator of a text may not be one of its annotators" })).toBeTruthy();
    expect(screen.queryByText(/adjudicator/i)).toBeNull();
  });
});
