import { IconButton } from "../ui/IconButton";
import { Textarea } from "../ui/Textarea";
import { Select } from "../ui/Select";
import { Button } from "../ui/Button";
import React, { useEffect, useId, useRef, useState } from "react";
import { ProposalSource } from "./ProposalSource";
import { AiBadge } from "./AiBadge";
import type { EditorProposal, AnnotationSnapshot, SearchCandidate } from "../api/client";
import type { components } from "../api/generated";
import type { CodepointSegment } from "../spans/adapter";
import { SearchPanel } from "./SearchPanel";
import { TermName } from "./TermName";
import type { SearchLanguageControl } from "./searchLanguages";
import type { SearchManager, WorkspaceKey } from "./searchState";
import { IconClose, IconTrash } from "../ui/icons";
import { axisOptionLabel } from "./axisLabels";
import { InlineMessage } from "../ui/InlineMessage";
import { Kbd } from "../ui/Kbd";
import { useCoalescedAxisChange } from "./useCoalescedAxisChange";

export type AxesValues = Record<string, string | null>;
export type Axes = AxesValues;
export type EvidenceSnapshot = components["schemas"]["EvidenceSnapshot"];
export type AxisDefinition = components["schemas"]["AxisDefinition"];

export interface AnnotationPanelProps {
  source?: EditorProposal;
  readOnly?: boolean;
  annotation: AnnotationSnapshot | null;
  allEvidence: Record<string, EvidenceSnapshot>;
  workspaceKey: WorkspaceKey;
  searchManager: SearchManager;
  selectedEvidenceId: string | null;
  layerId?: string;
  axesConfig?: AxisDefinition[];
  axesDefinition?: string;
  termLabel?: string | null;
  linkedTarget?: {
    targetId: string;
    termId: string;
    termLabel?: string | null;
  } | null;
  onNavigateTarget?: () => void;
  onDeselect?: () => void;
  /** Open the ontology tree at this annotation's term. */
  onShowInTree?: () => void;
  onSelectEvidence: (evidenceId: string) => void;
  noteValue?: string;
  noteRequired?: boolean;
  noteHint?: string;
  onChangeNote?: (note: string) => void;
  onSaveNote?: () => void;
  detachLastBlockedReason?: string;
  onUpdateTerm: (termId: string, searchId?: string) => void;
  onUpdateAxes: (axes: Partial<Axes>) => void;
  /** "Confirm defaults (n)": the defaulted axes to confirm and the values shown (one set_axes). */
  onConfirmDefaults?: (axisIds: string[], values?: AxesValues) => void;
  /** Error of the last confirmation, shown inside the Values section. */
  valuesError?: string | null;
  /** Each increment opens "Change term" and focuses the term search. */
  searchRequest?: number;
  onAttachMention: (segments: CodepointSegment[]) => void;
  onDetachMention: (evidenceId: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  /** Text of the delete confirmation; defaults to "Delete this annotation and all its mentions?". */
  deleteConfirmMessage?: string;
  onSetIntent: (intent: "new_mention" | "extend_mention") => void;
  /** Document text, used to quote mention snippets. */
  documentText?: string;
  /** True while "+ Add Mention" mode waits for a text selection. */
  isAttachingMention?: boolean;
  /** Language selection of the term search, when the layer's ontology has translations. */
  searchLanguages?: SearchLanguageControl;
}

/** Quote the text covered by codepoint segments; discontinuous parts are joined with " … ". */
export function quoteSegments(text: string, segments: { start: number; end: number }[], maxLength = 160): string {
  const chars = Array.from(text);
  const quoted = segments
    .map((seg) => chars.slice(Math.max(0, seg.start), Math.min(chars.length, seg.end)).join(""))
    .join(" … ");
  return quoted.length > maxLength ? `${quoted.slice(0, maxLength - 1)}…` : quoted;
}

export const AnnotationPanel: React.FC<AnnotationPanelProps> = ({
  annotation,
  source,
  readOnly = false,
  allEvidence,
  workspaceKey,
  searchManager,
  selectedEvidenceId,
  layerId,
  axesConfig,
  termLabel,
  linkedTarget,
  onNavigateTarget,
  onDeselect,
  onShowInTree,
  onSelectEvidence,
  noteValue, noteRequired, noteHint, onChangeNote, onSaveNote, detachLastBlockedReason,
  onUpdateTerm,
  onUpdateAxes,
  onConfirmDefaults,
  valuesError,
  searchRequest,
  onDetachMention,
  onDeleteAnnotation,
  deleteConfirmMessage = "Delete this annotation and all its mentions?",
  onSetIntent,
  documentText = "",
  isAttachingMention = false,
  searchLanguages,
}) => {
  const [showSearch, setShowSearch] = useState(false);
  const changeTermButton = useRef<HTMLButtonElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDetachId, setConfirmDetachId] = useState<string | null>(null);
  const valuesHeadingId = useId();
  // Radio changes by arrow keys are coalesced (one save after a pause); a click saves at once.
  const arrowChange = useRef(false);
  const savedAxes: AxesValues = annotation?.annotation.axes_values ?? (annotation?.annotation as any)?.axes?.values ?? {};
  const axes = useCoalescedAxisChange(savedAxes, values => onUpdateAxes(values));
  const searchRequestSeen = useRef(searchRequest);
  useEffect(() => {
    if (searchRequest === searchRequestSeen.current) return;
    searchRequestSeen.current = searchRequest;
    setShowSearch(true);
  }, [searchRequest]);

  if (!annotation) {
    return (
      <div className="detail-pane">
        <div className="detail-section detail-empty">
          <h3>No annotation selected</h3>
          <p>
            Select an existing annotation or mention in the text,
            {readOnly ? "to inspect its details." : "or highlight text to create a new annotation."}
          </p>
        </div>
      </div>
    );
  }

  const ann = annotation.annotation;
  const currentTerm = ann.term_id;
  const axesValues = axes.values;
  const defaultedAxes = new Set(ann.axes_defaulted ?? []);
  /** A defaulted axis is unconfirmed while it shows its saved, still available default value. */
  const isUnconfirmedDefault = (axis: AxisDefinition) => {
    const value = axesValues[axis.id];
    return defaultedAxes.has(axis.id) && typeof value === "string" && value === savedAxes[axis.id] && axis.options.includes(value);
  };
  const confirmableDefaults = (axesConfig ?? []).filter(isUnconfirmedDefault);
  const confirmDefaults = () => {
    if (readOnly || !onConfirmDefaults || confirmableDefaults.length === 0) return;
    const ids = confirmableDefaults.map(axis => axis.id);
    axes.flush();
    onConfirmDefaults(ids, { ...axes.values });
  };

  const evidenceRefs = ann.evidence_refs ?? [];
  const linkedEvidence = evidenceRefs
    .map((ref) => allEvidence[ref.evidence_id])
    .filter(Boolean);

  const handleSelectCandidate = (candidate: SearchCandidate, searchId?: string) => {
    if (readOnly) return;
    onUpdateTerm(candidate.term_id, searchId);
    setShowSearch(false);
  };


  return (
    <div className="detail-pane">
      <ProposalSource source={source} />
      {/* Target Proposal Counter-Annotation Banner */}
      {linkedTarget && (
        <div
          style={{
            padding: "8px 12px",
            background: "var(--accent-light)",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.82rem",
          }}
        >
          <div>
            <span style={{ fontWeight: 600, color: "var(--accent)" }}>↳ Replacement for proposal: </span>
            <span style={{ color: "var(--text)", fontWeight: 500 }}>
              {linkedTarget.termLabel ? `${linkedTarget.termLabel} (${linkedTarget.termId})` : linkedTarget.termId}
            </span>
          </div>
          {onNavigateTarget && (
            <Button
              type="button"
              variant="secondary" size="sm"
              style={{ padding: "2px 8px", fontSize: "0.75rem", background: "var(--surface)" }}
              onClick={onNavigateTarget}
            >
              View review target
            </Button>
          )}
        </div>
      )}

      {/* 1. Term heading */}
      <div className="detail-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "2px 0 4px" }}>
              <TermName termId={currentTerm} label={termLabel} />{" "}<AiBadge provenance={ann.provenance} source={source} />
            </h2>
            {onShowInTree && currentTerm && (
              <Button
                type="button"
                variant="secondary" size="sm" className="annotation-tree-button"
                onClick={onShowInTree}
                title="Show this term in the ontology tree: broader and narrower terms"
              >
                Show in tree
              </Button>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Button
              ref={changeTermButton}
              type="button"
              variant="secondary" size="sm"
              data-repair="change-term" onClick={() => setShowSearch(!showSearch)}
              aria-keyshortcuts={!showSearch && !readOnly ? "/" : undefined}
            >
              {showSearch ? "Close search" : readOnly ? "Search ontology" : "Change term"}
              {!showSearch && !readOnly && <span aria-hidden="true"> <Kbd>/</Kbd></span>}
            </Button>
            {onDeselect && (
              <IconButton label="Clear selection" icon={<IconClose />} variant="quiet" size="sm" onClick={onDeselect} />
            )}
          </div>
        </div>

        {showSearch && (
          <div style={{ marginTop: 12 }}>
            <SearchPanel
              canAssign={!readOnly}
              searchManager={searchManager}
              annotationId={ann.annotation_id}
              layerId={layerId ?? ann.layer_id}
              workspaceKey={workspaceKey}
              currentTermId={currentTerm}
              onSelectCandidate={handleSelectCandidate}
              languages={searchLanguages}
              autoFocus
              onEscape={() => {
                setShowSearch(false);
                changeTermButton.current?.focus({ preventScroll: true });
              }}
            />
          </div>
        )}
      </div>

      {/* 2. Values (hidden if the type has no axes) */}
      {axesConfig && axesConfig.length > 0 && (
        <section className="detail-section values-section" data-values-section data-testid="axes-section" tabIndex={-1}
          aria-labelledby={valuesHeadingId}
          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) axes.flush(); }}>
          <h3 id={valuesHeadingId}>Values{!readOnly && <span aria-hidden="true"> <Kbd>V</Kbd></span>}</h3>
          {axesConfig.map((axis) => {
            const val = axesValues[axis.id] ?? "";
            const isRequired = !axis.allow_empty;
            const unavailable = val !== "" && !axis.options.includes(val);
            const unavailableLabel = `${val} (current unavailable value)`;
            const unconfirmed = isUnconfirmedDefault(axis);
            const options = [
              ...(axis.allow_empty ? [{ value: "", label: "Not specified" }] : []),
              ...axis.options.map((option) => ({ value: option, label: axisOptionLabel(option) })),
              ...(unavailable ? [{ value: val, label: unavailableLabel }] : []),
            ];
            const updateAxis = (value: string) => {
              axes.change(axis.id, value === "" ? null : value);
              if (!arrowChange.current) axes.flush();
              arrowChange.current = false;
            };

            return (
              <fieldset key={axis.id} className="axis-field" data-axis-field={axis.id}>
                <legend className="axis-legend">
                  {axis.label}{isRequired && <span className="axis-required"> (required)</span>}
                </legend>
                {options.length <= 4 ? (
                  <div className="axis-options">
                    {options.map((option) => {
                      const isDefault = unconfirmed && val === option.value;
                      return (
                        <label key={option.value} className={`axis-option${isDefault ? " is-default" : ""}`}
                          onPointerDown={() => { arrowChange.current = false; }}>
                          <input type="radio" name={`axis-${ann.annotation_id}-${axis.id}`}
                            value={option.value} checked={val === option.value}
                            disabled={readOnly || (unavailable && option.value === val)}
                            onKeyDown={event => { if (event.key.startsWith("Arrow")) arrowChange.current = true; }}
                            onChange={() => updateAxis(option.value)} />
                          <span>{option.label}</span>{isDefault && <span className="axis-default-tag"> · default</span>}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <Select label={null} id={`axis-select-${axis.id}`} aria-label={axis.label}
                    disabled={readOnly} value={val} onChange={(e) => updateAxis(e.target.value)}>
                    {axis.allow_empty && <option value="">Not specified</option>}
                    {!axis.allow_empty && <option value="" disabled>Please select</option>}
                    {unavailable && <option value={val} disabled>{unavailableLabel}</option>}
                    {axis.options.map((option) => <option key={option} value={option}>{axisOptionLabel(option)}{unconfirmed && option === val ? " · default" : ""}</option>)}
                  </Select>
                )}
              </fieldset>
            );
          })}
          {!readOnly && onConfirmDefaults && confirmableDefaults.length > 0 && (
            <Button type="button" variant="primary" size="sm" className="values-confirm" data-confirm-defaults
              aria-keyshortcuts="d" onClick={confirmDefaults}>
              Confirm defaults ({confirmableDefaults.length})<span aria-hidden="true"> <Kbd>D</Kbd></span>
            </Button>
          )}
          {confirmableDefaults.length > 0 && (
            <p className="form-hint">Defaults are not confirmed until you confirm them or choose another value.</p>
          )}
          {valuesError && <InlineMessage tone="error">{valuesError}</InlineMessage>}
        </section>
      )}

      <div className="detail-section">
        <Textarea id={`annotation-note-${ann.annotation_id}`} label={noteRequired ? "Reason for no text span" : "Annotation note"}
          data-repair="annotation-note" hint={noteHint} required={noteRequired} value={noteValue ?? ann.note ?? ""} readOnly={readOnly}
          error={noteRequired && !(noteValue ?? ann.note ?? "").trim() ? "A reason is required for a finding without a text span." : undefined}
          onChange={event => onChangeNote?.(event.target.value)} onBlur={onSaveNote} />
      </div>

      {/* 3. Evidence Mentions */}
      <div className="detail-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3>Mentions ({linkedEvidence.length})</h3>
          <Button
            type="button" data-repair="add-mention"
            variant="secondary" size="sm"
            disabled={readOnly} onClick={() => onSetIntent("new_mention")}
            aria-pressed={isAttachingMention}
            title="Highlight text to add an additional mention for this term"
          >
            {isAttachingMention ? "Select text…" : "+ Add Mention"}
          </Button>
        </div>

        {linkedEvidence.length === 0 ? (
          <div
            style={{
              padding: "10px 12px",
              background: "var(--surface)",
              border: "1px dashed var(--border)",
              borderRadius: "var(--radius)",
              fontSize: "0.85rem",
              color: "var(--text-muted)",
            }}
          >
            <strong>No text span:</strong> This finding currently has no linked text mentions.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {linkedEvidence.map((ev, idx) => {
              const isSelected = ev.mention.evidence_id === selectedEvidenceId;
              const segments = ev.mention.segments ?? [];
              const ranges = segments.map((s) => `[${s.start}:${s.end}]`).join(", ");
              const snippet = quoteSegments(documentText, segments);

              return (
                <div
                  key={ev.mention.evidence_id}
                  style={{
                    padding: "8px 10px",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    background: isSelected ? "var(--accent-light)" : "var(--surface-raised)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{ cursor: "pointer", flex: 1 }}
                    onClick={() => onSelectEvidence(ev.mention.evidence_id)}
                  >
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      Mention #{idx + 1}
                    </div>
                    <div
                      className="mention-snippet"
                      title={`Offsets: ${ranges}`}
                      style={{ fontSize: "0.85rem", fontWeight: 600 }}
                    >
                      {snippet ? `“${snippet}”` : `Offsets: ${ranges}`}
                    </div>
                  </div>
                  {confirmDetachId === ev.mention.evidence_id ? (
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }} role="group" aria-label="Confirm mention removal">
                      <span style={{ fontSize: "0.75rem" }}>Remove?</span>
                      <Button
                        type="button"
                        variant="danger" size="sm"
                        disabled={readOnly} onClick={() => { if (readOnly) return; setConfirmDetachId(null); onDetachMention(ev.mention.evidence_id); }}
                      >
                        Yes, remove
                      </Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmDetachId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                  <div style={{ display: "flex", gap: 4 }}>
                    <Button
                      type="button"
                      variant="secondary" size="sm"
                      disabled={readOnly} onClick={() => {
                        if (readOnly) return;
                        onSelectEvidence(ev.mention.evidence_id);
                        onSetIntent("extend_mention");
                      }}
                      title="Add another text segment to this mention"
                    >
                      + Segment
                    </Button>
                    <Button
                      type="button"
                      variant="danger" size="sm"
                      disabled={readOnly || (linkedEvidence.length === 1 && !!detachLastBlockedReason)} onClick={() => setConfirmDetachId(ev.mention.evidence_id)}
                      title="Detach mention from this annotation"
                    >
                      Remove
                    </Button>
                  </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {detachLastBlockedReason && <p className="field-hint">{detachLastBlockedReason}</p>}

      {/* 4. Delete Annotation */}
      <div className="detail-section" style={{ marginTop: "auto" }}>
        {confirmDelete ? (
          <div role="group" aria-label="Confirm deletion" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: "0.85rem" }}>{deleteConfirmMessage}</span>
            <div style={{ display: "flex", gap: 6 }}>
              <Button
                type="button"
                variant="danger"
                style={{ flex: 1 }}
                disabled={readOnly} onClick={() => { if (readOnly) return; setConfirmDelete(false); onDeleteAnnotation(ann.annotation_id); }}
              >
                Yes, delete
              </Button>
              <Button type="button" variant="secondary" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="danger"
            style={{ width: "100%" }}
            disabled={readOnly} onClick={() => setConfirmDelete(true)}
          >
            <IconTrash />
            Delete Annotation
          </Button>
        )}
      </div>
    </div>
  );
};
