import { assigned, assignedList } from "./assignments";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiClient, AuthError, isSessionExpired, onSessionExpired, type CurrentUser } from "../src/api/client";
import { AuthGate } from "../src/app/AuthGate";
import { testUser } from "./session";

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const notLoggedIn = () => new AuthError("Log in to continue.", undefined, "NOT_AUTHENTICATED", 401);

const oneCaseServer = () => {
  assignedList(caseView());
  vi.spyOn(api, "getPreferences").mockResolvedValue({ mode_by_package: {} } as any);
  vi.spyOn(api, "listOntologies").mockResolvedValue([]);
  vi.spyOn(api, "listProjects").mockResolvedValue([{ project_key: "pkg" }] as any);
  vi.spyOn(api, "listDocuments").mockResolvedValue([
    { document_id: "doc-1", text_length: 10, language: "en", position: 1, status: "not_started" as const },
  ]);
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  api.setCsrfToken(null);
});

/** `api.me()` answers with these users in turn and stores their CSRF tokens, as the real call does. */
const sessionsOf = (...users: CurrentUser[]) => {
  const me = vi.spyOn(api, "me");
  for (const user of users) {
    me.mockImplementationOnce(async () => {
      api.setCsrfToken(user.csrf_token);
      return user;
    });
  }
  return me;
};

type Handler = (init: RequestInit) => unknown;
/** A fetch stub that answers "METHOD /path" routes and 404 otherwise. */
const fakeServer = (routes: Record<string, Handler>) =>
  vi.fn(async (url: string, init: RequestInit = {}) => {
    const route = `${(init.method ?? "GET").toUpperCase()} ${url.split("?")[0]}`;
    const handler = routes[route];
    return handler ? handler(init) : jsonResponse(404, {});
  });
const callsTo = (fetchMock: ReturnType<typeof fakeServer>, path: string) =>
  fetchMock.mock.calls.filter(([url]) => url.split("?")[0] === path);
const csrfOf = (init?: RequestInit) => (init?.headers as Headers).get("X-CSRF-Token");

const key = { project_key: "pkg", document_id: "doc-1", annotator_id: "ann-0007", mode: "independent" as const, scope_id: "scope-default", target_set_id: "empty" };
const caseView = (): any => ({
  key,
  // Two layers, so the layer controls (with "Mark ... as verified") are shown.
  scope: { scope_id: "scope-default", mode: "independent", editable_layer_ids: ["phenotype", "findings"], reference_layer_ids: [] },
  layers: ["Phenotype", "Findings"].map((label) => ({
    layer_id: label.toLowerCase(), label, ontology_id: "hp", access: "editable", default_visible: true, default_type_id: "default",
    annotation_types: [{ type_id: "default", label, evidence_policy: "optional", axes: [] }],
  })),
  ontologies: [],
  checked_layer_ids: [],
  document: { document_id: "doc-1", text: "alpha beta gamma", language: "en", text_sha256: "text" },
  targets: { target_set_id: "empty", targets: [] },
  available_inputs: [],
  submissions: [],
  term_statuses: {},
  axes_definition: "editor-axes/v1",
  axes_config: [],
  axes_config_sha256: "sha-axes",
  draft: { key, targets: { target_set_id: "empty", targets: [] }, revision: 0, annotations: [], evidence: [], decisions: [], checked_layer_ids: [] },
});

/** Alice opens a case; her session has ended on the server, so the first save gets a 401. */
const caseWithEndedSession = (relogin: CurrentUser, view = caseView()) => {
  const alice = testUser("ann-0007", { display_name: "Alice", csrf_token: "csrf-1" });
  sessionsOf(alice);
  oneCaseServer();
  vi.spyOn(api, "listMyTasks").mockResolvedValue([{ assignment_id: 1, project_key: "pkg", project_name: "pkg", document_id: view.document.document_id, language: "en", task: view.key.mode === "review" ? "review" : "annotate", status: "open", updated_at: "2026-10-14T12:00:00Z" }]);
  vi.spyOn(api, "openAssignment").mockResolvedValueOnce(assigned({ read_only: false, workspace_id: "ws", view })).mockRejectedValue(new AuthError("This task is no longer assigned to you.", undefined, "ASSIGNMENT_NOT_FOUND", 403));
  let sessionOpen = false;
  const fetchMock = fakeServer({
    "POST /api/v1/workspaces/ws/commands": () => sessionOpen
      ? jsonResponse(200, { ...view.draft, revision: 1, checked_layer_ids: ["phenotype"] })
      : jsonResponse(401, { code: "NOT_AUTHENTICATED", details: "Log in to continue." }),
    "POST /api/v1/auth/login": () => {
      sessionOpen = true;
      return jsonResponse(200, relogin);
    },
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

/** The second of two cases, in review mode with one proposal to decide on. */
const reviewCaseView = (): any => {
  const view = caseView();
  const reviewKey = { ...key, document_id: "doc-2", mode: "review" as const };
  const targets = { target_set_id: "targets", targets: [{ annotation_id: "prop", version: "p-v1" }] };
  view.key = reviewKey;
  view.scope = { ...view.scope, mode: "review" };
  view.document = { ...view.document, document_id: "doc-2" };
  view.targets = targets;
  view.available_inputs = [{
    schema_version: "ontocurator-annotation/v3",
    annotation: {
      annotation_id: "prop", document_id: "doc-2", layer_id: "phenotype", type_id: "default", term_id: "HP:0001", axes_values: {},
      evidence_refs: [{ evidence_id: "ev-prop", version: "ev-v" }],
      provenance: { actor: { actor_id: "source", kind: "tool" }, method: "automated" },
    },
    evidence: [{ mention: { evidence_id: "ev-prop", segments: [{ start: 0, end: 5 }], cue_segments: [] }, version: "ev-v", document_id: "doc-2", text_sha256: "text" }],
    version: "p-v1", document_id: "doc-2", text_sha256: "text", ontology_sha256: "ontology", layer_config_sha256: "layer-sha",
  }];
  view.draft = { ...view.draft, key: reviewKey, targets };
  return view;
};

const logInThrough = (dialog: HTMLElement, username: string) => {
  fireEvent.change(within(dialog).getByLabelText("Username"), { target: { value: username } });
  fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "correct horse battery" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Log in" }));
};

describe("sessions in the API client", () => {
  it("sends cookies, and the CSRF token on writes but not on reads", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, testUser("ann-0007")))
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(200, { mode_by_package: {} }))
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => { throw new Error("no body"); } });
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient();

    await client.me();
    await client.listProjects();
    await client.updatePreferences({ mode_by_package: { pkg: "review" } });
    await expect(client.logout()).resolves.toBeUndefined();

    const [meUrl, meInit] = fetchMock.mock.calls[0];
    expect(meUrl).toBe("/api/v1/auth/me");
    expect(meInit.credentials).toBe("same-origin");
    expect((meInit.headers as Headers).has("X-CSRF-Token")).toBe(false);
    const [, readInit] = fetchMock.mock.calls[1];
    expect(readInit.credentials).toBe("same-origin");
    expect((readInit.headers as Headers).has("X-CSRF-Token")).toBe(false);
    expect((readInit.headers as Headers).has("Authorization")).toBe(false);
    const [, writeInit] = fetchMock.mock.calls[2];
    expect(writeInit.method).toBe("PUT");
    expect(writeInit.credentials).toBe("same-origin");
    expect((writeInit.headers as Headers).get("X-CSRF-Token")).toBe("csrf-test");
    const [logoutUrl, logoutInit] = fetchMock.mock.calls[3];
    expect(logoutUrl).toBe("/api/v1/auth/logout");
    expect((logoutInit.headers as Headers).get("X-CSRF-Token")).toBe("csrf-test");
  });

  it("reports an ended session on 401, but not a failed login", async () => {
    const seen: number[] = [];
    const off = onSessionExpired(() => seen.push(1));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, { code: "LOGIN_FAILED", details: "Wrong username or password." }))
      .mockResolvedValueOnce(jsonResponse(401, { code: "NOT_AUTHENTICATED", details: "Log in to continue." }))
      .mockResolvedValueOnce(jsonResponse(403, { code: "CSRF_FAILED", details: "The page is out of date; reload it." }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient();

    const failedLogin = await client.login("alice", "wrong").catch((e) => e);
    expect(failedLogin).toBeInstanceOf(AuthError);
    expect(failedLogin.status).toBe(401);
    expect(failedLogin.code).toBe("LOGIN_FAILED");
    expect(isSessionExpired(failedLogin)).toBe(false);
    expect(seen).toHaveLength(0);

    const ended = await client.listProjects().catch((e) => e);
    expect(ended).toBeInstanceOf(AuthError);
    expect(ended.status).toBe(401);
    expect(isSessionExpired(ended)).toBe(true);

    const forbidden = await client.listProjects().catch((e) => e);
    expect(forbidden).toBeInstanceOf(AuthError);
    expect(forbidden.status).toBe(403);
    expect(forbidden.code).toBe("CSRF_FAILED");
    expect(isSessionExpired(forbidden)).toBe(false);

    expect(seen).toHaveLength(1);
    off();
  });
});

describe("sessions in the API client, continued", () => {
  it("does not report a 401 that answers a request sent before a new login", async () => {
    const seen: number[] = [];
    const off = onSessionExpired(() => seen.push(1));
    let answer!: (response: unknown) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }))
      .mockResolvedValueOnce(jsonResponse(200, testUser("ann-0007", { csrf_token: "csrf-new" })));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient();
    client.setCsrfToken("csrf-old");

    const late = client.updatePreferences({ mode_by_package: {} }).catch((e) => e);
    await client.login("alice", "correct horse battery");
    answer(jsonResponse(401, { code: "NOT_AUTHENTICATED", details: "Log in to continue." }));

    expect(isSessionExpired(await late)).toBe(true);
    expect(seen).toHaveLength(0);
    off();
  });
});

describe("the login gate", () => {
  it("shows the login form without a session and the app after logging in", async () => {
    vi.spyOn(api, "me").mockRejectedValue(notLoggedIn());
    const login = vi.spyOn(api, "login").mockResolvedValue(testUser("ann-0007", { display_name: "Alice" }));
    oneCaseServer();
    render(<AuthGate />);

    const form = await screen.findByRole("form", { name: "Log in to Ontocurator" });
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.change(within(form).getByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.change(within(form).getByLabelText("Password"), { target: { value: "correct horse battery" } });
    fireEvent.click(within(form).getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(login).toHaveBeenCalledWith("alice", "correct horse battery"));
    expect((await screen.findByTestId("current-user")).textContent).toBe("Alice · ann-0007");
    expect(screen.getByRole("button", { name: "Log out" })).toBeDefined();
    await screen.findByRole("table");
  });

  it("redeems a setup code after checking that both passwords match", async () => {
    vi.spyOn(api, "me").mockRejectedValue(notLoggedIn());
    const redeem = vi.spyOn(api, "redeemCode").mockResolvedValue(testUser("ann-0008", { display_name: "Bob", is_system_admin: false }));
    oneCaseServer();
    render(<AuthGate />);

    await screen.findByRole("form", { name: "Log in to Ontocurator" });
    fireEvent.click(screen.getByRole("button", { name: "I have a setup or reset code" }));
    const form = screen.getByRole("form", { name: "Set your password" });
    expect(document.activeElement).toBe(within(form).getByRole("heading", { name: "Set your password" }));
    expect(within(form).getByText("At least 12 characters.")).toBeDefined();
    fireEvent.change(within(form).getByLabelText("Username"), { target: { value: "bob" } });
    fireEvent.change(within(form).getByLabelText("Setup or reset code"), { target: { value: "ABCD-EFGH" } });
    fireEvent.change(within(form).getByLabelText("New password"), { target: { value: "a long new password" } });
    fireEvent.change(within(form).getByLabelText("Repeat the new password"), { target: { value: "a long new passwort" } });
    fireEvent.click(within(form).getByRole("button", { name: "Set password and log in" }));

    expect((await screen.findByRole("alert")).textContent).toBe("The two passwords differ.");
    expect(redeem).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText("Repeat the new password"), { target: { value: "a long new password" } });
    fireEvent.click(within(form).getByRole("button", { name: "Set password and log in" }));

    await waitFor(() => expect(redeem).toHaveBeenCalledWith("bob", "ABCD-EFGH", "a long new password"));
    expect((await screen.findByTestId("current-user")).textContent).toBe("Bob · ann-0008");
  });

  it("asks to log in again when the password is set but the login after it fails", async () => {
    vi.spyOn(api, "me").mockRejectedValue(notLoggedIn());
    vi.spyOn(api, "redeemCode").mockRejectedValue(new AuthError("Login failed.", undefined, "LOGIN_FAILED", 401));
    render(<AuthGate />);

    fireEvent.click(await screen.findByRole("button", { name: "I have a setup or reset code" }));
    const form = screen.getByRole("form", { name: "Set your password" });
    fireEvent.change(within(form).getByLabelText("Username"), { target: { value: "bob" } });
    fireEvent.change(within(form).getByLabelText("Setup or reset code"), { target: { value: "ABCD-EFGH" } });
    fireEvent.change(within(form).getByLabelText("New password"), { target: { value: "a long new password" } });
    fireEvent.change(within(form).getByLabelText("Repeat the new password"), { target: { value: "a long new password" } });
    fireEvent.click(within(form).getByRole("button", { name: "Set password and log in" }));

    const login = await screen.findByRole("form", { name: "Log in to Ontocurator" });
    expect(within(login).getByText("Your password is set. Log in with it now.")).toBeDefined();
    expect((within(login).getByLabelText("Username") as HTMLInputElement).value).toBe("bob");
  });

  it("says so when the session cannot be checked", async () => {
    vi.spyOn(api, "me").mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AuthGate />);
    await screen.findByRole("form", { name: "Log in to Ontocurator" });
    expect(screen.getByText("Ontocurator could not check your session: Failed to fetch")).toBeDefined();
  });

  it("logs out and shows the login page", async () => {
    sessionsOf(testUser("ann-0007", { display_name: "Alice" }));
    const logout = vi.spyOn(api, "logout").mockResolvedValue(undefined);
    oneCaseServer();
    render(<AuthGate />);

    fireEvent.click(await screen.findByRole("button", { name: "Log out" }));

    await screen.findByRole("form", { name: "Log in to Ontocurator" });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("current-user")).toBeNull();
  });

  it("keeps the case open when the session ends and saves the queued edit after logging in again", async () => {
    const fetchMock = caseWithEndedSession(testUser("ann-0007", { display_name: "Alice", csrf_token: "csrf-2" }));
    render(<AuthGate />);
    fireEvent.click(await screen.findByRole("button", { name: /^Open$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Mark Phenotype as verified/i }));

    const dialog = await screen.findByRole("dialog", { name: "Log in to Ontocurator" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByText("Your session has ended. Please log in again.")).toBeDefined();
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText("Username")));
    expect(screen.getByTestId("annotator-identity")).toBeDefined();
    expect(screen.getByText(/Session ended – changes kept/)).toBeDefined();

    logInThrough(dialog, "alice");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Log in to Ontocurator" })).toBeNull());
    await waitFor(() => expect(callsTo(fetchMock, "/api/v1/workspaces/ws/commands")).toHaveLength(2));
    const retried = callsTo(fetchMock, "/api/v1/workspaces/ws/commands")[1][1];
    expect(csrfOf(retried)).toBe("csrf-2");
    expect(JSON.parse(retried?.body as string).payload).toEqual({ command: "check_layer", layer_id: "phenotype", checked: true });
    await screen.findByText(/^Saved$/);
    expect(screen.getByTestId("annotator-identity")).toBeDefined();
  });

  it("starts afresh when someone else logs in after the session ended", async () => {
    const fetchMock = caseWithEndedSession(testUser("ann-0009", { display_name: "Bob", csrf_token: "csrf-b" }));
    render(<AuthGate />);
    fireEvent.click(await screen.findByRole("button", { name: /^Open$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Mark Phenotype as verified/i }));

    logInThrough(await screen.findByRole("dialog", { name: "Log in to Ontocurator" }), "bob");

    await waitFor(() => expect(screen.getByTestId("current-user").textContent).toBe("Bob · ann-0009"));
    expect(screen.queryByRole("dialog", { name: "Log in to Ontocurator" })).toBeNull();
    expect(screen.queryByTestId("annotator-identity")).toBeNull();
    expect(callsTo(fetchMock, "/api/v1/workspaces/ws/commands")).toHaveLength(1);
  });

  it("asks who is logged in after a CSRF failure and carries on as the same user", async () => {
    const alice = testUser("ann-0007", { display_name: "Alice", csrf_token: "csrf-1" });
    const me = sessionsOf(alice, { ...alice, csrf_token: "csrf-2" });
    oneCaseServer();
    vi.spyOn(api, "openAssignment").mockResolvedValue(assigned({ read_only: false, workspace_id: "ws", view: caseView() }));
    let refused = false;
    const fetchMock = fakeServer({
      "POST /api/v1/workspaces/ws/commands": () => {
        if (refused) return jsonResponse(200, { ...caseView().draft, revision: 1 });
        refused = true;
        return jsonResponse(403, { code: "CSRF_FAILED", details: "The page is out of date; reload it." });
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthGate />);
    fireEvent.click(await screen.findByRole("button", { name: /^Open$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Mark Phenotype as verified/i }));
    await waitFor(() => expect(me).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(callsTo(fetchMock, "/api/v1/workspaces/ws/commands")).toHaveLength(2));
    expect(csrfOf(callsTo(fetchMock, "/api/v1/workspaces/ws/commands")[0][1])).toBe("csrf-1");
    expect(csrfOf(callsTo(fetchMock, "/api/v1/workspaces/ws/commands")[1][1])).toBe("csrf-2");
    expect(screen.getByTestId("annotator-identity").textContent).toContain("ann-0007");
    expect(api.openAssignment).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/from another tab/)).toBeNull();
  });

  it("switches to the user another tab logged in after a CSRF failure", async () => {
    sessionsOf(testUser("ann-0007", { display_name: "Alice", csrf_token: "csrf-1" }), testUser("ann-0009", { display_name: "Bob", csrf_token: "csrf-b" }));
    oneCaseServer();
    vi.spyOn(api, "openAssignment").mockResolvedValueOnce(assigned({ read_only: false, workspace_id: "ws", view: caseView() }))
      .mockRejectedValue(new AuthError("Not assigned", undefined, "ASSIGNMENT_NOT_FOUND", 403));
    vi.stubGlobal("fetch", fakeServer({ "POST /api/v1/workspaces/ws/commands": () => jsonResponse(403, { code: "CSRF_FAILED", details: "The page is out of date; reload it." }) }));
    render(<AuthGate />);
    fireEvent.click(await screen.findByRole("button", { name: /^Open$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Mark Phenotype as verified/i }));
    expect(await screen.findByText("You are now logged in as Bob (from another tab).")).toBeDefined();
    expect(screen.getByTestId("current-user").textContent).toBe("Bob · ann-0009");
    await screen.findByText("This task is no longer assigned to you.");
    expect(screen.queryByTestId("annotator-identity")).toBeNull();
  });

  it("keeps the case out of reach of keys pressed in the login dialog", async () => {
    const fetchMock = caseWithEndedSession(testUser("ann-0007", { display_name: "Alice", csrf_token: "csrf-2" }), reviewCaseView());
    vi.spyOn(api, "listDocuments").mockResolvedValue([
      { document_id: "doc-1", text_length: 10, language: "en", position: 1, status: "completed" as const },
      { document_id: "doc-2", text_length: 10, language: "en", position: 2, status: "in_progress" as const },
    ]);
    const decide = vi.spyOn(api, "recordDecision").mockResolvedValue({ ...reviewCaseView().draft, revision: 2 });
    render(<AuthGate />);
    fireEvent.click(await screen.findByRole("button", { name: /^Open$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Mark Phenotype as verified/i }));
    const dialog = await screen.findByRole("dialog", { name: "Log in to Ontocurator" });

    // The editor behind the dialog is inert, and its window shortcuts do not see these keys.
    expect(screen.getByTestId("annotator-identity").closest("[inert]")).not.toBeNull();
    expect(dialog.closest("[inert]")).toBeNull();
    const button = within(dialog).getByRole("button", { name: "I have a setup or reset code" });
    fireEvent.keyDown(button, { key: "j" });
    fireEvent.keyDown(button, { key: "1" });
    fireEvent.keyDown(button, { key: "ArrowLeft", altKey: true });
    expect(screen.queryByText(/Changes not saved/)).toBeNull();
    expect(api.openAssignment).toHaveBeenCalledTimes(1);

    logInThrough(dialog, "alice");
    await waitFor(() => expect(callsTo(fetchMock, "/api/v1/workspaces/ws/commands")).toHaveLength(2));
    await screen.findByText(/^Saved$/);
    expect(screen.getByTestId("annotator-identity").closest("[inert]")).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });

  it("does not retry for ever when a CSRF failure persists with the same token", async () => {
    const alice = testUser("ann-0007", { display_name: "Alice", csrf_token: "csrf-1" });
    const me = sessionsOf(alice, alice, alice);
    oneCaseServer();
    vi.spyOn(api, "openAssignment").mockResolvedValue(assigned({ read_only: false, workspace_id: "ws", view: caseView() }));
    const fetchMock = fakeServer({
      "POST /api/v1/workspaces/ws/commands": () =>
        jsonResponse(403, { code: "CSRF_FAILED", details: "The page is out of date; reload it." }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthGate />);
    fireEvent.click(await screen.findByRole("button", { name: /^Open$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Mark Phenotype as verified/i }));

    expect(await screen.findByText("The page is out of date; reload it.")).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(me).toHaveBeenCalledTimes(2);
    expect(callsTo(fetchMock, "/api/v1/workspaces/ws/commands")).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "Log in to Ontocurator" })).toBeNull();
    expect(screen.getByTestId("annotator-identity")).toBeDefined();
  });
});
