import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { AppVersion } from "../src/help/AppVersion";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("AppVersion", () => {
  it("shows the version and the short commit, with the full commit on hover", async () => {
    vi.spyOn(api, "getAbout").mockResolvedValue({ version: "0.3.0", revision: "cc65cea5558f85384f92c6bfb07a15f5a3fabe2b" });
    render(<AppVersion />);
    const line = await screen.findByText("Ontotator 0.3.0 · commit cc65cea");
    expect(line.getAttribute("title")).toBe("cc65cea5558f85384f92c6bfb07a15f5a3fabe2b");
  });

  it("shows the version alone without a known commit", async () => {
    vi.spyOn(api, "getAbout").mockResolvedValue({ version: "0.3.0", revision: null });
    render(<AppVersion />);
    expect(await screen.findByText("Ontotator 0.3.0")).toBeTruthy();
  });

  it("shows nothing when the request fails", async () => {
    const failed = Promise.reject(new Error("offline"));
    vi.spyOn(api, "getAbout").mockReturnValue(failed);
    const { container } = render(<AppVersion />);
    await failed.catch(() => undefined);
    expect(container.textContent).toBe("");
  });
});
