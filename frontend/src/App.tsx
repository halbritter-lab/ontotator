import { useEffect, useRef, useState } from "react";
import { api, type CurrentUser, type Profile, type ProjectSummary } from "./api/client";
import { CaseViewer } from "./variants/CaseViewer";
import { Shell } from "./app/Shell";
import { NotFound } from "./app/NotFound";
import { TaskEditor } from "./tasks/TaskEditor";
import { parseRoute, routeHref, type NavigateOptions, type Route, type RouteLeaveGuard } from "./app/router";
import { MyTasks } from "./tasks/MyTasks";
import { ProfilePage } from "./me/ProfilePage";
import { ErrorNotice } from "./admin/ErrorNotice";
import { UsersPage } from "./admin/UsersPage";
import { OntologiesPage } from "./admin/OntologiesPage";
import { ProjectNewPage } from "./admin/ProjectNewPage";
import { ProjectSettingsPage } from "./admin/ProjectSettingsPage";
import { DocumentsPage } from "./admin/DocumentsPage";
import { ProgressPage } from "./admin/ProgressPage";
import { ExportPage } from "./admin/ExportPage";
import { ProblemReportDetail } from './tasks/ProblemReportDetail';
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
  const [projectContext, setProjectContext] = useState<{ identity: string; projects: ProjectSummary[] } | null>(null);
  const [projectError, setProjectError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const projectIdentity = JSON.stringify([baseUser?.username, baseUser?.is_system_admin, retry]);
  const projects = baseUser && projectContext?.identity === projectIdentity ? projectContext.projects : [];
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [taskProject, setTaskProject] = useState<{ identity: string; key: string } | null>(null);
  const taskIdentity = route.name === 'task' ? JSON.stringify([baseUser?.username, route.assignmentId]) : '';
  const acceptedHash = useRef(window.location.hash || "#/");
  const acceptedIndex = useRef(typeof window.history.state?.ontocuratorRouteIndex === "number" ? window.history.state.ontocuratorRouteIndex as number : 0);
  type HistoryEntry = { hash: string; index: number; state: Record<string, unknown> };
  const historyCursor = useRef(acceptedIndex.current);
  const replacedEntries = useRef(new Map<number, HistoryEntry>());
  const historyTarget = useRef<number | null>(null);
  const restoringHistory = useRef(false);
  const historyRestored = useRef<(() => void) | null>(null);
  const routeLeaveRef = useRef<RouteLeaveGuard | null>(null);
  const logoutGuardRef = useRef<((proceed: () => void) => void) | null>(null);
  const destination = useRef<{ route: Route; nativeIndex?: number; options?: NavigateOptions } | null>(null);
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
    setProjectContext(null);
    if (!baseUser) return;
    let active = true;
    setProjectError(null);
    api.listProjects().then(next => { if (active) setProjectContext({ identity: projectIdentity, projects: next }); }, error => { if (active) setProjectError(error); });
    return () => { active = false; };
  }, [projectIdentity]);

  const travelTo = async (index: number): Promise<void> => {
    if (!alive.current || historyCursor.current === index) return;
    await new Promise<void>(resolve => {
      historyTarget.current = index;
      historyRestored.current = resolve;
      window.history.go(index - historyCursor.current);
    });
  };

  const restoreEntries = async (): Promise<void> => {
    // More than one native traversal may occur while a single dialog is open.
    // Restore every temporary URL, including intermediate Back/Forward entries.
    for (const [index, entry] of [...replacedEntries.current].sort(([a], [b]) => a - b)) {
      await travelTo(index);
      if (!alive.current) return;
      window.history.replaceState(entry.state, "", entry.hash);
    }
    replacedEntries.current.clear();
  };

  // Share a single editor save/leave flow. Keep the accepted editor until it
  // resolves, then honor the latest native destination or ordinary link.
  const requestRoute = async (next: Route, nativeIndex?: number, options?: NavigateOptions): Promise<void> => {
    destination.current = { route: next, nativeIndex, options };
    if (leaving.current) return;
    leaving.current = true;
    try {
      const allowed = await (routeLeaveRef.current?.() ?? Promise.resolve(true));
      if (!alive.current) return;
      restoringHistory.current = true;
      await restoreEntries();
      if (!allowed) { await travelTo(acceptedIndex.current); return; }
      let target = destination.current;
      // A link can supersede the native request while its entries are restored.
      while (target) {
        await travelTo(target.nativeIndex ?? acceptedIndex.current);
        if (!alive.current) return;
        if (target === destination.current) break;
        target = destination.current;
      }
      if (!target) return;
      const hash = routeHref(target.route);
      if (target.nativeIndex === undefined) {
        if (hash === acceptedHash.current) return;
        // Replace keeps the accepted index (e.g. row expansion), so Back skips it.
        if (target.options?.replace) {
          window.history.replaceState({ ...window.history.state, ontocuratorRouteIndex: acceptedIndex.current }, "", hash);
        } else {
          acceptedIndex.current++;
          window.history.pushState({ ...window.history.state, ontocuratorRouteIndex: acceptedIndex.current }, "", hash);
        }
        historyCursor.current = acceptedIndex.current;
      } else acceptedIndex.current = target.nativeIndex;
      acceptedHash.current = hash;
      setRoute(target.route);
    } finally {
      restoringHistory.current = false;
      historyTarget.current = null;
      historyRestored.current = null;
      leaving.current = false;
      destination.current = null;
    }
  };
  const requestRef = useRef(requestRoute);
  requestRef.current = requestRoute;
  useEffect(() => {
    const changed = (event: Event) => {
      // Native traversal dispatches popstate followed by hashchange. A paired
      // hashchange can describe the URL we already temporarily replaced.
      if (event instanceof HashChangeEvent && event.newURL !== window.location.href) return;
      const hash = window.location.hash;
      const state = window.history.state ?? {};
      const index = typeof state.ontocuratorRouteIndex === "number" ? state.ontocuratorRouteIndex : historyCursor.current + 1;
      historyCursor.current = index;
      if (restoringHistory.current) {
        if (index === historyTarget.current) historyRestored.current?.();
        return;
      }
      if (hash === acceptedHash.current && index === acceptedIndex.current && !leaving.current) return;
      const original = replacedEntries.current.get(index) ?? { hash, index, state: { ...state, ontocuratorRouteIndex: index } };
      replacedEntries.current.set(index, original);
      window.history.replaceState(original.state, "", acceptedHash.current);
      void requestRef.current(parseRoute(original.hash), index);
    };
    window.addEventListener("popstate", changed);
    window.addEventListener("hashchange", changed);
    return () => {
      window.removeEventListener("popstate", changed);
      window.removeEventListener("hashchange", changed);
    };
  }, []);

  if (!user) return projectError ? <ErrorNotice error={projectError} /> : <InlineMessage tone="info">Checking your session...</InlineMessage>;
  const go = (next: Route, options?: NavigateOptions) => { void requestRoute(next, undefined, options); };
  const logout = () => {
    const proceed = () => onLogout?.();
    if (logoutGuardRef.current) logoutGuardRef.current(proceed);
    else void (routeLeaveRef.current?.() ?? Promise.resolve(true)).then(allowed => {
      if (allowed && alive.current) proceed();
    });
  };
  let content: JSX.Element;
  switch (route.name) {
    case "tasks": content = <MyTasks project={route.project} projects={projects} onNavigate={go} />; break;
    case "task": content = <TaskEditor key={JSON.stringify([user.username, route.assignmentId])} assignmentId={route.assignmentId}
      user={user} onNavigate={go} routeLeaveRef={routeLeaveRef} leaveGuardRef={logoutGuardRef}
      onProjectContext={key => setTaskProject({ identity: taskIdentity, key })} />; break;
    case "adminUsers": content = <UsersPage currentUser={user} routeLeaveRef={routeLeaveRef} />; break;
    case "adminOntologies": content = <OntologiesPage onNavigate={go} />; break;
    case "projectNew": content = <ProjectNewPage onNavigate={next => { setRetry(value => value + 1); go(next); }} />; break;
    case "projectSettings": content = <ProjectSettingsPage projectKey={route.key} currentUser={user}
      onSaved={() => setRetry(value => value + 1)} />; break;
    case "projectDocuments": {
      const currentProject = projects.find(project => project.project_key === route.key);
      // Display capability only; the import endpoint rechecks current authority.
      const canOverrideTranslationStatus = !!currentProject?.can_manage && (user.is_system_admin || currentProject.roles.includes("lead"));
      // Lead access is decided from the projects list before the page shows anything (open question 6).
      content = projectContext?.identity !== projectIdentity ? <InlineMessage tone="info">Loading project access…</InlineMessage>
        : <DocumentsPage projectKey={route.key} currentUser={user} canManage={!!currentProject?.can_manage} canOverrideTranslationStatus={canOverrideTranslationStatus} query={route} onNavigate={go} />;
      break;
    }
    case "projectCase": content = <CaseViewer projectKey={route.key} caseId={route.caseId} variant={route.variant} annotations={route.annotations} compare={route.compare} documents={route.documents} username={user.username} onNavigate={go} />; break;
    case "projectProgress": content = <ProgressPage projectKey={route.key} onNavigate={go} />; break;
    case "projectExport": content = <ExportPage projectKey={route.key} currentUser={user} />; break;
    case 'projectProblemReport': {
      const canManage = !!projects.find(project => project.project_key === route.key)?.can_manage;
      content = projectContext?.identity !== projectIdentity ? <InlineMessage tone="info">Loading project access…</InlineMessage>
        : canManage ? <ProblemReportDetail key={JSON.stringify([user.username, route.key, route.reportId])} projectKey={route.key} reportId={route.reportId} canManage={canManage} action={route.action} documents={route.documents} onNavigate={go} />
        : <NotFound noAccess onNavigate={go} />;
      break;
    }
    case "me": content = <ProfilePage onSaved={setSavedIdentity} routeLeaveRef={routeLeaveRef} leaveGuardRef={logoutGuardRef} />; break;
    case "notFound": content = <NotFound onNavigate={go} />; break;
    default: content = <EmptyState title="This page is not available yet.">This section is planned for a later step.</EmptyState>;
  }
  return <Shell user={user} projects={projects} route={route} onNavigate={go} onLogout={logout}
    taskProject={taskProject?.identity === taskIdentity ? taskProject.key : undefined}
    breadcrumb={route.name === "task" ? [
      { label: "My tasks", onClick: () => go({ name: "tasks" }) }, { label: `Task ${route.assignmentId}` },
    ] : undefined}>
    {!!projectError && <><ErrorNotice error={projectError} /><Button onClick={() => setRetry(value => value + 1)}>Retry projects</Button></>}
    {content}
  </Shell>;
}
