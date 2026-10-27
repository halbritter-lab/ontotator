import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api } from "../src/api/client";
import { routeHref, type NavigateOptions, type Route } from "../src/app/router";
import { testUser } from "./session";

// A stub page that navigates with and without the replace option and stays
// mounted across both, so one test can observe both history effects.
vi.mock("../src/tasks/MyTasks", () => ({
  MyTasks: ({ project, onNavigate }: { project?: string; onNavigate: (route: Route, options?: NavigateOptions) => void }) => (
    <div>
      <p>Project {project ?? "none"}</p>
      <button type="button" onClick={() => onNavigate({ name: "tasks", project: "replaced" }, { replace: true })}>Replace</button>
      <button type="button" onClick={() => onNavigate({ name: "tasks", project: "pushed" })}>Push</button>
    </div>
  ),
}));

const user = testUser("root", { username: "root", is_system_admin: true });

beforeEach(() => {
  // "#/?status=all": a bare "#/" lands on the Projects page without a last-used project (F8).
  window.history.replaceState(null, "", "#/?status=all");
  vi.spyOn(api, "listProjects").mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "#/"); });

it("replace navigation keeps the history length; a following normal navigation adds one entry", async () => {
  render(<App user={user} />);
  await screen.findByText("Project none");
  const before = window.history.length;
  const index = window.history.state?.ontotatorRouteIndex as number;

  fireEvent.click(screen.getByRole("button", { name: "Replace" }));
  await screen.findByText("Project replaced");
  expect(window.location.hash).toBe(routeHref({ name: "tasks", project: "replaced" }));
  expect(window.history.length).toBe(before);
  expect(window.history.state?.ontotatorRouteIndex).toBe(index);

  fireEvent.click(screen.getByRole("button", { name: "Push" }));
  await screen.findByText("Project pushed");
  await waitFor(() => expect(window.location.hash).toBe(routeHref({ name: "tasks", project: "pushed" })));
  expect(window.history.length).toBe(before + 1);
  expect(window.history.state?.ontotatorRouteIndex).toBe(index + 1);
});
