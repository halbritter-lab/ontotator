import { describe, expect, it } from "vitest";
import { routeTitle } from "../src/app/labels";
import { documentTitle } from "../src/ui/useDocumentTitle";

describe("browser title (#9)", () => {
  it("names the page and its project, most specific first", () => {
    expect(documentTitle(routeTitle({ name: "projectDocuments", key: "ward-notes" }, { name: "Ward notes" }))).toBe("Documents · Ward notes · Ontotator");
    expect(documentTitle(routeTitle({ name: "projectProgress", key: "ward-notes" }))).toBe("Progress · ward-notes · Ontotator");
    expect(documentTitle(routeTitle({ name: "projectCase", key: "ward-notes", caseId: "W04" }, { name: "Ward notes" }))).toBe("W04 · Ward notes · Ontotator");
    expect(documentTitle(routeTitle({ name: "adminUsers" }))).toBe("Users · Ontotator");
    expect(documentTitle(routeTitle({ name: "notFound", hash: "#/x" }))).toBe("Page not found · Ontotator");
    expect(documentTitle(routeTitle({ name: "projectSettings", key: "gone" }, null))).toBe("Project not found · Ontotator");
  });

  it("names a task by its text and task type", () => {
    expect(documentTitle(routeTitle({ name: "task", assignmentId: 4 }, undefined, { external_id: "W04-pulmonary", document_id: "d1", task: "annotate" })))
      .toBe("W04-pulmonary · Annotation · Ontotator");
    expect(documentTitle(routeTitle({ name: "task", assignmentId: 4 }, undefined, null))).toBe("Task · Ontotator");
  });
});
