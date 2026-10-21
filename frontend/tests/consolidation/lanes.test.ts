import { describe, expect, it } from "vitest";
import { laneLegend, laneOf, lanesOf, personName } from "../../src/consolidation/lanes";

const person = (n: number) => ({ person_id: `ann-000${n}`, label: `Person ${n} (ann-000${n})`, lane: Math.min(n, 4) });

describe("person lanes", () => {
  it("gives every person a lane in the view's order", () => {
    const people = [person(1), person(2), person(3)];
    expect(lanesOf(people).map(lane => [lane.lane, lane.people.map(value => value.person_id), lane.extra]))
      .toEqual([[1, ["ann-0001"], ""], [2, ["ann-0002"], ""], [3, ["ann-0003"], ""]]);
    expect(laneOf(people, "ann-0002")).toBe(2);
  });

  it("combines every person beyond the fourth on lane 4 with +n", () => {
    const people = [1, 2, 3, 4, 5].map(person);
    const lanes = lanesOf(people);
    expect(lanes).toHaveLength(4);
    expect(lanes[3].extra).toBe("+2");
    expect(lanes[3].people.map(value => value.person_id)).toEqual(["ann-0004", "ann-0005"]);
    expect(laneLegend(lanes[3])).toBe("+2: Person 4 (ann-0004), Person 5 (ann-0005)");
    expect(laneOf(people, "ann-0005")).toBe(4);
  });

  it("names a person by the display name, a pseudonym stays", () => {
    expect(personName("Luc Martin (ann-0004)")).toBe("Luc Martin");
    expect(personName("ann-0004")).toBe("ann-0004");
  });
});
