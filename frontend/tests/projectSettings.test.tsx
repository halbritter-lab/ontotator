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
    // A short SHA-256 in the option, the full one in its title and in the select's description.
    const chosen = within(select).getByRole("option", { selected: true });
    expect(chosen.textContent).toContain(`(${"b".repeat(12)})`);
    expect(chosen.textContent).not.toContain("b".repeat(13));
    expect(chosen.getAttribute("title")).toBe("b".repeat(64));
    expect(document.getElementById(select.getAttribute("aria-describedby")!)?.textContent).toBe(`SHA-256 ${"b".repeat(64)}`);
    fireEvent.change(screen.getByLabelText("Allowed roots for HP"), { target: { value: "HP:1, HP:2" } });
    // HP preselects the HPO phenotype scheme (#5).
    expect((screen.getByLabelText("Annotation scheme for HP") as HTMLSelectElement).value).toBe("hpo-phenotype");
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByLabelText(/^Built-in template/);
    expect(api.createProject).toHaveBeenCalledWith({ key: "project-1", name: "Research", description: null, languages: [], template: "template", pins: [{ ontology_id: "HP", sha256: "b".repeat(64), allowed_roots: ["HP:1", "HP:2"], t1_profile: "hpo-phenotype" }] });
    expect(navigate).toHaveBeenCalledWith({ name: "projectSettings", key: settings.project_key, section: "people" });
  });

  it("preselects the only loaded version of an ontology; several stay a choice (#47 A-18)", async () => {
    vi.mocked(api.listOntologies).mockResolvedValue([ontologies[0]!]);
    render(<ProjectNewPage onNavigate={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/^Built-in template/), { target: { value: "template" } });
    expect((screen.getByLabelText(/^Ontology file for HP/) as HTMLSelectElement).value).toBe(ontologies[0]!.sha256);
    // The key pattern compiles under the `v` flag browsers use for `pattern` (an unescaped "-" in a class does not).
    expect(() => new RegExp((screen.getByLabelText(/^Project key/) as HTMLInputElement).pattern, "v")).not.toThrow();
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

  it("shows a refused key at the key field and focuses it", async () => {
    vi.mocked(api.createProject).mockRejectedValue(new ApiError(409, "exists", "PROJECT_EXISTS"));
    render(<ProjectNewPage onNavigate={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/^Built-in template/), { target: { value: "template" } });
    fireEvent.change(screen.getByLabelText(/^Project key/), { target: { value: "ward-notes" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Research" } });
    fireEvent.change(screen.getByLabelText(/^Ontology file for HP/), { target: { value: "a".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    const key = screen.getByLabelText(/^Project key/);
    await waitFor(() => expect(key.getAttribute("aria-invalid")).toBe("true"));
    expect(document.getElementById(key.getAttribute("aria-describedby")!.split(" ").pop()!)?.textContent).toBe("A project with this key already exists. Choose another key.");
    expect(document.activeElement).toBe(key);
    expect(screen.getAllByText("A project with this key already exists. Choose another key.")).toHaveLength(1);
    fireEvent.change(key, { target: { value: "ward-notes-2" } });
    expect(key.getAttribute("aria-invalid")).toBe("false");
  });

  it("blocks native pending-language validation and duplicate submits", async () => {
    const pending = deferred<typeof settings>();
    vi.mocked(api.createProject).mockReturnValue(pending.promise);
    render(<ProjectNewPage onNavigate={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/^Built-in template/), { target: { value: "template" } });
    fireEvent.change(screen.getByLabelText(/^Project key/), { target: { value: "project-1" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Research" } });
    fireEvent.change(screen.getByLabelText(/^Ontology file for HP/), { target: { value: "a".repeat(64) } });
    const languages = screen.getByLabelText("Languages of the texts");
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
  const labels = ["General", "Annotation", "Workflow", "Guidelines", "People", "Ontology"];
  const saveIn = (form: string) => within(screen.getByRole("form", { name: form })).getByRole("button", { name: "Save changes" });

  it("opens General at the default address with six job tabs (M-8a, B6-1)", async () => {
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} />);
    const navigation = await screen.findByRole("navigation", { name: "Settings sections" });
    const links = within(navigation).getAllByRole("link");
    expect(links.map(link => link.textContent)).toEqual(labels);
    expect(links.map(link => link.getAttribute("href"))).toEqual(["", "/annotation", "/workflow", "/guidelines", "/people", "/ontology"].map(suffix => `#/projects/p%2Fkey/settings${suffix}`));
    expect(within(navigation).getByRole("link", { name: "General" }).getAttribute("aria-current")).toBe("page");
    expect(links.filter(link => link.hasAttribute("aria-current"))).toHaveLength(1);
    expect(await screen.findByRole("form", { name: "General" })).toBeDefined();
    expect(screen.queryByRole("region", { name: "Members" })).toBeNull();
  });

  it("section Guidelines renders GuidelinesSection", async () => {
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} section="guidelines" />);
    const section = await screen.findByRole("region", { name: "Guidelines" });
    expect(within(section).getByRole("heading", { level: 2, name: "Guidelines" })).toBeDefined();
    expect(await within(section).findByText(/^v1, guide-v1\.md/)).toBeDefined();
    expect(within(section).getByLabelText("Guideline file (.md or .txt, up to 256 KB)")).toBeDefined();
    expect(api.listGuidelines).toHaveBeenCalledWith(settings.project_key);
    expect(within(section).getAllByRole("heading", { level: 2, name: "Guidelines" })).toHaveLength(1);
  });

  it("shows the section of its address", async () => {
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} section="annotation" />);
    expect(await screen.findByRole("form", { name: "Annotation" })).toBeDefined();
    expect(screen.queryByRole("form", { name: "General" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Workflow" })).toBeNull();
    const navigation = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(navigation).getByRole("link", { name: "Annotation" }).getAttribute("aria-current")).toBe("page");
    expect(within(navigation).getByRole("link", { name: "People" }).hasAttribute("aria-current")).toBe(false);
  });

  it("navigates through onNavigate and focuses the new section without a container focus ring (P9)", async () => {
    const onNavigate = vi.fn();
    const view = renderSettings(undefined, { onNavigate });
    const navigation = await screen.findByRole("navigation", { name: "Settings sections" });
    fireEvent.click(within(navigation).getByRole("link", { name: "Annotation" }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "projectSettings", key: settings.project_key, section: "annotation" });
    fireEvent.click(within(navigation).getByRole("link", { name: "General" }));
    expect(onNavigate).toHaveBeenLastCalledWith({ name: "projectSettings", key: settings.project_key });
    fireEvent.click(within(navigation).getByRole("link", { name: "Workflow" }), { ctrlKey: true });
    expect(onNavigate).toHaveBeenCalledTimes(2);
    view.show("annotation");
    const form = screen.getByRole("form", { name: "Annotation" });
    expect(document.activeElement).toBe(form);
    expect(form.classList.contains("settings-section")).toBe(true);
  });

  it("asks Save, Discard or Cancel when leaving a section with unsaved edits", async () => {
    const routeLeaveRef = { current: null } as MutableRefObject<RouteLeaveGuard | null>;
    renderSettings("general", { routeLeaveRef });
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: "Edited" } });
    await waitFor(() => expect(routeLeaveRef.current).not.toBeNull());

    let cancelled: Promise<boolean> | undefined;
    act(() => { cancelled = routeLeaveRef.current!(); });
    const dialog = await screen.findByRole("dialog", { name: "Unsaved changes in General" });
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Discard changes" })).toBeDefined();
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
    fireEvent.click(within(again).getByRole("button", { name: "Save changes" }));
    expect(await within(again).findByRole("alert")).toBeDefined();
    expect(screen.getByRole("dialog", { name: "Unsaved changes in General" })).toBeDefined();
    expect(settled).toBe(false);

    fireEvent.click(within(again).getByRole("button", { name: "Save changes" }));
    await expect(failed!).resolves.toBe(true);
    expect(api.updateProjectSettings).toHaveBeenLastCalledWith(settings.project_key, { name: "Edited", description: "Original", languages: ["de"] });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("discards the section's edits when leaving with Discard changes", async () => {
    const routeLeaveRef = { current: null } as MutableRefObject<RouteLeaveGuard | null>;
    renderSettings("general", { routeLeaveRef });
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: "Edited" } });
    await waitFor(() => expect(routeLeaveRef.current).not.toBeNull());
    let leaving: Promise<boolean> | undefined;
    act(() => { leaving = routeLeaveRef.current!(); });
    const dialog = await screen.findByRole("dialog", { name: "Unsaved changes in General" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard changes" }));
    await expect(leaving!).resolves.toBe(true);
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("Research");
    expect(api.updateProjectSettings).not.toHaveBeenCalled();
  });

  it("does not ask when nothing is unsaved", async () => {
    const routeLeaveRef = { current: null } as MutableRefObject<RouteLeaveGuard | null>;
    renderSettings("annotation", { routeLeaveRef });
    await screen.findByRole("form", { name: "Annotation" });
    let allowed: boolean | undefined;
    await act(async () => { allowed = await (routeLeaveRef.current?.() ?? Promise.resolve(true)); });
    expect(allowed).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("every form saves with Save changes, offers Discard changes only when dirty and names unsaved changes (M-8d)", async () => {
    renderSettings("general");
    const form = await screen.findByRole("form", { name: "General" });
    const save = within(form).getByRole("button", { name: "Save changes" });
    expect(save.className).toContain("btn-primary");
    expect(within(form).queryByRole("button", { name: "Discard changes" })).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Edited" } });
    expect(within(form).getByRole("status").textContent).toBe("Unsaved changes.");
    fireEvent.click(within(form).getByRole("button", { name: "Discard changes" }));
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("Research");
    expect(within(form).queryByRole("button", { name: "Discard changes" })).toBeNull();
    expect(saveIn("General")).toBe(save);
  });
});

describe("project settings sections", () => {
  const saveIn = (form: string) => within(screen.getByRole("form", { name: form })).getByRole("button", { name: "Save changes" });
  const prefill = (group: string, axis: string) => within(screen.getByRole("group", { name: group })).getByRole("combobox", { name: axis });
  const shown = (value: string) => screen.getByRole("button", { name: value, pressed: undefined }) as HTMLButtonElement;

  it("Annotation merges the submit rules and prefilled values with one Save; the shown values are collapsed with a count (M-8c)", async () => {
    const view = renderSettings();
    await screen.findByRole("navigation", { name: "Settings sections" });
    view.show("annotation");
    const form = screen.getByRole("form", { name: "Annotation" });
    expect(document.activeElement).toBe(form);
    expect(within(form).getAllByRole("heading", { level: 2 }).map(heading => heading.textContent)).toEqual(["When submitting", "Prefilled values"]);
    const save = within(form).getByRole("button", { name: "Save changes" });
    const control = within(form).getByRole("combobox", { name: "Findings that point to no text passage" });
    expect(save.className).toContain("btn-primary");
    expect(save.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    fireEvent.change(control, { target: { value: "optional" } });
    expect(within(form).getByRole("status").compareDocumentPosition(save) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    const disclosure = within(form).getByText("Values annotators can choose").closest("details")!;
    expect(disclosure.open).toBe(false);
    expect(save.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    fireEvent.click(shown("Absent"));
    expect(within(form).getByText("Values annotators can choose (1 hidden)")).toBeDefined();
    fireEvent.change(prefill("Findings: Phenotype", "Assertion"), { target: { value: "present" } });
    expect(within(prefill("Findings: Phenotype", "Assertion")).getAllByRole("option").map(option => option.textContent)).toEqual(["No prefill", "Present"]);
    fireEvent.click(save);
    await screen.findByText("Annotation saved.");
    expect(api.updateProjectSettings).toHaveBeenCalledTimes(1);
    expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, { allow_spanless_findings: true, require_spanless_note: false, require_chosen_axes: false,
      contiguous_mentions_only: false, hidden_axis_values: { findings: { assertion: ["absent"] } }, creation_defaults: { findings: { phenotype: { assertion: "present" } } } });
  });

  it("saves only one section and preserves another section's unsaved draft", async () => {
    const view = renderSettings("general");
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: "New name" } });
    view.show("annotation");
    fireEvent.click(screen.getByRole("checkbox", { name: "Annotators must confirm every value before submitting" }));
    view.show("general");
    fireEvent.click(saveIn("General"));
    await screen.findByText("General saved.");
    expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, { name: "New name", description: "Original", languages: ["de"] });
    view.show("annotation");
    expect(screen.getByRole("checkbox", { name: "Annotators must confirm every value before submitting" })).toHaveProperty("checked", true);
  });

  it("enables Save only with unsaved edits and guards reload or tab close while any edit is unsaved", async () => {
    const view = renderSettings("general");
    const name = await screen.findByLabelText(/^Name/);
    expect(saveIn("General")).toHaveProperty("disabled", true);
    const clean = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(clean); expect(clean.defaultPrevented).toBe(false);
    fireEvent.change(name, { target: { value: "New name" } });
    expect(saveIn("General")).toHaveProperty("disabled", false);
    // An edit on another tab still counts.
    view.show("annotation");
    expect(saveIn("Annotation")).toHaveProperty("disabled", true);
    const dirty = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(dirty); expect(dirty.defaultPrevented).toBe(true);
    view.show("general");
    fireEvent.click(within(screen.getByRole("form", { name: "General" })).getByRole("button", { name: "Discard changes" }));
    expect(saveIn("General")).toHaveProperty("disabled", true);
    const discarded = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(discarded); expect(discarded.defaultPrevented).toBe(false);
  });

  it("preserves null clearing and false rule values in section-only PATCH bodies", async () => {
    const view = renderSettings("general");
    fireEvent.change(await screen.findByLabelText(/^Description/), { target: { value: " " } });
    fireEvent.click(saveIn("General"));
    expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, { name: "Research", description: null, languages: ["de"] });
    await screen.findByText("General saved.");
    view.show("annotation");
    fireEvent.change(screen.getByRole("combobox", { name: "Findings that point to no text passage" }), { target: { value: "optional" } });
    fireEvent.click(saveIn("Annotation"));
    await screen.findByText("Annotation saved.");
    expect(api.updateProjectSettings).toHaveBeenLastCalledWith(settings.project_key, { require_chosen_axes: false, contiguous_mentions_only: false, allow_spanless_findings: true, require_spanless_note: false, hidden_axis_values: {}, creation_defaults: {} });
  });

  it.each([
    ["prohibited", false, true], ["required", true, true], ["optional", true, false],
  ] as const)("persists the %s spanless mode through one setting", async (mode, allow, requireNote) => {
    // Start from another mode, so choosing this one is an edit.
    if (mode === "required") vi.mocked(api.getProjectSettings).mockResolvedValue({ ...settings, allow_spanless_findings: false });
    renderSettings("annotation");
    const control = await screen.findByRole("combobox", { name: "Findings that point to no text passage" });
    expect((control as HTMLSelectElement).value).toBe(mode === "required" ? "prohibited" : "required");
    expect(within(control).getAllByRole("option").map(option => option.textContent)).toEqual(["Not allowed", "Allowed with a reason", "Allowed, reason optional"]);
    fireEvent.change(control, { target: { value: mode } });
    fireEvent.click(saveIn("Annotation"));
    await waitFor(() => expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, expect.objectContaining({ allow_spanless_findings: allow, require_spanless_note: requireNote })));
    expect(screen.getByText(/Applies to every submission from now on/)).toBeDefined();
  });

  it("loads the saved optional mode and preserves its flag when prohibiting spanless findings", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue({ ...settings, require_spanless_note: false });
    renderSettings("annotation");
    const control = await screen.findByRole("combobox", { name: "Findings that point to no text passage" });
    expect((control as HTMLSelectElement).value).toBe("optional");
    fireEvent.change(control, { target: { value: "prohibited" } });
    fireEvent.click(saveIn("Annotation"));
    await waitFor(() => expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, expect.objectContaining({ allow_spanless_findings: false, require_spanless_note: false })));
  });

  it("uses the real server defaults and every annotation type without guessing", async () => {
    renderSettings("annotation");
    const actual = await screen.findByRole("button", { name: "Present" }) as HTMLButtonElement;
    expect(actual.disabled).toBe(true);
    expect(actual.title).toBe("The default value cannot be hidden");
    expect(shown("Absent").disabled).toBe(false);
    expect(shown("Uncertain")).toBeDefined();
  });

  it("Ontology when locked: a plain summary, the technical details collapsed (D8)", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue({ ...settings, locked: true });
    const view = renderSettings("ontology");
    expect(await screen.findByText("The ontology cannot change once work has been submitted. Start a new project for another ontology version.")).toBeDefined();
    expect(within(screen.getByRole("list", { name: "Ontologies" })).getByRole("listitem").textContent).toBe("HPO (HP), release 2026");
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    const details = screen.getByText("a".repeat(64)).closest("details")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("HPO phenotype (fixed qualifiers, modifiers)");
    view.show("general");
    expect(saveIn("General")).toBeDefined();
  });

  it("shows a server refusal without losing edited values", async () => {
    vi.mocked(api.updateProjectSettings).mockRejectedValue(new ApiError(422, "Invalid", "SETTINGS_INVALID"));
    renderSettings("general");
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: "Edited" } });
    fireEvent.click(saveIn("General"));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("Edited");
    expect(within(screen.getByRole("form", { name: "General" })).getByRole("status").textContent).toContain("Unsaved changes");
    expect(screen.queryByText("General saved.")).toBeNull();
  });

  it("ignores stale project loads and discards responses after unmount", async () => {
    const older = deferred<typeof settings>();
    vi.mocked(api.getProjectSettings).mockReturnValueOnce(older.promise).mockResolvedValueOnce({ ...settings, project_key: "new", name: "Current" });
    const view = render(<ProjectSettingsPage projectKey="old" currentUser={currentUser} section="general" />);
    view.rerender(<ProjectSettingsPage projectKey="new" currentUser={currentUser} section="general" />);
    expect((await screen.findByLabelText(/^Name/) as HTMLInputElement).value).toBe("Current");
    await act(async () => { older.resolve({ ...settings, name: "Stale" }); });
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("Current");
    view.unmount();
  });

  it("Ontology when unlocked: the version is visible, branches and checks are under Advanced with plain labels (D8)", async () => {
    vi.mocked(api.updatePins).mockResolvedValue({ ...settings, pins: [{ ...settings.pins[0], sha256: "b".repeat(64), release: "2027", t1_profile: "generic" }], axis_defaults: {} });
    const view = renderSettings("ontology");
    const version = await screen.findByLabelText(/^HP version/);
    expect(version.closest("details")).toBeNull();
    expect(screen.getByLabelText("Limit HP terms to these branches").closest("details")!.querySelector("summary")!.textContent).toBe("Advanced");
    expect(within(screen.getByLabelText("Annotation scheme for HP")).getAllByRole("option").map(option => option.textContent)).toEqual(["HPO phenotype (fixed qualifiers, modifiers)", "Generic (free qualifiers)"]);
    fireEvent.change(version, { target: { value: "b".repeat(64) } });
    fireEvent.change(screen.getByLabelText("Annotation scheme for HP"), { target: { value: "generic" } });
    fireEvent.click(saveIn("Ontology version"));
    await screen.findByText("Ontology version saved.");
    expect(api.updatePins).toHaveBeenCalledWith(settings.project_key, [{ ontology_id: "HP", sha256: "b".repeat(64), allowed_roots: ["HP:1"], t1_profile: "generic" }]);
    expect(api.updateProjectSettings).not.toHaveBeenCalled();
    view.show("annotation");
    expect(shown("Present").disabled).toBe(false);
  });

  it("sends an uploaded profile unchanged through the distinct profile PUT", async () => {
    renderSettings("ontology");
    const uploaded = { ...profile, profile_id: "replacement", custom_metadata: { keep: true } };
    fireEvent.change(await screen.findByLabelText("Profile file (JSON)"), { target: { files: [new File([JSON.stringify(uploaded)], "replacement.json")] } });
    await waitFor(() => expect((saveIn("Task profile") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveIn("Task profile"));
    await screen.findByText("Task profile saved.");
    expect(api.updateProjectProfile).toHaveBeenCalledWith(settings.project_key, uploaded);
    expect(api.updateProjectSettings).not.toHaveBeenCalled();
    expect(api.updatePins).not.toHaveBeenCalled();
  });

  it("preserves dirty pin selections across a compatible profile save and submits them afterward", async () => {
    const pending = deferred<typeof settings>();
    vi.mocked(api.updateProjectProfile).mockReturnValue(pending.promise);
    const view = renderSettings("ontology");
    fireEvent.change(await screen.findByLabelText(/^HP version/), { target: { value: "b".repeat(64) } });
    fireEvent.change(screen.getByLabelText("Limit HP terms to these branches"), { target: { value: "HP:2, HP:3" } });
    fireEvent.change(screen.getByLabelText("Annotation scheme for HP"), { target: { value: "generic" } });
    fireEvent.change(screen.getByLabelText("Profile file (JSON)"), { target: { files: [new File([JSON.stringify(profile)], "compatible.json")] } });
    await waitFor(() => expect((saveIn("Task profile") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveIn("Task profile"));
    await act(async () => { pending.resolve({ ...settings, axis_defaults: {} }); });
    await screen.findByText("Task profile saved.");
    expect((screen.getByLabelText(/^HP version/) as HTMLSelectElement).value).toBe("b".repeat(64));
    expect((screen.getByLabelText("Limit HP terms to these branches") as HTMLInputElement).value).toBe("HP:2, HP:3");
    expect((screen.getByLabelText("Annotation scheme for HP") as HTMLSelectElement).value).toBe("generic");
    view.show("annotation");
    expect(shown("Present").disabled).toBe(false);
    view.show("ontology");
    expect((saveIn("Task profile") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(saveIn("Ontology version"));
    await screen.findByText("Ontology version saved.");
    expect(api.updatePins).toHaveBeenCalledWith(settings.project_key, [{ ontology_id: "HP", sha256: "b".repeat(64), allowed_roots: ["HP:2", "HP:3"], t1_profile: "generic" }]);
    expect((screen.getByLabelText(/^HP version/) as HTMLSelectElement).value).toBe(settings.pins[0].sha256);
  });

  it("does not overwrite a newer pin draft when a pin save response arrives", async () => {
    const pending = deferred<typeof settings>();
    vi.mocked(api.updatePins).mockReturnValue(pending.promise);
    renderSettings("ontology");
    fireEvent.change(await screen.findByLabelText("Limit HP terms to these branches"), { target: { value: "HP:2" } });
    fireEvent.click(saveIn("Ontology version"));
    // A late draft event must survive even while normal UI controls are disabled.
    fireEvent.change(screen.getByLabelText("Limit HP terms to these branches"), { target: { value: "HP:3" } });
    await act(async () => { pending.resolve(settings); });
    await screen.findByText("Ontology version saved. Newer changes remain unsaved.");
    expect((screen.getByLabelText("Limit HP terms to these branches") as HTMLInputElement).value).toBe("HP:3");
    expect(api.updatePins).toHaveBeenCalledWith(settings.project_key, [{ ontology_id: "HP", sha256: settings.pins[0].sha256, allowed_roots: ["HP:2"], t1_profile: settings.pins[0].t1_profile }]);
  });

  it("lets unsaved annotation settings be explicitly discarded after pin metadata introduces a protected default", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue({ ...settings, axis_defaults: {}, pins: [{ ...settings.pins[0], t1_profile: "generic" }] });
    vi.mocked(api.updatePins).mockResolvedValue(settings);
    const view = renderSettings("annotation");
    fireEvent.click(await screen.findByRole("button", { name: "Present" }));
    view.show("ontology");
    fireEvent.change(screen.getByLabelText("Annotation scheme for HP"), { target: { value: "hpo-phenotype" } });
    fireEvent.click(saveIn("Ontology version"));
    await screen.findByText("Ontology version saved.");
    view.show("annotation");
    expect(shown("Present").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(within(screen.getByRole("form", { name: "Annotation" })).getByRole("button", { name: "Discard changes" }));
    const defaultValue = shown("Present");
    expect(defaultValue.getAttribute("aria-pressed")).toBe("true");
    expect(defaultValue.disabled).toBe(true);
    expect(api.updateProjectSettings).not.toHaveBeenCalled();
  });

  it("blocks repeated section writes and suppresses onSaved after unmount", async () => {
    const pending = deferred<typeof settings>();
    vi.mocked(api.updateProjectSettings).mockReturnValue(pending.promise);
    const onSaved = vi.fn();
    const view = render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} onSaved={onSaved} section="general" />);
    const form = (await screen.findByRole("button", { name: "Save changes" })).closest("form")!;
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
    render(<ProjectSettingsPage projectKey={settings.project_key} currentUser={currentUser} section="general" />);
    expect(await screen.findByRole("alert")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByLabelText(/^Name/);
    expect(api.getProjectSettings).toHaveBeenCalledTimes(2);
    expect(adminInventory).not.toHaveBeenCalled();
    expect(adminUsers).not.toHaveBeenCalled();
  });

  it("General names what the languages do and where the description shows (D4, P4)", async () => {
    renderSettings("general");
    expect(await screen.findByRole("combobox", { name: /^Languages of the texts/ })).toBeDefined();
    expect(screen.getByText(/An import refuses texts in other languages\. Empty: any language\./)).toBeDefined();
    expect(screen.getByText("Shown under the project name on Projects.")).toBeDefined();
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
  const WORKFLOW_BODY = { import_plan: "review_and_annotate_translations", annotations_per_text: 1, tool_proposal_mode: "proposals", annotate_accepted_translations_only: true, adjudicator_not_annotator: false };

  it("reads in the order a text moves through work, with the new copy (M-8b)", async () => {
    const view = renderSettings();
    await screen.findByRole("navigation", { name: "Settings sections" });
    view.show("workflow");
    const form = screen.getByRole("form", { name: "Workflow" });
    expect(document.activeElement).toBe(form);
    expect(within(form).getAllByRole("heading", { level: 2 }).map(heading => heading.textContent)).toEqual(["New imports", "Texts with tool proposals", "Annotation and consolidation"]);
    const group = within(form).getByRole("radiogroup", { name: "When texts are imported" });
    expect(within(group).getAllByRole("radio").map(radio => radio.closest("label")!.textContent)).toEqual(["Plan review and annotation for every translation", "Do not plan anything (plan texts on Documents)"]);
    expect(within(group).getByRole("radio", { name: "Plan review and annotation for every translation" })).toHaveProperty("checked", true);
    expect(within(form).getByText("Applies to texts imported from now on. Single texts can be changed on Documents (Plan…); those changes stay.")).toBeTruthy();
    fireEvent.click(within(group).getByRole("radio", { name: "Do not plan anything (plan texts on Documents)" }));
    const count = within(form).getByRole("spinbutton", { name: /Annotators per text/ });
    expect(count).toHaveProperty("min", "1");
    expect(count).toHaveProperty("max", "5");
    expect(within(form).getByText("An upper limit per text when you assign; fewer is fine.")).toBeTruthy();
    fireEvent.change(count, { target: { value: "3" } });
    vi.mocked(api.updateProjectSettings).mockResolvedValue({ ...settings, import_plan: "nothing", annotations_per_text: 3 });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    await within(form).findByText("Workflow saved.");
    expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, { ...WORKFLOW_BODY, import_plan: "nothing", annotations_per_text: 3 });
  });

  it("shows how many rows exceed a lowered target", async () => {
    const preview = vi.spyOn(api, "annotationTargetPreview").mockResolvedValue({ rows_over_target: 4 });
    vi.mocked(api.getProjectSettings).mockResolvedValue({ ...settings, annotations_per_text: 3 });
    renderSettings("workflow");
    const count = await screen.findByRole("spinbutton", { name: /Annotators per text/ });
    expect(screen.queryByText(/Nobody is removed\./)).toBeNull();
    fireEvent.change(count, { target: { value: "2" } });
    expect(await screen.findByText("4 rows have more annotators than the new limit. Nobody is removed.")).toBeTruthy();
    expect(preview).toHaveBeenLastCalledWith(settings.project_key, 2);
    preview.mockResolvedValue({ rows_over_target: 0 });
    fireEvent.change(count, { target: { value: "1" } });
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith(settings.project_key, 1));
    expect(await screen.findByText("Nobody is removed.")).toBeTruthy();
    expect(screen.queryByText(/rows have more annotators/)).toBeNull();
    fireEvent.change(count, { target: { value: "4" } });
    await waitFor(() => expect(screen.queryByText(/Nobody is removed\./)).toBeNull());
  });

  it("always sends the whole workflow on save", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue({ ...settings, import_plan: "nothing", annotations_per_text: 2 });
    renderSettings("workflow");
    const form = await screen.findByRole("form", { name: "Workflow" });
    fireEvent.change(within(form).getByRole("spinbutton", { name: /Annotators per text/ }), { target: { value: "3" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateProjectSettings).toHaveBeenCalledWith(settings.project_key, { ...WORKFLOW_BODY, import_plan: "nothing", annotations_per_text: 3 }));
  });

  it("saves how annotators work on texts with tool proposals", async () => {
    vi.mocked(api.getProjectSettings).mockResolvedValue({ ...settings, tool_proposal_mode: "proposals" });
    renderSettings("workflow");
    const form = await screen.findByRole("form", { name: "Workflow" });
    const group = within(form).getByRole("radiogroup", { name: "Annotators work" });
    expect(within(group).getByRole("radio", { name: /From the proposals/ })).toHaveProperty("checked", true);
    expect(within(group).getByText("They confirm, reject or correct each proposal and add what the tool missed.")).toBeTruthy();
    expect(within(group).getByText("They start from the plain text and do not see the proposals.")).toBeTruthy();
    expect(within(form).getByText("The project default. A text's plan can override it until work on that text has started.")).toBeTruthy();
    fireEvent.click(within(group).getByRole("radio", { name: /From scratch/ }));
    vi.mocked(api.updateProjectSettings).mockResolvedValue({ ...settings, tool_proposal_mode: "scratch" });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    await within(form).findByText("Workflow saved.");
    expect(api.updateProjectSettings).toHaveBeenLastCalledWith(settings.project_key, expect.objectContaining({ tool_proposal_mode: "scratch" }));
  });

  it("the translation gate, annotators per text and the consolidator rule follow in that order (D3)", async () => {
    const gateLabel = "Wait for an accepted translation review before annotating";
    const consolidatorLabel = "The consolidator of a text may not be one of its annotators";
    const view = renderSettings("annotation");
    const annotation = await screen.findByRole("form", { name: "Annotation" });
    expect(within(annotation).queryByRole("checkbox", { name: gateLabel })).toBeNull();
    expect(within(annotation).queryByRole("checkbox", { name: consolidatorLabel })).toBeNull();
    fireEvent.click(within(annotation).getByRole("checkbox", { name: "A finding must be one continuous passage" }));
    fireEvent.click(within(annotation).getByRole("button", { name: "Save changes" }));
    await screen.findByText("Annotation saved.");
    expect(vi.mocked(api.updateProjectSettings).mock.lastCall![1]).not.toHaveProperty("adjudicator_not_annotator");
    view.show("workflow");
    const form = screen.getByRole("form", { name: "Workflow" });
    const gate = within(form).getByRole("checkbox", { name: gateLabel });
    expect(gate).toHaveProperty("checked", true);
    expect(within(form).getByText("Native source texts are never held back. The Assign dialog can override this for one assignment.")).toBeTruthy();
    const tools = within(form).getByRole("radiogroup", { name: "Annotators work" });
    const count = within(form).getByRole("spinbutton", { name: /Annotators per text/ });
    const consolidator = within(form).getByRole("checkbox", { name: consolidatorLabel });
    expect(tools.compareDocumentPosition(gate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gate.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(count.compareDocumentPosition(consolidator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(form).getByText("Checked when you assign consolidation.")).toBeTruthy();
    fireEvent.click(gate);
    fireEvent.click(consolidator);
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateProjectSettings).toHaveBeenLastCalledWith(settings.project_key, expect.objectContaining({ annotate_accepted_translations_only: false, adjudicator_not_annotator: true })));
  });

  it("names the consolidator rule in D2 words", async () => {
    renderSettings("workflow");
    expect(await screen.findByRole("checkbox", { name: "The consolidator of a text may not be one of its annotators" })).toBeTruthy();
    expect(screen.queryByText(/adjudicator/i)).toBeNull();
  });
});
