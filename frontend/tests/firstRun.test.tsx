import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiClient,
  AuthError,
  getActiveSessionToken,
  isSessionLostError,
  onSessionLost,
  parseTokenInput,
  setActiveSessionToken,
} from "../src/api/client";
import { App } from "../src/App";
import { CaseScreen } from "../src/app/CaseScreen";

const docs = [
  { document_id: "doc-1", text_length: 10, language: "en", position: 1, status: "completed" as const },
  { document_id: "doc-2", text_length: 10, language: "en", position: 2, status: "in_progress" as const },
];

const view = () => ({
  document: { document_id: "doc-2", text: "Patient has seizures.", language: "en", text_sha256: "x" },
  key: { package_id: "pkg", document_id: "doc-2", annotator_id: "JPL", mode: "independent" as const, scope_id: "s", target_set_id: "t" },
  scope: { scope_id: "s", mode: "independent" as const, editable_layer_ids: ["phenotype"], reference_layer_ids: [] },
  draft: { schema_version: "ontocurator-draft/v3" as const, revision: 7, annotations: [], decisions: [] },
  layers: [{ layer_id: "phenotype", label: "Phenotype", access: "editable" as const, default_visible: true, default_type_id: "default", annotation_types: [] }],
}) as any;

const sessionLost = () => new AuthError("Forbidden: Invalid session token", undefined, "SESSION_TOKEN_INVALID");

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  history.replaceState(null, "", "/");
  setActiveSessionToken(null);
  vi.spyOn(api, "listOntologies").mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("session token: restart detection", () => {
  it("parses a pasted link or a bare token", () => {
    expect(parseTokenInput("http://127.0.0.1:8000/#token=abc&package_id=p")).toEqual({ token: "abc", packageId: "p" });
    expect(parseTokenInput("  #token=xyz ")).toEqual({ token: "xyz", packageId: null });
    expect(parseTokenInput("token=xyz")).toEqual({ token: "xyz", packageId: null });
    expect(parseTokenInput("rawToken_123")).toEqual({ token: "rawToken_123", packageId: null });
    expect(parseTokenInput("http://127.0.0.1:8000/")).toEqual({ token: null, packageId: null });
    expect(parseTokenInput("   ")).toEqual({ token: null, packageId: null });
  });

  it("notifies listeners on 403 session errors, but not on other 403s", async () => {
    const seen: string[] = [];
    const off = onSessionLost((reason) => seen.push(reason));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ code: "SESSION_TOKEN_INVALID", detail: "Forbidden: Invalid session token" }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ detail: "Forbidden: Cross-origin request not permitted" }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ code: "SESSION_TOKEN_MISSING", detail: "Forbidden: Missing Bearer authorization token" }) });
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient({ token: "old" });
    const first = await client.listPackages().catch((e) => e);
    expect(isSessionLostError(first)).toBe(true);
    const second = await client.listPackages().catch((e) => e);
    expect(isSessionLostError(second)).toBe(false);
    await client.listPackages().catch(() => undefined);
    expect(seen).toEqual(["invalid", "missing"]);
    off();
  });

  it("replaces red token errors with a friendly full-page message", async () => {
    vi.spyOn(api, "getPreferences").mockRejectedValue(sessionLost());
    vi.spyOn(api, "listPackages").mockRejectedValue(sessionLost());
    render(<App />);
    const page = await screen.findByRole("main", { name: /Ontocurator needs to be reopened/i });
    expect(page.textContent).toMatch(/Ontocurator was restarted/);
    expect(page.textContent).toMatch(/double-click/i);
    expect(page.textContent).toMatch(/safe/i);
    expect(screen.queryByText(/Forbidden/)).toBeNull();
    expect(screen.queryByText(/Enter Session Token/i)).toBeNull();
  });

  it("recovers from a link pasted into the advanced field", async () => {
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
    const list = vi.spyOn(api, "listPackages").mockRejectedValueOnce(sessionLost()).mockResolvedValue([{ package_id: "pkg" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    render(<App />);
    await screen.findByText(/Ontocurator was restarted/);
    fireEvent.click(screen.getByText(/Advanced: paste link/i));
    fireEvent.change(screen.getByLabelText(/Link or access key/i), {
      target: { value: "http://127.0.0.1:8000/#token=fresh-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Connect$/i }));
    await waitFor(() => expect(screen.queryByText(/Ontocurator was restarted/)).toBeNull());
    expect(getActiveSessionToken()).toBe("fresh-token");
    expect(list).toHaveBeenCalledTimes(2);
    await screen.findByRole("table");
  });

  it("re-reads the token when a new link is pasted into the address bar (hashchange)", async () => {
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
    const list = vi.spyOn(api, "listPackages").mockRejectedValueOnce(sessionLost()).mockResolvedValue([{ package_id: "pkg" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    render(<App />);
    await screen.findByText(/Ontocurator was restarted/);
    await act(async () => {
      history.replaceState(null, "", "/#token=from-hash");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(screen.queryByText(/Ontocurator was restarted/)).toBeNull());
    expect(getActiveSessionToken()).toBe("from-hash");
    expect(window.location.hash).toBe("");
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe("dashboard: guided first run", () => {
  it("shows a 3-step guide with import as the primary action when there are no packages", async () => {
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
    vi.spyOn(api, "listPackages").mockResolvedValue([]);
    render(<App />);
    const guide = await screen.findByRole("region", { name: /Get started/i });
    expect(within(guide).getByText(/Import work package \(\.zip\)/i)).toBeDefined();
    expect(within(guide).getByText(/Enter your initials/i)).toBeDefined();
    expect(within(guide).getByText(/Open a case/i)).toBeDefined();
    const importBtn = within(guide).getByRole("button", { name: /Import work package/i });
    expect(importBtn.className).toContain("btn-primary");
    const input = document.querySelector('input[type="file"][accept=".zip"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(importBtn);
    expect(click).toHaveBeenCalled();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("uses real buttons for adding ontologies and importing packages", async () => {
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    render(<App />);
    await screen.findByRole("table");
    const header = document.querySelector(".app-header") as HTMLElement;
    expect(within(header).getByRole("button", { name: /Add ontology/i }).tagName).toBe("BUTTON");
    expect(within(header).getByRole("button", { name: /Import work package/i }).tagName).toBe("BUTTON");
  });

  it("confirms a successful import with the number of cases", async () => {
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
    vi.spyOn(api, "listPackages").mockResolvedValueOnce([]).mockResolvedValue([{ package_id: "ward-7" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    vi.spyOn(api, "uploadPackage").mockResolvedValue({ package_id: "ward-7", manifest: { package_id: "ward-7", document_order: ["a", "b", "c"] } as any });
    render(<App />);
    await screen.findByRole("region", { name: /Get started/i });
    const input = document.querySelector('input[type="file"][accept=".zip"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["z"], "ward-7.zip")] } });
    const note = await screen.findByRole("status", { name: /Import result/i });
    expect(note.textContent).toMatch(/Package 'ward-7' imported – 3 cases/);
  });

  it("uses plain mode labels with one-sentence explanations", async () => {
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    render(<App />);
    await screen.findByRole("table");
    const select = screen.getByLabelText(/Working mode/i) as HTMLSelectElement;
    expect(within(select).getByText("Annotate from scratch")).toBeDefined();
    expect(within(select).getByText("Review proposals")).toBeDefined();
    expect(screen.getByText("You won't see any proposals.")).toBeDefined();
    fireEvent.change(select, { target: { value: "review" } });
    expect(screen.getByText("Check suggested terms one by one: confirm, reject or change.")).toBeDefined();
    expect(document.body.textContent).not.toMatch(/origin-neutral|Independent Mode|Review Mode|Workspace/);
  });

  it("offers a single primary 'Open case' action", async () => {
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "JPL", mode_by_package: {} });
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    render(<App />);
    await screen.findByRole("table");
    expect(screen.getAllByRole("button", { name: /Open case/i })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Continue|Open Workspace|Open Case →/ })).toBeNull();
  });
});

describe("annotator identity", () => {
  it("has no default identity, requires one before opening, and ignores old browser storage", async () => {
    window.localStorage.setItem("ontocurator.annotatorId", "previous-person");
    window.localStorage.setItem("ontocurator.mode.pkg", "review");
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    const open = vi.spyOn(api, "openWorkspace");
    render(<App />);
    await screen.findByRole("table");
    const field = screen.getByLabelText(/Your initials \/ ID/i) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.required).toBe(true);
    expect(field.placeholder).toMatch(/e\.g\. JPL/);
    expect((screen.getByLabelText(/Working mode/i) as HTMLSelectElement).value).toBe("independent");
    const openBtn = screen.getByRole("button", { name: /Open case/i }) as HTMLButtonElement;
    expect(openBtn.disabled).toBe(true);
    expect(screen.getByText(/Enter your initials first/i)).toBeDefined();
    expect(open).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("ontocurator.annotatorId")).toBeNull();
    expect(window.localStorage.getItem("ontocurator.mode.pkg")).toBeNull();
  });

  it("asks to confirm the identity once and stores it in the workspace", async () => {
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
    const save = vi.spyOn(api, "updatePreferences").mockResolvedValue({ last_annotator_id: "JPL", mode_by_package: {} });
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    const open = vi.spyOn(api, "openWorkspace").mockResolvedValue({ workspace_id: "ws", view: view() });
    render(<App />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText(/Your initials \/ ID/i), { target: { value: " JPL " } });
    fireEvent.click(screen.getByRole("button", { name: /Open case/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/You are annotating as JPL/);
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /Yes, continue/i }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open.mock.calls[0][0].annotator_id).toBe("JPL");
    expect(save).toHaveBeenCalledWith({ last_annotator_id: "JPL" });
    expect(window.localStorage.getItem("ontocurator.annotatorId")).toBeNull();

    // Back on the dashboard, the same identity opens without asking again.
    fireEvent.click(await screen.findByRole("button", { name: /Dashboard/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Open case/i }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("prefills the last identity from the workspace but still asks to confirm it", async () => {
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: "AB", mode_by_package: { pkg: "review" } });
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
    const list = vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    render(<App />);
    await screen.findByRole("table");
    expect((screen.getByLabelText(/Your initials \/ ID/i) as HTMLInputElement).value).toBe("AB");
    expect((screen.getByLabelText(/Working mode/i) as HTMLSelectElement).value).toBe("review");
    expect(list.mock.calls[0][1]).toEqual({ annotator_id: "AB", mode: "review" });
    fireEvent.click(screen.getByRole("button", { name: /Open case/i }));
    expect((await screen.findByRole("dialog")).textContent).toMatch(/You are annotating as AB/);
    fireEvent.click(screen.getByRole("button", { name: /Change/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText(/Your initials \/ ID/i));
  });

  it("stores the working mode per package in the workspace", async () => {
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
    const save = vi.spyOn(api, "updatePreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: { pkg: "review" } });
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    render(<App />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText(/Working mode/i), { target: { value: "review" } });
    expect(save).toHaveBeenCalledWith({ mode_by_package: { pkg: "review" } });
    expect(window.localStorage.getItem("ontocurator.mode.pkg")).toBeNull();
  });

  it("rejects identities with control characters or over 64 characters", async () => {
    vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
    vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg" }] as any);
    vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
    render(<App />);
    await screen.findByRole("table");
    const field = screen.getByLabelText(/Your initials \/ ID/i);
    fireEvent.change(field, { target: { value: "x".repeat(65) } });
    expect((screen.getByRole("button", { name: /Open case/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/at most 64 characters/i)).toBeDefined();
  });
});

describe("editor and page polish", () => {
  it("shows 'Saved' without the revision number (revision in the tooltip)", () => {
    render(<CaseScreen view={view()} workspaceId="ws" onClose={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Saved/);
    expect(status.textContent).not.toMatch(/Rev/);
    expect(status.getAttribute("title")).toMatch(/7/);
  });

  it("declares an inline favicon and English page language", () => {
    const html = readFileSync(resolve(__dirname, "../index.html"), "utf-8");
    expect(html).toMatch(/<link rel="icon"[^>]*href="data:image\/svg\+xml/);
    expect(html).toMatch(/<html lang="en">/);
  });
});
