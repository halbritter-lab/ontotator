import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type AssignmentView, type GuidelineNotice } from "../api/client";
import { routeHref } from "../app/router";
import { GuidelineReader } from "../guidelines/GuidelineReader";
import { Button, Drawer, IconBook, InlineMessage } from "../ui";

export interface TaskGuidelinesProps {
  assignment: AssignmentView;
  /** The task's real read-only state (submitted, held, read-only round): no notice and nothing recorded. */
  readOnly: boolean;
  children: (parts: { button: ReactNode; notice: ReactNode; drawer: ReactNode }) => ReactNode;
  /**
   * Only where no other part of the screen reloads the task metadata on window focus (the translation
   * review's lead-correction mode has no problem reporter): the focus reload then also re-reads the task
   * and hands it here when its guideline state changed.
   */
  onRefresh?: (assignment: AssignmentView) => void;
}

const guidelineState = (value: AssignmentView) => JSON.stringify([value.guideline ?? null, value.guideline_notice ?? null]);

/**
 * "Guidelines vN" in a task: the toolbar button (with "New" while a version newer than the user's last
 * opened one is in force), the one-time update notice on editable tasks and the reading drawer. The
 * caller places the three parts. Showing the notice records `notified`; the drawer's reader records `opened`.
 */
export function TaskGuidelines({ assignment, readOnly, children, onRefresh }: TaskGuidelinesProps): JSX.Element {
  const projectKey = assignment.project_key;
  const current = assignment.guideline?.version ?? null;
  const [latestSeen, setLatestSeen] = useState<{ key: string; version: number | null } | null>(null);
  const [drawer, setDrawer] = useState<{ open: boolean; version: number | null }>({ open: false, version: null });
  const [notice, setNotice] = useState<{ key: string; value: GuidelineNotice } | null>(null);
  const recorded = useRef(new Set<string>());
  const button = useRef<HTMLButtonElement>(null);
  // The toolbar holding the button, kept so focus can return there when the button unmounts (version withdrawn).
  const toolbar = useRef<HTMLElement | null>(null);
  const returnFocus = useRef({
    get current(): HTMLElement | null {
      if (button.current?.isConnected) return button.current;
      const group = toolbar.current?.isConnected ? toolbar.current : null;
      const inGroup = group?.querySelector<HTMLElement>("button:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])");
      if (inGroup) return inGroup;
      const heading = document.querySelector<HTMLElement>("main h1, h1");
      if (heading && !heading.hasAttribute("tabindex")) heading.tabIndex = -1;
      return heading;
    },
  }).current;
  // Bumped by a focus reload while the drawer is open, so its reader fetches the text again.
  const [readerLoad, setReaderLoad] = useState(0);
  const drawerOpen = useRef(false);
  drawerOpen.current = drawer.open;
  const latest = useRef({ assignment, onRefresh });
  latest.current = { assignment, onRefresh };

  // The user's latest opened version, for the badge; re-read on window focus like the task metadata.
  useEffect(() => {
    let active = true;
    const load = () => {
      void api.listGuidelines(projectKey).then(listing => {
        if (active) setLatestSeen(seen => ({ key: projectKey, version: Math.max(listing.my_latest_seen ?? 0, seen?.key === projectKey ? seen.version ?? 0 : 0) || null }));
      }, () => undefined);
    };
    const onFocus = () => {
      load();
      if (drawerOpen.current) setReaderLoad(value => value + 1);
      const { assignment: shown, onRefresh: refresh } = latest.current;
      if (!refresh) return;
      void api.getAssignmentMetadata(shown.id).then(fresh => {
        // A failed load keeps the shown task; an unchanged guideline state is not handed on (no refresh loop).
        if (active && guidelineState(fresh) !== guidelineState(latest.current.assignment)) latest.current.onRefresh?.(fresh);
      }, () => undefined);
    };
    load();
    window.addEventListener("focus", onFocus);
    return () => { active = false; window.removeEventListener("focus", onFocus); };
  }, [projectKey]);

  // The notice is shown (and `notified` recorded) once per version; later reloads without it keep it until closed.
  const offered = readOnly ? null : assignment.guideline_notice ?? null;
  useEffect(() => {
    if (!offered) return;
    const id = JSON.stringify([projectKey, offered.to_version]);
    if (recorded.current.has(id)) return;
    recorded.current.add(id);
    setNotice({ key: projectKey, value: offered });
    void api.recordGuidelineRead(projectKey, offered.to_version, "notified").catch(() => undefined);
  }, [projectKey, offered]);

  const openDrawer = (version: number) => {
    toolbar.current = button.current?.parentElement ?? toolbar.current;
    setDrawer({ open: true, version });
    setLatestSeen(seen => ({ key: projectKey, version: Math.max(version, seen?.key === projectKey ? seen.version ?? 0 : 0) }));
  };
  const closeDrawer = () => setDrawer(value => ({ ...value, open: false }));

  const seenLoaded = latestSeen?.key === projectKey;
  const isNew = current !== null && seenLoaded && (latestSeen.version === null || current > latestSeen.version);
  const buttonPart = current === null ? null
    : <Button ref={button} size="sm" className="task-guidelines-entry" icon={<IconBook />} onClick={() => openDrawer(current)}
      aria-label={`Guidelines v${current}, open the project guidelines${isNew ? ", updated" : ""}`}>
      Guidelines v{current}{isNew && <> <span className="task-guidelines-badge">New</span></>}
    </Button>;

  const shown = !readOnly && current !== null && notice?.key === projectKey ? notice.value : null;
  const noticePart = shown && <GuidelineNoticeMessage notice={shown} onRead={() => { setNotice(null); openDrawer(shown.to_version); }} onClose={() => setNotice(null)} />;

  const version = drawer.version;
  const drawerPart = version !== null && <Drawer open={drawer.open} title={`Guidelines v${version}`} onClose={closeDrawer} returnFocusRef={returnFocus}
    footer={<>
      <a className="btn btn-secondary" href={routeHref({ name: "projectGuidelines", key: projectKey })} target="_blank" rel="noopener noreferrer">All versions</a>
      <Button onClick={closeDrawer}>Close</Button>
    </>}>
    {/* Remounted when the version in force changes or a focus reload runs, so a withdrawal of the shown version replaces its text. */}
    <div className="task-guidelines-reader">
      <GuidelineReader key={`${version}:${current ?? "none"}:${readerLoad}`} projectKey={projectKey} version={version} currentVersion={current} headingLevel={2} showHeading={false} />
    </div>
  </Drawer>;

  return <>{children({ button: buttonPart, notice: noticePart || null, drawer: drawerPart || null })}</>;
}

function GuidelineNoticeMessage({ notice, onRead, onClose }: { notice: GuidelineNotice; onRead: () => void; onClose: () => void }): JSX.Element {
  const read = <Button variant="quiet" size="sm" onClick={onRead}>Read guidelines v{notice.to_version}</Button>;
  if (notice.from_version === null) {
    return <InlineMessage tone="info" title={`This project has guidelines (v${notice.to_version})`} onDismiss={onClose}>
      <p className="task-guidelines-notice-text">Read them before you start; they are available at any time under Guidelines in the toolbar.</p>
      {read}
    </InlineMessage>;
  }
  return <InlineMessage tone="info" title={`Guidelines updated to v${notice.to_version}`} onDismiss={onClose}>
    <ul className="task-guidelines-changes">
      {notice.changes.map(change => <li key={change.version}>
        {change.withdrawn ? `v${change.version}: withdrawn` : change.change_note ? `v${change.version}: ${change.change_note}` : `v${change.version}`}
      </li>)}
    </ul>
    {notice.more > 0 && <p className="task-guidelines-notice-text">{`and ${notice.more} earlier ${notice.more === 1 ? "change" : "changes"}`}</p>}
    {read}
  </InlineMessage>;
}
