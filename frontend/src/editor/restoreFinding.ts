import type { AnnotationSnapshot, Draft, Modifier } from "../api/client";
import { carriedChosenAxisIds } from "./carried/checkState";

/**
 * Undo of "Delete finding" (#150): everything needed to put a deleted finding back with the existing draft
 * commands, captured before the delete. The finding keeps its ID, mentions (IDs and segments), term, values
 * (chosen stay chosen, defaults stay defaults), note and modifiers; review decisions that named it as their
 * replacement are recorded again.
 */
export interface DeletedFinding {
  snapshot: AnnotationSnapshot;
  /** Segments per mention, in the finding's mention order. */
  mentions: { evidenceId: string; segments: { start: number; end: number }[] }[];
  /** Decisions the delete removed (the server drops decisions whose replacement is the finding). */
  decisions: NonNullable<Draft["decisions"]>;
}

type Decision = NonNullable<Draft["decisions"]>[number];

export function captureDeletedFinding(draft: Draft, annotationId: string): DeletedFinding | null {
  const snapshot = (draft.annotations ?? []).find(item => item.annotation.annotation_id === annotationId);
  if (!snapshot) return null;
  const mentions = (snapshot.annotation.evidence_refs ?? []).map(ref => {
    const evidence = (draft.evidence ?? []).find(item => item.mention.evidence_id === ref.evidence_id)
      ?? snapshot.evidence?.find(item => item.mention.evidence_id === ref.evidence_id);
    return { evidenceId: ref.evidence_id, segments: (evidence?.mention.segments ?? []).map(({ start, end }) => ({ start, end })) };
  });
  const decisions = (draft.decisions ?? []).filter((decision: Decision) => decision.replacement?.annotation_id === annotationId);
  return { snapshot: structuredClone(snapshot), mentions, decisions: structuredClone(decisions) };
}

/**
 * Whether the existing commands can put the finding back as it was. Not offered for a consolidation's
 * decisions (they carry a resolution mark no command can restore) or a mention whose text is unknown.
 */
export function canRestore(deleted: DeletedFinding): boolean {
  return deleted.decisions.every(decision => !decision.consolidation)
    && deleted.mentions.every(mention => mention.segments.length > 0);
}

/**
 * The create_annotation and attach_mention payloads that bring the finding back. `adoptable` says whether a
 * provenance source ref ("{annotation id}:{version}") names a proposal the server can adopt from again (an
 * Edit & Replace copy); other refs, such as a carried finding's round input, cannot be given to create_annotation.
 */
export function restoreCommands(
  deleted: DeletedFinding,
  axisIds: readonly string[],
  adoptable: (annotationId: string, version: string) => boolean,
): Record<string, unknown>[] {
  const ann = deleted.snapshot.annotation;
  const [first, ...rest] = deleted.mentions;
  const source = (ann.provenance.source_refs ?? []).map(ref => {
    const at = ref.lastIndexOf(":");
    return at > 0 ? { id: ref.slice(0, at), version: ref.slice(at + 1) } : null;
  }).find(ref => ref !== null && adoptable(ref.id, ref.version));
  const actor = ann.provenance.actor;
  const create: Record<string, unknown> = {
    command: "create_annotation",
    annotation_id: ann.annotation_id,
    layer_id: ann.layer_id,
    type_id: ann.type_id,
    term_id: ann.term_id,
    axes_values: { ...(ann.axes_values ?? {}) },
    chosen_axis_ids: carriedChosenAxisIds(ann, axisIds),
    segments: first?.segments ?? [],
    ...(first ? { evidence_id: first.evidenceId } : {}),
    ...(ann.note?.trim() ? { note: ann.note } : {}),
    ...(ann.provenance.method ? { method: ann.provenance.method } : {}),
    // A person's finding is the workspace annotator's; only a tool's finding names its actor.
    ...(actor.kind !== "human" ? { actor_kind: actor.kind, actor_id: actor.actor_id } : {}),
    ...(source ? { source_annotation_id: source.id, source_version: source.version } : {}),
  };
  const attach = rest.map(mention => ({
    command: "attach_mention", annotation_id: ann.annotation_id, evidence_id: mention.evidenceId, segments: mention.segments,
  }));
  return [create, ...attach];
}

const segmentsKey = (modifier: Pick<Modifier, "segments"> | undefined) =>
  JSON.stringify((modifier?.segments ?? []).map(({ start, end }) => [start, end]));

/**
 * Modifier commands that turn `current` (after create_annotation; an adopted copy starts with the proposal's
 * modifiers) into the deleted finding's modifiers.
 */
export function modifierRestoreCommands(annotationId: string, wanted: readonly Modifier[], current: readonly Modifier[]): Record<string, unknown>[] {
  const commands: Record<string, unknown>[] = [];
  for (const modifier of current) {
    if (!wanted.some(item => item.term_id === modifier.term_id)) {
      commands.push({ command: "remove_modifier", annotation_id: annotationId, term_id: modifier.term_id });
    }
  }
  for (const modifier of wanted) {
    const segments = (modifier.segments ?? []).map(({ start, end }) => ({ start, end }));
    const existing = current.find(item => item.term_id === modifier.term_id);
    if (!existing) {
      commands.push({ command: "add_modifier", annotation_id: annotationId, term_id: modifier.term_id, ...(segments.length ? { segments } : {}) });
    } else if (segmentsKey(existing) !== segmentsKey(modifier)) {
      commands.push({ command: "set_modifier_segments", annotation_id: annotationId, term_id: modifier.term_id, segments });
    }
  }
  return commands;
}
