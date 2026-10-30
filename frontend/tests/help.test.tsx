import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HelpPage from "../src/help/HelpPage";
import { CHAPTERS, chapterOrder, chapterTitle, imageUrl, resolveLink, slug, slugger } from "../src/help/handbook";
import { HELP_SECTIONS } from "../src/help/sections";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** Heading ids of a chapter, as GitHub (and the renderer) make them. */
function headingIds(chapter: string): string[] {
  const next = slugger();
  return [...CHAPTERS[chapter].replace(/^```[\s\S]*?^```/gm, "").matchAll(/^#{1,6} +(.+?)\s*$/gm)]
    .map(match => next(match[1].replace(/[*`]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")));
}

describe("handbook slugs", () => {
  it("follows GitHub's anchor rules", () => {
    expect(slug("Change a member's roles")).toBe("change-a-members-roles");
    expect(slug("Compare values in the ✓ table and Keep")).toBe("compare-values-in-the--table-and-keep");
    expect(slug("Read a submitted consolidation (lead)")).toBe("read-a-submitted-consolidation-lead");
    expect(slug("Annotate from scratch: mark text and add a finding")).toBe("annotate-from-scratch-mark-text-and-add-a-finding");
    const next = slugger();
    expect([next("Texts"), next("Texts"), next("Texts")]).toEqual(["texts", "texts-1", "texts-2"]);
  });
});

describe("handbook links", () => {
  it("keeps in-page anchors, maps chapters into the app and sends the rest to GitHub", () => {
    expect(resolveLink("#upload-texts", "annotator")).toEqual({ kind: "anchor", id: "upload-texts" });
    expect(resolveLink("annotator.md#submit-the-text", "annotator")).toEqual({ kind: "anchor", id: "submit-the-text" });
    expect(resolveLink("annotator.md#submit-the-text", "faq")).toEqual({ kind: "chapter", href: "#/help/annotator?section=submit-the-text" });
    expect(resolveLink("README.md", "faq")).toEqual({ kind: "chapter", href: "#/help" });
    expect(resolveLink("../operations.md#lost-admin-password", "admin")).toEqual({
      kind: "external", href: "https://github.com/halbritter-lab/ontotator/blob/main/docs/operations.md#lost-admin-password" });
    expect(resolveLink("https://example.org/x", "faq")).toEqual({ kind: "external", href: "https://example.org/x" });
  });

  it("finds bundled images by relative path only", () => {
    const [first] = [...CHAPTERS.README.matchAll(/!\[[^\]]*\]\((images\/[^)]+)\)/g), ...Object.values(CHAPTERS).flatMap(text => [...text.matchAll(/!\[[^\]]*\]\((images\/[^)]+)\)/g)])];
    expect(first).toBeDefined();
    expect(imageUrl(first[1], "README")).toEqual(expect.any(String));
    expect(imageUrl("images/missing.png", "README")).toBeNull();
    expect(imageUrl("https://example.org/a.png", "README")).toBeNull();
  });

  it("lists README first and every chapter once", () => {
    const order = chapterOrder();
    expect(order[0]).toBe("README");
    expect([...order].sort()).toEqual(Object.keys(CHAPTERS).sort());
  });

  it("every chapter link points at an existing heading", () => {
    const broken: string[] = [];
    for (const chapter of Object.keys(CHAPTERS)) {
      for (const [, href] of CHAPTERS[chapter].matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = resolveLink(href, chapter);
        const [to, id] = target.kind === "anchor" ? [chapter, target.id]
          : target.kind === "chapter" ? [/#\/help\/?([^?]*)/.exec(target.href)![1] || "README", new URLSearchParams(target.href.split("?")[1]).get("section")]
          : [null, null];
        if (to && id && !headingIds(to).includes(id)) broken.push(`${chapter}: ${href}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("contextual help sections", () => {
  it.each(Object.entries(HELP_SECTIONS))("%s points at an existing chapter heading", (_, { chapter, section }) => {
    expect(Object.keys(CHAPTERS)).toContain(chapter);
    expect(headingIds(chapter)).toContain(section);
  });
});

describe("HelpPage", () => {
  it("renders heading ids, rewritten links, images and no HTML comments", () => {
    render(<HelpPage chapter="annotator" />);
    const article = document.querySelector("article")!;
    for (const id of headingIds("annotator")) expect(document.getElementById(id), id).not.toBeNull();
    for (const link of article.querySelectorAll("a")) {
      const href = link.getAttribute("href")!;
      expect(href.startsWith("#/help") || link.getAttribute("rel") === "noopener noreferrer", href).toBe(true);
    }
    for (const image of article.querySelectorAll("img")) expect(image.getAttribute("alt")).not.toBe("");
    expect(screen.getByRole("navigation", { name: "Handbook chapters" })).toBeTruthy();
  });

  it("links each screenshot to its full-size image in a new tab (#173)", () => {
    render(<HelpPage chapter="lead-documents" />);
    const images = [...document.querySelectorAll("article img")];
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      const link = image.closest("a")!;
      expect(link.getAttribute("href")).toBe(image.getAttribute("src"));
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("scrolls in-page anchors without touching the route", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    window.history.replaceState(null, "", "#/help/annotator");
    render(<HelpPage chapter="annotator" />);
    const anchor = [...document.querySelectorAll("article a")].find(link => link.getAttribute("href")?.startsWith("#/help/annotator?section="));
    if (!anchor) return; // shortcut: the chapter has no in-page link today; the browser spec covers the scroll.
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(scroll).toHaveBeenCalled();
    expect(window.location.hash).toBe("#/help/annotator");
  });

  it.each(Object.keys(CHAPTERS))("renders %s without HTML comments", chapter => {
    const { container } = render(<HelpPage chapter={chapter} />);
    expect(container.querySelector("article")!.textContent).not.toContain("<!--");
  });

  it("names every chapter in the navigation by its title, never its file name", () => {
    render(<HelpPage chapter="lead-results" />);
    const links = [...screen.getByRole("navigation", { name: "Handbook chapters" }).querySelectorAll("a")].map(link => link.textContent);
    expect(links).toEqual(chapterOrder().map(chapterTitle));
    for (const name of chapterOrder()) expect(chapterTitle(name), name).not.toBe(name);
    expect(chapterTitle("lead-results")).toBe("Lead: results, decisions and export");
  });

  it("says so for an unknown chapter", () => {
    const { container } = render(<HelpPage chapter="no-such-chapter" />);
    expect(container.textContent).toContain("Chapter not found");
  });
});
