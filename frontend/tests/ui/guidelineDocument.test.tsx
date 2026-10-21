import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GuidelineDocument } from "../../src/ui";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

async function renderMarkdown(body: string, headingOffset?: number) {
  const view = render(<GuidelineDocument kind="markdown" body={body} headingOffset={headingOffset} />);
  await screen.findByTestId("guideline-markdown");
  return view;
}

describe("GuidelineDocument", () => {
  it("shows a loading text while the renderer chunk loads", () => {
    render(<GuidelineDocument kind="markdown" body="Hello" />);
    expect(screen.getByText("Loading guidelines…")).toBeTruthy();
  });

  it("renders raw HTML as text and never creates a script element", async () => {
    const { container } = await renderMarkdown('Before\n\n<script>window.pwned = 1</script>\n\n<b onclick="x()">bold</b> after');
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(container.textContent).toContain("<script>window.pwned = 1</script>");
    expect(container.textContent).toContain('<b onclick="x()">');
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it("drops javascript:, vbscript: and data: links", async () => {
    const { container } = await renderMarkdown(
      "[one](javascript:alert(1)) [two](JaVaScRiPt:alert(1)) [three](vbscript:msgbox) [four](data:text/html;base64,PHNjcmlwdD4=)",
    );
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/javascript:|vbscript:|data:/i);
    for (const text of ["one", "two", "three", "four"]) expect(screen.getByText(text)).toBeTruthy();
  });

  it("renders a link whose href the urlTransform emptied as text, never as <a href>", async () => {
    const { container } = await renderMarkdown("[unsafe](javascript:void(0)) and [also](xmpp:someone@example.org)");
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector('[href=""]')).toBeNull();
    expect(screen.getByText("unsafe").tagName).toBe("SPAN");
    expect(screen.getByText("also").tagName).toBe("SPAN");
  });

  it("opens http, https and mailto links in a new tab with noopener noreferrer", async () => {
    await renderMarkdown("[web](http://example.org/a) [secure](https://example.org/b) [mail](mailto:lead@example.org) <https://example.org/auto>");
    const expected: Array<[string, string]> = [
      ["web", "http://example.org/a"],
      ["secure", "https://example.org/b"],
      ["mail", "mailto:lead@example.org"],
      ["https://example.org/auto", "https://example.org/auto"],
    ];
    for (const [name, href] of expected) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("renders relative links and #anchors as text with the target shown", async () => {
    const { container } = await renderMarkdown("See [the rules](rules.md) and [below](#scope).\n\nA note.[^1]\n\n[^1]: Footnote text.");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("the rules (rules.md)");
    expect(container.textContent).toContain("below (#scope)");
    expect(container.textContent).toContain("Footnote text.");
  });

  it("renders images as the link Image: {alt} and never loads them", async () => {
    const { container } = await renderMarkdown("![Decision tree](https://example.org/tree.png)\n\n![Local](figure.png)\n\n![Bad](javascript:alert(1))");
    expect(container.querySelector("img")).toBeNull();
    const link = screen.getByRole("link", { name: "Image: Decision tree" });
    expect(link.getAttribute("href")).toBe("https://example.org/tree.png");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByRole("link", { name: /Local|Bad/ })).toBeNull();
    expect(container.textContent).toContain("Image: Local");
    expect(container.textContent).toContain("Image: Bad");
  });

  it("never nests a link inside a link for linked images", async () => {
    const { container } = await renderMarkdown("[![Logo](https://example.org/logo.png)](https://example.org/)");
    expect(container.querySelector("a a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Image: Logo");
  });

  it("shifts headings by one level", async () => {
    const { container } = await renderMarkdown("# Scope\n\n## Terms\n\n###### Deep");
    expect(screen.getByRole("heading", { level: 3, name: "Scope" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "Terms" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 6, name: "Deep" })).toBeTruthy();
    expect(container.querySelector("h1, h2")).toBeNull();
  });

  it("honours a custom heading offset", async () => {
    await renderMarkdown("# Scope", 0);
    expect(screen.getByRole("heading", { level: 2, name: "Scope" })).toBeTruthy();
  });

  it("renders GFM tables inside a horizontally scrollable container", async () => {
    const { container } = await renderMarkdown("| Term | Rule |\n| --- | --- |\n| HP:1 | ~~old~~ keep |");
    const table = screen.getByRole("table");
    const scroller = table.parentElement as HTMLElement;
    expect(scroller.classList.contains("guideline-table-scroll")).toBe(true);
    expect(scroller.getAttribute("tabindex")).toBe("0");
    expect(container.querySelector("del")?.textContent).toBe("old");
    expect(read("../../src/ui/guidelineDocument.css")).toMatch(/\.guideline-table-scroll\s*\{[^}]*overflow-x: auto/);
  });

  it("renders .txt in pre with pre-wrap and keeps CRLF lines", () => {
    const { container } = render(<GuidelineDocument kind="text" body={"First line\r\nSecond <b>line</b>\r\n\r\nThird"} />);
    const pre = container.querySelector("pre") as HTMLPreElement;
    expect(pre).toBeTruthy();
    expect(pre.classList.contains("guideline-text")).toBe(true);
    expect(pre.textContent).toBe("First line\nSecond <b>line</b>\n\nThird");
    expect(container.querySelector("b")).toBeNull();
    expect(read("../../src/ui/guidelineDocument.css")).toMatch(/\.guideline-text\s*\{[^}]*white-space: pre-wrap/);
  });

  it("renders CRLF Markdown as separate paragraphs", async () => {
    const { container } = await renderMarkdown("First paragraph\r\n\r\nSecond paragraph");
    expect([...container.querySelectorAll("p")].map(p => p.textContent)).toEqual(["First paragraph", "Second paragraph"]);
  });

  it("never uses dangerouslySetInnerHTML", () => {
    for (const path of ["../../src/ui/MarkdownBody.tsx", "../../src/ui/GuidelineDocument.tsx"]) {
      expect(read(path)).not.toContain("dangerouslySetInnerHTML");
    }
    expect(read("../../src/ui/MarkdownBody.tsx")).not.toContain("rehype-raw");
  });
});
