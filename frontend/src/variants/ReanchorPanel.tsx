import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type ReanchorItem } from '../api/client';
import { ErrorNotice } from '../admin/ErrorNotice';
import { useTermLabels } from '../editor/useTermLabels';
import { Button } from '../ui';
import { DiffView } from '../translation/DiffView';
import type { TextDiffPart } from '../translation/textDiff';
import { toUtf16 } from '../spans/offsets';
import type { CodepointSegment } from '../spans/adapter';

type Window = ReanchorItem['new_context'];
const length = (text: string) => Array.from(text).length;
const validWindow = (value: Window) => Number.isSafeInteger(value.start) && value.start >= 0 && Number.isSafeInteger(value.end)
  && value.end >= value.start && value.end - value.start === length(value.text);

/** Validate and adapt the literal server windows; never run another diff algorithm. */
export function pendingDiffParts(item: ReanchorItem): TextDiffPart[] | null {
  const old = item.old_context, next = item.new_context;
  if (!validWindow(old) || !validWindow(next)) return null;
  let oldPosition = old.start, newPosition = next.start;
  const parts: TextDiffPart[] = [];
  for (const opcode of item.diff) {
    if (!validWindow({ start: opcode.old_start, end: opcode.old_end, text: opcode.old_text })
      || !validWindow({ start: opcode.new_start, end: opcode.new_end, text: opcode.new_text })
      || opcode.old_start !== oldPosition || opcode.new_start !== newPosition
      || opcode.old_end > old.end || opcode.new_end > next.end) return null;
    if (opcode.op === 'equal') {
      if (opcode.old_text !== opcode.new_text) return null;
      parts.push({ op: 'equal', text: opcode.new_text });
    } else if (opcode.op === 'replace') {
      parts.push({ op: 'delete', text: opcode.old_text }, { op: 'insert', text: opcode.new_text });
    } else if (opcode.op === 'delete') {
      if (opcode.new_text) return null;
      parts.push({ op: 'delete', text: opcode.old_text });
    } else if (opcode.op === 'insert') {
      if (opcode.old_text) return null;
      parts.push({ op: 'insert', text: opcode.new_text });
    } else return null;
    oldPosition = opcode.old_end; newPosition = opcode.new_end;
  }
  return oldPosition === old.end && newPosition === next.end
    && parts.filter(part => part.op !== 'insert').map(part => part.text).join('') === old.text
    && parts.filter(part => part.op !== 'delete').map(part => part.text).join('') === next.text ? parts : null;
}

function oldContext(item: ReanchorItem): ReactNode {
  const context = item.old_context;
  if (!validWindow(context)) return 'Old context is unavailable.';
  const points = Array.from(context.text), cuts = new Set([0, points.length]);
  const windows = item.old_mentions.flatMap(mention => [
    ...mention.segments.map(window => ({ ...window, kind: 'mention' })),
    ...mention.cue_segments.map(window => ({ ...window, kind: 'cue' })),
  ]);
  for (const window of windows) {
    if (!validWindow(window)) return 'Old context is unavailable.';
    const start = Math.max(context.start, window.start), end = Math.min(context.end, window.end);
    if (end <= start) continue;
    if (points.slice(start - context.start, end - context.start).join('') !== Array.from(window.text).slice(start - window.start, end - window.start).join('')) return 'Old context is unavailable.';
    cuts.add(start - context.start); cuts.add(end - context.start);
  }
  const edges = [...cuts].sort((a,b) => a-b);
  return edges.slice(0,-1).map((start,index) => {
    const end = edges[index+1], text = points.slice(start,end).join('');
    const kinds = [...new Set(windows.filter(window => window.start < end + context.start && start + context.start < window.end).map(window => window.kind))].join(' ');
    return kinds ? <mark key={start} data-old-kind={kinds}>{text}</mark> : <span key={start}>{text}</span>;
  });
}
const reasons: Record<ReanchorItem['reason'],string> = {
  source_text_mismatch: 'The source text does not match.', missing_evidence: 'Source evidence is missing.',
  evidence_version_mismatch: 'The evidence version does not match.', ambiguous_evidence: 'The evidence is ambiguous.',
  evidence_source_mismatch: 'The evidence belongs to another source.', invalid_bounds: 'The evidence offsets are invalid.',
  changed_segment: 'The evidence text changed.', changed_cue: 'The cue text changed.',
};
export function ReanchorPanel({ items, labelFor, onContext }: { items: readonly ReanchorItem[]; labelFor: (layer:string,term:string)=>string|null; onContext:(window:Window)=>void }) {
  if (!items.length) return null;
  return <section className="reanchor-panel detail-section" aria-label="Needs review after the text change">
    <details open><summary><h3>Needs review after the text change ({items.length})</h3></summary>
    <ol>{items.map((item,index) => {
      const parts = pendingDiffParts(item);
      const label = labelFor(item.layer_id,item.term_id);
      return <li key={JSON.stringify([item.proposal_set_id,item.source_ref.annotation_id,item.source_ref.version,index])}>
        <Button variant="quiet" onClick={() => onContext(item.new_context)}>{label && label !== item.term_id ? `${label} (${item.term_id})` : item.term_id} · {item.layer_id}</Button>
        <p>{reasons[item.reason]}</p>
        <p>Old context</p><div className="reanchor-context" data-old-context data-context-start={item.old_context.start}>{oldContext(item)}</div>
        <p>New context</p><div className="reanchor-context">{validWindow(item.new_context) ? item.new_context.text : 'New context is unavailable.'}</div>
        {parts ? <div data-old-start={item.old_context.start} data-new-start={item.new_context.start}><DiffView before={item.old_context.text} after={item.new_context.text} parts={parts} /></div> : <p>Text changes are unavailable.</p>}
      </li>;
    })}</ol></details>
  </section>;
}

/** Reads only in an explicitly authorized current proposal context; late results stay hidden. */
export function PendingReanchorPanel({ projectKey, documentId, scope, enabled, proposalSetId, onContext }: {
  projectKey:string; documentId:string; scope:string; enabled:boolean; proposalSetId?:string; onContext:(window:Window)=>void;
}) {
  const identity = useMemo(() => ({}),[projectKey,documentId,scope,enabled,proposalSetId]);
  const [state,setState] = useState<{identity:object; items:ReanchorItem[]; error?:unknown}|null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api.getReanchorItems(projectKey,documentId).then(items => {
      if (active) setState({identity,items:proposalSetId === undefined ? items : items.filter(item => String(item.proposal_set_id) === proposalSetId)});
    },error => {if(active)setState({identity,items:[],error});});
    return () => {active=false;};
  },[identity]);
  const current = enabled && state?.identity===identity ? state : null;
  const labelFor = useTermLabels(projectKey,(current?.items ?? []).map(item => ({layer_id:item.layer_id,term_id:item.term_id})));
  return current?.error ? <ErrorNotice error={current.error}/> : <ReanchorPanel items={current?.items ?? []} labelFor={labelFor} onContext={onContext}/>;
}

/** Display state only: no evidence, draft or selection mutation. */
export function useReanchorContext(text:string, element:HTMLElement|null, identity:string) {
  const latest = useRef({text,element,identity}); latest.current={text,element,identity};
  const timer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const [shown,setShown] = useState<{text:string;element:HTMLElement;identity:string;window:Window}|null>(null);
  useEffect(() => () => {if(timer.current!==null)clearTimeout(timer.current);timer.current=null;},[text,element,identity]);
  const reveal = useCallback((window:Window) => {
    if(latest.current.text!==text || latest.current.element!==element || latest.current.identity!==identity || !element) return;
    if(timer.current!==null)clearTimeout(timer.current); timer.current=null;setShown(null);
    const points=Array.from(text);
    if(!validWindow(window) || window.end>points.length || points.slice(window.start,window.end).join('')!==window.text) return;
    const offset=toUtf16(text,window.start);
    const runs=[...element.querySelectorAll<HTMLElement>('.run[data-start]')];
    const run=runs.find(node => {const start=Number(node.dataset.start);return start<=offset && offset<start+(node.textContent?.length ?? 0);}) ?? (offset===text.length ? runs.at(-1) : undefined);
    if(run?.firstChild?.nodeType===Node.TEXT_NODE){
      const range=document.createRange(); const local=offset-Number(run.dataset.start);
      range.setStart(run.firstChild,local);range.setEnd(run.firstChild,local);
      const rect=range.getBoundingClientRect?.();
      const top=rect && (rect.width || rect.height) ? rect.top : run.getBoundingClientRect().top;
      element.scrollTop += top-element.getBoundingClientRect().top-element.clientTop;
    }
    setShown({text,element,identity,window});
    const owned=setTimeout(()=>{if(timer.current===owned){setShown(null);timer.current=null;}},2000);timer.current=owned;
  },[text,element,identity]);
  const current=shown?.text===text && shown.element===element && shown.identity===identity ? shown.window : null;
  const contextSegments:CodepointSegment[] = useMemo(()=>current && current.end>current.start ? [{start:current.start,end:current.end}] : [],[current]);
  return {contextSegments,reveal};
}
