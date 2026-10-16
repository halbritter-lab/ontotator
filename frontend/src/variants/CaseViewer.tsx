import { ComparePane } from './ComparePane';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type AnnotationVersion, type CaseDetail, type TaskSummary, type VariantText, type VersionRef } from '../api/client';
import { ErrorNotice } from '../admin/ErrorNotice';
import { routeHref, type Route } from '../app/router';
import { useTermLabels } from '../editor/useTermLabels';
import { Button, InlineMessage } from '../ui';
import { annotationOptions, languagesOf, pickVariant, refForKey } from './versionState';
import { VariantSelectors } from './VariantSelectors';
import { ReadOnlyAnnotationView } from './ReadOnlyAnnotationView';

export interface CaseViewerProps {
  projectKey: string; caseId: string; variant?: string; annotations?: string;
  username: string; onNavigate: (route: Route) => void;
}
export const variantDescription = (variant: CaseDetail['variants'][number]) => {
  const origin = { native: 'Native', machine_translation: 'Machine translation', human_translation: 'Human translation', correction: 'Corrected' }[variant.origin];
  return [origin, variant.translation_status?.replaceAll('_', ' ')].filter(Boolean).join(' · ');
};

/** Display only: follow actual readable metadata, never infer lineage from IDs. */
export function VariantDetails({ detail, documentId }: { detail: CaseDetail; documentId: string }): JSX.Element | null {
  const current = detail.variants.find(row => row.document_id === documentId);
  if (!current) return null;
  let ancestor = current;
  const seen = new Set<string>();
  while (ancestor.origin === 'correction') {
    if (seen.has(ancestor.document_id)) return null;
    seen.add(ancestor.document_id);
    const previous = detail.variants.find(row => row.document_id === ancestor.derived_from && row.language === current.language && row.case_id === current.case_id);
    if (!previous) return null;
    ancestor = previous;
  }
  const run = ancestor.translation;
  if (!run || !['machine_translation', 'human_translation'].includes(ancestor.origin)) return null;
  const source = detail.variants.find(row => row.document_id === ancestor.derived_from);
  return <details className="variant-details"><summary>Translation details</summary>
    <dl><dt>Provider</dt><dd>{run.provider}</dd>
      {run.model && <><dt>Model</dt><dd>{run.model}</dd></>}
      {run.run_id && <><dt>Run</dt><dd>{run.run_id}</dd></>}
      {run.recipe && <><dt>Recipe</dt><dd>{run.recipe}</dd></>}
      {source && <><dt>Source variant</dt><dd>{source.external_id} · {source.language} · v{source.version}</dd></>}
    </dl>
    <h2>{ancestor === current ? 'Translation-run checks' : 'Inherited translation-run checks'}</h2>
    <ul>{(run.checks ?? []).map((check, index) => <li key={index}>{check.code}: {check.passed ? 'passed' : 'failed'}{check.detail ? ` · ${check.detail}` : ''}</li>)}</ul>
  </details>;
}

export function CaseViewer({ projectKey, caseId, variant, annotations, username, onNavigate }: CaseViewerProps): JSX.Element {
  const identity = useMemo(() => ({ username, projectKey, caseId }), [username, projectKey, caseId]);
  const [retry, setRetry] = useState(0);
  const [compareIdentity, setCompareIdentity] = useState<object | null>(null);
  const compareOpen = compareIdentity === identity;
  const [leftElement, setLeftElement] = useState<HTMLDivElement | null>(null);
  const compareButton = useRef<HTMLButtonElement | null>(null);
  const closeComparison = () => { setCompareIdentity(null); compareButton.current?.focus(); };
  const [detailState, setDetail] = useState<{ identity: object; retry: number; value: CaseDetail } | null>(null);
  const [caseError, setCaseError] = useState<{ identity: object; error: unknown } | null>(null);
  const detail = detailState?.identity === identity ? detailState.value : null;
  const detailFresh = detailState?.identity === identity && detailState.retry === retry;
  const selectedId = variant !== undefined ? variant : detail ? pickVariant(detail, languagesOf(detail)[0] ?? '') : null;
  const current = detail?.variants.find(row => row.document_id === selectedId);
  const selection = annotations ?? 'text';
  const contentIdentity = useMemo(() => ({ identity, selectedId, retry }), [identity, selectedId, retry]);
  const [textState, setText] = useState<{ identity: object; value: VariantText } | null>(null);
  const [refsState, setRefs] = useState<{ identity: object; value: VersionRef[] } | null>(null);
  const [textError, setTextError] = useState<{ identity: object; error: unknown } | null>(null);
  const [refsError, setRefsError] = useState<{ identity: object; error: unknown } | null>(null);
  const [tasks, setTasks] = useState<{ identity: object; value: TaskSummary[] } | null>(null);
  const [taskError, setTaskError] = useState<{ identity: object; error: unknown } | null>(null);
  const payloadIdentity = useMemo(() => ({ contentIdentity, selection }), [contentIdentity, selection]);
  const [payload, setPayload] = useState<{ identity: object; value: AnnotationVersion } | null>(null);
  const [payloadError, setPayloadError] = useState<{ identity: object; error: unknown } | null>(null);
  const refs = refsState?.identity === contentIdentity ? refsState.value : null;
  const ref = refs ? refForKey(selection, refs) : null;
  const snapshot = ref && payload?.identity === payloadIdentity ? payload.value : null;
  const labelFor = useTermLabels(projectKey, (snapshot?.annotations ?? []).map(row => ({ layer_id: row.annotation.layer_id, term_id: row.annotation.term_id })));
  useEffect(() => {
    let active = true;
    setCaseError(null); setTaskError(null); setTasks(null);
    api.getCase(projectKey, caseId).then(value => { if (active) setDetail({ identity, retry, value }); }, error => { if (active) setCaseError({ identity, error }); });
    api.listMyTasks().then(value => { if (active) setTasks({ identity, value }); }, error => { if (active) setTaskError({ identity, error }); });
    return () => { active = false; };
  }, [identity, retry]);
  useEffect(() => {
    if (!current) return;
    let active = true;
    setTextError(null); setRefsError(null);
    api.getVariantText(projectKey, current.document_id).then(value => { if (active) setText({ identity: contentIdentity, value }); }, error => { if (active) setTextError({ identity: contentIdentity, error }); });
    api.listAnnotationVersions(projectKey, current.document_id).then(value => { if (active) setRefs({ identity: contentIdentity, value }); }, error => { if (active) setRefsError({ identity: contentIdentity, error }); });
    return () => { active = false; };
  }, [contentIdentity, current?.document_id]);
  useEffect(() => {
    if (!current || !ref) return;
    let active = true;
    api.getAnnotationVersion(projectKey, current.document_id, ref.kind, ref.id).then(value => { if (active) setPayload({ identity: payloadIdentity, value }); }, error => { if (active) setPayloadError({ identity: payloadIdentity, error }); });
    return () => { active = false; };
  }, [payloadIdentity, ref?.kind, ref?.id]);
  const move = (documentId: string, selected = 'text') => onNavigate({ name: 'projectCase', key: projectKey, caseId, variant: documentId, annotations: selected });
  const retryButton = <Button onClick={() => setRetry(value => value + 1)}>Retry</Button>;
  if (caseError?.identity === identity) return <>{caseError.error instanceof ApiError && caseError.error.status === 404
    ? <InlineMessage tone="info">This case is not available to you.</InlineMessage> : <ErrorNotice error={caseError.error} />}{retryButton}</>;
  if (!detail) return <InlineMessage tone="info">Loading case...</InlineMessage>;
  if (!current) return <InlineMessage tone="info">This text version is not available to you.</InlineMessage>;
  const text = textState?.identity === contentIdentity ? textState.value : null;
  const supported = tasks?.identity === identity ? tasks.value.filter(row => row.project_key === projectKey && row.document_id === current.document_id) : [];
  const payloadFailed = payloadError?.identity === payloadIdentity;
  return <section className={`case-viewer${compareOpen ? " case-comparing" : ""}`} aria-label="Case viewer">
    <div className="case-toolbar" role="group" aria-label="Case"><h1>Case: {detail.case_id}</h1><span className="badge">{variantDescription(current)}</span>
      {supported.map((task, index) => <a key={task.assignment_id} href={routeHref({ name: 'task', assignmentId: task.assignment_id })} className="btn btn-secondary"
        onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); onNavigate({ name: 'task', assignmentId: task.assignment_id }); }}>
        {supported.length === 1 ? 'Open my task' : `Open my ${task.task === 'annotate' ? 'annotation' : task.task === 'translation_review' ? 'translation review' : 'review'} task${supported.filter(row => row.task === task.task).length > 1 ? ` (${index + 1})` : ''}`}
      </a>)}
    </div>
    <VariantSelectors caseDetail={detail} currentDocumentId={current.document_id} annotationOptions={annotationOptions(refs ?? [], false)} selectedAnnotation={selection}
      onLanguage={language => { const id = pickVariant(detail, language); if (id) move(id); }} onVersion={id => move(id)} onAnnotation={value => move(current.document_id, value)} />
    <Button ref={compareButton} aria-expanded={compareOpen} onClick={() => { if (compareOpen) closeComparison(); else setCompareIdentity(identity); }}>Compare</Button>
    <VariantDetails detail={detail} documentId={current.document_id} />
    {taskError?.identity === identity && <><ErrorNotice error={taskError.error} />{retryButton}</>}
    {refsError?.identity === contentIdentity && <><ErrorNotice error={refsError.error} />{retryButton}</>}
    {refs && selection !== 'text' && !ref && <InlineMessage tone="info">This annotation version is not available to you.</InlineMessage>}
    {payloadFailed && <><ErrorNotice error={payloadError.error} />{retryButton}</>}
    <div className="comparison-reading">
    {textError?.identity === contentIdentity ? <><ErrorNotice error={textError.error} />{retryButton}</> : text ? <>
      {selection !== 'text' && ref && !snapshot && !payloadFailed && <InlineMessage tone="info">Loading annotation version...</InlineMessage>}
      <ReadOnlyAnnotationView onTextElement={setLeftElement} key={JSON.stringify([username, projectKey, caseId, selectedId, selection, retry])} text={text.text} annotations={snapshot?.annotations ?? []} evidence={snapshot?.evidence ?? []} labelFor={labelFor} />
    </> : <InlineMessage tone="info">Loading text...</InlineMessage>}
      {compareOpen && <ComparePane projectKey={projectKey} username={username} caseDetail={detail} leftDocumentId={current.document_id}
        leftText={text?.text ?? ""} leftElement={text ? leftElement : null} suspended={!text || !detailFresh} leftContext={JSON.stringify([selectedId, selection, retry])} onClose={closeComparison} />}
      </div>
  </section>;
}
