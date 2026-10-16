import { diffWordsWithSpace } from "diff";

export interface TextDiffPart {
  op: "equal" | "insert" | "delete";
  text: string;
}

/** Word diff over exact raw text; display rules and normalization live elsewhere. */
export function diffText(before: string, after: string): TextDiffPart[] {
  if (before === after) return [{ op: "equal", text: before }];
  const parts: TextDiffPart[] = [];
  for (const change of diffWordsWithSpace(before, after)) {
    if (change.value.length === 0) continue;
    const op = change.added ? "insert" : change.removed ? "delete" : "equal";
    const previous = parts[parts.length - 1];
    if (previous?.op === op) previous.text += change.value;
    else parts.push({ op, text: change.value });
  }
  return parts;
}
