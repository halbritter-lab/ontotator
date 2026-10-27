import { IconButton } from "../ui/IconButton";
import { IconChevronLeft, IconChevronRight } from "../ui/icons";
import { Select } from "../ui/Select";
import React from "react";
import type { DocumentSummary } from "../api/client";
import { adjacentCase, canOpenCase, sharedIdPrefix } from "./caseOrder";
import { taskText } from "./identity";
import { assignmentStatusLabels } from "./labels";

export interface CaseNavigationProps {
  documents: DocumentSummary[];
  currentDocumentId: string;
  onNavigate: (documentId: string) => Promise<void>;
  disabled?: boolean;
  navigationIds?: string[];
  currentNavigationId?: string;
}

// The My tasks status words (X-7): a document status maps to the task status it stands for.
const statusLabels: Record<string, string> = {
  not_started: assignmentStatusLabels.open,
  in_progress: assignmentStatusLabels.in_progress,
  completed: assignmentStatusLabels.submitted,
  reopened: assignmentStatusLabels.reopened,
  paused: "Paused",
};

export const CaseNavigation: React.FC<CaseNavigationProps> = ({
  documents,
  currentDocumentId,
  onNavigate,
  disabled = false,
  navigationIds, currentNavigationId,
}) => {
  const currentIndex = navigationIds ? navigationIds.indexOf(currentNavigationId ?? "") : documents.findIndex((d) => d.document_id === currentDocumentId);
  const idAt = (index: number) => navigationIds?.[index] ?? documents[index]?.document_id;
  const total = documents.length;
  const currentDoc = currentIndex >= 0 ? documents[currentIndex] : null;
  const position = currentDoc?.position ?? (currentIndex >= 0 ? currentIndex + 1 : 1);

  // Review includes every document in package order.
  const prevDoc = navigationIds ? documents[currentIndex - 1] ?? null : adjacentCase(documents, currentDocumentId, -1);
  const nextDoc = navigationIds ? documents[currentIndex + 1] ?? null : adjacentCase(documents, currentDocumentId, 1);
  const hasPrev = prevDoc !== null;
  const hasNext = nextDoc !== null;
  // Long IDs often share a prefix (source, release); only the rest tells cases apart.
  const idPrefix = sharedIdPrefix(documents.map((d) => d.document_id));

  const handlePrev = async () => {
    if (!prevDoc || disabled) return;
    await onNavigate(idAt(documents.indexOf(prevDoc)));
  };

  const handleNext = async () => {
    if (!nextDoc || disabled) return;
    await onNavigate(idAt(documents.indexOf(nextDoc)));
  };

  const handleSelect = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextId = e.target.value;
    if (nextId !== (currentNavigationId ?? currentDocumentId) && !disabled) {
      await onNavigate(nextId);
    }
  };

  return (
    <div className="case-navigation" data-testid="case-navigation">
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
          value={currentNavigationId ?? currentDocumentId}
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
            maxWidth: 360,
          }}
        >
          {documents.map((doc, index) => {
            const statusLabel = statusLabels[doc.status] ?? doc.status;
            // The text's name as in My tasks and the heading (R-11); a bare document ID only without a case ID.
            const shownId = doc.case_id ? taskText(doc) : idPrefix ? `…${doc.document_id.slice(idPrefix.length)}` : doc.document_id;
            const openable = canOpenCase(doc);
            return (
              <option key={idAt(index)} value={idAt(index)} disabled={!openable}>
                Case {doc.position} of {total}: {shownId} ({statusLabel}){!openable && " – no proposals"}
              </option>
            );
          })}
        </Select>
      ) : (
        // The document name is the page's h1; the id stays available on hover.
        <span className="case-navigation__label" title={currentDocumentId}>
          Case {position} of {total}
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
