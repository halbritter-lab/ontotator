import { IconButton } from "../ui/IconButton";
import { IconChevronLeft, IconChevronRight } from "../ui/icons";
import { Select } from "../ui/Select";
import React from "react";
import type { DocumentSummary } from "../api/client";
import { adjacentCase, canOpenCase, sharedIdPrefix } from "./caseOrder";

export interface CaseNavigationProps {
  documents: DocumentSummary[];
  currentDocumentId: string;
  onNavigate: (documentId: string) => Promise<void>;
  disabled?: boolean;
}

const statusLabels: Record<string, string> = {
  not_started: "Open",
  in_progress: "In Progress",
  completed: "Completed",
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

  // Review includes every document in package order.
  const prevDoc = adjacentCase(documents, currentDocumentId, -1);
  const nextDoc = adjacentCase(documents, currentDocumentId, 1);
  const hasPrev = prevDoc !== null;
  const hasNext = nextDoc !== null;
  // Long IDs often share a prefix (source, release); only the rest tells cases apart.
  const idPrefix = sharedIdPrefix(documents.map((d) => d.document_id));

  const handlePrev = async () => {
    if (!prevDoc || disabled) return;
    await onNavigate(prevDoc.document_id);
  };

  const handleNext = async () => {
    if (!nextDoc || disabled) return;
    await onNavigate(nextDoc.document_id);
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
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        background: "var(--surface-raised)",
        overflow: "hidden",
      }}
    >
      <IconButton label="Previous Case" icon={<IconChevronLeft />}
        type="button"
        variant="secondary" size="sm"
        onClick={handlePrev}
        disabled={!hasPrev || disabled}
        title="Previous Case (Alt + ←)"
        style={{ border: "none", borderRadius: 0, padding: "4px 10px", fontSize: "0.95rem" }}
      />

      {total > 1 ? (
        <Select id="case-navigation-select" label={null}
          aria-label="Select case"
          className="form-select-sm"
          value={currentDocumentId}
          onChange={handleSelect}
          disabled={disabled}
          title={currentDocumentId}
          style={{
            borderTop: "none",
            borderBottom: "none",
            borderLeft: "1px solid var(--border)",
            borderRight: "1px solid var(--border)",
            borderRadius: 0,
            background: "transparent",
            fontWeight: 600,
            fontSize: "0.82rem",
            padding: "4px 24px 4px 10px",
            cursor: "pointer",
            maxWidth: 280,
          }}
        >
          {documents.map((doc) => {
            const statusLabel = statusLabels[doc.status] ?? doc.status;
            const shownId = idPrefix ? `…${doc.document_id.slice(idPrefix.length)}` : doc.document_id;
            const openable = canOpenCase(doc);
            return (
              <option key={doc.document_id} value={doc.document_id} disabled={!openable}>
                Case {doc.position} of {total}: {shownId} ({statusLabel}){!openable && " – no proposals"}
              </option>
            );
          })}
        </Select>
      ) : (
        <span
          style={{
            fontSize: "0.82rem",
            fontWeight: 600,
            color: "var(--text)",
            padding: "0 10px",
            whiteSpace: "nowrap",
            borderLeft: "1px solid var(--border)",
            borderRight: "1px solid var(--border)",
            lineHeight: "26px",
          }}
        >
          Case {position} of {total}: {currentDocumentId}
        </span>
      )}

      <IconButton label="Next Case" icon={<IconChevronRight />}
        type="button"
        variant="secondary" size="sm"
        onClick={handleNext}
        disabled={!hasNext || disabled}
        title="Next Case (Alt + →)"
        style={{ border: "none", borderRadius: 0, padding: "4px 10px", fontSize: "0.95rem" }}
      />
    </div>
  );
};
