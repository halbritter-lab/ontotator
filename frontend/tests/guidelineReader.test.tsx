import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { GuidelineReader } from "../src/guidelines/GuidelineReader";
import { guidelineDocument, guidelineSummary, withdrawnGuideline } from "./projectFixtures";

// Load the lazy Markdown chunk once, so the first rendering test does not pay for it.
beforeAll(async () => { await import("../src/ui/MarkdownBody"); }, 30_000);
beforeEach(() => {
  vi.spyOn(api, "recordGuidelineRead").mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("GuidelineReader", () => {
  it("renders the meta line Published {date}, {change note}", async () => {
    vi.spyOn(api, "getGuideline").mockResolvedValue(guidelineDocument(guidelineSummary(3, { change_note: "Negations are now annotated." })));
    render(<GuidelineReader projectKey="p/key" version={3} currentVersion={3} />);
    expect(await screen.findByRole("heading", { level: 2, name: "Guidelines v3" })).toBeDefined();
    expect(screen.getByText("Published 13 Oct, Negations are now annotated.")).toBeDefined();
    expect(await screen.findByRole("heading", { level: 3, name: "Guide v3" })).toBeDefined();
    expect(screen.queryByText(/The current version is/)).toBeNull();
    expect(api.getGuideline).toHaveBeenCalledWith("p/key", 3);
    await waitFor(() => expect(api.recordGuidelineRead).toHaveBeenCalledWith("p/key", 3, "opened"));
  });

  it("renders the meta line without a change note and plain text in pre", async () => {
    vi.spyOn(api, "getGuideline").mockResolvedValue(guidelineDocument(guidelineSummary(1, { kind: "text", change_note: null }), "Line one\r\nLine two"));
    const { container } = render(<GuidelineReader projectKey="p/key" version={1} currentVersion={1} headingLevel={3} />);
    expect(await screen.findByRole("heading", { level: 3, name: "Guidelines v1" })).toBeDefined();
    expect(screen.getByText("Published 11 Oct")).toBeDefined();
    expect(container.querySelector("pre")?.textContent).toBe("Line one\nLine two");
  });

  it("shows the older-version banner", async () => {
    vi.spyOn(api, "getGuideline").mockResolvedValue(guidelineDocument(guidelineSummary(2)));
    render(<GuidelineReader projectKey="p/key" version={2} currentVersion={3} />);
    expect(await screen.findByText("This is v2. The current version is v3.")).toBeDefined();
  });

  it("shows v3 was withdrawn by the project lead. for a withdrawn version", async () => {
    vi.spyOn(api, "getGuideline").mockResolvedValue(guidelineDocument(withdrawnGuideline(3, "Wrong file")));
    const { container } = render(<GuidelineReader projectKey="p/key" version={3} currentVersion={null} />);
    expect(await screen.findByText("v3 was withdrawn by the project lead.")).toBeDefined();
    expect(screen.queryByText(/^Published/)).toBeNull();
    expect(container.querySelector(".guideline-document")).toBeNull();
    expect(api.recordGuidelineRead).not.toHaveBeenCalled();
  });

  it("shows the server error when the version cannot be loaded", async () => {
    vi.spyOn(api, "getGuideline").mockRejectedValue(new Error("Network down"));
    render(<GuidelineReader projectKey="p/key" version={9} currentVersion={3} />);
    expect(await screen.findByText("Network down")).toBeDefined();
  });
});
