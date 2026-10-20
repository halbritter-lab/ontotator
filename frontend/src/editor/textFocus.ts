/** Focus the clinical text and put the caret at a codepoint offset, without scrolling. */

/** Focus `.text-container` inside root without scrolling and place a collapsed caret at a codepoint offset of the
 *  document text (counted over the text nodes of `.run` elements). Returns false when the container is missing. */
export function focusTextAt(root: ParentNode | null, documentText: string, codepoint: number): boolean {
  const container = root?.querySelector<HTMLElement>(".text-container");
  if (!container) return false;
  container.focus({ preventScroll: true });
  const chars = Array.from(documentText);
  const target = chars.slice(0, Math.max(0, Math.min(codepoint, chars.length))).join("").length;
  const selection = typeof window !== "undefined" ? window.getSelection() : null;
  if (!selection) return true;
  let consumed = 0;
  for (const run of Array.from(container.querySelectorAll<HTMLElement>(".run"))) {
    for (const node of Array.from(run.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const length = node.textContent?.length ?? 0;
      if (target <= consumed + length) {
        selection.collapse(node, target - consumed);
        return true;
      }
      consumed += length;
    }
  }
  selection.collapse(container, container.childNodes.length);
  return true;
}
