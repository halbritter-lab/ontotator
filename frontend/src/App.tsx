import React, { useEffect, useRef, useState } from "react";
import {
  api,
  initSessionToken,
  type AnnotationSnapshot,
  type DocumentSummary,
  type OpenWorkspaceResponse,
  type PackageManifest,
} from "./api/client";
import type { components } from "./api/generated";
import { CaseScreen } from "./app/CaseScreen";

const snapshotKey = (s: AnnotationSnapshot) => JSON.stringify([s.annotation.annotation_id, s.version]);

export type WorkspaceMode = "independent" | "review";
export type ReviewTargetSet = components["schemas"]["ReviewTargetSet"];

export const App: React.FC = () => {
  const documentRequest = useRef(0);
  const reviewRequest = useRef(0);
  const [packages, setPackages] = useState<PackageManifest[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [annotatorId, setAnnotatorId] = useState<string>("annotator-1");
  const [mode, setMode] = useState<WorkspaceMode>("independent");

  // Review mode target setup
  const [reviewInputs, setReviewInputs] = useState<AnnotationSnapshot[]>([]);
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(new Set());
  const [isLoadingInputs, setIsLoadingInputs] = useState<boolean>(false);

  // Active workspace view
  const [activeWorkspace, setActiveWorkspace] = useState<OpenWorkspaceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  useEffect(() => {
    initSessionToken();
    loadPackages();
  }, []);

  const loadPackages = async () => {
    try {
      setError(null);
      const list = await api.listPackages();
      setPackages(list);
      if (list.length > 0 && !selectedPackageId) {
        handleSelectPackage(list[0].package_id);
      }
    } catch (err: unknown) {
      setError(`Fehler beim Laden der Pakete: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSelectPackage = async (pkgId: string) => {
    const requestId = ++documentRequest.current;
    ++reviewRequest.current;
    setDocuments([]);
    setSelectedPackageId(pkgId);
    setSelectedDocId(null);
    setReviewInputs([]);
    try {
      const docs = await api.listDocuments(pkgId);
      if (requestId !== documentRequest.current) return;
      setDocuments(docs);
      if (docs.length > 0) {
        setSelectedDocId(docs[0].document_id);
      }
    } catch (err: unknown) {
      setError(`Fehler beim Laden der Dokumente: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleUploadPackage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);
    try {
      const res = await api.uploadPackage(file);
      await loadPackages();
      handleSelectPackage(res.package_id);
    } catch (err: unknown) {
      setError(`Fehler beim Paket-Upload: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  const handleFetchReviewInputs = async () => {
    if (!selectedPackageId || !selectedDocId) return;
    const requestId = ++reviewRequest.current;
    setIsLoadingInputs(true);
    setError(null);
    try {
      const inputs = await api.getReviewInputs({
        package_id: selectedPackageId,
        document_id: selectedDocId,
        annotator_id: annotatorId.trim() || "reviewer-1",
        mode: "review",
      });
      if (requestId !== reviewRequest.current) return;
      setReviewInputs(inputs);
      // Select all by default
      const allIds = new Set(inputs.map(snapshotKey));
      setSelectedTargetIds(allIds);
    } catch (err: unknown) {
      setError(`Fehler beim Abrufen der Review-Vorschläge: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (requestId === reviewRequest.current) setIsLoadingInputs(false);
    }
  };

  useEffect(() => {
    ++reviewRequest.current;
    setReviewInputs([]);
    setSelectedTargetIds(new Set());
    if (mode === "review" && selectedPackageId && selectedDocId) void handleFetchReviewInputs();
  }, [mode, selectedPackageId, selectedDocId, annotatorId]);

  const handleOpenWorkspace = async () => {
    if (!selectedPackageId || !selectedDocId) return;
    setError(null);

    let targets: ReviewTargetSet | null = null;

    if (mode === "review") {
      const chosenSnapshots = reviewInputs.filter((i) =>
        selectedTargetIds.has(snapshotKey(i))
      );
      if (chosenSnapshots.length === 0) {
        setError("Bitte wählen Sie mindestens einen Vorschlag für die Review-Runde aus.");
        return;
      }
      targets = {
        target_set_id: "",
        targets: chosenSnapshots.map((s) => ({
          annotation_id: s.annotation.annotation_id,
          version: s.version,
        })),
      };
    }

    try {
      const res = await api.openWorkspace({
        package_id: selectedPackageId,
        document_id: selectedDocId,
        annotator_id: annotatorId.trim() || "annotator-1",
        mode,
        targets,
      });
      setActiveWorkspace(res);
    } catch (err: unknown) {
      setError(`Fehler beim Öffnen des Arbeitsbereichs: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (activeWorkspace) {
    return (
      <CaseScreen
        view={activeWorkspace.view}
        workspaceId={activeWorkspace.workspace_id}
        onClose={() => {
          setActiveWorkspace(null);
          if (selectedPackageId) {
            handleSelectPackage(selectedPackageId);
          }
        }}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-primary)" }}>
      {/* App Header */}
      <header className="app-header">
        <div className="app-title">
          <span>🏥 HPO Annotations-Editor</span>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: 400 }}>
            Lokale ärztliche Phänotyp-Annotation & Origin-neutrales Review
          </span>
        </div>
        <div>
          <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
            {isUploading ? "Wird importiert..." : "📦 Arbeitspaket (.zip) importieren"}
            <input
              type="file"
              accept=".zip"
              style={{ display: "none" }}
              onChange={handleUploadPackage}
              disabled={isUploading}
            />
          </label>
        </div>
      </header>

      {/* Main Setup View */}
      <div style={{ flex: 1, padding: 32, overflowY: "auto", maxWidth: 900, margin: "0 auto", width: "100%" }}>
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

        {/* 1. Paket & Dokumentauswahl */}
        <div
          style={{
            background: "var(--bg-surface)",
            padding: 24,
            borderRadius: "var(--radius)",
            border: "1px solid var(--border-color)",
            marginBottom: 24,
          }}
        >
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 16 }}>
            1. Fall & Arbeitspaket auswählen
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div className="form-group">
              <label htmlFor="package-select" className="form-label">
                Installiertes Arbeitspaket
              </label>
              <select
                id="package-select"
                className="form-select"
                value={selectedPackageId ?? ""}
                onChange={(e) => handleSelectPackage(e.target.value)}
              >
                {packages.length === 0 && <option value="">Keine Pakete gefunden</option>}
                {packages.map((pkg) => (
                  <option key={pkg.package_id} value={pkg.package_id}>
                    {pkg.package_id} (Release: {pkg.ontology.release})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="doc-select" className="form-label">
                Klinischer Fall (Dokument)
              </label>
              <select
                id="doc-select"
                className="form-select"
                value={selectedDocId ?? ""}
                onChange={(e) => { setSelectedDocId(e.target.value); setReviewInputs([]); setSelectedTargetIds(new Set()); }}
              >
                {documents.length === 0 && <option value="">Keine Dokumente</option>}
                {documents.map((doc) => (
                  <option key={doc.document_id} value={doc.document_id}>
                    {doc.document_id} ({doc.text_length} Zeichen, {doc.language.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* 2. Annotator & Modus */}
        <div
          style={{
            background: "var(--bg-surface)",
            padding: 24,
            borderRadius: "var(--radius)",
            border: "1px solid var(--border-color)",
            marginBottom: 24,
          }}
        >
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 16 }}>
            2. Annotationsmodus & Identität
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
            <div className="form-group">
              <label htmlFor="annotator-input" className="form-label">
                Ihre Annotator-Kennung
              </label>
              <input
                id="annotator-input"
                type="text"
                className="form-control"
                value={annotatorId}
                onChange={(e) => setAnnotatorId(e.target.value)}
                placeholder="z. B. dr-mueller"
              />
            </div>

            <div className="form-group">
              <label htmlFor="mode-select" className="form-label">
                Arbeitsmodus
              </label>
              <select
                id="mode-select"
                className="form-select"
                value={mode}
                onChange={(e) => {
                  const m = e.target.value as WorkspaceMode;
                  setMode(m);
                }}
              >
                <option value="independent">
                  Unabhängige Annotation (ohne fremde Vorschläge)
                </option>
                <option value="review">
                  Review-Modus (Vorschläge herkunftsunabhängig prüfen)
                </option>
              </select>
            </div>
          </div>

          {/* Info Banner */}
          {mode === "independent" && (
            <div
              style={{
                padding: "12px 16px",
                background: "var(--primary-light)",
                color: "var(--primary-hover)",
                borderRadius: "var(--radius)",
                fontSize: "0.85rem",
              }}
            >
              🔒 <strong>Unabhängiger Modus:</strong> Sie annotieren den Text ohne Kenntnis
              vorhandener Vorschläge, KI-Hypothesen oder fremder Annotationen.
            </div>
          )}

          {/* Review Target Setup */}
          {mode === "review" && (
            <div style={{ marginTop: 16, borderTop: "1px solid var(--border-color)", paddingTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 600 }}>
                  Verfügbare Vorschläge zur Prüfung ({reviewInputs.length})
                </h3>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleFetchReviewInputs}
                  disabled={isLoadingInputs}
                >
                  {isLoadingInputs ? "Lädt..." : "Aktualisieren"}
                </button>
              </div>

              {reviewInputs.length === 0 ? (
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  Keine Vorschläge für diesen Fall vorhanden.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {reviewInputs.map((input) => {
                    const ann = input.annotation;
                    const isChecked = selectedTargetIds.has(snapshotKey(input));

                    return (
                      <label
                        key={snapshotKey(input)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "10px 14px",
                          border: "1px solid var(--border-color)",
                          borderRadius: "var(--radius)",
                          cursor: "pointer",
                          background: isChecked ? "var(--bg-primary)" : "var(--bg-surface)",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const next = new Set(selectedTargetIds);
                            if (e.target.checked) next.add(snapshotKey(input));
                            else next.delete(snapshotKey(input));
                            setSelectedTargetIds(next);
                          }}
                        />
                        <div style={{ flex: 1 }}>
                          <span style={{ fontWeight: 600 }}>{ann.hpo_id}</span>
                          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginLeft: 8 }}>
                            ({ann.evidence_refs?.length ?? 0} Belegstellen • Version: {input.version.slice(0, 8)})
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Start Workspace Button */}
        <div style={{ textAlign: "right" }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: "10px 24px", fontSize: "1rem" }}
            onClick={handleOpenWorkspace}
            disabled={!selectedPackageId || !selectedDocId}
          >
            Arbeitsbereich öffnen →
          </button>
        </div>
      </div>
    </div>
  );
};
