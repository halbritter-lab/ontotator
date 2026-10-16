import { useMemo, useState } from 'react';
import type { AnnotationSnapshot, AnnotationVersion } from '../api/client';
import { TextPane } from '../editor/TextPane';
import { TermName } from '../editor/TermName';
import { AiBadge } from '../editor/AiBadge';
import { markColourSlot } from '../editor/markColours';
import { isNegated } from '../editor/negation';
import type { MentionDisplay } from '../spans/adapter';
import { Button } from '../ui';

export interface ReadOnlyAnnotationViewProps {
  text: string;
  annotations: AnnotationSnapshot[];
  evidence: AnnotationVersion['evidence'];
  labelFor: (layerId: string | undefined, termId: string) => string | null;
}
export function ReadOnlyAnnotationView({ text, annotations, evidence, labelFor }: ReadOnlyAnnotationViewProps): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);
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
  return <div className="readonly-annotation-view">
    {annotations.length > 0 && <aside className="readonly-annotations density-compact" aria-label="Read-only annotations">
      <ul className="doc-list">{annotations.map((snapshot, index) => <li className="doc-item" key={JSON.stringify([snapshot.annotation.annotation_id, snapshot.version])}>
        <Button variant="quiet" onClick={() => setSelected(mentions.find(mention => mention.evidence_id.startsWith(`${index}:`))?.evidence_id ?? null)}>
          <TermName termId={snapshot.annotation.term_id} label={labelFor(snapshot.annotation.layer_id, snapshot.annotation.term_id)} />
        </Button>{' '}<AiBadge provenance={snapshot.annotation.provenance} />
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
    <TextPane text={text} mentions={mentions} selectedEvidenceId={selected} selectionIntent="new_mention"
      readOnly isAttachingMention={false} resizableEvidenceIds={[]} onPick={setSelected} onSelection={() => {}} onChangeIntent={() => {}} />
  </div>;
}
