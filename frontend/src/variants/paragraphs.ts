/** Paragraph boundaries use the editor's Unicode codepoint offsets, never UTF-16 indices. */
export function paragraphStarts(text: string): number[] {
  const points = Array.from(text);
  const starts = [0];
  let hasBlankSeparator = false;

  for (let i = 0; i < points.length; i++) {
    if (points[i] !== "\n") continue;
    let end = i + 1;
    while (points[end] === " " || points[end] === "\t") end++;
    if (points[end] !== "\n") continue;
    hasBlankSeparator = true;
    end++;

    // Consume the entire blank-line run, preserving indentation of the next line.
    while (end < points.length) {
      let next = end;
      while (points[next] === " " || points[next] === "\t") next++;
      if (points[next] !== "\n") break;
      end = next + 1;
    }
    if (end < points.length) starts.push(end);
    i = end - 1;
  }

  // Even an EOF separator selects paragraph mode; it must not trigger line fallback.
  if (hasBlankSeparator) return starts;
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** Index of the last paragraph start at or before offset, clamped to first/last. */
export function paragraphAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** The paragraph holding a caret (code-point offset) and the caret's share of it, up to the next paragraph start. */
export function caretInParagraph(text: string, offset: number): { paragraph: number; fraction: number } {
  const starts = paragraphStarts(text);
  const paragraph = paragraphAt(starts, offset);
  const start = starts[paragraph], end = starts[paragraph + 1] ?? Array.from(text).length;
  return { paragraph, fraction: end > start ? Math.min(1, Math.max(0, (offset - start) / (end - start))) : 0 };
}
