import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FilterChip, LanguageFlag, LanguageTag, LanguageText, languageFlagRegion } from "../src/ui";

afterEach(cleanup);

describe("languageFlagRegion", () => {
  it("maps the supported languages to their flag, English to the UK flag", () => {
    const expected: Record<string, string> = {
      de: "DE", en: "GB", fr: "FR", es: "ES", it: "IT", nl: "NL", pt: "PT", pl: "PL", sv: "SE", da: "DK", fi: "FI",
      no: "NO", nb: "NO", cs: "CZ", tr: "TR", el: "GR", ru: "RU", ja: "JP", zh: "CN", uk: "UA", hu: "HU", ro: "RO",
    };
    for (const [code, region] of Object.entries(expected)) expect(languageFlagRegion(code), code).toBe(region);
    expect(languageFlagRegion("DE")).toBe("DE");
  });

  it("uses a known region subtag, else the base language", () => {
    expect(languageFlagRegion("de-AT")).toBe("AT");
    expect(languageFlagRegion("pt-BR")).toBe("BR");
    expect(languageFlagRegion("en-US")).toBe("US");
    expect(languageFlagRegion("en_gb")).toBe("GB");
    expect(languageFlagRegion("zh-Hans-CN")).toBe("CN");
    expect(languageFlagRegion("de-LU")).toBe("DE");
    expect(languageFlagRegion("fr-CA")).toBe("FR");
  });

  it("has no flag for unknown codes", () => {
    expect(languageFlagRegion("xx")).toBeUndefined();
    expect(languageFlagRegion("")).toBeUndefined();
  });
});

describe("LanguageTag", () => {
  it("shows a decorative flag and the code unchanged", () => {
    const { container } = render(<LanguageTag code="de" />);
    const tag = container.querySelector(".language-tag")!;
    expect(tag.textContent).toBe("de");
    const flag = tag.querySelector("svg.language-flag")!;
    expect(flag.getAttribute("aria-hidden")).toBe("true");
    expect(flag.getAttribute("focusable")).toBe("false");
    expect(flag.getAttribute("data-flag")).toBe("DE");
  });

  it("draws the UK flag for English", () => {
    const { container } = render(<LanguageFlag code="en" />);
    expect(container.querySelector("svg")?.getAttribute("data-flag")).toBe("GB");
  });

  it("falls back to the code alone for an unknown language", () => {
    const { container } = render(<LanguageTag code="xx" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).toBe("xx");
  });

  it("can show other text than the code", () => {
    const { container } = render(<LanguageTag code="fr">French</LanguageTag>);
    expect(container.textContent).toBe("French");
    expect(container.querySelector("svg")?.getAttribute("data-flag")).toBe("FR");
  });
});

describe("LanguageText", () => {
  it("puts the flag before the code and keeps the text", () => {
    const { container } = render(<p><LanguageText text="Consolidate case-de de v2" code="de" /></p>);
    expect(container.textContent).toBe("Consolidate case-de de v2");
    const flag = container.querySelector("svg.language-flag")!;
    expect(flag.getAttribute("aria-hidden")).toBe("true");
    expect(flag.previousSibling?.textContent).toBe("Consolidate case-de ");
    expect(flag.nextSibling?.textContent).toBe("de v2");
    // The text stays in the paragraph itself, so getByText still finds it.
    expect(screen.getByText("Consolidate case-de de v2").tagName).toBe("P");
  });

  it("leaves text without the code or without a flag as it is", () => {
    const { container, rerender } = render(<p><LanguageText text="case-0101 xx" code="xx" /></p>);
    expect(container.querySelector("svg")).toBeNull();
    rerender(<p><LanguageText text="nothing here" code="de" /></p>);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).toBe("nothing here");
  });
});

describe("FilterChip with a language", () => {
  it("adds the flag and keeps the label and the name", () => {
    const { getByRole } = render(<FilterChip label="Language: de" language="de" onRemove={() => undefined} />);
    const chip = getByRole("button", { name: "Remove filter Language: de" });
    expect(chip.textContent).toBe("Language: de");
    expect(chip.querySelector("svg.language-flag")?.getAttribute("data-flag")).toBe("DE");
  });
});
