import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, setActiveSessionToken } from "../src/api/client";
import { App } from "../src/App";

const ALL_MODES = ["independent", "review", "assisted"] as const;
type Mode = (typeof ALL_MODES)[number];

const docs = [
  { document_id: "doc-1", text_length: 10, language: "en", position: 1, status: "not_started" as const },
];

const mockServer = (opts: {
  allowed?: Mode[];
  defaultMode?: Mode;
  annotator?: string | null;
  openPackage?: string | null;
  lastAnnotator?: string | null;
  modeByPackage?: Record<string, Mode>;
  packages?: string[];
}) => {
  vi.spyOn(api, "getSettings").mockResolvedValue({
    allowed_modes: opts.allowed ?? [...ALL_MODES],
    default_mode: opts.defaultMode ?? "independent",
    annotator_id: opts.annotator ?? null,
    open_package: opts.openPackage ?? null,
  });
  vi.spyOn(api, "getPreferences").mockResolvedValue({
    last_annotator_id: opts.lastAnnotator ?? null,
    mode_by_package: opts.modeByPackage ?? {},
  });
  vi.spyOn(api, "updatePreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
  vi.spyOn(api, "listOntologies").mockResolvedValue([]);
  vi.spyOn(api, "listPackages").mockResolvedValue(
    (opts.packages ?? ["pkg-a"]).map((package_id) => ({ package_id })) as any,
  );
  return vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  history.replaceState(null, "", "/");
  setActiveSessionToken(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("preconfigured distribution settings", () => {
  it("hides the mode chooser and shows the fixed mode when only one mode is allowed", async () => {
    const list = mockServer({ allowed: ["independent"], modeByPackage: { "pkg-a": "review" } });
    render(<App />);
    await screen.findByRole("table");
    expect(screen.queryByLabelText(/Working mode/i, { selector: "select" })).toBeNull();
    const fixed = screen.getByTestId("fixed-mode");
    expect(fixed.textContent).toMatch(/Annotate from scratch/);
    // A stored mode that is no longer allowed is not used.
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("pkg-a", expect.objectContaining({ mode: "independent" })));
  });

  it("offers only allowed modes in the chooser and starts with the default mode", async () => {
    const list = mockServer({ allowed: ["independent", "review"], defaultMode: "review" });
    render(<App />);
    await screen.findByRole("table");
    const select = screen.getByLabelText(/Working mode/i, { selector: "select" }) as HTMLSelectElement;
    expect(select.value).toBe("review");
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["independent", "review"]);
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("pkg-a", expect.objectContaining({ mode: "review" })));
  });

  it("prefills a preset identity but still asks for confirmation", async () => {
    mockServer({ annotator: "JPL", lastAnnotator: "OTHER" });
    const open = vi.spyOn(api, "openWorkspace").mockResolvedValue(undefined as any);
    render(<App />);
    await screen.findByRole("table");
    const input = screen.getByLabelText(/Your initials/i) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("JPL"));
    fireEvent.click(screen.getByRole("button", { name: /^Open case$/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/You are annotating as JPL/)).toBeDefined();
    expect(open).not.toHaveBeenCalled();
  });

  it("preselects the configured package", async () => {
    const list = mockServer({ packages: ["pkg-a", "study-xy"], openPackage: "study-xy" });
    render(<App />);
    await screen.findByRole("table");
    const select = screen.getByLabelText(/^Work package$/i, { selector: "select" }) as HTMLSelectElement;
    expect(select.value).toBe("study-xy");
    expect(list).toHaveBeenLastCalledWith("study-xy", expect.anything());
  });
});
