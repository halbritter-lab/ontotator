import { Fragment, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Kbd, formatKey } from "./Kbd";
import { useRegisteredShortcuts, useShortcut } from "./shortcuts";

const hosts = new Set<object>();
const subscribers = new Set<() => void>();
let state: { owner?: object; open: boolean } = { open: false };
function publish(open = state.open) {
  state = { owner: hosts.values().next().value, open: hosts.size > 0 && open };
  for (const subscriber of subscribers) subscriber();
}
const subscribe = (subscriber: () => void) => { subscribers.add(subscriber); return () => { subscribers.delete(subscriber); }; };
const getSnapshot = () => state;
export function openShortcutHelp(): void { publish(true); }

export function ShortcutHelpHost(): JSX.Element | null {
  const identity = useRef({});
  const root = useRef<HTMLDivElement>(null);
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useLayoutEffect(() => {
    hosts.add(identity.current); publish();
    return () => { hosts.delete(identity.current); publish(); };
  }, []);
  const owner = current.owner === identity.current;
  const rows = useRegisteredShortcuts();
  const toggle = () => { publish(!state.open); };
  useShortcut("?", toggle, { scope: "global", enabled: owner, description: "Show / hide this help", root });
  useShortcut("?", toggle, { scope: "dialog", enabled: owner && current.open, root });
  if (!owner) return null;
  const groups = new Map<string, typeof rows[number][]>();
  for (const row of rows) { const group = groups.get(row.group) ?? []; group.push(row); groups.set(row.group, group); }
  return <div ref={root}><Dialog open={current.open} title="Keyboard shortcuts" onClose={() => publish(false)} footer={<Button onClick={() => publish(false)}>Close</Button>}>
    {Array.from(groups, ([group, bindings]) => <section className="shortcut-help-group" key={group}>
      <h3>{group}</h3>
      <dl>{bindings.map((row, index) => <div className="shortcut-help-row" key={index}>
        <dt>{row.keys.map((key, keyIndex) => <Fragment key={keyIndex}>{keyIndex > 0 && " / "}<Kbd>{formatKey(key)}</Kbd></Fragment>)}</dt>
        <dd>{row.description}{row.unavailable && <span className="shortcut-help-unavailable"> (not available right now)</span>}</dd>
      </div>)}</dl>
    </section>)}
    <p className="shortcut-help-note">Shortcuts are disabled while typing in a field or when a dialog is open.</p>
  </Dialog></div>;
}
