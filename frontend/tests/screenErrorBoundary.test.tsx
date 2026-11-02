import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api } from "../src/api/client";
import { ScreenErrorBoundary } from "../src/app/ErrorBoundary";
import { taskOf, workspaceFixture } from "./assignments";
import { testUser } from "./session";

const receipt = { id: 12, reference: "TR-12", created_at: "2026-11-01T10:00:00Z" };
const Broken = (): JSX.Element => { throw new RangeError("Assignment ID must be a positive safe integer"); };

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "#/"); });

it("shows a way back, a reload and the technical report with the crash message", async () => {
  const send = vi.spyOn(api, "sendTechnicalReport").mockResolvedValue(receipt);
  const home = vi.fn();
  render(<ScreenErrorBoundary onHome={home}><Broken /></ScreenErrorBoundary>);
  const alert = screen.getByRole("alert");
  expect(within(alert).getByRole("heading", { name: "Something went wrong while displaying this page." })).toBeDefined();
  expect(within(alert).getByText(/Assignment ID must be a positive safe integer/)).toBeDefined();
  expect(within(alert).getByRole("button", { name: "Reload page" })).toBeDefined();
  // Its own wording: no text or case here.
  expect(within(alert).queryByText(/this text|case/i)).toBeNull();
  const input = userEvent.setup();
  await input.click(within(alert).getByRole("button", { name: "Report a technical problem…" }));
  const dialog = screen.getByRole("dialog", { name: "Report a technical problem" });
  expect(within(dialog).getByText("Error message: RangeError: Assignment ID must be a positive safe integer")).toBeDefined();
  await input.type(within(dialog).getByLabelText("What happened?"), "Opened My tasks");
  await input.click(within(dialog).getByRole("button", { name: "Send report" }));
  await screen.findByText(/Reference: TR-12/);
  expect(send.mock.calls[0][0].context?.crash_message).toBe("RangeError: Assignment ID must be a positive safe integer");
  await input.click(screen.getByRole("button", { name: "Go to My tasks" }));
  expect(home).toHaveBeenCalledTimes(1);
});

it("goes to the start page without a handler and renders again on another screen", () => {
  window.history.replaceState(null, "", "#/projects");
  function Harness(): JSX.Element {
    const [screenName, setScreen] = useState("broken");
    return <>
      <button onClick={() => setScreen("fine")}>Elsewhere</button>
      <ScreenErrorBoundary resetKey={screenName}>{screenName === "broken" ? <Broken /> : <p>Another screen</p>}</ScreenErrorBoundary>
    </>;
  }
  const { unmount } = render(<Harness />);
  expect(screen.getByRole("alert")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Another screen")).toBeDefined();
  unmount();

  render(<ScreenErrorBoundary><Broken /></ScreenErrorBoundary>);
  fireEvent.click(screen.getByRole("button", { name: "Go to My tasks" }));
  expect(window.location.hash).toBe("#/");
});

it("keeps the shell around a crashed screen, and the next screen renders again", async () => {
  // A task row My tasks cannot render, as in the issue: the page threw and stayed blank.
  window.history.replaceState(null, "", "#/?status=all");
  vi.spyOn(api, "listProjects").mockResolvedValue([]);
  vi.spyOn(api, "listMyTasks").mockResolvedValue([taskOf(workspaceFixture("bad").view, -1)]);
  render(<App user={testUser("alice")} />);
  const alert = await screen.findByRole("alert", {}, { timeout: 3000 });
  expect(within(alert).getByRole("heading", { name: "Something went wrong while displaying this page." })).toBeDefined();
  expect(within(alert).getByRole("button", { name: "Report a technical problem…" })).toBeDefined();
  // The sidebar stays, and another screen renders again.
  vi.spyOn(api, "adminListUsers").mockResolvedValue([]);
  const disclosure = document.querySelector<HTMLDetailsElement>(".shell-reading-navigation");
  if (disclosure && !disclosure.open) fireEvent.click(disclosure.querySelector("summary")!);
  fireEvent.click(screen.getByRole("link", { name: "Users" }));
  expect(await screen.findByRole("heading", { name: "Users" })).toBeDefined();
  await waitFor(() => expect(screen.queryByText("Something went wrong while displaying this page.")).toBeNull());
});
