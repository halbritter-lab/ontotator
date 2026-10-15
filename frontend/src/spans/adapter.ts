/**
 * Adapter integrating SpanEditor DOM component with Unicode codepoint domain evidence model.
 */

import { SpanEditor } from "../vendor/spans.js";
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
  label?: string;
  segments: CodepointSegment[];
  is_suggestion?: boolean;
  kind?: "own" | "target" | "source";
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
export type ResizeCallback = (evidenceId: string, segments: CodepointSegment[]) => void;

export interface SpanEditorHandle {
  setMentions: (mentions: MentionDisplay[]) => void;
  setSelected: (evidenceId: string | null) => void;
  setSelectionIntent: (
    intent: "new_mention" | "extend_mention",
    evidenceId?: string,
  ) => void;
  /** Evidence ids whose segments get drag handles. */
  setResizable: (evidenceIds: string[]) => void;
  destroy: () => void;
}

interface VendorSpan {
  char_start: number;
  char_end: number;
}

interface VendorMention {
  mention_id: string;
  spans: VendorSpan[];
  kind?: "own" | "target" | "source";
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
        onPick(mentionIds[0]);
      }
    },
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
    setResizable: (evidenceIds: string[]) => {
      editor.setResizable(evidenceIds);
    },
    destroy: () => {
      editor.destroy();
    },
  };
}
