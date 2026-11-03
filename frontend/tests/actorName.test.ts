import { expect, it } from "vitest";
import { actorName } from "../src/editor/actorName";

it("shows blinded annotator ids as the consolidation's labels (#302)", () => {
  expect(actorName({ actor_id: "annotator-a", kind: "human" })).toBe("Annotator A");
  expect(actorName({ actor_id: "annotator-b", kind: "human" })).toBe("Annotator B");
  expect(actorName({ actor_id: "annotator-aa", kind: "human" })).toBe("Annotator AA");
  expect(actorName({ actor_id: "annotator", kind: "human" })).toBe("Another annotator");
});

it("leaves pseudonyms and tools as they are", () => {
  expect(actorName({ actor_id: "ann-0004", kind: "human" })).toBe("ann-0004");
  expect(actorName({ actor_id: "annotator-a", kind: "tool" })).toBe("annotator-a");
  expect(actorName({ actor_id: "phentrieve", kind: "tool" })).toBe("phentrieve");
});
