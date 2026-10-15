import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  isSessionExpired,
  ApiError,
  type CurrentUser,
  type DocumentSummary,
  type OpenWorkspaceResponse,
  type ProjectSummary,
  type OntologyInfo,
} from "./api/client";
import type { components } from "./api/generated";
import { AppShell } from "./ui/AppShell";
import { Button } from "./ui/Button";
import { Select } from "./ui/Select";
import { TextInput } from "./ui/TextInput";
import { DataTable } from "./ui/DataTable";
import { StatusBadge } from "./ui/StatusBadge";
import { InlineMessage } from "./ui/InlineMessage";
import { EmptyState } from "./ui/EmptyState";
import { Dialog } from "./ui/Dialog";
import { CaseScreen } from "./app/CaseScreen";
import { CaseErrorBoundary } from "./app/ErrorBoundary";

export type WorkspaceMode = "independent" | "review" | "assisted";
export type ReviewTargetSet = components["schemas"]["ReviewTargetSet"];

const statusLabels: Record<string, string> = {
  not_started: "Open",
  in_progress: "In Progress",
  completed: "Completed",
};

/** Plain-language names for the working modes (API values stay unchanged). */
export const modeLabels: Record<WorkspaceMode, string> = {
  independent: "Annotate from scratch",
  review: "Review proposals",
  assisted: "Assisted annotation",
};
export const modeExplanations: Record<WorkspaceMode, string> = {
  independent: "You won't see any proposals.",
  review: "Check suggested terms one by one: confirm, reject or change.",
  assisted: "Suggested terms are shown while you annotate.",
};

/**
 * Older builds kept the identity and mode in the browser, so a new copy on a
 * shared computer silently inherited the previous person's name. Those values
 * are never adopted; they are only removed.
 */
const LEGACY_ANNOTATOR_KEY = "ontocurator.annotatorId";
const LEGACY_MODE_PREFIX = "ontocurator.mode.";
const clearLegacyStorage = () => {
  try {
    const storage = window.localStorage;
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && (k === LEGACY_ANNOTATOR_KEY || k.startsWith(LEGACY_MODE_PREFIX))) stale.push(k);
    }
    stale.forEach((k) => storage.removeItem(k));
  } catch {
    // storage unavailable
  }
};

const isMode = (value: unknown): value is WorkspaceMode =>
  value === "independent" || value === "review" || value === "assisted";

const ALL_MODES: WorkspaceMode[] = ["independent", "review", "assisted"];

/**
 * The working modes the user's roles give in a project. A project without the
 * field (an older server or test mock) allows every mode.
 */
const modesOf = (project: ProjectSummary | undefined): WorkspaceMode[] => {
  if (!project) return ALL_MODES;
  if (!Array.isArray(project.allowed_modes)) return ALL_MODES;
  return project.allowed_modes.filter(isMode);
};

/** "Name (key)", or the key alone when the project has no name of its own. */
const projectLabel = (project: ProjectSummary) =>
  project.name && project.name !== project.project_key
    ? `${project.name} (${project.project_key})`
    : project.project_key;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** 18201 -> "18 201". */
const formatCount = (n: number) => n.toLocaleString("en-US").replace(/,/g, " ");

/** "HP", or with translations "HP 2026-06-23 · de 3 412 · es 18 201 terms". */
export const ontologySummary = (ontology: OntologyInfo): string => {
  const id = ontology.ontology_id.toUpperCase();
  const translations = ontology.translations ?? [];
  if (translations.length === 0) return id;
  const languages = translations.map((item) => `${item.language} ${formatCount(item.term_count)}`);
  return `${id} ${ontology.release} · ${languages.join(" · ")} terms`;
};

export interface AppProps {
  /** The logged-in user (from the login gate). Without it the app asks `api.me()` itself. */
  user?: CurrentUser | null;
  onLogout?: () => void;
}

export const App: React.FC<AppProps> = ({ user: givenUser, onLogout }) => {
  const documentRequest = useRef(0);
  const leaveGuardRef = useRef<((proceed: () => void) => void) | null>(null);

  const [packages, setPackagesState] = useState<ProjectSummary[]>([]);
  const [packagesLoaded, setPackagesLoaded] = useState(false);
  const [selectedPackageId, setSelectedPackageIdState] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  // The annotator is always the logged-in user's pseudonym.
  const [fetchedUser, setFetchedUser] = useState<CurrentUser | null>(null);
  const user = givenUser !== undefined ? givenUser : fetchedUser;
  const annotatorId = user?.pseudonym ?? "";
  const [roundSelection, setRoundSelection] = useState<{ docId: string; rounds: string[] } | null>(null);
  const [selectedRound, setSelectedRound] = useState("");
  const [mode, setMode] = useState<WorkspaceMode>("independent");

  // Async flows (start-up) must see current values, not stale closures.
  const annotatorRef = useRef(annotatorId);
  annotatorRef.current = annotatorId;
  const selectedPackageRef = useRef<string | null>(null);
  const modeByPackageRef = useRef<Record<string, WorkspaceMode>>({});
  const packagesRef = useRef<ProjectSummary[]>([]);
  const setPackages = (list: ProjectSummary[]) => {
    packagesRef.current = list;
    setPackagesState(list);
  };
  const setSelectedPackageId = (id: string | null) => {
    selectedPackageRef.current = id;
    setSelectedPackageIdState(id);
  };
  const modesOfPackage = (pkgId: string | null) =>
    modesOf(packagesRef.current.find((p) => p.project_key === pkgId));

  // Dashboard filter & search
  const [statusFilter, setStatusFilter] = useState<"all" | "not_started" | "in_progress" | "completed">("all");
  const [searchFilter, setSearchFilter] = useState<string>("");

  // Active case view
  const [activeWorkspace, setActiveWorkspace] = useState<OpenWorkspaceResponse | null>(null);
  const [workspaceNonce, setWorkspaceNonce] = useState(0);
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In-app ontology state
  const [ontologies, setOntologies] = useState<OntologyInfo[]>([]);

  /** Show an error, unless it only means the session ended (then the login gate takes over). */
  const reportError = (prefix: string, err: unknown) => {
    if (isSessionExpired(err)) return;
    setError(`${prefix}: ${errorText(err)}`);
  };

  const loadOntologies = async () => {
    try {
      const list = await api.listOntologies();
      setOntologies(list);
    } catch {
      // Ignored if API not ready
    }
  };

  const loadPreferences = async () => {
    try {
      const prefs = await api.getPreferences();
      const modes: Record<string, WorkspaceMode> = {};
      for (const [pkg, m] of Object.entries(prefs?.mode_by_package ?? {})) if (isMode(m)) modes[pkg] = m;
      modeByPackageRef.current = modes;
    } catch {
      // Start without preferences.
    }
  };

  // Pick the case to highlight: continue in-progress work first, then the next open case.
  const pickResumeDoc = (docs: DocumentSummary[]) =>
    docs.find((d) => d.status === "in_progress") ?? docs.find((d) => d.status === "not_started") ?? docs[0] ?? null;

  const refreshDocuments = async (pkgId: string, opts: { annotator: string; mode: WorkspaceMode; resetSelection?: boolean }) => {
    const requestId = ++documentRequest.current;
    try {
      const docs = await api.listDocuments(pkgId, { annotator_id: opts.annotator, mode: opts.mode });
      if (requestId !== documentRequest.current) return docs;
      setDocuments(docs);
      setSelectedDocId((current) => {
        if (!opts.resetSelection && current && docs.some((d) => d.document_id === current)) return current;
        return pickResumeDoc(docs)?.document_id ?? null;
      });
      return docs;
    } catch (err: unknown) {
      if (requestId === documentRequest.current) reportError("Error loading cases", err);
      return null;
    }
  };

  // Selecting a package never touches review inputs (blinding): it only lists cases.
  const handleSelectPackage = async (pkgId: string) => {
    const stored = modeByPackageRef.current[pkgId];
    const allowedModes = modesOfPackage(pkgId);
    const nextMode: WorkspaceMode =
      isMode(stored) && allowedModes.includes(stored) ? stored : (allowedModes[0] ?? "independent");
    setDocuments([]);
    setSelectedPackageId(pkgId);
    setSelectedDocId(null);
    setMode(nextMode);
    return refreshDocuments(pkgId, { annotator: annotatorRef.current, mode: nextMode, resetSelection: true });
  };

  const loadPackages = async (preferredPackageId?: string | null): Promise<DocumentSummary[] | null> => {
    try {
      setError(null);
      const list = await api.listProjects();
      setPackages(list);
      setPackagesLoaded(true);
      const preferred = preferredPackageId && list.some((p) => p.project_key === preferredPackageId) ? preferredPackageId : null;
      // The project selected last, otherwise the first (newest).
      const current = selectedPackageRef.current;
      const next = preferred
        ?? (current && list.some((p) => p.project_key === current) ? current : null)
        ?? list[0]?.project_key
        ?? null;
      return next ? await handleSelectPackage(next) : null;
    } catch (err: unknown) {
      reportError("Error loading projects", err);
      return null;
    }
  };

  const bootstrap = async () => {
    // Rendered without a user (component tests), the app asks for the session itself.
    if (givenUser === undefined) {
      const me = await api.me().catch(() => null);
      annotatorRef.current = me?.pseudonym ?? "";
      setFetchedUser(me);
    }
    await loadPreferences();
    await loadPackages();
    void loadOntologies();
  };

  useEffect(() => {
    clearLegacyStorage();
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChangeMode = (nextMode: WorkspaceMode) => {
    if (!modesOfPackage(selectedPackageRef.current).includes(nextMode)) return;
    setMode(nextMode);
    if (selectedPackageId) {
      modeByPackageRef.current = { ...modeByPackageRef.current, [selectedPackageId]: nextMode };
      void api.updatePreferences({ mode_by_package: { [selectedPackageId]: nextMode } }).catch(() => undefined);
      void refreshDocuments(selectedPackageId, { annotator: annotatorRef.current, mode: nextMode });
    }
  };

  /**
   * Open a case. In review mode, all review proposals for the case are loaded here
   * (and only here). Throws on failure.
   */
  const openCase = async (docId: string, opts: { forceRemount?: boolean; roundId?: string } = {}) => {
    if (!selectedPackageId) throw new Error("No work package selected.");
    const identity = annotatorRef.current;
    if (!identity) throw new Error("Log in to open cases.");
    let res: OpenWorkspaceResponse;
    try {
      res = await api.openWorkspace({
      project_key: selectedPackageId,
      document_id: docId,
      annotator_id: identity,
      mode,
      targets: null,
      ...(opts.roundId ? { review_round_target_set_id: opts.roundId } : {}),
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "AMBIGUOUS_REVIEW_ROUND"
          && typeof err.details === "object" && Array.isArray(err.details.rounds)
          && err.details.rounds.every((id) => typeof id === "string")) {
        setSelectedRound("");
        setRoundSelection({ docId, rounds: err.details.rounds as string[] });
        return;
      }
      throw err;
    }
    setRoundSelection(null);
    setSelectedDocId(docId);
    if (opts.forceRemount) setWorkspaceNonce((n) => n + 1);
    setActiveWorkspace(res);
    void refreshDocuments(selectedPackageId, { annotator: identity, mode });
  };

  /** Dashboard entry point: errors are shown on the dashboard. */
  const handleOpenWorkspace = async (docId: string) => {
    if (!selectedPackageId || isOpening) return;
    setError(null);
    setSelectedDocId(docId);
    setIsOpening(true);
    try {
      await openCase(docId);
    } catch (err: unknown) {
      reportError("Error opening case", err);
    } finally {
      setIsOpening(false);
    }
  };

  /** "Open case": works under the logged-in user's pseudonym. */
  const requestOpen = (docIdToOpen?: string) => {
    const targetDoc = docIdToOpen ?? selectedDocId;
    if (!selectedPackageId || !targetDoc || isOpening || !annotatorRef.current) return;
    setSelectedDocId(targetDoc);
    void handleOpenWorkspace(targetDoc);
  };

  const closeWorkspace = async () => {
    setActiveWorkspace(null);
    if (selectedPackageId) await refreshDocuments(selectedPackageId, { annotator: annotatorRef.current, mode });
  };

  // Filtered documents for dashboard table
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      if (statusFilter !== "all" && doc.status !== statusFilter) return false;
      if (searchFilter.trim() && !doc.document_id.toLowerCase().includes(searchFilter.trim().toLowerCase())) return false;
      return true;
    });
  }, [documents, statusFilter, searchFilter]);

  // The hero card always shows the currently selected case.
  const heroDoc = useMemo(
    () => documents.find((d) => d.document_id === selectedDocId) ?? pickResumeDoc(documents),
    [documents, selectedDocId],
  );

  const ontologyLabels = useMemo(
    () => Array.from(new Set(ontologies.map(ontologySummary))),
    [ontologies],
  );

  const openCount = documents.filter((d) => d.status === "not_started").length;
  const inProgressCount = documents.filter((d) => d.status === "in_progress").length;
  const completedCount = documents.filter((d) => d.status === "completed").length;

  const hasPackages = packages.length > 0;
  const allowedModes = modesOf(packages.find((p) => p.project_key === selectedPackageId));
  const noWorkingRole = selectedPackageId !== null && allowedModes.length === 0;
  const showGuide = packagesLoaded && !hasPackages;

  const roundSelectionDialog = (
    roundSelection && <Dialog open title="Select review round" onClose={() => setRoundSelection(null)}>
      <p>This annotator has several review rounds for this case. Choose the round to continue.</p>
      <label htmlFor="review-round-select">Review round</label>
      <select id="review-round-select" className="form-select" value={selectedRound} onChange={(e) => setSelectedRound(e.target.value)}>
        <option value="">Choose a round</option>
        {roundSelection.rounds.map((id) => <option key={id} value={id}>{id}</option>)}
      </select>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={() => setRoundSelection(null)}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!selectedRound || isOpening} onClick={async () => {
          setIsOpening(true);
          try { await openCase(roundSelection.docId, { roundId: selectedRound }); }
          catch (err) { reportError("Error opening review round", err); }
          finally { setIsOpening(false); }
        }}>Resume round</button>
      </div>
    </Dialog>
  );

  if (activeWorkspace) {
    const currentDocId = activeWorkspace.view.document.document_id;
    const reload = () => openCase(currentDocId, { forceRemount: true, roundId: mode === "review" ? activeWorkspace.view.key.target_set_id : undefined });
    return (
      <AppShell user={user ?? null} onLogout={onLogout ? () => leaveGuardRef.current ? leaveGuardRef.current(onLogout) : onLogout() : undefined} density="reading" breadcrumb={[{ label: packages.find((p) => p.project_key === selectedPackageId)?.name || selectedPackageId || "Project" }, { label: `Case ${currentDocId}` }]}>
        <CaseErrorBoundary
          key={`${activeWorkspace.workspace_id}:${workspaceNonce}`}
          onBackToDashboard={() => { void closeWorkspace(); }}
          onReload={() => { void reload().catch((err) => reportError("Error reloading case", err)); }}
        >
          <CaseScreen
            key={`${activeWorkspace.workspace_id}:${workspaceNonce}`}
            view={activeWorkspace.view}
            workspaceId={activeWorkspace.workspace_id}
            leaveGuardRef={leaveGuardRef}
            documentList={documents}
            annotatorName={user?.display_name}
            onNavigateCase={(docId) => openCase(docId)}
            onReload={reload}
            onSubmitted={async () => {
              if (selectedPackageId) await refreshDocuments(selectedPackageId, { annotator: annotatorRef.current, mode });
            }}
            onClose={() => { void closeWorkspace(); }}
          />
        </CaseErrorBoundary>
        {roundSelectionDialog}
      </AppShell>
    );
  }

  return (
    <AppShell user={user ?? null} onLogout={onLogout}
      breadcrumb={selectedPackageId ? [{ label: packages.find((p) => p.project_key === selectedPackageId)?.name || selectedPackageId }] : undefined}
      actions={ontologyLabels.length > 0 && <span className="ontology-summary">Ontologies: {ontologyLabels.join(", ")}</span>}
    >
      {roundSelectionDialog}
      <div className="dashboard-container">
        {error && <InlineMessage tone="error">{error}</InlineMessage>}
        {showGuide && <section id="getting-started-title" className="getting-started" aria-label="Get started">
          <EmptyState title="Get started">No projects are available to you yet. Ask an administrator to add you to a project.</EmptyState>
        </section>}
        {hasPackages && <>
          <div className="dashboard-settings">
            <Select id="project-select" label="Project" value={selectedPackageId ?? ""} onChange={(e) => { void handleSelectPackage(e.target.value); }}>
              {packages.map((pkg) => <option key={pkg.project_key} value={pkg.project_key}>{projectLabel(pkg)}</option>)}
            </Select>
            {noWorkingRole ? null : allowedModes.length === 1 ? <div className="form-group">
              <div className="form-label">Working mode</div>
              <div className="fixed-mode" data-testid="fixed-mode">{modeLabels[mode]}</div>
              <div className="field-hint">{modeExplanations[mode]} Set by your role in this project.</div>
            </div> : <Select id="mode-select" label="Working mode" hint={modeExplanations[mode]} value={mode} onChange={(e) => handleChangeMode(e.target.value as WorkspaceMode)}>
              {allowedModes.map((m) => <option key={m} value={m} hidden={m === "assisted"}>{modeLabels[m]}</option>)}
            </Select>}
          </div>
          <div hidden>
            <select id="doc-select" aria-label="Clinical Case (Document)" value={selectedDocId ?? ""} onChange={(e) => setSelectedDocId(e.target.value)}>
              {documents.map((doc) => <option key={doc.document_id} value={doc.document_id}>Case {doc.position}: {doc.document_id}</option>)}
            </select>
          </div>
          {noWorkingRole ? <div className="dashboard-hero" role="status" data-testid="no-working-role">You have no working role in this project.</div> : heroDoc && <section className="dashboard-hero" aria-label="Selected case">
            <div className="dashboard-case-summary">
              <h1>Case {heroDoc.position}: <span className="case-id">{heroDoc.document_id}</span></h1>
              <p className="dashboard-resume">{heroDoc.status === "in_progress" ? "Continue where you left off" : "Selected case"}</p>
              <div className="dashboard-case-meta">{heroDoc.language.toUpperCase()} • {heroDoc.text_length} chars • Status: <StatusBadge status={heroDoc.status}>{statusLabels[heroDoc.status] ?? heroDoc.status}</StatusBadge>{" • "}{modeLabels[mode]}</div>
            </div>
            <div className="dashboard-open">
              <Button variant="primary" disabled={isOpening || !annotatorId} onClick={() => requestOpen(heroDoc.document_id)}>{isOpening ? "Opening..." : "Open case"}</Button>
              {!annotatorId && <span className="field-hint">Log in to open cases.</span>}
            </div>
          </section>}
          <div className="dashboard-table-controls">
            <div className="dashboard-tabs">
              {([
                ["all", `All (${documents.length})`], ["not_started", `Open (${openCount})`],
                ["in_progress", `In Progress (${inProgressCount})`], ["completed", `Completed (${completedCount})`],
              ] as const).map(([filter, label]) => <button type="button" key={filter} className={`dashboard-tab ${statusFilter === filter ? "active" : ""}`} onClick={() => setStatusFilter(filter)}>{label}</button>)}
            </div>
            <div className="dashboard-search"><TextInput id="case-filter" label="Filter cases by ID" type="search" placeholder="Filter cases by ID..." value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} /></div>
          </div>
          <DataTable label="Clinical Cases" className="dashboard-table" rows={filteredDocuments} rowKey={(doc) => doc.document_id}
            empty={<div className="dashboard-empty">No cases found for the selected filter.</div>}
            columns={[
              { id: "position", header: "#", width: "3rem", cell: (doc) => <span className="case-position">{doc.position}</span> },
              { id: "document", header: "Case ID", cell: (doc) => <span className="case-id">{doc.document_id}</span> },
              { id: "language", header: "Language", cell: (doc) => doc.language.toUpperCase() },
              { id: "length", header: "Length", cell: (doc) => `${doc.text_length.toLocaleString("en-US")} chars` },
              { id: "status", header: "Status", cell: (doc) => <StatusBadge status={doc.status}>{statusLabels[doc.status] ?? doc.status}</StatusBadge> },
            ]}
            rowProps={(doc) => ({
              selected: doc.document_id === selectedDocId, tabIndex: 0,
              title: "Click to select, double-click to open",
              onClick: () => setSelectedDocId(doc.document_id),
              onDoubleClick: () => requestOpen(doc.document_id),
              onKeyDown: (e) => {
                if (e.key === "Enter") { e.preventDefault(); requestOpen(doc.document_id); }
                else if (e.key === " ") { e.preventDefault(); setSelectedDocId(doc.document_id); }
              },
            })}
          />
        </>}
      </div>
    </AppShell>
  );
};
