import { useState } from 'react';
import type { AnnotationSnapshot } from '../api/client';
import { AxisValue, Button } from '../ui';

const FIRST = 20;

/** Read-only findings of the shown layer with the fixed axis colours (spec §4); key it by layer to reset "more". */
export function LayerFindings({ label, annotations, labelFor }: {
  label: string; annotations: readonly AnnotationSnapshot[]; labelFor: (layerId: string | undefined, termId: string) => string | null;
}): JSX.Element {
  const [all, setAll] = useState(false);
  const shown = all ? annotations : annotations.slice(0, FIRST);
  return <section className="layer-findings density-compact" aria-label="Findings">
    <h2>{label}</h2>
    {annotations.length === 0 ? <p>No findings.</p> : <ul>
      {shown.map(({ annotation, version }) => {
        const term = labelFor(annotation.layer_id, annotation.term_id);
        return <li key={JSON.stringify([annotation.annotation_id, version])}>
          <span className="layer-finding-term">{term ? `${term} (${annotation.term_id})` : annotation.term_id}</span>
          {Object.entries(annotation.axes_values ?? {}).map(([axis, value]) => value != null && <AxisValue key={axis} value={value} />)}
        </li>;
      })}
    </ul>}
    {!all && annotations.length > FIRST && <Button variant="quiet" size="sm" onClick={() => setAll(true)}>{annotations.length - FIRST} more…</Button>}
  </section>;
}
