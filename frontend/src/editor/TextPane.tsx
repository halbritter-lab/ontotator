import React, { useEffect, useRef } from "react";
import {
  mountSpanEditor,
  type MentionDisplay,
  type SelectionPayload,
  type SpanEditorHandle,
} from "../spans/adapter";

export interface TextPaneProps {
  text: string;
  mentions: MentionDisplay[];
  selectedEvidenceId: string | null;
  selectionIntent: "new_mention" | "extend_mention";
  onSelection: (payload: SelectionPayload) => void;
  onPick: (evidenceId: string) => void;
  onChangeIntent: (intent: "new_mention" | "extend_mention") => void;
}

export const TextPane: React.FC<TextPaneProps> = ({
  text,
  mentions,
  selectedEvidenceId,
  selectionIntent,
  onSelection,
  onPick,
  onChangeIntent,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<SpanEditorHandle | null>(null);

  const callbacks = useRef({ onSelection, onPick });
  callbacks.current = { onSelection, onPick };

  // Mount span editor once or when text changes
  useEffect(() => {
    if (!containerRef.current) return;

    const handle = mountSpanEditor(
      containerRef.current,
      text,
      mentions,
      (payload) => callbacks.current.onSelection(payload),
      (evidenceId) => callbacks.current.onPick(evidenceId)
    );
    handleRef.current = handle;

    return () => {
      handle.destroy();
      handleRef.current = null;
    };
  }, [text]);

  // Sync mentions
  useEffect(() => {
    if (handleRef.current) {
      handleRef.current.setMentions(mentions);
    }
  }, [mentions]);

  // Sync selected evidence
  useEffect(() => {
    if (handleRef.current) {
      handleRef.current.setSelected(selectedEvidenceId);
    }
  }, [selectedEvidenceId]);

  // Sync selection intent
  useEffect(() => {
    if (handleRef.current) {
      handleRef.current.setSelectionIntent(
        selectionIntent,
        selectedEvidenceId ?? undefined
      );
    }
  }, [selectionIntent, selectedEvidenceId]);

  return (
    <div className="center-pane">
      <div className="pane-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-muted)" }}>
            Selection intent:
          </span>
          <span
            className="badge"
            style={{
              backgroundColor:
                selectionIntent === "extend_mention" ? "var(--warning-light)" : "var(--primary-light)",
              color:
                selectionIntent === "extend_mention" ? "var(--warning)" : "var(--primary)",
            }}
          >
            {selectionIntent === "extend_mention"
              ? "Additional segment (discontinuous mention)"
              : "New mention"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {selectedEvidenceId && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                onChangeIntent(
                  selectionIntent === "new_mention" ? "extend_mention" : "new_mention"
                )
              }
            >
              {selectionIntent === "new_mention"
                ? "Switch to »Additional segment«"
                : "Switch to »New mention«"}
            </button>
          )}
        </div>
      </div>
      <div ref={containerRef} className="text-container" tabIndex={0} />
    </div>
  );
};
