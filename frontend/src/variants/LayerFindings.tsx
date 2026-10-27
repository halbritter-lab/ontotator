import { useState } from 'react';
import type { AnnotationSnapshot } from '../api/client';
import { chipText, quoteOf, sortByLabel } from '../editor/modifiers';
import { AxisValue, Button } from '../ui';

const FIRST = 20;

/** Terms whose labels the layer needs: each finding's term and its modifiers' terms. */
export const layerTerms = (annotations: readonly AnnotationSnapshot[]): { layer_id: string; term_id: string }[] =>
  annotations.flatMap(({ annotation }) => [annotation.term_id, ...(annotation.modifiers ?? []).map(modifier => modifier.term_id)]
    .map(term_id => ({ layer_id: annotation.layer_id, term_id })));

/**
 * Read-only findings of the shown layer with the fixed axis colours (spec §4), each with its modifiers (the editor's
 * chip text), its note and "No text span" (R-4); key it by layer to reset "more".
 */
export function LayerFindings({ label, annotations, labelFor, text }: {
  label: string; annotations: readonly AnnotationSnapshot[]; labelFor: (layerId: string | undefined, termId: string) => string | null;
  /** The shown text: the quotes of linked modifiers. */
  text: string;
}): JSX.Element {
  const [all, setAll] = useState(false);
  const shown = all ? annotations : annotations.slice(0, FIRST);
  return <section className="layer-findings density-compact" aria-label="Findings">
    <h2>{label}</h2>
    {annotations.length === 0 ? <p>No findings.</p> : <ul>
      {shown.map(({ annotation, version }) => {
        const term = labelFor(annotation.layer_id, annotation.term_id);
        const modifierLabel = (id: string) => labelFor(annotation.layer_id, id) ?? id;
        const modifiers = sortByLabel(annotation.modifiers ?? [], id => ({ label: modifierLabel(id), role: 'modifier', exclusiveClass: null }));
        return <li key={JSON.stringify([annotation.annotation_id, version])}>
          <span className="layer-finding-term">{term ? `${term} (${annotation.term_id})` : annotation.term_id}</span>
          {Object.entries(annotation.axes_values ?? {}).map(([axis, value]) => value != null && <AxisValue key={axis} value={value} />)}
          {modifiers.length > 0 && <span className="layer-finding-line">{`Modifiers: ${modifiers.map(modifier =>
            chipText(modifierLabel(modifier.term_id), modifier.segments?.length ? quoteOf(text, modifier.segments) : null, 'modifier')).join(', ')}`}</span>}
          {!annotation.evidence_refs?.length && <span className="layer-finding-line">No text span</span>}
          {annotation.note && <span className="layer-finding-line">{`Note: ${annotation.note}`}</span>}
        </li>;
      })}
    </ul>}
    {!all && annotations.length > FIRST && <Button variant="quiet" size="sm" onClick={() => setAll(true)}>{annotations.length - FIRST} more…</Button>}
  </section>;
}
