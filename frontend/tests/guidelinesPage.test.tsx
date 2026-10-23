import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { GuidelinesPage } from "../src/guidelines/GuidelinesPage";
import { guidelineDocument, guidelineListing, guidelineSummary, withdrawnGuideline } from "./projectFixtures";

// Load the lazy Markdown chunk once, so the first rendering test does not pay for it.
beforeAll(async () => { await import("../src/ui/MarkdownBody"); }, 30_000);
beforeEach(() => {
  vi.spyOn(api, "recordGuidelineRead").mockResolvedValue(undefined);
  vi.spyOn(api, "getGuideline").mockImplementation(async (_key, version) => guidelineDocument(guidelineSummary(version)));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const three = () => guidelineListing([guidelineSummary(3), guidelineSummary(2), guidelineSummary(1)]);
const versionList = () => screen.getByRole("list", { name: "Versions" });

describe("GuidelinesPage", () => {
  it("shows the current version and the list without Seen by for non-leads", async () => {
    vi.spyOn(api, "listGuidelines").mockResolvedValue(three());
    render(<GuidelinesPage projectKey="p/key" canManage={false} onNavigate={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Project guidelines" })).toBeDefined();
    expect(await screen.findByRole("heading", { level: 2, name: "Guidelines v3" })).toBeDefined();
    expect(api.listGuidelines).toHaveBeenCalledWith("p/key");
    // The heading commits before the reader's passive effect fetches the text; under load findByRole can return in between.
    await waitFor(() => expect(api.getGuideline).toHaveBeenCalledWith("p/key", 3));
    expect(screen.queryByText(/The current version is/)).toBeNull();
    const items = within(versionList()).getAllByRole("listitem");
    expect(items.map(item => item.textContent)).toEqual([
      "v3, Published 13 Oct, Change 3, current",
      "v2, Published 12 Oct, Change 2",
      "v1, Published 11 Oct, Change 1",
    ]);
    expect(within(items[0]).getByRole("link", { name: "v3" }).getAttribute("aria-current")).toBe("page");
    expect(within(items[1]).getByRole("link", { name: "v2" }).getAttribute("href")).toBe("#/projects/p%2Fkey/guidelines/v2");
    expect(screen.queryByText(/Seen by/)).toBeNull();
    await waitFor(() => expect(api.recordGuidelineRead).toHaveBeenCalledWith("p/key", 3, "opened"));
  });

  it("shows Seen by to leads", async () => {
    vi.spyOn(api, "listGuidelines").mockResolvedValue(three());
    render(<GuidelinesPage projectKey="p/key" canManage onNavigate={vi.fn()} />);
    const items = await within(await screen.findByRole("list", { name: "Versions" })).findAllByRole("listitem");
    expect(items[0].textContent).toBe("v3, Published 13 Oct, Change 3, current, Seen by 4 of 6 task members");
  });

  it("lists withdrawn versions as v4, Withdrawn 21 Oct without text", async () => {
    vi.spyOn(api, "listGuidelines").mockResolvedValue(guidelineListing([withdrawnGuideline(4, "Confidential reason"), guidelineSummary(3)]));
    render(<GuidelinesPage projectKey="p/key" canManage onNavigate={vi.fn()} />);
    expect(await screen.findByText("No guideline is in force.")).toBeDefined();
    const items = within(versionList()).getAllByRole("listitem");
    expect(items.map(item => item.textContent)).toEqual(["v4, Withdrawn 21 Oct", "v3, Published 13 Oct, Change 3, Seen by 4 of 6 task members"]);
    expect(within(items[0]).queryByRole("link")).toBeNull();
    expect(screen.queryByText(/Confidential reason/)).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: /^Guidelines v/ })).toBeNull();
    expect(api.getGuideline).not.toHaveBeenCalled();
  });

  it("opens a chosen version with the older-version banner", async () => {
    vi.spyOn(api, "listGuidelines").mockResolvedValue(three());
    const onNavigate = vi.fn();
    render(<GuidelinesPage projectKey="p/key" version={2} canManage={false} onNavigate={onNavigate} />);
    expect(await screen.findByRole("heading", { level: 2, name: "Guidelines v2" })).toBeDefined();
    expect(await screen.findByText("This is v2. The current version is v3.")).toBeDefined();
    expect(api.getGuideline).toHaveBeenCalledWith("p/key", 2);
    expect(within(versionList()).getByRole("link", { name: "v2" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(within(versionList()).getByRole("link", { name: "v1" }));
    expect(onNavigate).toHaveBeenCalledWith({ name: "projectGuidelines", key: "p/key", version: 1 });
  });

  it("says when the project has no guidelines and shows load errors", async () => {
    vi.spyOn(api, "listGuidelines").mockResolvedValue(guidelineListing([]));
    render(<GuidelinesPage projectKey="p/key" canManage={false} onNavigate={vi.fn()} />);
    expect(await screen.findByText("This project has no guidelines yet.")).toBeDefined();
    expect(screen.queryByRole("list", { name: "Versions" })).toBeNull();
    cleanup();
    vi.mocked(api.listGuidelines).mockRejectedValue(new Error("Network down"));
    render(<GuidelinesPage projectKey="p/key" canManage={false} onNavigate={vi.fn()} />);
    expect(await screen.findByText("Network down")).toBeDefined();
  });
});
