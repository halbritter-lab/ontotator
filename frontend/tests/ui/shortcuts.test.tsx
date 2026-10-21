import { StrictMode, createRef, useRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { isTypingTarget, matches, useRegisteredShortcuts, useShortcut, useShortcutHint, type ShortcutOptions } from "../../src/ui/shortcuts";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Binding({ keys = "j", handler, options }: { keys?: string | string[]; handler: (event: KeyboardEvent) => void | false; options?: ShortcutOptions }) {
  useShortcut(keys, handler, options);
  return null;
}
function Hint({ enabled = true }: { enabled?: boolean }) {
  useShortcutHint(["Shift+arrows", "←/→"], "Select text", { enabled, group: "Editor" });
  return null;
}
function Help() {
  const rows = useRegisteredShortcuts();
  return <output data-testid="help">{JSON.stringify(rows)}</output>;
}
const rows = () => JSON.parse(screen.getByTestId("help").textContent ?? "[]");
function press(key = "j", init: KeyboardEventInit = {}, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(event); });
  return event;
}

it("modifiers_must_match_exactly", () => {
  expect(matches("j", new KeyboardEvent("keydown", { key: "j", ctrlKey: true }))).toBe(false);
  expect(matches("Alt+ArrowRight", new KeyboardEvent("keydown", { key: "ArrowRight" }))).toBe(false);
  expect(matches("Alt+ArrowRight", new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true }))).toBe(true);
  expect(matches("Ctrl+Meta+j", new KeyboardEvent("keydown", { key: "J", ctrlKey: true, metaKey: true }))).toBe(true);
  expect(matches("j", new KeyboardEvent("keydown", { key: "j", metaKey: true }))).toBe(false);
  expect(matches("j", new KeyboardEvent("keydown", { key: "j", altKey: true }))).toBe(false);
});

it("letters_are_case_insensitive_and_shift_is_ignored_for_characters", () => {
  for (const [binding, key] of [["j", "J"], ["?", "?"], ["1", "1"], ["+", "+"], ["Ctrl++", "+"]]) {
    expect(matches(binding, new KeyboardEvent("keydown", { key, shiftKey: true, ctrlKey: binding === "Ctrl++" }))).toBe(true);
  }
  expect(matches("?", new KeyboardEvent("keydown", { key: "/", shiftKey: true }))).toBe(false);
});

it("alt_letter_bindings_fall_back_to_event_code", () => {
  // macOS Option+M yields "µ"; the physical key code still names the letter.
  expect(matches("Alt+M", new KeyboardEvent("keydown", { altKey: true, key: "µ", code: "KeyM" }))).toBe(true);
  expect(matches("Alt+M", new KeyboardEvent("keydown", { altKey: true, key: "µ", code: "KeyN" }))).toBe(false);
  expect(matches("Alt+M", new KeyboardEvent("keydown", { altKey: true, key: "m", code: "KeyM" }))).toBe(true);
  expect(matches("Alt+M", new KeyboardEvent("keydown", { key: "µ", code: "KeyM" }))).toBe(false);
  // Plain letter bindings never use the code: another layout's letter on that key is a different key.
  expect(matches("m", new KeyboardEvent("keydown", { key: "µ", code: "KeyM" }))).toBe(false);
  expect(matches("m", new KeyboardEvent("keydown", { key: ",", code: "KeyM" }))).toBe(false);
  expect(matches("Ctrl+m", new KeyboardEvent("keydown", { key: "µ", code: "KeyM", ctrlKey: true }))).toBe(false);
});

it("named_control_keys_require_exact_shift_and_key_names", () => {
  expect(matches("Escape", new KeyboardEvent("keydown", { key: "Escape" }))).toBe(true);
  expect(matches("Escape", new KeyboardEvent("keydown", { key: "Escape", shiftKey: true }))).toBe(false);
  expect(matches("Shift+ArrowRight", new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true }))).toBe(true);
  expect(matches("Shift+ArrowRight", new KeyboardEvent("keydown", { key: "ArrowRight" }))).toBe(false);
  expect(matches("Escape", new KeyboardEvent("keydown", { key: "Enter" }))).toBe(false);
});

it("ignores_keys_typed_in_inputs_textareas_selects_and_contenteditable", () => {
  const handler = vi.fn();
  render(<><Binding handler={handler} /><input /><textarea /><select /><div contentEditable /><div contentEditable="false" data-testid="plain" /></>);
  for (const element of document.querySelectorAll("input,textarea,select,[contenteditable=true]")) {
    expect(isTypingTarget(element)).toBe(true);
    expect(press("j", {}, element).defaultPrevented).toBe(false);
  }
  expect(handler).not.toHaveBeenCalled();
  expect(isTypingTarget(null)).toBe(false);
  expect(isTypingTarget(window)).toBe(false);
  expect(isTypingTarget(screen.getByTestId("plain"))).toBe(false);
  expect(press("j", {}, screen.getByTestId("plain")).defaultPrevented).toBe(true);
});

it("allow_in_inputs_opts_in", () => {
  const handler = vi.fn();
  render(<><Binding handler={handler} options={{ allowInInputs: true }} /><input /></>);
  press("j", {}, document.querySelector("input")!);
  expect(handler).toHaveBeenCalledOnce();
});

it("dialog_beats_screen_beats_global", () => {
  const calls: string[] = [];
  const view = render(<><Binding handler={() => { calls.push("dialog"); }} options={{ scope: "dialog" }} /><Binding handler={() => { calls.push("screen"); }} /><Binding handler={() => { calls.push("global"); }} options={{ scope: "global" }} /></>);
  press();
  expect(calls).toEqual(["dialog"]);
  view.rerender(<><Binding handler={() => { calls.push("screen"); }} /><Binding handler={() => { calls.push("global"); }} options={{ scope: "global" }} /></>);
  press();
  expect(calls).toEqual(["dialog", "screen"]);
});

it("the_latest_registration_wins_within_a_scope", () => {
  const calls: string[] = [];
  const view = render(<><Binding handler={() => { calls.push("first"); }} /><Binding handler={() => { calls.push("last"); }} /></>);
  press();
  view.rerender(<><Binding handler={() => { calls.push("updated first"); }} /><Binding handler={() => { calls.push("last"); }} /></>);
  press();
  expect(calls).toEqual(["last", "last"]);
});

it("an_open_aria_modal_dialog_blocks_screen_and_global_bindings", () => {
  const handler = vi.fn();
  render(<><Binding handler={handler} /><Binding handler={handler} options={{ scope: "global" }} /><div aria-modal="true" /></>);
  expect(press().defaultPrevented).toBe(false);
  expect(handler).not.toHaveBeenCalled();
  const dialogHandler = vi.fn();
  render(<Binding handler={dialogHandler} options={{ scope: "dialog" }} />);
  press();
  expect(dialogHandler).toHaveBeenCalledOnce();
});

it("a_binding_whose_root_is_inert_does_not_fire", () => {
  const root = createRef<HTMLDivElement>();
  const handler = vi.fn();
  render(<div {...{ inert: "" }}><div ref={root}><Binding handler={handler} options={{ root }} /></div></div>);
  expect(press().defaultPrevented).toBe(false);
  expect(handler).not.toHaveBeenCalled();
  root.current!.parentElement!.removeAttribute("inert");
  press();
  expect(handler).toHaveBeenCalledOnce();
});

it("repeat_is_ignored_unless_allowed", () => {
  const handler = vi.fn();
  const view = render(<Binding handler={handler} />);
  expect(press("j", { repeat: true }).defaultPrevented).toBe(false);
  view.rerender(<Binding handler={handler} options={{ allowRepeat: true }} />);
  expect(press("j", { repeat: true }).defaultPrevented).toBe(true);
  expect(handler).toHaveBeenCalledOnce();
});

it("composition_events_never_dispatch_even_when_inputs_are_allowed", () => {
  const handler = vi.fn();
  render(<Binding handler={handler} options={{ allowInInputs: true }} />);
  expect(press("j", { isComposing: true }).defaultPrevented).toBe(false);
  expect(handler).not.toHaveBeenCalled();
  press();
  expect(handler).toHaveBeenCalledOnce();
});

it("returning_false_passes_the_event_on", () => {
  const calls: string[] = [];
  render(<><Binding handler={() => { calls.push("screen"); }} /><Binding handler={(event) => { calls.push(`dialog:${event.defaultPrevented}`); return false; }} options={{ scope: "dialog" }} /></>);
  expect(press().defaultPrevented).toBe(true);
  expect(calls).toEqual(["dialog:false", "screen"]);
});

it("all_declining_handlers_leave_the_event_unhandled", () => {
  let calls = 0;
  render(<Binding handler={() => { calls++; return false; }} />);
  expect(press().defaultPrevented).toBe(false);
  expect(calls).toBe(1);
});

it("disabled_bindings_neither_fire_nor_list", () => {
  const handler = vi.fn();
  const view = render(<><Binding handler={handler} options={{ enabled: false, description: "Review" }} /><Help /></>);
  press();
  expect(handler).not.toHaveBeenCalled();
  expect(rows()).toEqual([]);
  view.rerender(<><Binding handler={handler} options={{ description: "Review" }} /><Help /></>);
  press();
  expect(handler).toHaveBeenCalledOnce();
  expect(rows()).toEqual([{ keys: ["j"], description: "Review", group: "General" }]);
});

it("hints_are_listed_but_never_fire", () => {
  const view = render(<><Hint /><Help /></>);
  expect(rows()).toEqual([{ keys: ["Shift+arrows", "←/→"], description: "Select text", group: "Editor" }]);
  expect(press("ArrowRight", { shiftKey: true }).defaultPrevented).toBe(false);
  view.rerender(<><Hint enabled={false} /><Help /></>);
  expect(rows()).toEqual([]);
});

it("help_keeps_registration_order_and_multiple_keys_share_one_row", () => {
  const handler = vi.fn();
  const view = render(<><Binding keys={["j", "k"]} handler={handler} options={{ description: "Review", group: "Review" }} /><Hint /><Binding keys="x" handler={handler} /><Help /></>);
  expect(rows()).toEqual([{ keys: ["j", "k"], description: "Review", group: "Review" }, { keys: ["Shift+arrows", "←/→"], description: "Select text", group: "Editor" }]);
  press("j"); press("k");
  expect(handler).toHaveBeenCalledTimes(2);
  view.unmount();
  render(<Help />);
  expect(rows()).toEqual([]);
});

it("rerender_uses_current_keys_handler_and_options", () => {
  const first = vi.fn();
  const latest = vi.fn();
  const view = render(<><Binding handler={first} options={{ description: "First" }} /><Help /></>);
  view.rerender(<><Binding keys="k" handler={latest} options={{ description: "Latest", group: "Review" }} /><Help /></>);
  expect(press().defaultPrevented).toBe(false);
  press("k");
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledOnce();
  expect(rows()).toEqual([{ keys: ["k"], description: "Latest", group: "Review" }]);
});

it("unmount_unregisters_and_the_last_unmount_removes_the_listener", () => {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const firstHandler = vi.fn();
  const lastHandler = vi.fn();
  const first = render(<Binding handler={firstHandler} />);
  const last = render(<Binding handler={lastHandler} />);
  const added = add.mock.calls.filter(([name]) => name === "keydown");
  expect(added).toHaveLength(1);
  expect(added[0][2] ?? false).toBe(false);
  last.unmount();
  press();
  expect(firstHandler).toHaveBeenCalledOnce();
  expect(lastHandler).not.toHaveBeenCalled();
  expect(remove.mock.calls.filter(([name]) => name === "keydown")).toHaveLength(0);
  first.unmount();
  const removed = remove.mock.calls.filter(([name]) => name === "keydown");
  expect(removed).toHaveLength(1);
  expect(removed[0][1]).toBe(added[0][1]);
  expect(removed[0][2] ?? false).toBe(false);
  expect(press().defaultPrevented).toBe(false);
});

it("bubble_listener_respects_element_stop_propagation", () => {
  const handler = vi.fn();
  render(<><Binding keys="ArrowRight" handler={handler} /><button onKeyDown={(event) => event.stopPropagation()}>Handle</button></>);
  expect(press("ArrowRight", {}, screen.getByRole("button")).defaultPrevented).toBe(false);
  expect(handler).not.toHaveBeenCalled();
  press("ArrowRight");
  expect(handler).toHaveBeenCalledOnce();
});

it("strict_mode_remount_does_not_duplicate_bindings_or_help", () => {
  const handler = vi.fn();
  render(<StrictMode><Binding handler={handler} options={{ description: "Review" }} /><Help /></StrictMode>);
  press();
  expect(handler).toHaveBeenCalledOnce();
  expect(rows()).toEqual([{ keys: ["j"], description: "Review", group: "General" }]);
});

it("multiple_hooks_in_one_component_register_and_cleanup_independently", () => {
  const calls: string[] = [];
  function Shortcuts() {
    useShortcut("j", () => { calls.push("screen"); });
    useShortcut("k", () => { calls.push("global"); }, { scope: "global" });
    return null;
  }
  const view = render(<Shortcuts />);
  press("j"); press("k");
  expect(calls).toEqual(["screen", "global"]);
  view.unmount();
  expect(press("j").defaultPrevented).toBe(false);
  expect(press("k").defaultPrevented).toBe(false);
  expect(calls).toEqual(["screen", "global"]);
});

it("escape_with_allowInInputs_reaches_a_handler_while_a_checkbox_is_focused", () => {
  const handler = vi.fn(() => undefined);
  function Host() {
    const root = useRef<HTMLDivElement>(null);
    useShortcut("Escape", handler, { allowInInputs: true, root });
    return <div ref={root}><input type="checkbox" aria-label="Reviewed" /></div>;
  }
  render(<Host />);
  const box = screen.getByRole("checkbox", { name: "Reviewed" });
  box.focus();
  fireEvent.keyDown(box, { key: "Escape" });
  expect(handler).toHaveBeenCalledOnce();
});

it("a_handler_returning_false_lets_the_event_through", () => {
  const outer = vi.fn(() => undefined), inner = vi.fn(() => false as const);
  function Host() { useShortcut("Escape", outer); useShortcut("Escape", inner); return <button>x</button>; }
  render(<Host />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(inner).toHaveBeenCalledOnce();
  expect(outer).toHaveBeenCalledOnce();
});

it("does not treat checkboxes and radios as typing targets", () => {
  const handler = vi.fn();
  render(<><Binding keys="Ctrl+z" handler={handler} options={{ scope: "screen" }} />
    <input type="checkbox" aria-label="Select case-0101" /><input type="radio" aria-label="Round robin" />
    <input type="text" aria-label="Name" /><textarea aria-label="Note" /><select aria-label="Choice" /><div contentEditable data-testid="editable" /></>);
  expect(isTypingTarget(screen.getByRole("checkbox"))).toBe(false);
  expect(isTypingTarget(screen.getByRole("radio"))).toBe(false);
  for (const name of ["Name", "Note", "Choice"]) expect(isTypingTarget(screen.getByLabelText(name))).toBe(true);
  expect(isTypingTarget(screen.getByTestId("editable"))).toBe(true);
  const box = screen.getByRole("checkbox");
  box.focus();
  expect(press("z", { ctrlKey: true }, box).defaultPrevented).toBe(true);
  expect(handler).toHaveBeenCalledTimes(1);
});
