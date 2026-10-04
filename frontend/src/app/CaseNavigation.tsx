import React from "react";
import type { DocumentSummary } from "../api/client";

export interface CaseNavigationProps {
  documents: DocumentSummary[];
  currentDocumentId: string;
  onNavigate: (documentId: string) => Promise<void>;
  disabled?: boolean;
}

const statusLabels: Record<string, string> = {
  not_started: "Nicht begonnen",
  in_progress: "In Bearbeitung",
  completed: "Abgeschlossen",
};

export const CaseNavigation: React.FC<CaseNavigationProps> = ({
  documents,
  currentDocumentId,
  onNavigate,
  disabled = false,
}) => {
  const currentIndex = documents.findIndex((d) => d.document_id === currentDocumentId);
  const total = documents.length;
  const currentDoc = currentIndex >= 0 ? documents[currentIndex] : null;
  const position = currentDoc?.position ?? (currentIndex >= 0 ? currentIndex + 1 : 1);

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < total - 1;

  const handlePrev = async () => {
    if (!hasPrev || disabled) return;
    await onNavigate(documents[currentIndex - 1].document_id);
  };

  const handleNext = async () => {
    if (!hasNext || disabled) return;
    await onNavigate(documents[currentIndex + 1].document_id);
  };

  const handleSelect = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextId = e.target.value;
    if (nextId !== currentDocumentId && !disabled) {
      await onNavigate(nextId);
    }
  };

  return (
    <div
      className="case-navigation"
      data-testid="case-navigation"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius)",
          background: "var(--bg-surface)",
          overflow: "hidden",
        }}
      >
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          aria-label="Vorheriger Fall"
          onClick={handlePrev}
          disabled={!hasPrev || disabled}
          title="Vorheriger Fall (Alt + ←)"
          style={{ border: "none", borderRadius: 0, padding: "3px 8px", fontSize: "0.9rem" }}
        >
          ‹ Vorheriger Fall
        </button>

        <span
          style={{
            fontSize: "0.82rem",
            fontWeight: 600,
            color: "var(--text-main)",
            padding: "0 10px",
            whiteSpace: "nowrap",
            borderLeft: "1px solid var(--border-color)",
            borderRight: "1px solid var(--border-color)",
            lineHeight: "26px",
          }}
        >
          Fall {position} von {total}
        </span>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          aria-label="Nächster Fall"
          onClick={handleNext}
          disabled={!hasNext || disabled}
          title="Nächster Fall (Alt + →)"
          style={{ border: "none", borderRadius: 0, padding: "3px 8px", fontSize: "0.9rem" }}
        >
          Nächster Fall ›
        </button>
      </div>

      {total > 1 && (
        <select
          aria-label="Fall auswählen"
          className="form-select form-select-sm"
          value={currentDocumentId}
          onChange={handleSelect}
          disabled={disabled}
          style={{ maxWidth: 220, fontSize: "0.8rem", padding: "3px 6px" }}
        >
          {documents.map((doc) => {
            const label = `Fall ${doc.position}: ${doc.document_id} (${statusLabels[doc.status] ?? doc.status})`;
            return (
              <option key={doc.document_id} value={doc.document_id}>
                {label}
              </option>
            );
          })}
        </select>
      )}
    </div>
  );
};
