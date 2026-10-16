import { useEffect, useMemo, useState } from 'react';
import { api, type AnnotationVersion, type CaseDetail, type VariantText, type VersionRef } from '../api/client';
import { ErrorNotice } from '../admin/ErrorNotice';
import { useTermLabels } from '../editor/useTermLabels';
import { Button, IconButton, InlineMessage } from '../ui';
import { IconClose } from '../ui/icons';
import { paragraphStarts } from './paragraphs';
import { useCoupledScroll } from './useCoupledScroll';
import { annotationOptions, pickVariant, refForKey, refKey } from './versionState';
import { VariantSelectors } from './VariantSelectors';
import { ReadOnlyAnnotationView } from './ReadOnlyAnnotationView';

export interface ComparePaneProps {
  projectKey: string; username: string; caseDetail: CaseDetail; leftDocumentId: string;
  leftText: string; leftElement: HTMLElement | null; leftContext: string; suspended?: boolean; onClose: () => void;
}

/** Only traverse explicitly readable, same-case lineage. No ID or status inference. */
function defaultComparison(detail: CaseDetail, documentId: string) {
  let row = detail.variants.find(value => value.document_id === documentId);
  const seen = new Set<string>();
  while (row?.origin === 'correction') {
    if (seen.has(row.document_id)) return { id: null, source: true };
    seen.add(row.document_id);
    const previous = detail.variants.find(value => value.document_id === row!.derived_from && value.case_id === row!.case_id && value.language === row!.language);
    row = previous;
  }
  if (row?.origin === 'machine_translation' || row?.origin === 'human_translation') {
    const source = detail.variants.find(value => value.document_id === row!.derived_from && value.case_id === row!.case_id && value.document_id !== row!.document_id && !seen.has(value.document_id));
    return { id: source?.document_id ?? null, source: true };
  }
  return { id: row ? documentId : null, source: !row };
}

export function ComparePane({ projectKey, username, caseDetail, leftDocumentId, leftText, leftElement, leftContext, suspended = false, onClose }: ComparePaneProps): JSX.Element {
  // User choices outlive left annotation changes; requests must still reauthorize in each context.
  const choiceIdentity = useMemo(() => ({}), [projectKey, username, caseDetail.case_id, leftDocumentId]);
  const identity = useMemo(() => ({}), [choiceIdentity, caseDetail, leftContext]);
  const initial = defaultComparison(caseDetail, leftDocumentId);
  const [chosen, setChosen] = useState<{ identity: object; id: string } | null>(null);
  const manual = chosen?.identity === choiceIdentity;
  const selectedId = manual ? chosen.id : initial.id;
  const available = selectedId !== null && caseDetail.variants.some(row => row.document_id === selectedId);
  const selectionIdentity = useMemo(() => ({}), [choiceIdentity, selectedId]);
  const [retry, setRetry] = useState(0);
  const contentIdentity = useMemo(() => ({}), [identity, selectedId, retry, suspended]);
  const [content, setContent] = useState<{ identity: object; text: VariantText | null; refs: VersionRef[] | null; textError?: unknown; refsError?: unknown } | null>(null);
  const current = !suspended && available && content?.identity === contentIdentity ? content : null;
  const [choice, setChoice] = useState<{ identity: object; key: string } | null>(null);
  const refs = current?.refs;
  const newest = refs?.reduce<VersionRef | null>((best, ref) => !best || Date.parse(ref.created_at) > Date.parse(best.created_at) ? ref : best, null);
  const selection = choice?.identity === selectionIdentity ? choice.key
    : !manual && !initial.source && newest ? refKey(newest) : 'text';
  const ref = refForKey(selection, refs ?? []);
  const payloadIdentity = useMemo(() => ({}), [contentIdentity, selection]);
  const [payload, setPayload] = useState<{ identity: object; value?: AnnotationVersion; error?: unknown } | null>(null);
  const snapshot = payload?.identity === payloadIdentity && ref ? payload.value : undefined;
  const payloadError = payload?.identity === payloadIdentity ? payload.error : undefined;
  const labelFor = useTermLabels(projectKey, (snapshot?.annotations ?? []).map(row => ({ layer_id: row.annotation.layer_id, term_id: row.annotation.term_id })));
  const [rightElement, setRightElement] = useState<HTMLDivElement | null>(null);
  const [coupled, setCoupled] = useState(true);
  const leftStarts = useMemo(() => paragraphStarts(leftText), [leftText, identity]);
  const rightStarts = useMemo(() => paragraphStarts(current?.text?.text ?? ''), [current?.text, contentIdentity]);
  useCoupledScroll(leftElement, current?.text ? rightElement : null, { leftStarts, rightStarts, enabled: coupled });

  useEffect(() => {
    if (suspended || !available || !selectedId) return;
    let active = true;
    setContent({ identity: contentIdentity, text: null, refs: null });
    const update = (patch: Partial<NonNullable<typeof content>>) => {
      if (active) setContent(value => ({ identity: contentIdentity, text: null, refs: null, ...(value?.identity === contentIdentity ? value : {}), ...patch }));
    };
    api.getVariantText(projectKey, selectedId).then(text => update({ text }), textError => update({ textError }));
    api.listAnnotationVersions(projectKey, selectedId).then(refs => update({ refs }), refsError => update({ refsError }));
    return () => { active = false; };
  }, [contentIdentity]);
  useEffect(() => {
    if (!selectedId || !ref) return;
    let active = true;
    api.getAnnotationVersion(projectKey, selectedId, ref.kind, ref.id).then(value => {
      if (active) setPayload({ identity: payloadIdentity, value });
    }, error => { if (active) setPayload({ identity: payloadIdentity, error }); });
    return () => { active = false; };
  }, [payloadIdentity, ref?.kind, ref?.id]);
  const select = (id: string) => { if (caseDetail.variants.some(row => row.document_id === id)) setChosen({ identity: choiceIdentity, id }); };
  return <section className="compare-pane" aria-label="Comparison">
    <div className="compare-controls">
    <div className="compare-toolbar density-compact"><h2>Compare</h2>
      <label><input type="checkbox" checked={coupled} onChange={event => setCoupled(event.target.checked)} /> Couple scrolling</label>
      <IconButton label="Close comparison" icon={<IconClose />} onClick={onClose} />
    </div>
    {!initial.id && <InlineMessage tone="info">Original source is not available; choose a comparison text.</InlineMessage>}
    {selectedId && !available && <InlineMessage tone="info">This comparison text is not available to you.</InlineMessage>}
    {!available && caseDetail.variants.some(row => row.document_id === leftDocumentId) && <Button onClick={() => select(leftDocumentId)}>Compare current text</Button>}
    <VariantSelectors caseDetail={caseDetail} currentDocumentId={selectedId ?? ''} annotationOptions={annotationOptions(refs ?? [], false)} selectedAnnotation={selection}
      onLanguage={language => { const id = pickVariant(caseDetail, language); if (id) select(id); }} onVersion={select}
      onAnnotation={key => { if (key === 'text' || refForKey(key, refs ?? [])) setChoice({ identity: selectionIdentity, key }); }} />
    {current?.text && leftStarts.length !== rightStarts.length && <InlineMessage tone="info">Paragraphs differ ({leftStarts.length} / {rightStarts.length}); scrolling is approximate.</InlineMessage>}
    {(current?.textError || current?.refsError || payloadError) ? <><ErrorNotice error={current?.textError || current?.refsError || payloadError} /><Button onClick={() => setRetry(value => value + 1)}>Retry comparison</Button></> : null}
    {ref && !snapshot && !payloadError && <InlineMessage tone="info">Loading comparison annotations...</InlineMessage>}
    </div>
    {current?.text ? <ReadOnlyAnnotationView key={JSON.stringify([username, projectKey, caseDetail.case_id, selectedId, selection, retry, leftContext])}
      text={current.text.text} annotations={snapshot?.annotations ?? []} evidence={snapshot?.evidence ?? []} labelFor={labelFor} onTextElement={setRightElement} />
      : available && !suspended && !current?.textError ? <InlineMessage tone="info">Loading comparison text...</InlineMessage> : null}
  </section>;
}
