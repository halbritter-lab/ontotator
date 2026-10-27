import { useState } from "react";
import type { AddModifierPayload, ConvertToModifierPayload, Draft, RemoveModifierPayload, SetModifierSegmentsPayload } from "../api/client";
import { useToast } from "../ui/Toast";
import type { Seg } from "./modifiers";

type ModifierPayload = AddModifierPayload | SetModifierSegmentsPayload | RemoveModifierPayload | ConvertToModifierPayload;

export interface ModifierCommandDeps {
  /** One draft mutation through the editor's queue, with the review-decision sync of the finding. */
  mutate: (annotationId: string, payload: ModifierPayload) => Promise<Draft>;
  /** Current segments of a finding's modifier (undefined when absent). */
  segmentsOf: (annotationId: string, termId: string) => readonly Seg[] | undefined;
  reportError: (error: unknown) => void;
}

/** "Link a text span" waits for the next text selection for this modifier. */
export interface LinkSpanMode { annotationId: string; termId: string; term: string; finding: string }

/** The modifier commands of the editor (C3), the Undo toast of a removal and the link-a-span mode. */
export function useModifierCommands({ mutate, segmentsOf, reportError }: ModifierCommandDeps) {
  const { toast, show, dismiss } = useToast();
  const [linkSpan, setLinkSpan] = useState<LinkSpanMode | null>(null);
  const run = (annotationId: string, payload: ModifierPayload) =>
    mutate(annotationId, payload).catch(error => { reportError(error); throw error; });
  const add = (annotationId: string, termId: string, segments?: readonly Seg[]) =>
    run(annotationId, { command: "add_modifier", annotation_id: annotationId, term_id: termId, ...(segments?.length ? { segments: [...segments] } : {}) });
  const setSegments = (annotationId: string, termId: string, segments: readonly Seg[]) =>
    run(annotationId, { command: "set_modifier_segments", annotation_id: annotationId, term_id: termId, segments: [...segments] });
  const remove = async (annotationId: string, termId: string, term: string, finding: string) => {
    const old = segmentsOf(annotationId, termId) ?? [];
    await run(annotationId, { command: "remove_modifier", annotation_id: annotationId, term_id: termId });
    show({ message: `Removed ${term} from ${finding}`, actionLabel: "Undo", undo: true,
      onAction: () => { void add(annotationId, termId, old).catch(() => undefined); } });
  };
  const removeSpan = async (annotationId: string, termId: string, term: string) => {
    const old = segmentsOf(annotationId, termId) ?? [];
    await setSegments(annotationId, termId, []);
    show({ message: `Removed the text span of ${term}`, actionLabel: "Undo", undo: true,
      onAction: () => { void setSegments(annotationId, termId, old).catch(() => undefined); } });
  };
  /** R3: the standalone modifier finding `sourceId` becomes a modifier of `targetId` (one mutation, keyed on the target). */
  const convert = (sourceId: string, targetId: string, linkSpan: boolean) =>
    run(targetId, { command: "convert_to_modifier", annotation_id: sourceId, target_annotation_id: targetId, link_span: linkSpan });
  return { add, setSegments, remove, removeSpan, convert, toast, dismissToast: dismiss, linkSpan, setLinkSpan };
}
