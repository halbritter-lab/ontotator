import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type GuidelineListing } from "../src/api/client";
import { GuidelinesSection } from "../src/admin/GuidelinesSection";
import { checkGuidelineFile, readGuidelineFile } from "../src/guidelines/fileChecks";
import { deferred, guidelineDocument, guidelineListing, guidelineSummary, withdrawnGuideline } from "./projectFixtures";

const KEY = "p/key";
const three = () => guidelineListing([guidelineSummary(3), guidelineSummary(2), guidelineSummary(1)]);
const conflict = () => new ApiError(409, "Conflict", "GUIDELINE_VERSION_CONFLICT", { latest_version: 4 });
const CONFLICT_TEXT = "Someone published or withdrew a version meanwhile. Review the list and try again.";

// Load the lazy Markdown chunk once, so the first rendering test does not pay for it.
beforeAll(async () => { await import("../src/ui/MarkdownBody"); }, 30_000);
beforeEach(() => {
  vi.spyOn(api, "listGuidelines").mockResolvedValue(three());
  vi.spyOn(api, "getGuideline").mockImplementation(async (_key, version) => guidelineDocument(guidelineSummary(version)));
  vi.spyOn(api, "recordGuidelineRead").mockResolvedValue(undefined);
  vi.spyOn(api, "publishGuideline").mockResolvedValue(guidelineSummary(4));
  vi.spyOn(api, "withdrawGuideline").mockResolvedValue(withdrawnGuideline(3));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderSection(listing?: GuidelineListing) {
  if (listing) vi.mocked(api.listGuidelines).mockResolvedValue(listing);
  return render(<GuidelinesSection projectKey={KEY} />);
}
const fileInput = () => screen.getByLabelText("Guideline file (.md or .txt, up to 256 KB)") as HTMLInputElement;
function choose(file: File) { fireEvent.change(fileInput(), { target: { files: [file] } }); }
const markdown = (text = "# Hello\n\nWorld", name = "new.md") => new File([text], name, { type: "text/markdown" });
const versionsTable = () => screen.getByRole("table", { name: "Guideline versions" });
function row(version: number) {
  return within(versionsTable()).getAllByRole("row").find(item => new RegExp(`^v${version}\\b`).test(within(item).queryByRole("rowheader")?.textContent ?? ""))!;
}
const inForce = () => screen.getByRole("region", { name: /^In force/ });
/** Wait for the in-force card of version `version`. */
const loaded = (version = 3) => screen.findByRole("heading", { level: 2, name: `In force Guidelines v${version}` });
/** Open "More…" of version `version` in `scope` and return the menu's item labels. */
function openMore(scope: HTMLElement, version: number): string[] {
  fireEvent.click(within(scope).getByRole("button", { name: `More actions, v${version}` }));
  return screen.getAllByRole("menuitem").map(item => item.textContent ?? "");
}
function more(scope: HTMLElement, version: number, item: string) {
  openMore(scope, version);
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}
/** Open the publish form while a version is in force. */
function openPublish() { fireEvent.click(screen.getByRole("button", { name: "Publish a new version" })); }

describe("guideline file checks", () => {
  it("checks type, size and emptiness on file choice with the server messages", async () => {
    expect(checkGuidelineFile(new File(["x"], "guide.pdf"))).toBe("Upload a .md or .txt file.");
    expect(checkGuidelineFile(new File(["x"], "guide.markdown"))).toBeNull();
    expect(checkGuidelineFile(new File(["x"], "GUIDE.TXT"))).toBeNull();
    expect(checkGuidelineFile(new File(["x".repeat(262_148)], "guide.md"))).toBe("The file is larger than 256 KB.");
    await expect(readGuidelineFile(new File(["x".repeat(262_145)], "guide.md"))).resolves.toEqual({ error: "The file is larger than 256 KB." });
    await expect(readGuidelineFile(new File(["\ufeff" + "x".repeat(262_144)], "guide.md"))).resolves.toMatchObject({ kind: "markdown" });
    expect(checkGuidelineFile(new File([], "guide.md"))).toBe("The file is empty.");
    await expect(readGuidelineFile(new File([" \n\t "], "guide.txt"))).resolves.toEqual({ error: "The file is empty." });
    await expect(readGuidelineFile(new File([new Uint8Array([0x23, 0xff, 0xfe])], "guide.md"))).resolves.toEqual({ error: "The file is not UTF-8 text." });
    await expect(readGuidelineFile(new File(["a\u0000b"], "guide.md"))).resolves.toEqual({ error: "The file is not UTF-8 text." });
    await expect(readGuidelineFile(new File(["\ufeff# Title"], "guide.md"))).resolves.toEqual({ text: "# Title", kind: "markdown" });
    await expect(readGuidelineFile(new File(["Plain"], "guide.txt"))).resolves.toEqual({ text: "Plain", kind: "text" });

    renderSection();
    await loaded();
    openPublish();
    choose(new File(["x"], "guide.pdf"));
    expect(await screen.findByText("Upload a .md or .txt file.")).toBeDefined();
    expect(fileInput().getAttribute("aria-invalid")).toBe("true");
    choose(new File(["   "], "guide.md"));
    expect(await screen.findByText("The file is empty.")).toBeDefined();
    choose(new File(["x".repeat(262_145)], "guide.md"));
    expect(await screen.findByText("The file is larger than 256 KB.")).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Publish as/ })).toBeNull();
    expect(api.publishGuideline).not.toHaveBeenCalled();
  });
});

describe("Settings › Guidelines", () => {
  it("shows the empty state with the upload", async () => {
    renderSection(guidelineListing([]));
    // Nothing published yet: the upload form shows at once, without a "Publish a new version" step.
    expect(await screen.findByRole("heading", { level: 2, name: "No guidelines yet" })).toBeDefined();
    expect(screen.getByText("Annotators and reviewers find them in every task.")).toBeDefined();
    expect(fileInput().getAttribute("accept")).toContain(".md");
    expect(screen.queryByLabelText("What changed? (optional)")).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/No guideline is in force/)).toBeNull();
    choose(markdown());
    expect(await screen.findByRole("button", { name: "Publish as v1" })).toBeDefined();
    expect(screen.getByLabelText("What changed? (optional)")).toBeDefined();
    expect(screen.getByText("Shown with the update notice.")).toBeDefined();
  });

  it("opens the publish form on click and previews the chosen file with size", async () => {
    renderSection();
    await loaded();
    expect(screen.queryByLabelText("Guideline file (.md or .txt, up to 256 KB)")).toBeNull();
    openPublish();
    expect(screen.getByRole("heading", { level: 2, name: "Publish v4" })).toBeDefined();
    expect(document.activeElement).toBe(fileInput());
    expect(screen.queryByRole("button", { name: "Publish a new version" })).toBeNull();
    choose(markdown("# Hello\n\n" + "w".repeat(2048)));
    const preview = await screen.findByRole("region", { name: "Preview of new.md" });
    expect(await within(preview).findByRole("heading", { name: "Hello" })).toBeDefined();
    expect(screen.getByText("new.md, 2 KB")).toBeDefined();
    expect(screen.getByText("Everyone sees a notice in their next task. Published versions cannot be edited, only withdrawn.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Publish as v4" }).className).toContain("btn-primary");
    // Discard drops the file and closes the form again.
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("region", { name: "Preview of new.md" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish as v4" })).toBeNull();
    expect(screen.queryByLabelText("Guideline file (.md or .txt, up to 256 KB)")).toBeNull();
    expect(screen.getByRole("button", { name: "Publish a new version" })).toBeDefined();
  });

  it("puts Publish and Discard after the facts and above the preview", async () => {
    renderSection();
    await loaded();
    openPublish();
    choose(markdown("# Hello\n\n" + "Long text. ".repeat(500)));
    const preview = await screen.findByRole("region", { name: "Preview of new.md" });
    const publish = screen.getByRole("button", { name: "Publish as v4" });
    const discard = screen.getByRole("button", { name: "Discard" });
    const order = [fileInput(), screen.getByText("new.md, 5 KB"), screen.getByLabelText("What changed? (optional)"),
      screen.getByText(/Published versions cannot be edited/), publish, discard, preview];
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING, `element ${index} follows ${index - 1}`).toBeTruthy();
    }
    // Publish and Discard share the sticky action bar; the preview is outside it.
    const bar = publish.closest(".guidelines-publish-bar")!;
    expect(bar.contains(discard)).toBe(true);
    expect(bar.contains(preview)).toBe(false);
    expect(publish.closest("form")?.contains(bar)).toBe(true);
  });

  it("publishes with the change note and focuses the success message", async () => {
    renderSection();
    await loaded();
    openPublish();
    const file = markdown();
    choose(file);
    fireEvent.change(await screen.findByLabelText("What changed? (optional)"), { target: { value: "  Fixed a typo " } });
    vi.mocked(api.listGuidelines).mockResolvedValue(guidelineListing([guidelineSummary(4), ...three().versions]));
    fireEvent.click(await screen.findByRole("button", { name: "Publish as v4" }));
    const message = await screen.findByText("Published v4. Annotators and reviewers see the update notice when they next open a task.");
    expect(api.publishGuideline).toHaveBeenCalledWith(KEY, { file, changeNote: "Fixed a typo", expectedLatestVersion: 3 });
    await waitFor(() => expect(document.activeElement?.contains(message)).toBe(true));
    expect(api.listGuidelines).toHaveBeenCalledTimes(2);
    expect(await loaded(4)).toBeDefined();
    expect(screen.queryByLabelText("What changed? (optional)")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Publish as/ })).toBeNull();
  });

  it("keeps file and note on a version conflict and reloads the list", async () => {
    renderSection(guidelineListing([]));
    await screen.findByRole("heading", { name: "No guidelines yet" });
    const file = markdown();
    choose(file);
    fireEvent.change(await screen.findByLabelText("What changed? (optional)"), { target: { value: "First" } });
    vi.mocked(api.publishGuideline).mockRejectedValueOnce(conflict());
    vi.mocked(api.listGuidelines).mockResolvedValue(guidelineListing([guidelineSummary(1)]));
    fireEvent.click(await screen.findByRole("button", { name: "Publish as v1" }));
    expect(await screen.findByText(CONFLICT_TEXT)).toBeDefined();
    expect(api.publishGuideline).toHaveBeenCalledWith(KEY, { file, changeNote: "First", expectedLatestVersion: null });
    expect(await screen.findByRole("button", { name: "Publish as v2" })).toBeDefined();
    expect(api.listGuidelines).toHaveBeenCalledTimes(2);
    expect((screen.getByLabelText("What changed? (optional)") as HTMLInputElement).value).toBe("First");
    expect(screen.getByRole("region", { name: "Preview of new.md" })).toBeDefined();
    vi.mocked(api.publishGuideline).mockResolvedValueOnce(guidelineSummary(2));
    fireEvent.click(screen.getByRole("button", { name: "Publish as v2" }));
    await screen.findByText(/^Published v2\./);
    expect(api.publishGuideline).toHaveBeenLastCalledWith(KEY, { file, changeNote: "First", expectedLatestVersion: 1 });
  });

  it("ignores a second click while publishing", async () => {
    const pending = deferred<ReturnType<typeof guidelineSummary>>();
    vi.mocked(api.publishGuideline).mockReturnValue(pending.promise);
    renderSection();
    await loaded();
    openPublish();
    choose(markdown());
    const publish = await screen.findByRole("button", { name: "Publish as v4" });
    fireEvent.click(publish); fireEvent.click(publish);
    expect(api.publishGuideline).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(guidelineSummary(4)); });
  });

  it("lists versions newest first with Seen by and Read", async () => {
    renderSection(guidelineListing([guidelineSummary(3, { not_seen: [] }), guidelineSummary(2, { reach: { notified: 0, opened: 2, members: 6 } }), guidelineSummary(1)]));
    await loaded();
    // The in-force card: file and size beside the title, then Published, What changed and Seen by.
    const card = inForce();
    expect(within(card).getByText("guide-v3.md · 18 KB")).toBeDefined();
    expect(Array.from(card.querySelectorAll("dt")).map(item => item.textContent)).toEqual(["Published", "What changed", "Seen by"]);
    expect(Array.from(card.querySelectorAll("dd")).map(item => item.textContent)).toEqual(["13 Oct, 14:02 by Jana Popp (ann-0002)", "Change 3", "4 of 6 task members"]);
    expect(screen.queryByText(/^Not yet seen by/)).toBeNull();
    const table = versionsTable();
    expect(screen.getByRole("heading", { level: 2, name: "All versions" })).toBeDefined();
    expect(within(table).getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["Version", "Published", "What changed", "Seen by", "Actions"]);
    expect(within(table).getAllByRole("rowheader").map(cell => cell.textContent)).toEqual(["v3 In force", "v2", "v1"]);
    expect(within(row(2)).getByText("Change 2")).toBeDefined();
    expect(within(row(2)).getByText("2 of 6")).toBeDefined();
    expect(within(row(3)).getByText("4 of 6")).toBeDefined();
    expect(within(row(2)).getByText("12 Oct, 14:02")).toBeDefined();

    fireEvent.click(within(row(2)).getByRole("button", { name: "Read v2" }));
    const reader = await screen.findByRole("region", { name: "Reading v2" });
    await waitFor(() => expect(document.activeElement).toBe(reader));
    expect(await within(reader).findByText("This is v2. The current version is v3.")).toBeDefined();
    expect(api.getGuideline).toHaveBeenCalledWith(KEY, 2);
    fireEvent.click(screen.getAllByRole("button", { name: "Read v3" })[0]);
    expect(await screen.findByRole("region", { name: "Reading v3" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Close the reading view" }));
    expect(screen.queryByRole("region", { name: /^Reading/ })).toBeNull();
  });

  it("shows the not-seen names, with notified, only on demand", async () => {
    const people = Array.from({ length: 12 }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      return { person: { pseudonym: `ann-00${number}`, display_name: `Person ${number}`, is_me: false }, notified: index === 0 };
    });
    renderSection(guidelineListing([guidelineSummary(3, { not_seen: people }), guidelineSummary(2)]));
    const line = await screen.findByText(/^Not yet seen by:/);
    expect(line.textContent).toBe(`Not yet seen by: Person 01 (ann-0001, notified), ${people.slice(1).map(entry => `${entry.person.display_name} (${entry.person.pseudonym})`).join(", ")}`);
    const details = line.closest("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")!.textContent).toBe("who not yet?");
  });

  it("withdraw dialog for the current version adds the no-guideline sentence", async () => {
    renderSection();
    await loaded();
    // Withdraw sits behind More…, in the card and in the table.
    expect(screen.queryByRole("button", { name: /^Withdraw/ })).toBeNull();
    more(inForce(), 3, "Withdraw v3…");
    const dialog = await screen.findByRole("dialog", { name: "Withdraw v3?" });
    expect(within(dialog).getByText("The text, file name and change note of v3 are deleted and can no longer be read or exported. The version number, who published it and when stay; results made under v3 keep showing “Guidelines v3 (withdrawn)”. This cannot be undone.")).toBeDefined();
    expect(within(dialog).getByText("No guideline is in force until you publish a new version. v2 does not come back automatically.")).toBeDefined();
    expect(within(dialog).getByLabelText("Reason (optional)")).toBeDefined();
    expect(within(dialog).getByText("Shown instead of the change note. Do not repeat confidential content.")).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Withdraw v3" }).className).toContain("btn-danger");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.withdrawGuideline).not.toHaveBeenCalled();
  });

  it("withdraw dialog for an older version has no such sentence", async () => {
    renderSection();
    await loaded();
    more(row(2), 2, "Withdraw v2…");
    const dialog = await screen.findByRole("dialog", { name: "Withdraw v2?" });
    expect(within(dialog).getByText(/^The text, file name and change note of v2 are deleted/)).toBeDefined();
    expect(within(dialog).queryByText(/No guideline is in force/)).toBeNull();
  });

  it("withdraw keeps the reason on conflict and focuses v4 withdrawn. on success", async () => {
    const four = guidelineListing([guidelineSummary(4), ...three().versions]);
    renderSection(four);
    await loaded(4);
    more(row(4), 4, "Withdraw v4…");
    const dialog = await screen.findByRole("dialog", { name: "Withdraw v4?" });
    fireEvent.change(within(dialog).getByLabelText("Reason (optional)"), { target: { value: " Wrong file " } });
    vi.mocked(api.withdrawGuideline).mockRejectedValueOnce(conflict());
    fireEvent.click(within(dialog).getByRole("button", { name: "Withdraw v4" }));
    expect(await within(dialog).findByText(CONFLICT_TEXT)).toBeDefined();
    expect(api.withdrawGuideline).toHaveBeenCalledWith(KEY, 4, { reason: "Wrong file", expected_latest_version: 4 });
    await waitFor(() => expect(api.listGuidelines).toHaveBeenCalledTimes(2));
    expect((within(dialog).getByLabelText("Reason (optional)") as HTMLInputElement).value).toBe(" Wrong file ");

    vi.mocked(api.withdrawGuideline).mockResolvedValueOnce(withdrawnGuideline(4, "Wrong file"));
    vi.mocked(api.listGuidelines).mockResolvedValue(guidelineListing([withdrawnGuideline(4, "Wrong file"), ...three().versions]));
    fireEvent.click(within(dialog).getByRole("button", { name: "Withdraw v4" }));
    const message = await screen.findByText("v4 withdrawn.");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement?.contains(message)).toBe(true));
    expect(await screen.findByText(/^No guideline is in force\. v4 was withdrawn/)).toBeDefined();
  });

  it("sends no reason when the reason is blank", async () => {
    renderSection();
    await loaded();
    more(row(1), 1, "Withdraw v1…");
    const dialog = await screen.findByRole("dialog", { name: "Withdraw v1?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Withdraw v1" }));
    await screen.findByText("v1 withdrawn.");
    expect(api.withdrawGuideline).toHaveBeenCalledWith(KEY, 1, { reason: null, expected_latest_version: 3 });
  });

  it("withdrawn rows show — and the Withdrawn {date} by {person}: {reason} note without Read or Withdraw", async () => {
    renderSection(guidelineListing([guidelineSummary(3), withdrawnGuideline(2, "Wrong file"), withdrawnGuideline(1)]));
    await loaded();
    const withdrawn = row(2);
    const cells = within(withdrawn).getAllByRole("cell").map(cell => cell.textContent);
    expect(cells.slice(0, 3)).toEqual(["12 Oct, 14:02", "Withdrawn 21 Oct by Jana Popp (ann-0002): Wrong file", "—not set"]);
    expect(within(withdrawn).queryByRole("button")).toBeNull();
    expect(within(row(1)).getByText("Withdrawn 21 Oct by Jana Popp (ann-0002)")).toBeDefined();
    expect(within(row(1)).queryByRole("button")).toBeNull();
  });

  it("shows No guideline is in force when the current version is withdrawn", async () => {
    renderSection(guidelineListing([withdrawnGuideline(4), guidelineSummary(3)]));
    expect(await screen.findByText("No guideline is in force. v4 was withdrawn on 21 Oct by Jana Popp (ann-0002). Publish a new version, or republish an earlier version from the list below.")).toBeDefined();
    // No in-force card; the publish form is open at once.
    expect(screen.queryByRole("region", { name: /^In force/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "No guidelines yet" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Publish v5" })).toBeDefined();
    choose(markdown());
    expect(await screen.findByRole("button", { name: "Publish as v5" })).toBeDefined();
    fireEvent.click(within(row(3)).getByRole("button", { name: "Read v3" }));
    const reader = await screen.findByRole("region", { name: "Reading v3" });
    await within(reader).findByRole("heading", { name: "Guidelines v3" });
    expect(within(reader).queryByText(/The current version is/)).toBeNull();
  });

  it("without an earlier readable version the withdrawal notice only asks for a new version", async () => {
    renderSection(guidelineListing([withdrawnGuideline(2), withdrawnGuideline(1)]));
    expect(await screen.findByText("No guideline is in force. v2 was withdrawn on 21 Oct by Jana Popp (ann-0002). Publish a new version.")).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Republish/ })).toBeNull();
  });

  it("Republish fills the publish form with an earlier version's text for review", async () => {
    renderSection(guidelineListing([withdrawnGuideline(4), guidelineSummary(3), withdrawnGuideline(2), guidelineSummary(1)]));
    await screen.findByText(/^No guideline is in force/);
    // Withdrawn rows have no actions at all.
    expect(within(row(4)).queryByRole("button")).toBeNull();
    expect(within(row(2)).queryByRole("button")).toBeNull();
    more(row(3), 3, "Republish v3…");
    const preview = await screen.findByRole("region", { name: "Preview of guide-v3.md" });
    expect(api.getGuideline).toHaveBeenCalledWith(KEY, 3);
    expect(await within(preview).findByText("Annotate negations.")).toBeDefined();
    expect((screen.getByLabelText("What changed? (optional)") as HTMLInputElement).value).toBe("Republished v3");
    await waitFor(() => expect(document.activeElement).toBe(preview));
    fireEvent.click(screen.getByRole("button", { name: "Publish as v5" }));
    await waitFor(() => expect(api.publishGuideline).toHaveBeenCalledTimes(1));
    const input = vi.mocked(api.publishGuideline).mock.calls[0][1];
    expect(input.file.name).toBe("guide-v3.md");
    expect(await readGuidelineFile(input.file)).toEqual({ text: "# Guide v3\n\nAnnotate negations.", kind: "markdown" });
    expect(input).toMatchObject({ changeNote: "Republished v3", expectedLatestVersion: 4 });
  });

  it("offers Republish for older versions but not for the one in force", async () => {
    renderSection();
    await loaded();
    expect(openMore(row(3), 3)).toEqual(["Withdraw v3…"]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(openMore(row(2), 2)).toEqual(["Republish v2…", "Withdraw v2…"]);
  });

  it("shows the load error with a retry", async () => {
    vi.mocked(api.listGuidelines).mockRejectedValueOnce(new Error("Network down"));
    renderSection();
    expect(await screen.findByText("Network down")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await loaded()).toBeDefined();
  });
});
