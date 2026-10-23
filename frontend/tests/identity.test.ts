// @vitest-environment node
import { expect, it } from "vitest";
import { personLabel, textLabel } from "../src/app/identity";

it("formats people for leads and others", () => {
  expect(personLabel({ pseudonym: "ann-0004", display_name: "Ana Weber" })).toBe("Ana Weber (ann-0004)");
  expect(personLabel({ pseudonym: "ann-0002", display_name: "Project Lead", is_me: true })).toBe(
    "Project Lead (ann-0002, you)",
  );
  expect(personLabel({ pseudonym: "ann-0004", display_name: null })).toBe("ann-0004");
  expect(personLabel({ pseudonym: "ann-0004", display_name: "" })).toBe("ann-0004");
  expect(personLabel(null)).toBe("—");
  expect(personLabel(undefined, { fallback: "Former member" })).toBe("Former member");
});

it("formats texts as case, language with an optional version", () => {
  expect(textLabel({ case_id: "case-0101", language: "de" })).toBe("case-0101 de");
  expect(textLabel({ case_id: "case-0101", language: "de", version: 2 }, { withVersion: true })).toBe(
    "case-0101 de v2",
  );
  expect(textLabel({ case_id: "case-0101", language: "de", version: 1 })).toBe("case-0101 de");
});
