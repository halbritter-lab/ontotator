import { PendingReanchorPanel, useReanchorContext } from './ReanchorPanel';
import { ProposalMetadataProvider, ProposalSource } from '../editor/ProposalSource';
import { useCallback, useMemo, useState } from 'react';
import type { AnnotationSnapshot, AnnotationVersion, EditorProposal } from '../api/client';
import { TextPane } from '../editor/TextPane';
import { TermName } from '../editor/TermName';
import { AiBadge } from '../editor/AiBadge';
import { markColourSlot } from '../editor/markColours';
import { isNegated } from '../editor/negation';
import type { MentionDisplay } from '../spans/adapter';
import { Button } from '../ui';

export interface ReadOnlyAnnotationViewProps {
  proposalContext?: {projectKey:string;documentId:string;scope:string;setId:string};
  onTextElement?: (element: HTMLDivElement | null) => void;
  text: string;
  annotations: AnnotationSnapshot[];
  evidence: AnnotationVersion['evidence'];
  labelFor: (layerId: string | undefined, termId: string) => string | null;
}
export function ReadOnlyAnnotationView({ text, annotations, evidence, labelFor, onTextElement, proposalContext }: ReadOnlyAnnotationViewProps): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);
  const [element,setElement] = useState<HTMLDivElement|null>(null);
  const attachElement=useCallback((value:HTMLDivElement|null)=>{setElement(value);onTextElement?.(value);},[onTextElement]);
  const context=useReanchorContext(text,element,proposalContext?.scope ?? 'text-only');
  // The actual proposals VersionRef ID is the server's decimal proposal-set identity.
  const setId=proposalContext && /^[1-9]\d*$/.test(proposalContext.setId) && Number.isSafeInteger(Number(proposalContext.setId)) ? Number(proposalContext.setId) : null;
  const sources=useMemo<EditorProposal[]>(()=>setId===null ? [] : annotations.map(snapshot=>({...snapshot,proposal_set_id:setId,notes:[]})),[annotations,setId]);
  const mentions = useMemo(() => {
    const result: MentionDisplay[] = [];
    annotations.forEach((snapshot, index) => {
      const annotation = snapshot.annotation;
      // Version identity is essential when evidence IDs are reused by snapshots.
      for (const [refIndex, ref] of (annotation.evidence_refs ?? []).entries()) {
        const ev = [...snapshot.evidence, ...evidence].find(value => value.mention.evidence_id === ref.evidence_id && value.version === ref.version);
        if (!ev) continue;
        const id = `${index}:${refIndex}`;
        result.push({ evidence_id: id, segments: ev.mention.segments,
          kind: 'source', colorIndex: markColourSlot({ termId: annotation.term_id, layerId: annotation.layer_id, kind: 'source' }),
          negated: isNegated(annotation) });
        if (ev.mention.cue_segments?.length) result.push({ evidence_id: `${id}:cue`, segments: ev.mention.cue_segments,
          kind: 'source', colorIndex: markColourSlot({ termId: annotation.term_id, layerId: annotation.layer_id, kind: 'source' }) });
      }
    });
    return result;
  }, [annotations, evidence]);
  const content = <div className="readonly-annotation-view">
    {(annotations.length > 0 || setId !== null) && <aside className="readonly-annotations density-compact" aria-label="Read-only annotations">
      {proposalContext && setId !== null && <PendingReanchorPanel projectKey={proposalContext.projectKey} documentId={proposalContext.documentId}
        scope={proposalContext.scope} enabled={true} proposalSetId={proposalContext.setId} onContext={context.reveal} />}
      <ul className="doc-list">{annotations.map((snapshot, index) => <li className="doc-item" key={JSON.stringify([snapshot.annotation.annotation_id, snapshot.version])}>
        <Button variant="quiet" onClick={() => setSelected(mentions.find(mention => mention.evidence_id.startsWith(`${index}:`))?.evidence_id ?? null)}>
          <TermName termId={snapshot.annotation.term_id} label={labelFor(snapshot.annotation.layer_id, snapshot.annotation.term_id)} />
        </Button>{' '}<AiBadge provenance={snapshot.annotation.provenance} source={sources[index]} />
        <ProposalSource source={sources[index]}/>
        <p>{snapshot.annotation.layer_id} · {snapshot.annotation.type_id}</p>
        <p>{snapshot.annotation.provenance.actor.actor_id} · {snapshot.annotation.provenance.method}</p>
        <p>Version: {snapshot.version}</p>
        {!!snapshot.annotation.provenance.source_refs?.length && <details><summary>Source references</summary><ul>
          {snapshot.annotation.provenance.source_refs.map((ref, index) => <li key={index}>{ref}</li>)}
        </ul></details>}
        {(snapshot.annotation.evidence_refs ?? []).length === 0 && <p>Spanless</p>}
        {Object.entries(snapshot.annotation.axes_values ?? {}).map(([axis, value]) => <p key={axis}>
          {axis}: {value ?? 'Not specified'}{snapshot.annotation.axes_defaulted?.includes(axis) ? ' (defaulted)' : ''}
        </p>)}
      </li>)}</ul>
    </aside>}
    <TextPane onTextElement={attachElement} contextSegments={context.contextSegments} text={text} mentions={mentions} selectedEvidenceId={selected} selectionIntent="new_mention"
      readOnly isAttachingMention={false} resizableEvidenceIds={[]} onPick={setSelected} onSelection={() => {}} onChangeIntent={() => {}} />
  </div>;
  return proposalContext && setId !== null ? <ProposalMetadataProvider scope={proposalContext.scope} projectKey={proposalContext.projectKey} proposals={sources}>{content}</ProposalMetadataProvider> : content;
}
