import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type AdminOntology, type OntologyUploadResult } from "../src/api/client";
import { OntologiesPage } from "../src/admin/OntologiesPage";
import { formatDateTime } from "../src/app/labels";

const ontology: AdminOntology = { filename: "mondo.json", kind: "ontology", prefix: "MONDO", release: "2026-09-01", language: null, sha256: "a".repeat(64), uploaded_at: "2026-10-15T09:30:00Z", projects: ["project / one"] };
const translation: AdminOntology = { ...ontology, filename: "mondo-de.tsv", kind: "translation", language: "de", release: null, sha256: "b".repeat(64), projects: [] };
const translated: OntologyUploadResult[] = [{ filename: "mondo-de.tsv", status: "added", ontology: translation }];
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const chosen = () => screen.getByLabelText("Ontology files", { selector: "input" }) as HTMLInputElement;
const upload = () => screen.getByRole("button", { name: "Upload files" }) as HTMLButtonElement;
const files = () => [new File(["{}"], "mondo.json"), new File(["label"], "mondo-de.tsv")];

beforeEach(() => { vi.spyOn(api, "adminListOntologies").mockResolvedValue([ontology]); vi.spyOn(api, "adminUploadOntologies").mockResolvedValue(translated); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("ontology administration page", () => {
  it("lists files with their actual metadata, local date, full digest and controlled project links", async () => {
    vi.mocked(api.adminListOntologies).mockResolvedValue([ontology, translation]);
    const navigate = vi.fn(); render(<OntologiesPage onNavigate={navigate} />);
    await screen.findByText("mondo.json");
    const table = screen.getByRole("table", { name: "Ontology files" });
    expect(within(table).getByText("translation")).toBeTruthy();
    expect(within(table).getByText("2026-09-01")).toBeTruthy();
    expect(within(table).getByText("de")).toBeTruthy();
    expect(within(table).getByText("a".repeat(12)).getAttribute("title")).toBe(ontology.sha256);
    expect(within(table).getAllByText(formatDateTime(ontology.uploaded_at))).toHaveLength(2);
    const link = screen.getByRole("link", { name: "project / one" });
    expect(link.getAttribute("href")).toBe("#/projects/project%20%2F%20one/settings");
    fireEvent.click(link, { ctrlKey: true }); expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(link); expect(navigate).toHaveBeenCalledWith({ name: "projectSettings", key: "project / one" });
    expect(chosen().accept).toBe(".json,.tsv"); expect(chosen().multiple).toBe(true);
    expect(screen.getByText("OBO Graph JSON ontologies and Babelon translation files")).toBeTruthy();
  });

  it("uploads selected File objects, disables busy controls and refreshes after success", async () => {
    const pending = deferred<OntologyUploadResult[]>(); vi.mocked(api.adminUploadOntologies).mockReturnValue(pending.promise);
    vi.mocked(api.adminListOntologies).mockResolvedValueOnce([ontology]).mockResolvedValue([ontology, translation]);
    render(<OntologiesPage onNavigate={vi.fn()} />); await screen.findByText("mondo.json");
    const selected = files(); fireEvent.change(chosen(), { target: { files: selected } });
    fireEvent.click(upload());
    fireEvent.click(upload());
    expect(api.adminUploadOntologies).toHaveBeenCalledWith(selected);
    expect(api.adminUploadOntologies).toHaveBeenCalledOnce();
    expect(screen.getByText("Uploading 2 files …")).toBeTruthy();
    expect(chosen().disabled).toBe(true); expect(upload().disabled).toBe(true);
    await act(async () => pending.resolve(translated));
    await within(screen.getByRole("table", { name: "Ontology files" })).findByText("mondo-de.tsv");
    expect(api.adminListOntologies).toHaveBeenCalledTimes(2);
    expect(chosen().disabled).toBe(false);
  });

  it("refreshes after an invalid later file, shows source details and retains selection for correction", async () => {
    vi.mocked(api.adminUploadOntologies).mockRejectedValue(new ApiError(422, "Missing graph nodes in bad.json", "INVALID_ONTOLOGY"));
    vi.mocked(api.adminListOntologies).mockResolvedValueOnce([]).mockResolvedValue([ontology]);
    render(<OntologiesPage onNavigate={vi.fn()} />); await screen.findByText("No ontology files uploaded yet.");
    const selected = files(); fireEvent.change(chosen(), { target: { files: selected } }); fireEvent.click(upload());
    await screen.findByText("Missing graph nodes in bad.json");
    await screen.findByText("mondo.json");
    expect(api.adminListOntologies).toHaveBeenCalledTimes(2);
    expect(Array.from(chosen().files ?? [])).toEqual(selected);
    expect(upload().disabled).toBe(false);
    expect(screen.queryByText(/All files were rolled back/)).toBeNull();
  });

  it("keeps an upload refusal and reports a failed inventory refresh with retry", async () => {
    vi.mocked(api.adminUploadOntologies).mockRejectedValue(new Error("Upload interrupted"));
    vi.mocked(api.adminListOntologies).mockResolvedValueOnce([ontology]).mockRejectedValueOnce(new Error("Inventory offline")).mockResolvedValue([ontology, translation]);
    render(<OntologiesPage onNavigate={vi.fn()} />); await screen.findByText("mondo.json");
    fireEvent.change(chosen(), { target: { files: files() } }); fireEvent.click(upload());
    await screen.findByText("Inventory offline"); expect(screen.getByText("Upload interrupted")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh inventory" }));
    await screen.findByText("mondo-de.tsv"); expect(screen.getByText("Upload interrupted")).toBeTruthy();
  });

  it("disables upload while loading or without a selection and retries a failed initial load", async () => {
    vi.mocked(api.adminListOntologies).mockRejectedValueOnce(new Error("Offline"));
    render(<OntologiesPage onNavigate={vi.fn()} />);
    expect(upload().disabled).toBe(true);
    await screen.findByText("Offline");
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh inventory" }));
    await screen.findByText("mondo.json"); expect(upload().disabled).toBe(true);
  });

  it("ignores the older initial response after StrictMode effect cleanup", async () => {
    const old = deferred<AdminOntology[]>(); const current = deferred<AdminOntology[]>();
    vi.mocked(api.adminListOntologies).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    render(<StrictMode><OntologiesPage onNavigate={vi.fn()} /></StrictMode>);
    await act(async () => current.resolve([translation])); await screen.findByText("mondo-de.tsv");
    await act(async () => old.resolve([ontology])); expect(screen.queryByText("mondo.json")).toBeNull();
  });

  it("does not refresh a page after an in-flight upload completes following unmount", async () => {
    const pending = deferred<OntologyUploadResult[]>(); vi.mocked(api.adminUploadOntologies).mockReturnValue(pending.promise);
    const view = render(<OntologiesPage onNavigate={vi.fn()} />); await screen.findByText("mondo.json");
    fireEvent.change(chosen(), { target: { files: files() } }); fireEvent.click(upload()); view.unmount();
    await act(async () => pending.resolve(translated)); expect(api.adminListOntologies).toHaveBeenCalledOnce();
  });

  it("announces copied only after clipboard success and reports clipboard refusal", async () => {
    const pending = deferred<void>(); const writeText = vi.fn().mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new Error("Clipboard denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<OntologiesPage onNavigate={vi.fn()} />); await screen.findByText("mondo.json");
    fireEvent.click(screen.getByRole("button", { name: "Copy SHA-256 for mondo.json" }));
    expect(writeText).toHaveBeenCalledWith(ontology.sha256); expect(screen.queryByText("Copied SHA-256 for mondo.json.")).toBeNull();
    await act(async () => pending.resolve()); await screen.findByText("Copied SHA-256 for mondo.json.");
    fireEvent.click(screen.getByRole("button", { name: "Copy SHA-256 for mondo.json" }));
    await screen.findByText("Clipboard denied"); expect(screen.queryByText("Copied SHA-256 for mondo.json.")).toBeNull();
  });

  it("renders ordered server outcomes for input aliases and duplicate filenames or SHA values", async () => {
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    const outcomes: OntologyUploadResult[] = [
      { filename: "z-alias.json", status: "already_present", ontology },
      { filename: "same.json", status: "added", ontology },
      { filename: "same.json", status: "already_present", ontology },
      { filename: "a-alias.json", status: "added", ontology },
    ];
    vi.mocked(api.adminUploadOntologies).mockResolvedValue(outcomes);
    vi.mocked(api.adminListOntologies).mockResolvedValueOnce([]).mockResolvedValue([ontology]);
    render(<OntologiesPage onNavigate={vi.fn()} />); await screen.findByText("No ontology files uploaded yet.");
    fireEvent.change(chosen(), { target: { files: outcomes.map(item => new File(["same"], item.filename)) } }); fireEvent.click(upload());
    const table = await screen.findByRole("table", { name: "Upload results" });
    expect(within(table).getAllByRole("row").slice(1).map(row => within(row).getAllByRole("cell").map(cell => cell.textContent))).toEqual([
      ["z-alias.json", "Already present"], ["same.json", "Added"], ["same.json", "Already present"], ["a-alias.json", "Added"],
    ]);
    expect(within(screen.getByRole("table", { name: "Ontology files" })).getByText("mondo.json")).toBeTruthy();
    expect(warning).not.toHaveBeenCalled();
  });

  it("clears obsolete outcomes on selection change and a failed retry while refreshing partial inventory", async () => {
    vi.mocked(api.adminUploadOntologies).mockResolvedValueOnce(translated).mockRejectedValueOnce(new Error("Later file rejected"));
    render(<OntologiesPage onNavigate={vi.fn()} />); await screen.findByText("mondo.json");
    fireEvent.change(chosen(), { target: { files: files() } }); fireEvent.click(upload());
    await screen.findByRole("table", { name: "Upload results" });
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(chosen(), { target: { files: [new File(["bad"], "bad.json")] } });
    expect(screen.queryByRole("table", { name: "Upload results" })).toBeNull();
    fireEvent.click(upload()); await screen.findByText("Later file rejected");
    expect(screen.queryByRole("table", { name: "Upload results" })).toBeNull();
    expect(api.adminListOntologies).toHaveBeenCalledTimes(3);
  });

  it("clears the previous attempt's outcomes immediately while retrying retained files", async () => {
    const retry = deferred<OntologyUploadResult[]>();
    vi.mocked(api.adminUploadOntologies).mockResolvedValueOnce(translated).mockReturnValueOnce(retry.promise);
    render(<OntologiesPage onNavigate={vi.fn()} />); await screen.findByText("mondo.json");
    fireEvent.change(chosen(), { target: { files: files() } }); fireEvent.click(upload());
    await screen.findByRole("table", { name: "Upload results" });
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(upload()); expect(screen.queryByRole("table", { name: "Upload results" })).toBeNull();
    await act(async () => retry.resolve([{ ...translated[0], status: "already_present" }]));
    await screen.findByText("Already present");
  });
});
