/**
 * Adapter integrating SpanEditor DOM component with Unicode codepoint domain evidence model.
 */

import { SpanEditor } from "../vendor/spans.js";
import { parseModifierDisplayId } from "../editor/modifiers";
import {
  toCodepoint,
  toUtf16,
  validateCodepointRange,
} from "./offsets";

export interface CodepointSegment {
  start: number;
  end: number;
}

export interface MentionDisplay {
  evidence_id: string;
  sourceId?: string;
  /** Run title and accessible description, e.g. "Severe, modifier of Seizure". */
  label?: string;
  segments: CodepointSegment[];
  is_suggestion?: boolean;
  kind?: "own" | "target" | "source" | "context" | "modifier";
  colorIndex?: number;
  /** The annotation's assertion is "absent": its runs get a hatch. */
  negated?: boolean;
}

export interface SelectionPayload {
  segments: CodepointSegment[];
  intent: "new_mention" | "extend_mention";
  evidenceId?: string;
}

export type SelectionCallback = (payload: SelectionPayload) => void;
export type PickCallback = (evidenceId: string) => void;
export type HoverCallback = (evidenceIds: string[]) => void; // [] when the pointer leaves a run
export type ResizeCallback = (evidenceId: string, segments: CodepointSegment[]) => void;

export interface SpanEditorHandle {
  setMentions: (mentions: MentionDisplay[]) => void;
  setSelected: (evidenceId: string | null) => void;
  setSelectionIntent: (
    intent: "new_mention" | "extend_mention",
    evidenceId?: string,
  ) => void;
  /** Evidence ids whose segments get drag handles; `labels` optionally names an id's handles. */
  setResizable: (
    evidenceIds: string[],
    labels?: Record<string, { start: string; end: string }>,
  ) => void;
  /** Reports a keyboard resize that still waits for its pause, at once. */
  flushResize: () => void;
  /** Scrolls the first mark of the evidence to the middle of the text (`ifNeeded`: only into view when off-screen); unknown ids do nothing. */
  scrollToEvidence: (evidenceId: string, ifNeeded?: boolean) => void;
  /** Evidence ids whose runs get the `run--framed` frame (hover, focus, selection of a finding). */
  setFramed: (evidenceIds: string[]) => void;
  destroy: () => void;
}

interface VendorSpan {
  char_start: number;
  char_end: number;
}

interface VendorMention {
  mention_id: string;
  spans: VendorSpan[];
  kind?: MentionDisplay["kind"];
  label?: string;
  colorIndex?: number;
  negated?: boolean;
}

/**
 * Converts codepoint mentions to vendor spans. Segments with invalid offsets are
 * skipped (and reported) instead of throwing, so one bad mention cannot blank the screen.
 */
export function mentionsToVendor(
  mentions: MentionDisplay[],
  text: string,
  invalidIds?: string[],
): VendorMention[] {
  const result: VendorMention[] = [];
  for (const mention of mentions) {
    const spans: VendorSpan[] = [];
    let invalid = false;
    for (const seg of mention.segments) {
      try {
        validateCodepointRange(text, seg.start, seg.end);
        spans.push({
          char_start: toUtf16(text, seg.start),
          char_end: toUtf16(text, seg.end),
        });
      } catch {
        invalid = true;
      }
    }
    if (invalid) invalidIds?.push(mention.evidence_id);
    if (spans.length === 0) continue;
    result.push({
      mention_id: mention.evidence_id,
      spans,
      kind: mention.kind,
      label: mention.label,
      colorIndex: mention.colorIndex,
      negated: mention.negated,
    });
  }
  return result;
}

/**
 * Mounts a SpanEditor inside the container and binds it with codepoint-safe handlers.
 */
export function mountSpanEditor(
  container: HTMLElement,
  text: string,
  mentions: MentionDisplay[],
  onSelection: SelectionCallback,
  onPick: PickCallback,
  onInvalidMentions?: (evidenceIds: string[]) => void,
  onResize?: ResizeCallback,
  paragraphStarts: readonly number[] = [],
  onHoverMentions?: HoverCallback,
): SpanEditorHandle {
  const convert = (items: MentionDisplay[]): VendorMention[] => {
    const invalid: string[] = [];
    const converted = mentionsToVendor(items, text, invalid);
    if (invalid.length) console.warn("Skipping mentions with invalid offsets", invalid);
    onInvalidMentions?.(invalid);
    return converted;
  };
  let currentIntent: "new_mention" | "extend_mention" = "new_mention";
  let currentEvidenceId: string | undefined = undefined;

  // Validate initial mentions
  const initialVendorMentions = convert(mentions);

  // Vendor SpanEditor instance
  const editor = new SpanEditor(container, {
    onPaint: (spans: Array<{ start: number; end: number }>) => {
      const segments: CodepointSegment[] = [];
      for (const span of spans) {
        try {
          segments.push({
            start: toCodepoint(text, span.start),
            end: toCodepoint(text, span.end),
          });
        } catch {
          // selection boundary inside a surrogate pair: ignore this span
        }
      }
      if (segments.length > 0) {
        onSelection({
          segments,
          intent: currentIntent,
          evidenceId: currentEvidenceId,
        });
      }
    },
    onPick: (mentionIds: string[]) => {
      if (mentionIds && mentionIds.length > 0) {
        // A finding mark under a modifier segment wins: only a pure modifier run picks the modifier.
        onPick(mentionIds.find((id) => parseModifierDisplayId(id) === null) ?? mentionIds[0]);
      }
    },
    onHoverMentions: (mentionIds: string[]) => onHoverMentions?.(mentionIds),
    onResize: (mentionId: string, spans: Array<{ start: number; end: number }>) => {
      if (!onResize) return;
      try {
        onResize(mentionId, spans.map((span) => ({
          start: toCodepoint(text, span.start),
          end: toCodepoint(text, span.end),
        })));
      } catch {
        // an edge inside a surrogate pair cannot be expressed in codepoints: ignore
      }
    },
  });

  editor.setParagraphStarts(paragraphStarts.map(start => toUtf16(text, start)));
  editor.setBlock(text);
  editor.setMentions(initialVendorMentions);

  return {
    setMentions: (updatedMentions: MentionDisplay[]) => {
      const vendorMentions = convert(updatedMentions);
      editor.setMentions(vendorMentions);
    },
    setSelected: (evidenceId: string | null) => {
      editor.highlight(evidenceId ? [evidenceId] : []);
    },
    setSelectionIntent: (
      intent: "new_mention" | "extend_mention",
      evidenceId?: string,
    ) => {
      currentIntent = intent;
      currentEvidenceId = evidenceId;
    },
    setResizable: (
      evidenceIds: string[],
      labels?: Record<string, { start: string; end: string }>,
    ) => {
      editor.setResizable(evidenceIds, labels);
    },
    flushResize: () => {
      editor.flushResize();
    },
    scrollToEvidence: (evidenceId: string, ifNeeded = false) => {
      // The vendor editor renders one `.run` per text run, listing its mention ids in `data-mentions`.
      const mark = Array.from(container.querySelectorAll<HTMLElement>(".run[data-mentions]"))
        .find((node) => (node.dataset.mentions ?? "").split(",").includes(evidenceId));
      mark?.scrollIntoView?.({ block: ifNeeded ? "nearest" : "center" });
    },
    setFramed: (evidenceIds: string[]) => {
      editor.setFramed(evidenceIds);
    },
    destroy: () => {
      editor.destroy();
    },
  };
}
