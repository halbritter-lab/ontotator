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

export function termColorIndex(termId: string): number {
  if (!termId) return 0;
  let hash = 0;
  for (let i = 0; i < termId.length; i++) {
    hash = (hash << 5) - hash + termId.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 6;
}

export interface MentionDisplay {
  evidence_id: string;
  label?: string;
  segments: CodepointSegment[];
  is_suggestion?: boolean;
  kind?: "own" | "target" | "source";
  colorIndex?: number;
}

export interface SelectionPayload {
  segments: CodepointSegment[];
  intent: "new_mention" | "extend_mention";
  evidenceId?: string;
}

export type SelectionCallback = (payload: SelectionPayload) => void;
export type PickCallback = (evidenceId: string) => void;

export interface SpanEditorHandle {
  setMentions: (mentions: MentionDisplay[]) => void;
  setSelected: (evidenceId: string | null) => void;
  setSelectionIntent: (
    intent: "new_mention" | "extend_mention",
    evidenceId?: string,
  ) => void;
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
}

function mentionsToVendor(
  mentions: MentionDisplay[],
  text: string,
): VendorMention[] {
  const result: VendorMention[] = [];
  for (const mention of mentions) {
    const spans: VendorSpan[] = [];
    for (const seg of mention.segments) {
      validateCodepointRange(text, seg.start, seg.end);
      spans.push({
        char_start: toUtf16(text, seg.start),
        char_end: toUtf16(text, seg.end),
      });
    }
    result.push({
      mention_id: mention.evidence_id,
      spans,
      kind: mention.kind,
      colorIndex: mention.colorIndex,
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
): SpanEditorHandle {
  let currentIntent: "new_mention" | "extend_mention" = "new_mention";
  let currentEvidenceId: string | undefined = undefined;

  // Validate initial mentions
  const initialVendorMentions = mentionsToVendor(mentions, text);

  // Vendor SpanEditor instance
  const editor = new SpanEditor(container, {
    onPaint: (spans: Array<{ start: number; end: number }>) => {
      const segments: CodepointSegment[] = [];
      for (const span of spans) {
        segments.push({
          start: toCodepoint(text, span.start),
          end: toCodepoint(text, span.end),
        });
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
  });

  editor.setBlock(text);
  editor.setMentions(initialVendorMentions);

  return {
    setMentions: (updatedMentions: MentionDisplay[]) => {
      const vendorMentions = mentionsToVendor(updatedMentions, text);
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
    destroy: () => {
      editor.destroy();
    },
  };
}
