import { useEffect, useRef, useState } from "react";
import { api, type CurrentUser, type Profile, type ProjectSummary } from "./api/client";
import { Shell } from "./app/Shell";
import { NotFound } from "./app/NotFound";
import { TaskEditor } from "./tasks/TaskEditor";
import { parseRoute, routeHref, type Route, type RouteLeaveGuard } from "./app/router";
import { MyTasks } from "./tasks/MyTasks";
import { ProfilePage } from "./me/ProfilePage";
import { ErrorNotice } from "./admin/ErrorNotice";
import { Button, EmptyState, InlineMessage } from "./ui";

export interface AppProps { user?: CurrentUser | null; onLogout?: () => void }

function clearLegacyStorage(): void {
  try {
    const storage = window.localStorage;
    const stale = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => key === "ontocurator.annotatorId" || !!key?.startsWith("ontocurator.mode."));
    stale.forEach(key => storage.removeItem(key));
  } catch { /* Storage may be unavailable. Identity always comes from the session. */ }
}

export function App({ user: givenUser, onLogout }: AppProps): JSX.Element {
  const [loadedUser, setLoadedUser] = useState<CurrentUser | null>(null);
  const [savedIdentity, setSavedIdentity] = useState<Profile | null>(null);
  const baseUser = givenUser === undefined ? loadedUser : givenUser;
  const user = baseUser && savedIdentity?.username === baseUser.username
    ? { ...baseUser, display_name: savedIdentity.display_name } : baseUser;
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectError, setProjectError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const acceptedHash = useRef(window.location.hash || "#/");
  const acceptedIndex = useRef(typeof window.history.state?.ontocuratorRouteIndex === "number" ? window.history.state.ontocuratorRouteIndex as number : 0);
  const traversal = useRef<{ hash: string; index: number; state: Record<string, unknown> } | null>(null);
  const restoringHistory = useRef(false);
  const historyRestored = useRef<(() => void) | null>(null);
  const routeLeaveRef = useRef<RouteLeaveGuard | null>(null);
  const logoutGuardRef = useRef<((proceed: () => void) => void) | null>(null);
  const destination = useRef<{ route: Route; replace: boolean } | null>(null);
  const leaving = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    clearLegacyStorage();
    // Mark entries created by this controller so a cancelled Back/Forward can
    // restore the history cursor as well as the visible URL.
    window.history.replaceState({ ...window.history.state, ontocuratorRouteIndex: acceptedIndex.current }, "", acceptedHash.current);
    return () => { alive.current = false; historyRestored.current?.(); };
  }, []);
  useEffect(() => {
    if (givenUser !== undefined) return;
    let active = true;
    api.me().then(next => { if (active) setLoadedUser(next); }, error => { if (active) setProjectError(error); });
    return () => { active = false; };
  }, [givenUser]);
  useEffect(() => {
    if (!baseUser) return;
    let active = true;
    setProjectError(null);
    api.listProjects().then(next => { if (active) setProjects(next); }, error => { if (active) setProjectError(error); });
    return () => { active = false; };
  }, [baseUser?.username, retry]);

  const restoreTraversal = async (): Promise<void> => {
    const travelled = traversal.current;
    if (!travelled) return;
    traversal.current = null;
    const distance = acceptedIndex.current - travelled.index;
    if (distance === 0) {
      window.history.replaceState(travelled.state, "", acceptedHash.current);
      return;
    }
    window.history.replaceState(travelled.state, "", travelled.hash);
    restoringHistory.current = true;
    await new Promise<void>(resolve => {
      historyRestored.current = resolve;
      window.history.go(distance);
    });
  };

  // Share a single editor save/leave flow. Keep the accepted URL and editor until
  // it resolves, then navigate to the most recent requested destination.
  const requestRoute = async (next: Route, replace = false): Promise<void> => {
    destination.current = { route: next, replace };
    if (leaving.current) return;
    leaving.current = true;
    try {
      const allowed = await (routeLeaveRef.current?.() ?? Promise.resolve(true));
      if (!alive.current) return;
      if (!allowed) {
        await restoreTraversal();
        return;
      }
      const target = destination.current;
      if (!target) return;
      const hash = routeHref(target.route);
      if (hash !== acceptedHash.current) {
        const travelled = traversal.current;
        const index = travelled?.index ?? acceptedIndex.current + 1;
        window.history[travelled || target.replace ? "replaceState" : "pushState"](
          { ...window.history.state, ontocuratorRouteIndex: index }, "", hash,
        );
        traversal.current = null;
        acceptedIndex.current = index;
        acceptedHash.current = hash;
        setRoute(target.route);
      } else await restoreTraversal();
    } finally { leaving.current = false; destination.current = null; }
  };
  const requestRef = useRef(requestRoute);
  requestRef.current = requestRoute;
  useEffect(() => {
    const changed = () => {
      const hash = window.location.hash;
      if (restoringHistory.current && hash === acceptedHash.current) {
        restoringHistory.current = false;
        historyRestored.current?.(); historyRestored.current = null;
        return;
      }
      if (hash === acceptedHash.current && !leaving.current && !traversal.current) return;
      const state = window.history.state ?? {};
      const index = typeof state.ontocuratorRouteIndex === "number" ? state.ontocuratorRouteIndex : (traversal.current?.index ?? acceptedIndex.current) + 1;
      traversal.current = { hash, index, state: { ...state, ontocuratorRouteIndex: index } };
      window.history.replaceState(traversal.current.state, "", acceptedHash.current);
      void requestRef.current(parseRoute(hash), true);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);

  if (!user) return projectError ? <ErrorNotice error={projectError} /> : <InlineMessage tone="info">Checking your session...</InlineMessage>;
  const go = (next: Route) => { void requestRoute(next); };
  const logout = () => {
    const proceed = () => onLogout?.();
    if (logoutGuardRef.current) logoutGuardRef.current(proceed); else proceed();
  };
  let content: JSX.Element;
  switch (route.name) {
    case "tasks": content = <MyTasks project={route.project} projects={projects} onNavigate={go} />; break;
    case "task": content = <TaskEditor key={route.assignmentId} assignmentId={route.assignmentId}
      user={user} onNavigate={go} routeLeaveRef={routeLeaveRef} leaveGuardRef={logoutGuardRef} />; break;
    case "me": content = <ProfilePage onSaved={setSavedIdentity} />; break;
    case "notFound": content = <NotFound onNavigate={go} />; break;
    default: content = <EmptyState title="This page is not available yet.">This section is planned for a later step.</EmptyState>;
  }
  return <Shell user={user} projects={projects} route={route} onNavigate={go} onLogout={logout}
    breadcrumb={route.name === "task" ? [
      { label: "My tasks", onClick: () => go({ name: "tasks" }) }, { label: `Task ${route.assignmentId}` },
    ] : undefined}>
    {!!projectError && <><ErrorNotice error={projectError} /><Button onClick={() => setRetry(value => value + 1)}>Retry projects</Button></>}
    {content}
  </Shell>;
}
