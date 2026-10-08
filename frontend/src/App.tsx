import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  initSessionToken,
  onSessionLost,
  parseLaunchHash,
  sessionLostReasonOf,
  setActiveSessionToken,
  takeLaunchPackageId,
  ApiError,
  type DocumentSummary,
  type LegacyConfigStatus,
  type OpenWorkspaceResponse,
  type PackageManifest,
  type OntologyInfo,
  type ProvisioningNotice,
  type SessionLostReason,
} from "./api/client";
import type { components } from "./api/generated";
import { CaseScreen } from "./app/CaseScreen";
import { CaseErrorBoundary } from "./app/ErrorBoundary";
import { LegacyConfigNotice } from "./app/LegacyConfigNotice";
import { SessionLostScreen } from "./app/SessionLostScreen";

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

export const MAX_IDENTITY_LENGTH = 64;

/** Why an identity cannot be used (mirrors the server rules), or null if it is fine. */
export function identityProblem(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter your initials or a short ID.";
  if ([...trimmed].length > MAX_IDENTITY_LENGTH) return `Use at most ${MAX_IDENTITY_LENGTH} characters.`;
  if (/\p{C}/u.test(trimmed)) return "Remove invisible or control characters.";
  return null;
}

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

/** Presets of a preconfigured installation (ontocurator-settings.json). */
export interface AppSettings {
  allowedModes: WorkspaceMode[];
  defaultMode: WorkspaceMode;
  annotatorId: string | null;
  openPackage: string | null;
}
const DEFAULT_SETTINGS: AppSettings = {
  allowedModes: ALL_MODES,
  defaultMode: "independent",
  annotatorId: null,
  openPackage: null,
};

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
const casesText = (n: number) => `${n} ${n === 1 ? "case" : "cases"}`;

export const App: React.FC = () => {
  const documentRequest = useRef(0);
  const packageInputRef = useRef<HTMLInputElement>(null);
  const ontologyInputRef = useRef<HTMLInputElement>(null);
  const missingOntologyInputRef = useRef<HTMLInputElement>(null);
  const annotatorFieldRef = useRef<HTMLInputElement>(null);

  const [packages, setPackages] = useState<PackageManifest[]>([]);
  const [packagesLoaded, setPackagesLoaded] = useState(false);
  const [selectedPackageId, setSelectedPackageIdState] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  // Committed identity (used for API calls); the input field is edited separately.
  const [annotatorId, setAnnotatorIdState] = useState<string>("");
  const [annotatorInput, setAnnotatorInput] = useState<string>("");
  // Identity the person confirmed ("You are annotating as ...") in this page session.
  const [confirmedAnnotator, setConfirmedAnnotator] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState<{ docId: string; identity: string } | null>(null);
  const [mode, setMode] = useState<WorkspaceMode>("independent");
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [provisioningNotices, setProvisioningNotices] = useState<ProvisioningNotice[]>([]);
  const [legacyConfig, setLegacyConfig] = useState<LegacyConfigStatus | null>(null);

  // Async flows (start-up, reconnect) must see current values, not stale closures.
  const annotatorRef = useRef("");
  const selectedPackageRef = useRef<string | null>(null);
  const modeByPackageRef = useRef<Record<string, WorkspaceMode>>({});
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const setAnnotatorId = (id: string) => {
    annotatorRef.current = id;
    setAnnotatorIdState(id);
  };
  const setSelectedPackageId = (id: string | null) => {
    selectedPackageRef.current = id;
    setSelectedPackageIdState(id);
  };

  // Dashboard filter & search
  const [statusFilter, setStatusFilter] = useState<"all" | "not_started" | "in_progress" | "completed">("all");
  const [searchFilter, setSearchFilter] = useState<string>("");

  // Active case view
  const [activeWorkspace, setActiveWorkspace] = useState<OpenWorkspaceResponse | null>(null);
  const [workspaceNonce, setWorkspaceNonce] = useState(0);
  const [isOpening, setIsOpening] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [sessionLost, setSessionLost] = useState<SessionLostReason | null>(null);

  // In-app ontology state
  const [ontologies, setOntologies] = useState<OntologyInfo[]>([]);
  const [missingOntologyPrompt, setMissingOntologyPrompt] = useState<{
    message: string;
    pendingPackageFile?: File;
  } | null>(null);
  const [isUploadingOntology, setIsUploadingOntology] = useState<boolean>(false);

  /** Show an error, unless it only means the access key expired (then show the reopen page). */
  const reportError = (prefix: string, err: unknown) => {
    const reason = sessionLostReasonOf(err);
    if (reason) {
      setSessionLost(reason);
      return;
    }
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

  /** Installation presets; older servers without the endpoint keep the defaults. */
  const loadSettings = async () => {
    try {
      const raw = await api.getSettings();
      const allowed = (raw?.allowed_modes ?? []).filter(isMode);
      const allowedModes = allowed.length > 0 ? allowed : ALL_MODES;
      const next: AppSettings = {
        allowedModes,
        defaultMode: isMode(raw?.default_mode) && allowedModes.includes(raw.default_mode)
          ? raw.default_mode
          : allowedModes[0],
        annotatorId: raw?.annotator_id && !identityProblem(raw.annotator_id) ? raw.annotator_id.trim() : null,
        openPackage: raw?.open_package || null,
      };
      settingsRef.current = next;
      setSettingsState(next);
    } catch {
      // Keep the defaults (session problems are reported by the other requests).
    }
  };

  const loadProvisioning = async () => {
    try {
      const status = await api.getProvisioning();
      setProvisioningNotices(status?.notices ?? []);
    } catch {
      // Older server or not available: nothing to show.
    }
  };

  /** Settings of an earlier installation: only offered, never imported automatically. */
  const loadLegacyConfig = async () => {
    try {
      const status = await api.getLegacyConfig();
      setLegacyConfig(status?.found ? status : null);
    } catch {
      // Older server or not available: nothing to show.
    }
  };

  const loadPreferences = async () => {
    try {
      const prefs = await api.getPreferences();
      const modes: Record<string, WorkspaceMode> = {};
      for (const [pkg, m] of Object.entries(prefs?.mode_by_package ?? {})) if (isMode(m)) modes[pkg] = m;
      modeByPackageRef.current = modes;
      // A preset identity (personalised installation) wins over the last one used;
      // either way the person still confirms it before the first case opens.
      const last = settingsRef.current.annotatorId ?? prefs?.last_annotator_id?.trim();
      if (!annotatorRef.current && last && !identityProblem(last)) {
        setAnnotatorId(last);
        setAnnotatorInput(last);
      }
    } catch (err: unknown) {
      const reason = sessionLostReasonOf(err);
      if (reason) setSessionLost(reason);
      // Otherwise start without preferences.
      const preset = settingsRef.current.annotatorId;
      if (!annotatorRef.current && preset) {
        setAnnotatorId(preset);
        setAnnotatorInput(preset);
      }
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
    const { allowedModes, defaultMode } = settingsRef.current;
    const nextMode: WorkspaceMode = isMode(stored) && allowedModes.includes(stored) ? stored : defaultMode;
    setDocuments([]);
    setSelectedPackageId(pkgId);
    setSelectedDocId(null);
    setMode(nextMode);
    return refreshDocuments(pkgId, { annotator: annotatorRef.current, mode: nextMode, resetSelection: true });
  };

  const loadPackages = async (preferredPackageId?: string | null): Promise<DocumentSummary[] | null> => {
    try {
      setError(null);
      const list = await api.listPackages();
      setPackages(list);
      setPackagesLoaded(true);
      const preferred = preferredPackageId && list.some((p) => p.package_id === preferredPackageId) ? preferredPackageId : null;
      if (preferredPackageId && !preferred && list.length > 0) {
        setError(`Package "${preferredPackageId}" from the launch link was not found.`);
      }
      const current = selectedPackageRef.current;
      const preset = settingsRef.current.openPackage;
      const next = preferred
        ?? (current && list.some((p) => p.package_id === current) ? current : null)
        ?? (preset && list.some((p) => p.package_id === preset) ? preset : null)
        ?? list[0]?.package_id
        ?? null;
      return next ? await handleSelectPackage(next) : null;
    } catch (err: unknown) {
      reportError("Error loading packages", err);
      return null;
    }
  };

  const bootstrap = async (launchPackageId: string | null) => {
    await Promise.all([loadSettings(), loadProvisioning(), loadLegacyConfig()]);
    await loadPreferences();
    await loadPackages(launchPackageId);
    void loadOntologies();
  };

  /** Use a new access key (from the address bar or a pasted link) and reload everything. */
  const reconnect = (packageId: string | null) => {
    setSessionLost(null);
    setError(null);
    void bootstrap(packageId);
  };
  const reconnectRef = useRef(reconnect);
  reconnectRef.current = reconnect;

  useEffect(() => {
    clearLegacyStorage();
    initSessionToken();
    const unsubscribe = onSessionLost((reason) => setSessionLost(reason));
    void bootstrap(takeLaunchPackageId());
    // Pasting a fresh link into this tab only changes the fragment: no page reload happens.
    const onHashChange = () => {
      const launch = parseLaunchHash(window.location.hash);
      if (!launch.token && !launch.packageId) return;
      initSessionToken();
      reconnectRef.current(takeLaunchPackageId());
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      unsubscribe();
      window.removeEventListener("hashchange", onHashChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChangeMode = (nextMode: WorkspaceMode) => {
    if (!settingsRef.current.allowedModes.includes(nextMode)) return;
    setMode(nextMode);
    if (selectedPackageId) {
      modeByPackageRef.current = { ...modeByPackageRef.current, [selectedPackageId]: nextMode };
      void api.updatePreferences({ mode_by_package: { [selectedPackageId]: nextMode } }).catch(() => undefined);
      void refreshDocuments(selectedPackageId, { annotator: annotatorRef.current, mode: nextMode });
    }
  };

  // Identity is applied on blur/Enter only (not on every keystroke). Returns the committed value.
  const commitAnnotator = (): string => {
    const next = annotatorInput.trim();
    if (next && identityProblem(next)) return annotatorRef.current;
    if (next !== annotatorInput) setAnnotatorInput(next);
    if (next === annotatorRef.current) return next;
    setAnnotatorId(next);
    if (selectedPackageId) void refreshDocuments(selectedPackageId, { annotator: next, mode });
    return next;
  };

  const importPackageFile = async (file: File) => {
    const res = await api.uploadPackage(file);
    const docs = await loadPackages(res.package_id);
    const count = res.manifest?.document_order?.length || docs?.length || 0;
    setNotice(`Package '${res.package_id}' imported – ${casesText(count)}.`);
  };

  const handleUploadPackage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);
    setNotice(null);
    try {
      await importPackageFile(file);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === "ONTOLOGY_NOT_FOUND") {
        setMissingOntologyPrompt({
          message: err.message,
          pendingPackageFile: file,
        });
      } else {
        reportError("Package import failed", err);
      }
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  const handleUploadMissingOntology = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingOntology(true);
    setError(null);
    try {
      const uploaded = await api.uploadOntology(file);
      await loadOntologies();
      // A translation file answers with what was loaded, or why it waits for its ontology.
      if ("filename" in uploaded) setNotice(uploaded.message);
      const pending = missingOntologyPrompt?.pendingPackageFile;
      setMissingOntologyPrompt(null);
      if (pending) {
        setIsUploading(true);
        await importPackageFile(pending);
      }
    } catch (err: unknown) {
      reportError("Ontology upload failed", err);
    } finally {
      setIsUploadingOntology(false);
      setIsUploading(false);
      e.target.value = "";
    }
  };

  /**
   * Open a case. In review mode, all review proposals for the case are loaded here
   * (and only here). Throws on failure.
   */
  const openCase = async (docId: string, opts: { forceRemount?: boolean; identity?: string } = {}) => {
    if (!selectedPackageId) throw new Error("No work package selected.");
    const identity = opts.identity ?? annotatorRef.current;
    if (identityProblem(identity)) throw new Error("Enter your initials before opening a case.");
    let targets: ReviewTargetSet | null = null;
    if (mode === "review") {
      const inputs = await api.getReviewInputs({
        package_id: selectedPackageId,
        document_id: docId,
        annotator_id: identity,
        mode: "review",
      });
      if (inputs.length === 0) {
        throw new Error(
          `No review proposals are available for case ${docId}. Switch to "${modeLabels.independent}" to annotate this case.`,
        );
      }
      targets = {
        target_set_id: "",
        targets: inputs.map((s) => ({ annotation_id: s.annotation.annotation_id, version: s.version })),
      };
    }
    const res = await api.openWorkspace({
      package_id: selectedPackageId,
      document_id: docId,
      annotator_id: identity,
      mode,
      targets,
    });
    setSelectedDocId(docId);
    if (opts.forceRemount) setWorkspaceNonce((n) => n + 1);
    setActiveWorkspace(res);
    void refreshDocuments(selectedPackageId, { annotator: identity, mode });
  };

  /** Dashboard entry point: errors are shown on the dashboard. */
  const handleOpenWorkspace = async (docId: string, identity: string) => {
    if (!selectedPackageId || isOpening) return;
    setError(null);
    setSelectedDocId(docId);
    setIsOpening(true);
    try {
      await openCase(docId, { identity });
    } catch (err: unknown) {
      reportError("Error opening case", err);
    } finally {
      setIsOpening(false);
    }
  };

  /** "Open case": requires an identity and asks once per page session to confirm it. */
  const requestOpen = (docIdToOpen?: string) => {
    const targetDoc = docIdToOpen ?? selectedDocId;
    if (!selectedPackageId || !targetDoc || isOpening) return;
    if (identityProblem(annotatorInput)) {
      annotatorFieldRef.current?.focus();
      return;
    }
    const identity = commitAnnotator();
    setSelectedDocId(targetDoc);
    if (identity !== confirmedAnnotator) {
      setPendingOpen({ docId: targetDoc, identity });
      return;
    }
    void handleOpenWorkspace(targetDoc, identity);
  };

  const confirmIdentity = () => {
    if (!pendingOpen) return;
    const { docId, identity } = pendingOpen;
    setPendingOpen(null);
    setConfirmedAnnotator(identity);
    void api.updatePreferences({ last_annotator_id: identity }).catch(() => undefined);
    void handleOpenWorkspace(docId, identity);
  };

  const changeIdentity = () => {
    setPendingOpen(null);
    annotatorFieldRef.current?.focus();
    annotatorFieldRef.current?.select();
  };

  const handleExportPackage = async () => {
    if (!selectedPackageId || !annotatorId) return;
    setError(null);
    setIsExporting(true);
    try {
      await api.downloadPackageExport(selectedPackageId, { annotator_id: annotatorId, mode });
    } catch (err: unknown) {
      reportError("Package export failed", err);
    } finally {
      setIsExporting(false);
    }
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

  const identityIssue = identityProblem(annotatorInput);
  const identityMissing = !annotatorInput.trim();
  const hasPackages = packages.length > 0;
  const showGuide = packagesLoaded && !hasPackages;

  const sessionScreen = sessionLost && (
    <SessionLostScreen
      reason={sessionLost}
      onConnect={(token, packageId) => {
        setActiveSessionToken(token);
        reconnect(packageId);
      }}
    />
  );

  if (activeWorkspace) {
    const currentDocId = activeWorkspace.view.document.document_id;
    const reload = () => openCase(currentDocId, { forceRemount: true });
    return (
      <>
        <CaseErrorBoundary
          key={`${activeWorkspace.workspace_id}:${workspaceNonce}`}
          onBackToDashboard={() => { void closeWorkspace(); }}
          onReload={() => { void reload().catch((err) => reportError("Error reloading case", err)); }}
        >
          <CaseScreen
            key={`${activeWorkspace.workspace_id}:${workspaceNonce}`}
            view={activeWorkspace.view}
            workspaceId={activeWorkspace.workspace_id}
            documentList={documents}
            onNavigateCase={(docId) => openCase(docId)}
            onReload={reload}
            onSubmitted={async () => {
              if (selectedPackageId) await refreshDocuments(selectedPackageId, { annotator: annotatorRef.current, mode });
            }}
            onClose={() => { void closeWorkspace(); }}
          />
        </CaseErrorBoundary>
        {sessionScreen}
      </>
    );
  }

  const fileInputs = (
    <>
      <input
        ref={packageInputRef}
        type="file"
        accept=".zip"
        aria-label="Work package file (.zip)"
        style={{ display: "none" }}
        onChange={handleUploadPackage}
        disabled={isUploading}
      />
      <input
        ref={ontologyInputRef}
        type="file"
        accept=".json,.tsv"
        aria-label="Ontology (.json) or translation file (.tsv)"
        style={{ display: "none" }}
        onChange={handleUploadMissingOntology}
        disabled={isUploadingOntology}
      />
    </>
  );

  const importButton = (primary: boolean) => (
    <button
      type="button"
      className={`btn ${primary ? "btn-primary" : "btn-secondary btn-sm"}`}
      onClick={() => packageInputRef.current?.click()}
      disabled={isUploading}
    >
      {isUploading ? "Importing..." : primary ? "Import work package" : "Import work package (.zip)"}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-primary)" }}>
      {fileInputs}
      {/* App Header */}
      <header className="app-header">
        <div className="app-title" style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span>ontocurator</span>
          <span style={{ fontSize: "0.82rem", color: "var(--text-muted)", fontWeight: 400 }}>
            Clinical Curation Workbench
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {ontologyLabels.length > 0 && (
            <span
              style={{
                fontSize: "0.78rem",
                color: "var(--text-muted)",
                background: "var(--bg-secondary)",
                padding: "3px 8px",
                borderRadius: 4,
                whiteSpace: "nowrap",
              }}
            >
              Ontologies: {ontologyLabels.join(", ")}
            </span>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => ontologyInputRef.current?.click()}
            disabled={isUploadingOntology}
          >
            {isUploadingOntology ? "Uploading..." : "Add ontology (.json) or translation (.tsv)"}
          </button>
          {hasPackages && importButton(false)}
        </div>
      </header>

      {/* Main Dashboard View */}
      <div className="dashboard-container">
        {missingOntologyPrompt && (
          <div
            role="alert"
            style={{
              background: "rgba(234, 88, 12, 0.12)",
              border: "1px solid #ea580c",
              borderRadius: 8,
              padding: "16px 20px",
              marginBottom: 20,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 600, color: "#ea580c", fontSize: "1rem" }}>
                Missing ontology
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setMissingOntologyPrompt(null)}
              >
                Dismiss
              </button>
            </div>
            <p style={{ margin: 0, fontSize: "0.9rem" }}>{missingOntologyPrompt.message}</p>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)" }}>
              This package needs an ontology file that is not loaded yet. Select the matching ontology file (.json) to add it.
            </p>
            <div>
              <input
                ref={missingOntologyInputRef}
                type="file"
                accept=".json"
                aria-label="Upload missing ontology"
                style={{ display: "none" }}
                onChange={handleUploadMissingOntology}
                disabled={isUploadingOntology}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => missingOntologyInputRef.current?.click()}
                disabled={isUploadingOntology}
              >
                {isUploadingOntology ? "Uploading..." : "Upload missing ontology (.json)"}
              </button>
            </div>
          </div>
        )}
        {provisioningNotices.map((item, index) => (
          <div
            key={`${item.code}:${item.file ?? ""}:${index}`}
            role={item.level === "warning" ? "alert" : "status"}
            aria-label={item.level === "warning" ? "Delivery notice" : "Delivery information"}
            className={`notice ${item.level === "warning" ? "notice-warning" : "notice-info"}`}
          >
            <span>{item.message}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setProvisioningNotices((all) => all.filter((n) => n !== item))}
              aria-label="Dismiss notice"
            >
              ✕
            </button>
          </div>
        ))}
        {legacyConfig && (
          <LegacyConfigNotice
            status={legacyConfig}
            onClosed={(message) => {
              setLegacyConfig(null);
              setError(null);
              if (message) setNotice(message);
            }}
            onImported={() => { void loadOntologies(); }}
            onError={(message) => setError(message)}
          />
        )}
        {notice && (
          <div role="status" aria-label="Import result" className="notice notice-success">
            <span>{notice}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNotice(null)} aria-label="Dismiss message">
              ✕
            </button>
          </div>
        )}
        {error && (
          <div
            style={{
              padding: "12px 16px",
              background: "var(--danger-light)",
              color: "var(--danger)",
              borderRadius: "var(--radius)",
              marginBottom: 20,
              fontSize: "0.9rem",
            }}
          >
            {error}
          </div>
        )}

        {showGuide && (
          <section className="getting-started" aria-labelledby="getting-started-title">
            <h2 id="getting-started-title">Get started</h2>
            <ol className="getting-started-steps">
              <li>
                <div>
                  <strong>Import work package (.zip)</strong>
                  <span>The .zip file you received for this annotation project.</span>
                </div>
                {importButton(true)}
              </li>
              <li>
                <div>
                  <strong>Enter your initials</strong>
                  <span>Your annotations are saved under them.</span>
                </div>
              </li>
              <li>
                <div>
                  <strong>Open a case</strong>
                  <span>Pick a case from the list and click “Open case”.</span>
                </div>
              </li>
            </ol>
          </section>
        )}

        {hasPackages && (
          <>
            {/* Package, identity and mode */}
            <div
              style={{
                background: "var(--bg-surface)",
                padding: "16px 20px",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border-color)",
                marginBottom: 20,
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 1fr",
                gap: 16,
                alignItems: "start",
              }}
            >
              <div className="form-group" style={{ margin: 0 }}>
                <label htmlFor="package-select" className="form-label" style={{ marginBottom: 4 }}>
                  Work package
                </label>
                <select
                  id="package-select"
                  className="form-select"
                  value={selectedPackageId ?? ""}
                  onChange={(e) => { void handleSelectPackage(e.target.value); }}
                >
                  {packages.map((pkg) => (
                    <option key={pkg.package_id} value={pkg.package_id}>
                      {pkg.package_id} {pkg.ontology?.release ? `(Release: ${pkg.ontology.release})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label htmlFor="annotator-input" className="form-label" style={{ marginBottom: 4 }}>
                  Your initials / ID
                </label>
                <input
                  id="annotator-input"
                  ref={annotatorFieldRef}
                  type="text"
                  className={`form-control${identityIssue && !identityMissing ? " is-invalid" : ""}`}
                  required
                  aria-required="true"
                  aria-invalid={identityIssue ? true : undefined}
                  aria-describedby="annotator-hint"
                  maxLength={MAX_IDENTITY_LENGTH * 2}
                  autoComplete="off"
                  value={annotatorInput}
                  onChange={(e) => setAnnotatorInput(e.target.value)}
                  onBlur={() => { commitAnnotator(); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitAnnotator();
                    } else if (e.key === "Escape") {
                      setAnnotatorInput(annotatorId);
                    }
                  }}
                  placeholder="e.g. JPL"
                />
                <div
                  id="annotator-hint"
                  className={`field-hint${identityIssue && !identityMissing ? " field-hint-error" : ""}`}
                >
                  {identityMissing ? (
                    "Required. Your annotations are saved under this name."
                  ) : identityIssue ? (
                    identityIssue
                  ) : (
                    <>
                      Working as <strong data-testid="dashboard-identity">{annotatorInput.trim()}</strong>
                    </>
                  )}
                </div>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                {settings.allowedModes.length === 1 ? (
                  <>
                    <div className="form-label" style={{ marginBottom: 4 }}>
                      Working mode
                    </div>
                    <div className="fixed-mode" data-testid="fixed-mode">
                      {modeLabels[mode]}
                    </div>
                    <div className="field-hint">{modeExplanations[mode]} Set for this installation.</div>
                  </>
                ) : (
                  <>
                    <label htmlFor="mode-select" className="form-label" style={{ marginBottom: 4 }}>
                      Working mode
                    </label>
                    <select
                      id="mode-select"
                      className="form-select"
                      value={mode}
                      onChange={(e) => handleChangeMode(e.target.value as WorkspaceMode)}
                    >
                      {settings.allowedModes.map((m) => (
                        <option key={m} value={m} style={m === "assisted" ? { display: "none" } : undefined}>
                          {modeLabels[m]}
                        </option>
                      ))}
                    </select>
                    <div className="field-hint">{modeExplanations[mode]}</div>
                  </>
                )}
              </div>
            </div>

            {/* Hidden fallback select for strict document test compatibility */}
            <div style={{ display: "none" }}>
              <select
                id="doc-select"
                aria-label="Clinical Case (Document)"
                value={selectedDocId ?? ""}
                onChange={(e) => setSelectedDocId(e.target.value)}
              >
                {documents.map((doc) => (
                  <option key={doc.document_id} value={doc.document_id}>
                    Case {doc.position}: {doc.document_id}
                  </option>
                ))}
              </select>
            </div>

            {/* Hero: selected case (defaults to the case to continue) with the one primary action */}
            {heroDoc && (
              <div className="dashboard-hero">
                <div>
                  <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--primary)", fontWeight: 700 }}>
                    {heroDoc.status === "in_progress" ? "Continue where you left off" : "Selected case"}
                  </div>
                  <div style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--text-main)", marginTop: 2 }}>
                    Case {heroDoc.position}: <span style={{ fontFamily: "var(--font-mono)" }}>{heroDoc.document_id}</span>
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: 3 }}>
                    {heroDoc.language.toUpperCase()} • {heroDoc.text_length} chars • Status: <strong>{statusLabels[heroDoc.status] ?? heroDoc.status}</strong>
                    {" • "}{modeLabels[mode]}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: "8px 18px", fontWeight: 600 }}
                    disabled={isOpening || !!identityIssue}
                    onClick={() => requestOpen(heroDoc.document_id)}
                  >
                    {isOpening ? "Opening..." : "Open case"}
                  </button>
                  {identityIssue && (
                    <span className="field-hint">Enter your initials first.</span>
                  )}
                </div>
              </div>
            )}

            {/* Cases Data Table Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div className="dashboard-tabs">
                <button
                  type="button"
                  className={`dashboard-tab ${statusFilter === "all" ? "active" : ""}`}
                  onClick={() => setStatusFilter("all")}
                >
                  All ({documents.length})
                </button>
                <button
                  type="button"
                  className={`dashboard-tab ${statusFilter === "not_started" ? "active" : ""}`}
                  onClick={() => setStatusFilter("not_started")}
                >
                  Open ({openCount})
                </button>
                <button
                  type="button"
                  className={`dashboard-tab ${statusFilter === "in_progress" ? "active" : ""}`}
                  onClick={() => setStatusFilter("in_progress")}
                >
                  In Progress ({inProgressCount})
                </button>
                <button
                  type="button"
                  className={`dashboard-tab ${statusFilter === "completed" ? "active" : ""}`}
                  onClick={() => setStatusFilter("completed")}
                >
                  Completed ({completedCount})
                </button>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="search"
                  placeholder="Filter cases by ID..."
                  className="form-control"
                  style={{ width: 220, fontSize: "0.82rem", padding: "5px 10px" }}
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { void handleExportPackage(); }}
                  disabled={!selectedPackageId || !annotatorId || isExporting}
                  title={annotatorId
                    ? `Export all finished cases of ${annotatorId} (${modeLabels[mode]}) in this package as ZIP`
                    : "Enter your initials first"}
                  style={{ padding: "6px 14px" }}
                >
                  {isExporting ? "Exporting..." : "Export package (.zip)"}
                </button>
              </div>
            </div>

            {/* Cases Table: click selects, double-click or Enter opens */}
            <table className="dashboard-table" aria-label="Clinical Cases">
              <thead>
                <tr>
                  <th style={{ width: 48 }}>#</th>
                  <th>Case ID</th>
                  <th>Language</th>
                  <th>Length</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocuments.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: 24 }}>
                      No cases found for the selected filter.
                    </td>
                  </tr>
                ) : (
                  filteredDocuments.map((doc) => {
                    const isSelected = doc.document_id === selectedDocId;
                    return (
                      <tr
                        key={doc.document_id}
                        className={isSelected ? "is-selected" : undefined}
                        style={{ cursor: "pointer" }}
                        tabIndex={0}
                        aria-selected={isSelected}
                        title="Click to select, double-click to open"
                        onClick={() => setSelectedDocId(doc.document_id)}
                        onDoubleClick={() => requestOpen(doc.document_id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            requestOpen(doc.document_id);
                          } else if (e.key === " ") {
                            e.preventDefault();
                            setSelectedDocId(doc.document_id);
                          }
                        }}
                      >
                        <td style={{ fontWeight: 600, color: "var(--text-muted)" }}>{doc.position}</td>
                        <td style={{ fontWeight: 600, fontFamily: "var(--font-mono)" }}>{doc.document_id}</td>
                        <td>{doc.language.toUpperCase()}</td>
                        <td>{doc.text_length.toLocaleString("en-US")} chars</td>
                        <td>
                          <span
                            className="badge"
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              backgroundColor:
                                doc.status === "completed"
                                  ? "var(--success-light)"
                                  : doc.status === "in_progress"
                                  ? "var(--primary-light)"
                                  : "#f1f5f9",
                              color:
                                doc.status === "completed"
                                  ? "var(--success)"
                                  : doc.status === "in_progress"
                                  ? "var(--primary)"
                                  : "#64748b",
                            }}
                          >
                            {statusLabels[doc.status] ?? doc.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </>
        )}
      </div>

      {pendingOpen && (
        <div className="modal-overlay">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-identity-title"
            className="modal-content"
          >
            <h2 id="confirm-identity-title" style={{ fontSize: "1.1rem", margin: "0 0 8px" }}>
              You are annotating as {pendingOpen.identity}
            </h2>
            <p style={{ margin: "0 0 16px", color: "var(--text-muted)", fontSize: "0.9rem" }}>
              Your annotations and decisions are saved under these initials. If this is not you, change them first.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={changeIdentity}>
                Change initials
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmIdentity} autoFocus>
                Yes, continue
              </button>
            </div>
          </div>
        </div>
      )}
      {sessionScreen}
    </div>
  );
};
