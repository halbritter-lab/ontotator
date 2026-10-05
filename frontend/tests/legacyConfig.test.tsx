import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, setActiveSessionToken } from "../src/api/client";
import { App } from "../src/App";

const LEGACY_PATH = "C:\\Users\\x\\AppData\\Roaming\\ontocurator\\config.json";

const legacyStatus = {
  found: true,
  path: LEGACY_PATH,
  folder: "C:\\Users\\x\\AppData\\Roaming\\ontocurator",
  ontologies: [
    { path: "D:\\old\\hp.json", status: "found" as const },
    { path: "D:\\old\\gone.json", status: "missing" as const },
  ],
  port: 8123,
  auto_open_browser: false,
};

const mockServer = (legacy: object = legacyStatus) => {
  vi.spyOn(api, "getSettings").mockResolvedValue({
    allowed_modes: ["independent", "review", "assisted"],
    default_mode: "independent",
    annotator_id: null,
    open_package: null,
  });
  vi.spyOn(api, "getProvisioning").mockResolvedValue({ notices: [] });
  vi.spyOn(api, "getPreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
  vi.spyOn(api, "listOntologies").mockResolvedValue([]);
  vi.spyOn(api, "listPackages").mockResolvedValue([{ package_id: "pkg-a" }] as any);
  vi.spyOn(api, "listDocuments").mockResolvedValue([]);
  return vi.spyOn(api, "getLegacyConfig").mockResolvedValue(legacy as any);
};

const notice = () => screen.findByRole("region", { name: /Settings from an earlier installation/i });

beforeEach(() => {
  window.localStorage.clear();
  history.replaceState(null, "", "/");
  setActiveSessionToken(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("settings from an earlier installation", () => {
  it("shows what was found, marking missing files, and imports nothing by itself", async () => {
    mockServer();
    const imp = vi.spyOn(api, "importLegacyConfig");
    render(<App />);
    const region = await notice();
    expect(region.textContent).toMatch(/Settings from an earlier Ontocurator installation were found/);
    expect(region.textContent).toContain(LEGACY_PATH);
    expect(region.textContent).toContain("D:\\old\\hp.json");
    expect(within(region).getByText(/D:\\old\\gone\.json/).closest("li")?.textContent).toMatch(/file not found, will be skipped/);
    expect(region.textContent).toMatch(/Port: 8123/);
    expect(region.textContent).toMatch(/Open the browser automatically on start: No/);
    expect(region.textContent).toMatch(/next time Ontocurator starts/);
    expect(imp).not.toHaveBeenCalled();
  });

  it("shows nothing when the server reports no earlier settings", async () => {
    mockServer({ found: false, path: null, folder: null, ontologies: [], port: null, auto_open_browser: null });
    render(<App />);
    await screen.findByRole("table");
    expect(screen.queryByRole("region", { name: /Settings from an earlier installation/i })).toBeNull();
  });

  it("imports on request, reports the result and reloads the ontologies", async () => {
    mockServer();
    const imp = vi.spyOn(api, "importLegacyConfig").mockResolvedValue({
      imported_ontologies: ["C:\\app\\workspace\\ontologies\\hp-abc.json"],
      skipped_ontologies: [{ path: "D:\\old\\gone.json", reason: "file not found" }],
      port: 8123,
      auto_open_browser: false,
      restart_required: true,
    });
    render(<App />);
    const region = await notice();
    const listCalls = (api.listOntologies as any).mock.calls.length;
    fireEvent.click(within(region).getByRole("button", { name: /Import settings/i }));
    await waitFor(() => expect(imp).toHaveBeenCalledTimes(1));
    const result = await screen.findByRole("status", { name: "Import result" });
    expect(result.textContent).toMatch(/1 ontology file/);
    expect(result.textContent).toMatch(/gone\.json/);
    expect(result.textContent).toMatch(/next time Ontocurator starts/);
    expect(screen.queryByRole("region", { name: /Settings from an earlier installation/i })).toBeNull();
    await waitFor(() => expect((api.listOntologies as any).mock.calls.length).toBeGreaterThan(listCalls));
  });

  it("ignores on request and hides the notice", async () => {
    mockServer();
    const dismiss = vi.spyOn(api, "dismissLegacyConfig").mockResolvedValue({ found: false } as any);
    render(<App />);
    const region = await notice();
    fireEvent.click(within(region).getByRole("button", { name: /^Ignore$/i }));
    await waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /Settings from an earlier installation/i })).toBeNull(),
    );
  });

  it("opens the folder through the server (no path is sent)", async () => {
    mockServer();
    const open = vi.spyOn(api, "openLegacyConfigFolder").mockResolvedValue({ folder: legacyStatus.folder });
    render(<App />);
    const region = await notice();
    fireEvent.click(within(region).getByRole("button", { name: /Open folder/i }));
    await waitFor(() => expect(open).toHaveBeenCalledWith());
  });

  it("asks before deleting, names the file and can be cancelled", async () => {
    mockServer();
    const del = vi.spyOn(api, "deleteLegacyConfig").mockResolvedValue({ deleted: LEGACY_PATH });
    render(<App />);
    const region = await notice();
    fireEvent.click(within(region).getByRole("button", { name: /Delete old settings/i }));
    const dialog = await screen.findByRole("dialog", { name: /Delete old settings/i });
    expect(dialog.textContent).toContain(LEGACY_PATH);
    expect(dialog.textContent).toMatch(/workspace.*not affected|not affected/i);
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/i }));
    expect(screen.queryByRole("dialog", { name: /Delete old settings/i })).toBeNull();
    expect(del).not.toHaveBeenCalled();

    fireEvent.click(within(region).getByRole("button", { name: /Delete old settings/i }));
    const again = await screen.findByRole("dialog", { name: /Delete old settings/i });
    fireEvent.click(within(again).getByRole("button", { name: /Delete file/i }));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    const result = await screen.findByRole("status", { name: "Import result" });
    expect(result.textContent).toMatch(/deleted/i);
    expect(screen.queryByRole("region", { name: /Settings from an earlier installation/i })).toBeNull();
  });

  it("shows a readable error when deleting fails", async () => {
    mockServer();
    vi.spyOn(api, "deleteLegacyConfig").mockRejectedValue(new Error("in use"));
    render(<App />);
    const region = await notice();
    fireEvent.click(within(region).getByRole("button", { name: /Delete old settings/i }));
    const dialog = await screen.findByRole("dialog", { name: /Delete old settings/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Delete file/i }));
    expect(await screen.findByText(/Could not delete the old settings file: in use/)).toBeTruthy();
  });
});
