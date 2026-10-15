import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { App } from "../src/App";

const ALL_MODES = ["independent", "review", "assisted"] as const;
type Mode = (typeof ALL_MODES)[number];

const docs = [
  { document_id: "doc-1", text_length: 10, language: "en", position: 1, status: "not_started" as const },
];

type Project = { package_id: string; name?: string; allowed_modes?: Mode[] };

const mockServer = (opts: {
  allowed?: Mode[];
  modeByPackage?: Record<string, Mode>;
  projects?: Project[];
}) => {
  vi.spyOn(api, "getPreferences").mockResolvedValue({
    last_annotator_id: null,
    mode_by_package: opts.modeByPackage ?? {},
  });
  vi.spyOn(api, "updatePreferences").mockResolvedValue({ last_annotator_id: null, mode_by_package: {} });
  vi.spyOn(api, "listOntologies").mockResolvedValue([]);
  vi.spyOn(api, "listPackages").mockResolvedValue(
    (opts.projects ?? [{ package_id: "pkg-a", allowed_modes: opts.allowed ?? [...ALL_MODES] }]).map((p) => ({
      name: p.package_id,
      description: null,
      roles: [],
      document_count: docs.length,
      ...p,
    })) as any,
  );
  return vi.spyOn(api, "listDocuments").mockResolvedValue(docs);
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("working modes from the project roles", () => {
  it("hides the mode chooser and shows the fixed mode when only one mode is allowed", async () => {
    const list = mockServer({ allowed: ["independent"], modeByPackage: { "pkg-a": "review" } });
    render(<App />);
    await screen.findByRole("table");
    expect(screen.queryByLabelText(/Working mode/i, { selector: "select" })).toBeNull();
    const fixed = screen.getByTestId("fixed-mode");
    expect(fixed.textContent).toMatch(/Annotate from scratch/);
    expect(screen.getByText(/Set by your role in this project\./)).toBeDefined();
    // A stored mode that the roles do not give is not used.
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("pkg-a", expect.objectContaining({ mode: "independent" })));
  });

  it("offers only allowed modes and starts with the first", async () => {
    const list = mockServer({ allowed: ["review", "assisted"] });
    render(<App />);
    await screen.findByRole("table");
    const select = screen.getByLabelText(/Working mode/i, { selector: "select" }) as HTMLSelectElement;
    expect(select.value).toBe("review");
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["review", "assisted"]);
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("pkg-a", expect.objectContaining({ mode: "review" })));
  });

  it("shows a notice without a working role", async () => {
    mockServer({ allowed: [] });
    render(<App />);
    expect((await screen.findByTestId("no-working-role")).textContent).toMatch(
      /You have no working role in this project\./,
    );
    expect(screen.queryByRole("button", { name: /^Open case$/i })).toBeNull();
    expect(screen.queryByLabelText(/Working mode/i, { selector: "select" })).toBeNull();
  });

  it("names the projects and selects the first", async () => {
    const list = mockServer({
      projects: [
        { package_id: "study-xy", name: "Study XY", allowed_modes: ["independent"] },
        { package_id: "pkg-a", allowed_modes: ["independent"] },
      ],
    });
    render(<App />);
    await screen.findByRole("table");
    const select = screen.getByLabelText(/^Project$/i, { selector: "select" }) as HTMLSelectElement;
    expect(select.value).toBe("study-xy");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Study XY (study-xy)", "pkg-a"]);
    expect(list).toHaveBeenLastCalledWith("study-xy", expect.anything());
  });
});
