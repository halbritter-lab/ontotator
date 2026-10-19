import { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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
  leftText: string; leftElement: HTMLElement | null; leftContext: string; suspended?: boolean; editing?: boolean; onClose: () => void;
  toolbarHost?: HTMLElement | null;
  /** Right side preselected by a deep link (`compare` of the case route); the reader can still change it. */
  initialRight?: { documentId: string; refKey: string };
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

export function ComparePane({ projectKey, username, caseDetail, leftDocumentId, leftText, leftElement, leftContext, suspended = false, editing = false, onClose, toolbarHost, initialRight }: ComparePaneProps): JSX.Element {
  const couplingNoteId = useId();
  // User choices outlive left annotation changes; requests must still reauthorize in each context.
  const choiceIdentity = useMemo(() => ({}), [projectKey, username, caseDetail.case_id, leftDocumentId, initialRight?.documentId, initialRight?.refKey]);
  const identity = useMemo(() => ({}), [choiceIdentity, caseDetail, leftContext]);
  const preselected = initialRight && caseDetail.variants.some(row => row.document_id === initialRight.documentId) ? initialRight : undefined;
  const initial = preselected ? { id: preselected.documentId, source: false } : defaultComparison(caseDetail, leftDocumentId);
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
  // A deep-linked ref waits for the offered refs; one no longer offered falls back to Text only.
  const linked = !manual && preselected ? (!refs ? preselected.refKey : refForKey(preselected.refKey, refs) ? preselected.refKey : null) : undefined;
  const selection = choice?.identity === selectionIdentity ? choice.key
    : linked !== undefined ? linked ?? 'text'
    : !manual && !initial.source && newest ? refKey(newest) : 'text';
  const ref = refForKey(selection, refs ?? []);
  const payloadIdentity = useMemo(() => ({}), [contentIdentity, selection]);
  const [payload, setPayload] = useState<{ identity: object; value?: AnnotationVersion; error?: unknown } | null>(null);
  const snapshot = payload?.identity === payloadIdentity && ref ? payload.value : undefined;
  const payloadError = payload?.identity === payloadIdentity ? payload.error : undefined;
  const labelFor = useTermLabels(projectKey, (snapshot?.annotations ?? []).map(row => ({ layer_id: row.annotation.layer_id, term_id: row.annotation.term_id })));
  const [rightElement, setRightElement] = useState<HTMLDivElement | null>(null);
  const couplingIdentity = useMemo(() => ({}), [identity, selectedId, selection, leftText, editing, suspended]);
  const [requestedCoupling, setRequestedCoupling] = useState<object | null>(null);
  const couplingRequested = requestedCoupling === couplingIdentity && !editing && !suspended;
  const leftStarts = useMemo(() => paragraphStarts(leftText), [leftText, identity]);
  const rightStarts = useMemo(() => paragraphStarts(current?.text?.text ?? ''), [current?.text, contentIdentity]);
  const panes = useMemo(() => [{ id: 'left', element: leftElement, starts: leftStarts }, { id: 'right', element: current?.text ? rightElement : null, starts: rightStarts }], [leftElement, rightElement, leftStarts, rightStarts, current?.text]);
  const pairing = useCoupledScroll(panes, { enabled: couplingRequested });
  // A stacked layout pauses the preference; it never opts the reader in.
  const coupled = couplingRequested && pairing.available;
  const couplingUnavailable = editing ? 'Coupled scrolling is available in read-only views.'
    : !pairing.available ? 'Widen the window to at least 1100 px to couple scrolling in side-by-side panes.' : null;

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
  const globalControls = <div className="comparison-global-controls">
    <div className="compare-toolbar density-compact" role="toolbar" aria-label="Comparison controls"><h2>Compare</h2>
      <label><input type="checkbox" checked={coupled} disabled={editing || suspended || !pairing.available} aria-describedby={couplingUnavailable ? couplingNoteId : undefined} onChange={event => setRequestedCoupling(event.target.checked ? couplingIdentity : null)} /> Couple scrolling</label>
      <IconButton label="Close comparison" icon={<IconClose />} onClick={onClose} />
    </div>
    {couplingUnavailable && <p id={couplingNoteId}>{couplingUnavailable}</p>}
    {coupled && <><p>Paragraphs are paired by position, not by meaning</p><p role="status" aria-label="Paragraph pairing">{pairing.pairs.map(pair => `${pair.paneId === 'left' ? 'Current text' : 'Comparison'} paragraph ${pair.paragraph + 1}`).join(' ↔ ')}</p></>}
    {current?.text && leftStarts.length !== rightStarts.length && <InlineMessage tone="info">Paragraphs differ ({leftStarts.length} / {rightStarts.length}); scrolling is approximate.</InlineMessage>}
  </div>;
  return <section className="compare-pane" aria-label="Comparison">
    {toolbarHost ? createPortal(globalControls, toolbarHost) : null}
    <div className="compare-controls">
    {toolbarHost === undefined && globalControls}
    <div role="group" aria-label="Comparison text identity" className="comparison-pane-identity">
    {toolbarHost !== undefined && <h2 className="comparison-pane-title">Comparison text</h2>}
    <VariantSelectors caseDetail={caseDetail} currentDocumentId={selectedId ?? ''} annotationOptions={annotationOptions(refs ?? [], false)} selectedAnnotation={selection}
      onLanguage={language => { const id = pickVariant(caseDetail, language); if (id) select(id); }} onVersion={select}
      onAnnotation={key => { if (key === 'text' || refForKey(key, refs ?? [])) setChoice({ identity: selectionIdentity, key }); }} />
    </div>
    {!initial.id && <InlineMessage tone="info">Original source is not available; choose a comparison text.</InlineMessage>}
    {linked === null && choice?.identity !== selectionIdentity && <InlineMessage tone="info">The linked submission is not available to you.</InlineMessage>}
    {selectedId && !available && <InlineMessage tone="info">This comparison text is not available to you.</InlineMessage>}
    {!available && caseDetail.variants.some(row => row.document_id === leftDocumentId) && <Button onClick={() => select(leftDocumentId)}>Compare current text</Button>}
    {(current?.textError || current?.refsError || payloadError) ? <><ErrorNotice error={current?.textError || current?.refsError || payloadError} /><Button onClick={() => setRetry(value => value + 1)}>Retry comparison</Button></> : null}
    {ref && !snapshot && !payloadError && <InlineMessage tone="info">Loading comparison annotations...</InlineMessage>}
    </div>
    {current?.text ? <ReadOnlyAnnotationView key={JSON.stringify([username, projectKey, caseDetail.case_id, selectedId, selection, retry, leftContext])}
      text={current.text.text} annotations={snapshot?.annotations ?? []} evidence={snapshot?.evidence ?? []} labelFor={labelFor} onTextElement={setRightElement} proposalContext={ref?.kind === "proposals" && snapshot ? {projectKey,documentId:selectedId!,scope:JSON.stringify([username,projectKey,caseDetail.case_id,selectedId,selection,retry,leftContext]),setId:ref.id} : undefined} />
      : available && !suspended && !current?.textError ? <InlineMessage tone="info">Loading comparison text...</InlineMessage> : null}
  </section>;
}
