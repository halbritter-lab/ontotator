import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMediaQuery } from "../../src/ui/useMediaQuery";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Probe() { return <span>{useMediaQuery("(max-width: 699px)") ? "narrow" : "wide"}</span>; }

it("tracks_a_media_query", () => {
  let listener: (() => void) | null = null; let matches = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() { return matches; }, media: query,
    addEventListener: (_: string, l: () => void) => { listener = l; },
    removeEventListener: () => { listener = null; },
  }));
  render(<Probe />); expect(screen.getByText("wide")).toBeTruthy();
  act(() => { matches = true; listener?.(); }); expect(screen.getByText("narrow")).toBeTruthy();
});

it("is_false_without_matchMedia", () => {
  vi.stubGlobal("matchMedia", undefined);
  render(<Probe />);
  expect(screen.getByText("wide")).toBeTruthy();
});
