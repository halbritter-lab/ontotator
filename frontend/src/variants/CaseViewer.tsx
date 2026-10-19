import { useVersionAccess } from './useVersionAccess';
import { ComparePane } from './ComparePane';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type AnnotationVersion, type CaseDetail, type TaskSummary, type VariantText, type VersionRef } from '../api/client';
import { ErrorNotice } from '../admin/ErrorNotice';
import { routeHref, type Route, type ProjectDocumentsQuery } from '../app/router';
import { useTermLabels } from '../editor/useTermLabels';
import { Button, InlineMessage, StatusBadge } from '../ui';
import { annotationOptions, languagesOf, pickVariant, refForKey } from './versionState';
import { VariantSelectors } from './VariantSelectors';
import { ReadOnlyAnnotationView } from './ReadOnlyAnnotationView';
import { SubmissionHistory } from './SubmissionHistory';
import { useFinalSelectionState } from './finalSelectionState';
import { TranslationCorrectionAction } from './TranslationCorrectionAction';
import { reviewLanguages } from '../admin/variantMetadata';

export interface CaseViewerProps {
  projectKey: string; caseId: string; variant?: string; annotations?: string;
  /** Ref key of a submission on the same text version: opens the comparison with that right side. */
  compare?: string;
  username: string; onNavigate: (route: Route) => void;
  documents?: ProjectDocumentsQuery;
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
  const source = detail.variants.find(row => row.document_id === ancestor.derived_from && row.case_id === current.case_id);
  return <details className="variant-details"><summary>Translation details</summary>
    <div className="variant-metadata-groups">
      <section><h2>Source</h2>{source ? <dl><dt>Source variant</dt><dd>{source.external_id} · {source.language} · v{source.version}</dd></dl> : <p>Source text unavailable.</p>}</section>
      <section><h2>Translation</h2><dl><dt>Provider</dt><dd>{run.provider}</dd>
        {run.model && <><dt>Model</dt><dd>{run.model}</dd></>}
        <dt>Text</dt><dd>{current.language} · v{current.version}</dd></dl>
      </section>
      <section><h2>Review</h2><dl><dt>Translation status</dt><dd>{current.translation_status?.replaceAll('_', ' ') ?? 'Not recorded'}</dd>
        {current.status_reason && <><dt>Reason</dt><dd>{current.status_reason}</dd></>}
      </dl></section>
    </div>
    <details><summary>Technical details and checks</summary><dl>
      {run.run_id && <><dt>Run</dt><dd>{run.run_id}</dd></>}
      {run.recipe && <><dt>Recipe</dt><dd>{run.recipe}</dd></>}
      <dt>Document ID</dt><dd>{current.document_id}</dd>
      <dt>Text hash</dt><dd>{current.text_sha256}</dd>
    </dl><h2>{ancestor === current ? 'Translation-run checks' : 'Inherited translation-run checks'}</h2>
      <ul>{(run.checks ?? []).map((check, index) => <li key={index}>{check.code}: {check.passed ? 'passed' : 'failed'}{check.detail ? ` · ${check.detail}` : ''}</li>)}</ul>
    </details>
  </details>;
}

/** Ref kind of a selection key ("own" for `["own", id]`), or null for text, draft and malformed keys. */
function selectionKind(key: string): string | null {
  try {
    const tuple: unknown = JSON.parse(key);
    return Array.isArray(tuple) && tuple.length === 2 && typeof tuple[0] === 'string' && typeof tuple[1] === 'string' ? tuple[0] : null;
  } catch {
    return null;
  }
}

export function CaseViewer({ projectKey, caseId, variant, annotations, compare, username, onNavigate, documents }: CaseViewerProps): JSX.Element {
  const access = useVersionAccess(projectKey, username);
  const finalResults = useFinalSelectionState(projectKey, username, access.canManage);
  const identity = useMemo(() => ({ username, projectKey, caseId }), [username, projectKey, caseId]);
  const [retry, setRetry] = useState(0);
  const [compareIdentity, setCompareIdentity] = useState<object | null>(null);
  const compareOpen = access.allowed && (compareIdentity === identity || compare !== undefined);
  const [leftElement, setLeftElement] = useState<HTMLDivElement | null>(null);
  const [comparisonToolbar, setComparisonToolbar] = useState<HTMLDivElement | null>(null);
  const compareButton = useRef<HTMLButtonElement | null>(null);
  const wasComparing = useRef(false);
  useEffect(() => {
    if (!compareOpen && wasComparing.current) compareButton.current?.focus();
    wasComparing.current = compareOpen;
  }, [compareOpen]);
  useEffect(() => {
    if (!access.allowed && compareIdentity !== null) {
      setCompareIdentity(null);
      leftElement?.focus();
    }
  }, [access.allowed]);
  const selection = annotations ?? 'text';
  // Everyone may open their own submissions (the history's View links); browsing other refs needs browse access.
  const ownSelection = selectionKind(selection) === 'own';
  const readable = access.allowed || ownSelection;
  const [detailState, setDetail] = useState<{ identity: object; retry: number; value: CaseDetail } | null>(null);
  const [caseError, setCaseError] = useState<{ identity: object; error: unknown } | null>(null);
  const detail = detailState?.identity === identity ? detailState.value : null;
  const detailFresh = detailState?.identity === identity && detailState.retry === retry;
  const selectedId = variant !== undefined ? variant : detail ? pickVariant(detail, languagesOf(detail)[0] ?? '') : null;
  const current = detail?.variants.find(row => row.document_id === selectedId);
  const closeComparison = () => {
    setCompareIdentity(null);
    if (compare !== undefined) onNavigate({ name: 'projectCase', key: projectKey, caseId, ...(variant !== undefined ? { variant } : {}), ...(annotations !== undefined ? { annotations } : {}), ...(documents ? { documents } : {}) });
  };
  const contentIdentity = useMemo(() => ({ identity, selectedId, retry, allowed: access.allowed, loading: access.loading }), [identity, selectedId, retry, access.allowed, access.loading]);
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
  const ref = refs ? refForKey(selection, access.allowed ? refs : refs.filter(row => row.kind === 'own')) : null;
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
    if (!current || access.loading || (!readable && selection !== 'text')) return;
    let active = true;
    setTextError(null); setRefsError(null);
    api.getVariantText(projectKey, current.document_id).then(value => { if (active) setText({ identity: contentIdentity, value }); }, error => { if (active) setTextError({ identity: contentIdentity, error }); });
    if (readable) api.listAnnotationVersions(projectKey, current.document_id).then(value => { if (active) setRefs({ identity: contentIdentity, value }); }, error => { if (active) setRefsError({ identity: contentIdentity, error }); });
    return () => { active = false; };
  }, [contentIdentity, current?.document_id, access.allowed, access.loading, selection, readable]);
  useEffect(() => {
    if (!readable || !current || !ref) return;
    let active = true;
    api.getAnnotationVersion(projectKey, current.document_id, ref.kind, ref.id).then(value => { if (active) setPayload({ identity: payloadIdentity, value }); }, error => { if (active) setPayloadError({ identity: payloadIdentity, error }); });
    return () => { active = false; };
  }, [payloadIdentity, ref?.kind, ref?.id, readable]);
  // A deep-linked comparison stays open; its preselection only applies to its own text version.
  const move = (documentId: string, selected = 'text') => {
    if (compareOpen) setCompareIdentity(identity);
    onNavigate({ name: 'projectCase', key: projectKey, caseId, variant: documentId, annotations: selected,
      ...(compare !== undefined && documentId === current?.document_id ? { compare } : {}), ...(documents ? { documents } : {}) });
  };
  const retryButton = <Button onClick={() => { if (access.error) access.retry(); setRetry(value => value + 1); }}>Retry</Button>;
  if (caseError?.identity === identity) return <>{caseError.error instanceof ApiError && caseError.error.status === 404
    ? <InlineMessage tone="info">This case is not available to you.</InlineMessage> : <ErrorNotice error={caseError.error} />}{retryButton}</>;
  if (access.loading) return <InlineMessage tone="info">Loading case...</InlineMessage>;
  if (!readable && selection !== 'text') return <InlineMessage tone="info">This annotation version is not available to you.</InlineMessage>;
  if (!detail) return <InlineMessage tone="info">Loading case...</InlineMessage>;
  if (!current) return <InlineMessage tone="info">This text version is not available to you.</InlineMessage>;
  const text = textState?.identity === contentIdentity ? textState.value : null;
  const supported = tasks?.identity === identity ? tasks.value.filter(row => row.project_key === projectKey && row.document_id === current.document_id) : [];
  const payloadFailed = payloadError?.identity === payloadIdentity;
  const selectedFinal = finalResults.state?.selections.find(row => row.case_id === caseId && row.language === current.language);
  return <section className={`case-viewer${compareOpen ? " case-comparing" : ""}`} aria-label="Case viewer">
    <div className="case-toolbar" role="group" aria-label="Case">
      <a href={routeHref({ name: 'projectDocuments', key: projectKey, ...documents })} onClick={event => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); onNavigate({ name: 'projectDocuments', key: projectKey, ...documents });
      }}>Back to Documents</a>
      <h1>Text: {detail.case_id}</h1><span>{current.language} · v{current.version}</span><span className="badge">{variantDescription(current)}</span>
      <SubmissionHistory projectKey={projectKey} caseId={caseId} documentId={current.document_id} language={current.language} version={current.version}
        username={username} canManage={access.canManage} onNavigate={onNavigate} documents={documents} />
      {supported.map((task, index) => <a key={task.assignment_id} href={routeHref({ name: 'task', assignmentId: task.assignment_id })} className="btn btn-secondary"
        onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); onNavigate({ name: 'task', assignmentId: task.assignment_id }); }}>
        {supported.length === 1 ? 'Open my task' : `Open my ${task.task === 'annotate' ? 'annotation' : task.task === 'translation_review' ? 'translation review' : 'review'} task${supported.filter(row => row.task === task.task).length > 1 ? ` (${index + 1})` : ''}`}
      </a>)}
    </div>
    {access.canManage && <div className="case-version-controls" aria-label="Selected final result">
      {selectedFinal ? <>
        {selectedFinal.document_id === current.document_id ? <StatusBadge tone="success">Selected final result</StatusBadge> : <>
          <span>Final result uses another text version</span>{' '}
          <a href={routeHref({ name: 'projectCase', key: projectKey, caseId, variant: selectedFinal.document_id, ...(documents ? { documents } : {}) })}
            onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); move(selectedFinal.document_id); }}>View selected final text</a>
        </>}{' '}<span>{selectedFinal.submission_id}</span>
      </> : finalResults.state ? <span>No final result selected for this language.</span> : finalResults.loading ? <span>Loading final selection…</span> : null}
      {finalResults.error != null && <><span>Final selection unavailable.</span> <Button size="sm" onClick={finalResults.reload}>Retry final selection</Button></>}
    </div>}
    <VariantDetails detail={detail} documentId={current.document_id} />
    {access.canManage && <TranslationCorrectionAction projectKey={projectKey} variant={current} username={username}
      requiredLanguages={reviewLanguages(current.document_id, new Map(detail.variants.map(row => [row.document_id, row])))} />}
    {!!access.error && <><ErrorNotice error={access.error} />{retryButton}</>}
    {taskError?.identity === identity && <><ErrorNotice error={taskError.error} />{retryButton}</>}
    {refsError?.identity === contentIdentity && <><ErrorNotice error={refsError.error} />{retryButton}</>}
    {!access.allowed && ref && <p className="case-own-submission">{ref.label}</p>}
    {refs && selection !== 'text' && !ref && <InlineMessage tone="info">This annotation version is not available to you.</InlineMessage>}
    {payloadFailed && <><ErrorNotice error={payloadError.error} />{retryButton}</>}
    <div className="comparison-reading">
    {compareOpen && <div className="comparison-toolbar-slot" ref={setComparisonToolbar} />}
    {access.allowed && <div className="viewer-left-controls">
    <div role={compareOpen ? 'group' : undefined} aria-label={compareOpen ? 'Current text identity' : undefined} className={compareOpen ? 'comparison-pane-identity' : undefined}>
    {compareOpen ? <h2 className="comparison-pane-title">Current text</h2> : null}
    <details className={compareOpen ? 'comparison-identity-choices' : 'case-version-controls'} open={compareOpen || undefined}>
    <summary hidden={compareOpen}>Versions</summary>
    <VariantSelectors caseDetail={detail} currentDocumentId={current.document_id} annotationOptions={annotationOptions(refs ?? [], false)} selectedAnnotation={selection}
      onLanguage={language => { const id = pickVariant(detail, language); if (id) move(id); }} onVersion={id => move(id)} onAnnotation={value => move(current.document_id, value)} />
    </details></div>
    <Button ref={compareButton} hidden={compareOpen} aria-expanded={compareOpen} onClick={() => setCompareIdentity(identity)}>Compare</Button>
    </div>}
    {textError?.identity === contentIdentity ? <><ErrorNotice error={textError.error} />{retryButton}</> : text ? <>
      {selection !== 'text' && ref && !snapshot && !payloadFailed && <InlineMessage tone="info">Loading annotation version...</InlineMessage>}
      <ReadOnlyAnnotationView onTextElement={setLeftElement} key={JSON.stringify([username, projectKey, caseId, selectedId, selection, retry])} text={text.text} annotations={snapshot?.annotations ?? []} evidence={snapshot?.evidence ?? []} labelFor={labelFor} proposalContext={ref?.kind === "proposals" && snapshot ? {projectKey,documentId:current.document_id,scope:JSON.stringify([username,projectKey,caseId,selectedId,selection,retry]),setId:ref.id} : undefined} />
    </> : <InlineMessage tone="info">Loading text...</InlineMessage>}
      {compareOpen && <ComparePane projectKey={projectKey} username={username} caseDetail={detail} leftDocumentId={current.document_id}
        leftText={text?.text ?? ""} leftElement={text ? leftElement : null} suspended={!text || !detailFresh} leftContext={JSON.stringify([selectedId, selection, retry])} onClose={closeComparison} toolbarHost={comparisonToolbar}
        initialRight={compare !== undefined ? { documentId: current.document_id, refKey: compare } : undefined} />}
      </div>
  </section>;
}
