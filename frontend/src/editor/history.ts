import type { HistoryStepView } from "../api/client";

/**
 * Issue 320: the editor's name for one undo or redo step ("delete finding Seizure"), shown as
 * "Undo: delete finding Seizure" in the tooltip of the Undo button. `term` gives a finding's term name.
 */
export function stepText(step: HistoryStepView, term: (layerId: string, termId: string) => string | undefined): string {
  const name = step.term_id ? (step.layer_id ? term(step.layer_id, step.term_id) : undefined) ?? step.term_id : undefined;
  const of = name ? ` of ${name}` : "";
  const finding = name ? `finding ${name}` : "a finding";
  const proposal = name ? `proposal ${name}` : "a proposal";
  const carried = name ? `carried finding ${name}` : "a carried finding";
  switch (step.action) {
    // "copy": Edit & Replace made an editable copy of a proposal.
    case "create_annotation": return step.outcome === "copy" ? `edit and replace ${proposal}` : `add ${finding}`;
    case "recreate_reanchor": return `re-create ${finding}`;
    case "delete_draft_annotation": return `delete ${finding}`;
    case "set_term": return name ? `change the term to ${name}` : "change a term";
    case "set_axes": return `change the values${of}`;
    case "set_annotation_note": return `edit the note${of}`;
    case "attach_mention": return `add a text span${name ? ` to ${name}` : ""}`;
    case "edit_mention": return `change the text span${of}`;
    case "detach_mention": return `remove a text span${name ? ` from ${name}` : ""}`;
    case "add_modifier": return `add a modifier${name ? ` to ${name}` : ""}`;
    case "remove_modifier": return `remove a modifier${name ? ` from ${name}` : ""}`;
    case "set_modifier_segments": return `change a modifier span${of}`;
    case "convert_to_modifier": return name ? `make ${name} a modifier` : "make a finding a modifier";
    case "check_layer": return step.outcome === "unchecked" ? "mark a layer as not checked" : "mark a layer as checked";
    case "decision":
      switch (step.outcome) {
        case "confirmed": return `confirm ${proposal}`;
        case "rejected": return `reject ${proposal}`;
        case "uncertain": return `mark ${proposal} as unresolved`;
        case "changed": return `edit and replace ${proposal}`;
        default: return `reset the decision on ${proposal}`;
      }
    // Named after the buttons (Confirm, Unresolved, Edit & Replace, Mark as checked, Undo dismissal).
    // The server tells a check ("checked", also an older "completed") from a link to another finding ("linked").
    case "resolve_round_input": return step.outcome === "dismissed" ? `dismiss ${carried}` : step.outcome === "linked" ? `link ${carried}` : `mark ${carried} as checked`;
    case "clear_round_input_resolution": return `undo the dismissal of ${carried}`;
    case "resolve_reanchor": return `resolve moved ${finding}`;
    case "reset_changes": return "reset all my changes";
    default: return "the last change";
  }
}
