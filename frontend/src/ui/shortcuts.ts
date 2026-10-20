import { useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from "react";

export type ShortcutScope = "dialog" | "screen" | "global";
export interface ShortcutOptions {
  scope?: ShortcutScope;
  description?: string;
  group?: string;
  enabled?: boolean;
  allowRepeat?: boolean;
  allowInInputs?: boolean;
  root?: RefObject<HTMLElement>;
}

type HelpRow = { keys: string[]; description: string; group: string };
type Entry = {
  keys: string[];
  handler?: (event: KeyboardEvent) => void | false;
  options: ShortcutOptions;
};

// Set insertion order is registration order, including across hook rerenders.
const entries = new Set<Entry>();
const subscribers = new Set<() => void>();
const emptySnapshot: ReadonlyArray<HelpRow> = [];
let snapshot = emptySnapshot;
const priority: Record<ShortcutScope, number> = { dialog: 2, screen: 1, global: 0 };

function publish() {
  const next: HelpRow[] = [];
  for (const { keys, options } of entries) {
    if (options.enabled !== false && options.description) {
      next.push({ keys: [...keys], description: options.description, group: options.group ?? "General" });
    }
  }
  // useSyncExternalStore needs a stable snapshot when the public rows are unchanged.
  if (next.length === snapshot.length && next.every((row, index) => {
    const previous = snapshot[index];
    return row.description === previous.description && row.group === previous.group &&
      row.keys.length === previous.keys.length && row.keys.every((key, i) => key === previous.keys[i]);
  })) return;
  snapshot = next;
  for (const subscriber of subscribers) subscriber();
}

function dispatch(event: KeyboardEvent) {
  if (event.isComposing) return;
  const modalOpen = document.querySelector('[aria-modal="true"]') !== null;
  const typing = isTypingTarget(event.target);
  // Reverse registration order first; stable sorting then groups by scope priority.
  const candidates = [...entries].reverse().filter(({ keys, handler, options }) =>
    handler && options.enabled !== false &&
    (!modalOpen || options.scope === "dialog") &&
    !options.root?.current?.closest("[inert]") &&
    (!event.repeat || options.allowRepeat) &&
    (!typing || options.allowInInputs) &&
    keys.some((binding) => matches(binding, event)),
  ).sort((a, b) => priority[b.options.scope ?? "screen"] - priority[a.options.scope ?? "screen"]);
  for (const entry of candidates) {
    if (entry.handler!(event) !== false) {
      event.preventDefault();
      return;
    }
  }
}

function useEntry(value: Entry): void {
  const entry = useRef(value);
  useLayoutEffect(() => {
    entries.add(entry.current);
    if (entries.size === 1) window.addEventListener("keydown", dispatch, false);
    publish();
    return () => {
      entries.delete(entry.current);
      if (entries.size === 0) window.removeEventListener("keydown", dispatch, false);
      publish();
    };
  }, []);
  useLayoutEffect(() => {
    // Updating a registration must not give it newer conflict priority.
    Object.assign(entry.current, value);
    publish();
  });
}

export function useShortcut(
  keys: string | string[],
  handler: (event: KeyboardEvent) => void | false,
  options: ShortcutOptions = {},
): void {
  useEntry({ keys: typeof keys === "string" ? [keys] : keys, handler, options });
}

export function useShortcutHint(
  keysLabel: string[],
  description: string,
  options: { group?: string; enabled?: boolean } = {},
): void {
  useEntry({ keys: keysLabel, options: { ...options, description } });
}

const subscribe = (subscriber: () => void) => {
  subscribers.add(subscriber);
  return () => { subscribers.delete(subscriber); };
};
const getSnapshot = () => snapshot;
const getServerSnapshot = () => emptySnapshot;

export function useRegisteredShortcuts(): ReadonlyArray<HelpRow> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function matches(binding: string, event: KeyboardEvent): boolean {
  const modifiers = new Set<string>();
  let key = binding;
  let prefix: RegExpExecArray | null;
  while ((prefix = /^(Alt|Ctrl|Meta|Shift)\+/.exec(key))) {
    modifiers.add(prefix[1]);
    key = key.slice(prefix[0].length);
  }
  if (event.altKey !== modifiers.has("Alt") || event.ctrlKey !== modifiers.has("Ctrl") ||
      event.metaKey !== modifiers.has("Meta")) return false;
  if ([...key].length === 1) return key.toLowerCase() === event.key.toLowerCase();
  return key === event.key && event.shiftKey === modifiers.has("Shift");
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el !== "object") return false;
  const tag = el.tagName?.toLowerCase();
  // Checkboxes and radios take no text, so screen shortcuts (Ctrl+Z, Shift+arrows) still reach them.
  if (tag === "input") return !["checkbox", "radio"].includes((el as HTMLInputElement).type?.toLowerCase());
  if (tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  const editable = el.getAttribute?.("contenteditable");
  return editable !== null && editable !== undefined && editable !== "false";
}
