/**
 * Shared span editor: paint, render, hover-link and read back character offsets.
 *
 * Adapted from hpo-span-annotator / opti-data annot_gold.
 */

import { resizeSegment, stepOffset, wordBoundary } from "../spans/resize";

/** Delay before a keyboard resize is reported, so several steps become one edit. */
const KEY_RESIZE_COMMIT_MS = 400;

const NBSP = " ";

/**
 * Sort and merge a mention's own spans so it never double-counts a character.
 */
export function normaliseSpans(spans) {
  const sorted = (spans || [])
    .map((s) => ({ start: s.char_start | 0, end: s.char_end | 0 }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * Cut `text` at every span boundary and tag each piece with its mentions.
 */
export function decomposeRuns(textLength, mentions, extraCuts = []) {
  const cuts = new Set([0, textLength]);
  for (const cut of extraCuts) {
    if (cut > 0 && cut < textLength) cuts.add(cut);
  }
  const owned = new Map();
  for (const mention of mentions || []) {
    const spans = normaliseSpans(mention.spans || []);
    owned.set(mention.mention_id, spans);
    for (const span of spans) {
      if (span.start > 0 && span.start < textLength) cuts.add(span.start);
      if (span.end > 0 && span.end < textLength) cuts.add(span.end);
    }
  }
  const edges = [...cuts].sort((a, b) => a - b);
  const runs = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const start = edges[i];
    const end = edges[i + 1];
    const ids = [];
    for (const [id, spans] of owned) {
      if (spans.some((s) => s.start < end && start < s.end)) ids.push(id);
    }
    runs.push({ start, end, mentionIds: ids });
  }
  return runs;
}

/** Trim a raw drag-selection down to its visible characters. */
export function trimToVisible(text, start, end) {
  let a = Math.max(0, Math.min(start, end));
  let b = Math.min(text.length, Math.max(start, end));
  while (a < b && !text[a].trim()) a += 1;
  while (b > a && !text[b - 1].trim()) b -= 1;
  return b > a ? { start: a, end: b } : null;
}

export class SpanEditor {
  constructor(container, handlers = {}) {
    this.container = container;
    this.handlers = handlers;
    this.text = "";
    this.mentions = [];
    this.suggestions = [];
    this.markers = [];
    this.activeIds = new Set();
    this.readOnly = false;
    this.resizableIds = new Set();
    this._pendingKeyResize = null;
    this._keyResizeTimer = null;
    this._onFocusOutBound = (e) => this._onFocusOut(e);
    container.addEventListener("focusout", this._onFocusOutBound);

    this._onMouseUpBound = (e) => this._onMouseUp(e);
    this._onMouseOverBound = (e) => this._onHover(e, true);
    this._onMouseOutBound = (e) => this._onHover(e, false);
    this._onClickBound = (e) => this._onClick(e);
    this._keySelecting = false;
    this._onKeyDownBound = (e) => this._onKeyDown(e);
    this._onKeyUpBound = (e) => this._onKeyUp(e);

    container.addEventListener("mouseup", this._onMouseUpBound);
    container.addEventListener("keydown", this._onKeyDownBound);
    container.addEventListener("keyup", this._onKeyUpBound);
    container.addEventListener("mouseover", this._onMouseOverBound);
    container.addEventListener("mouseout", this._onMouseOutBound);
    container.addEventListener("click", this._onClickBound);
  }

  destroy() {
    this.container.removeEventListener("mouseup", this._onMouseUpBound);
    this.container.removeEventListener("keydown", this._onKeyDownBound);
    this.container.removeEventListener("keyup", this._onKeyUpBound);
    this.container.removeEventListener("mouseover", this._onMouseOverBound);
    this.container.removeEventListener("mouseout", this._onMouseOutBound);
    this.container.removeEventListener("click", this._onClickBound);
    this.container.removeEventListener("focusout", this._onFocusOutBound);
    clearTimeout(this._keyResizeTimer);
  }

  setReadOnly(readOnly) {
    this.readOnly = Boolean(readOnly);
    this.container.classList.toggle("readonly", this.readOnly);
  }

  setBlock(text) {
    this.text = text ?? "";
    this.render();
  }

  setMentions(mentions) {
    clearTimeout(this._keyResizeTimer);
    this._keyResizeTimer = null;
    this._pendingKeyResize = null;
    this.mentions = mentions || [];
    this.render();
  }

  setSuggestions(suggestions) {
    this.suggestions = suggestions || [];
    this.render();
  }

  setMarkers(markers) {
    this.markers = markers || [];
    this.render();
  }

  /** Mentions whose segments get draggable start/end handles. */
  setResizable(mentionIds) {
    this.resizableIds = new Set(mentionIds || []);
    this.render();
  }

  _handlesByOffset() {
    const starts = new Map();
    const ends = new Map();
    for (const mention of this.mentions) {
      if (!this.resizableIds.has(mention.mention_id)) continue;
      normaliseSpans(mention.spans || []).forEach((span, index) => {
        const base = { mentionId: mention.mention_id, index };
        starts.set(span.start, [...(starts.get(span.start) || []), { ...base, edge: "start", offset: span.start }]);
        ends.set(span.end, [...(ends.get(span.end) || []), { ...base, edge: "end", offset: span.end }]);
      });
    }
    return { starts, ends };
  }

  _handleNode(handle) {
    const node = document.createElement("span");
    node.className = `resize-handle resize-handle--${handle.edge}`;
    node.dataset.mention = handle.mentionId;
    node.dataset.segment = String(handle.index);
    node.dataset.edge = handle.edge;
    node.dataset.offset = String(handle.offset);
    node.tabIndex = 0;
    node.setAttribute("role", "separator");
    node.setAttribute("aria-label", handle.edge === "start" ? "Start of mention" : "End of mention");
    return node;
  }

  _spansOf(mentionId) {
    const mention = this.mentions.find((m) => m.mention_id === mentionId);
    return mention ? normaliseSpans(mention.spans || []) : null;
  }

  /** Replace a mention's spans in the editor's own copy and redraw. */
  _applySpans(mentionId, spans) {
    this.mentions = this.mentions.map((m) => (m.mention_id === mentionId
      ? { ...m, spans: spans.map((s) => ({ char_start: s.start, char_end: s.end })) }
      : m));
    this.render();
  }

  _findHandle(mentionId, edge, offset) {
    return Array.from(this.container.querySelectorAll(".resize-handle")).find((node) =>
      node.dataset.mention === mentionId && node.dataset.edge === edge && Number(node.dataset.offset) === offset);
  }

  _flushKeyResize() {
    clearTimeout(this._keyResizeTimer);
    this._keyResizeTimer = null;
    const pending = this._pendingKeyResize;
    this._pendingKeyResize = null;
    if (pending) this.handlers.onResize?.(pending.mentionId, pending.spans);
  }

  _onHandleKey(event, handle) {
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const mentionId = handle.dataset.mention;
    const edge = handle.dataset.edge;
    const index = Number(handle.dataset.segment);
    const from = Number(handle.dataset.offset);
    const spans = this._spansOf(mentionId);
    if (!spans) return;
    const to = (event.ctrlKey || event.metaKey)
      ? wordBoundary(this.text, from, direction)
      : stepOffset(this.text, from, direction);
    const next = resizeSegment(this.text, spans, index, edge, to);
    if (!next) return;
    // The moved edge of the (possibly merged) segment that now contains the old one.
    const anchor = edge === "start" ? spans[index].end - 1 : spans[index].start;
    const segment = next.find((s) => s.start <= anchor && anchor < s.end) || next[0];
    this._refocusing = true;
    this._applySpans(mentionId, next);
    this._findHandle(mentionId, edge, edge === "start" ? segment.start : segment.end)?.focus();
    this._refocusing = false;
    this._pendingKeyResize = { mentionId, spans: next };
    clearTimeout(this._keyResizeTimer);
    this._keyResizeTimer = setTimeout(() => this._flushKeyResize(), KEY_RESIZE_COMMIT_MS);
  }

  _onFocusOut(event) {
    if (this._refocusing || !this._pendingKeyResize) return;
    if (event.relatedTarget?.classList?.contains("resize-handle")
      && event.relatedTarget.dataset.mention === this._pendingKeyResize.mentionId) return;
    this._flushKeyResize();
  }

  highlight(mentionIds) {
    this.activeIds = new Set(mentionIds || []);
    for (const node of this.container.querySelectorAll(".run")) {
      const ids = (node.dataset.mentions || "").split(",").filter(Boolean);
      const isHot = ids.some((id) => this.activeIds.has(id));
      node.classList.toggle("run--hot", isHot);
      if (ids.length > 1) {
        const runMentions = ids
          .map((id) => this.mentions.find((m) => m.mention_id === id))
          .filter(Boolean);
        const activeMention = runMentions.find((m) => this.activeIds.has(m.mention_id));
        const primary = activeMention || runMentions[0];
        for (let i = 0; i < 6; i += 1) node.classList.remove(`run--color-${i}`);
        if (primary && typeof primary.colorIndex === "number") {
          node.classList.add(`run--color-${primary.colorIndex}`);
        }
      }
    }
  }

  render() {
    const marks = normaliseSpans(this.markers);
    const runs = decomposeRuns(
      this.text.length,
      this.mentions,
      marks.flatMap((m) => [m.start, m.end]),
    );
    const tints = normaliseSpans(this.suggestions);
    const fragment = document.createDocumentFragment();

    const { starts, ends } = this._handlesByOffset();
    for (const run of runs) {
      const node = document.createElement("span");
      node.className = "run";
      node.dataset.start = String(run.start);
      node.dataset.mentions = run.mentionIds.join(",");
      if (run.mentionIds.length === 1) node.classList.add("run--marked");
      if (run.mentionIds.length > 1) node.classList.add("run--marked", "run--multi");
      if (tints.some((t) => t.start < run.end && run.start < t.end)) {
        node.classList.add("run--suggested");
      }
      if (marks.some((m) => m.start < run.end && run.start < m.end)) {
        node.classList.add("run--marker");
      }
      if (run.mentionIds.some((id) => this.activeIds.has(id))) {
        node.classList.add("run--hot");
      }

      if (run.mentionIds.length > 0) {
        const runMentions = run.mentionIds
          .map((id) => this.mentions.find((m) => m.mention_id === id))
          .filter(Boolean);
        for (const m of runMentions) {
          if (m.kind) node.classList.add(`run--${m.kind}`);
        }
        const activeMention = runMentions.find((m) => this.activeIds.has(m.mention_id));
        const primaryMention = activeMention || runMentions[0];
        if (primaryMention && typeof primaryMention.colorIndex === "number") {
          node.classList.add(`run--color-${primaryMention.colorIndex}`);
        }
      }

      node.appendChild(document.createTextNode(this.text.slice(run.start, run.end)));
      for (const handle of starts.get(run.start) || []) fragment.appendChild(this._handleNode(handle));
      fragment.appendChild(node);
      for (const handle of ends.get(run.end) || []) fragment.appendChild(this._handleNode(handle));
    }
    this.container.replaceChildren(fragment);
    if (!this.text) {
      this.container.appendChild(document.createTextNode(NBSP));
    }
  }

  _offsetOf(node, offset) {
    let element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (element?.classList?.contains("resize-handle")) return Number(element.dataset.offset);
    while (element && element !== this.container && !element.classList?.contains("run")) {
      element = element.parentElement;
    }
    if (!element || element === this.container) return null;
    return Number(element.dataset.start) + offset;
  }

  _onMouseUp(event) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    if (this.readOnly) {
      if (!this.container.contains(selection.anchorNode)) return;
      this.handlers.onPaintBlocked?.();
      return;
    }

    const spans = [];
    for (let i = 0; i < selection.rangeCount; i += 1) {
      const range = selection.getRangeAt(i);
      if (!this.container.contains(range.commonAncestorContainer)) continue;
      const from = this._offsetOf(range.startContainer, range.startOffset);
      const to = this._offsetOf(range.endContainer, range.endOffset);
      if (from === null || to === null) continue;
      const span = trimToVisible(this.text, from, to);
      if (span) spans.push(span);
    }
    selection.removeAllRanges();
    if (!spans.length || !this.handlers.onPaint) return;
    this.handlers.onPaint(spans, {
      additive: Boolean(event?.metaKey || event?.ctrlKey),
    });
  }

  // Keyboard selection (Shift + arrows/Home/End, or caret browsing): commit the
  // selection when Shift is released or Enter is pressed.
  _onKeyDown(event) {
    const handle = event.target?.closest?.(".resize-handle");
    if (handle && (event.key === "ArrowLeft" || event.key === "ArrowRight")
      && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this._onHandleKey(event, handle);
      return;
    }
    if (event.shiftKey && /^(Arrow|Home$|End$|PageUp$|PageDown$)/.test(event.key)) {
      this._keySelecting = true;
    }
  }

  _onKeyUp(event) {
    if (!(event.key === "Shift" || event.key === "Enter")) return;
    if (event.key === "Shift" && !this._keySelecting) return;
    this._keySelecting = false;
    this._onMouseUp(event);
  }

  _runIds(target) {
    const run = target?.closest?.(".run");
    if (!run) return null;
    return (run.dataset.mentions || "").split(",").filter(Boolean);
  }

  _onHover(event, entering) {
    if (!this.handlers.onHoverMentions) return;
    const ids = this._runIds(event.target);
    if (ids === null) return;
    this.handlers.onHoverMentions(entering ? ids : []);
  }

  _onClick(event) {
    if (!window.getSelection()?.isCollapsed) return;
    const ids = this._runIds(event.target);
    if (ids && ids.length && this.handlers.onPick) {
      this.handlers.onPick(ids, event.target);
    }
  }
}
