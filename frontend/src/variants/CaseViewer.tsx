import { useVersionAccess } from './useVersionAccess';
import { ComparePane } from './ComparePane';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type AnnotationVersion, type CaseDetail, type SubmissionHistoryDetail, type TaskSummary, type VariantText } from '../api/client';
import { ErrorNotice } from '../admin/ErrorNotice';
import { routeHref, type Route, type ProjectDocumentsQuery } from '../app/router';
import { isNotAvailable, NotFound } from '../app/NotFound';
import { useTermLabels } from '../editor/useTermLabels';
import { Button, InlineMessage } from '../ui';
import { languagesOf, pickVariant } from './versionState';
import { ReadOnlyAnnotationView } from './ReadOnlyAnnotationView';
import { SubmissionHistory } from './SubmissionHistory';
import { TranslationCorrectionAction } from './TranslationCorrectionAction';
import { reviewLanguages } from '../admin/variantMetadata';
import { CarriedChecksReadOnly } from '../editor/carried/CarriedChecksReadOnly';
import type { CarriedInputLike } from '../editor/carried/checkState';
import { carriedCheckItems } from '../editor/historicalSubmission';
import { TermName } from '../editor/TermName';
import { LanguageFlag } from '../ui/LanguageTag';
import { TextViewToolbar } from './TextViewToolbar';
import { VersionSelect } from './VersionSelect';
import { ShowSelect } from './ShowSelect';
import { LayerFindings } from './LayerFindings';
import { layerKey, legacyLayerKey, refForLayer, useTextLayers } from './useTextLayers';
import './textView.css';
import { onSpaceActivate } from '../ui/spaceActivates';

export interface CaseViewerProps {
  projectKey: string; caseId: string; variant?: string;
  /** Layer key (`text`, `proposals`, `{kind}:{id}`) of the shown layer. */
  show?: string;
  /** Legacy JSON ref key of the shown layer; read once as `show`. */
  annotations?: string;
  /** Document of the comparison column and its layer key; a `compare` opens the comparison. */
  compare?: string; compareShow?: string;
  username: string; onNavigate: (route: Route) => void;
  documents?: ProjectDocumentsQuery;
}
export const variantDescription = (variant: CaseDetail['variants'][number]) => {
  const origin = { native: 'Native', machine_translation: 'Machine translation', human_translation: 'Human translation', correction: 'Corrected' }[variant.origin];
  return [origin, variant.translation_status?.replaceAll('_', ' ')].filter(Boolean).join(', ');
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
      <section><h2>Source</h2>{source ? <dl><dt>Source variant</dt><dd>{source.external_id}, <LanguageFlag code={source.language} />{source.language}, v{source.version}</dd></dl> : <p>Source text unavailable.</p>}</section>
      <section><h2>Translation</h2><dl><dt>Provider</dt><dd>{run.provider}</dd>
        {run.model && <><dt>Model</dt><dd>{run.model}</dd></>}
        <dt>Text</dt><dd><LanguageFlag code={current.language} />{current.language}, v{current.version}</dd></dl>
      </section>
      <section><h2>Translation review</h2><dl><dt>Translation status</dt><dd>{current.translation_status?.replaceAll('_', ' ') ?? 'Not recorded'}</dd>
        {current.status_reason && <><dt>Reason</dt><dd>{current.status_reason}</dd></>}
      </dl></section>
    </div>
    <details><summary>Technical details and checks</summary><dl>
      {run.run_id && <><dt>Run</dt><dd>{run.run_id}</dd></>}
      {run.recipe && <><dt>Recipe</dt><dd>{run.recipe}</dd></>}
      <dt>Document ID</dt><dd>{current.document_id}</dd>
      <dt>Text hash</dt><dd>{current.text_sha256}</dd>
    </dl><h2>{ancestor === current ? 'Translation-run checks' : 'Inherited translation-run checks'}</h2>
      <ul>{(run.checks ?? []).map((check, index) => <li key={index}>{check.code}: {check.passed ? 'passed' : 'failed'}{check.detail ? `, ${check.detail}` : ''}</li>)}</ul>
    </details>
  </details>;
}

/** Read-only check states of a submitted carry-forward submission (lead view); nothing without round inputs. */
function SubmissionCarriedChecks({ projectKey, documentId, submissionId }: { projectKey: string; documentId: string; submissionId: string }): JSX.Element | null {
  const key = JSON.stringify([projectKey, documentId, submissionId]);
  const [state, setState] = useState<{ key: string; value: SubmissionHistoryDetail | null; failed: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    api.getSubmissionHistory(projectKey, documentId, submissionId).then(value => { if (active) setState({ key, value, failed: false }); }, () => { if (active) setState({ key, value: null, failed: true }); });
    return () => { active = false; };
  }, [key]);
  const detail = state?.key === key ? state.value : null;
  const inputs = detail?.round_inputs ?? [];
  const termOf = (input: Pick<CarriedInputLike, 'source_snapshot' | 'target_snapshot'>) => (input.target_snapshot ?? input.source_snapshot).annotation;
  const labelFor = useTermLabels(projectKey, inputs.map(input => ({ layer_id: termOf(input).layer_id, term_id: termOf(input).term_id })));
  if (state?.key === key && state.failed) return <InlineMessage tone="warning">Carried check states are unavailable.</InlineMessage>;
  if (!detail || !inputs.length) return null;
  const items = carriedCheckItems(inputs, detail.round_input_resolutions ?? [], detail.annotations,
    ({ annotation }) => <TermName termId={annotation.term_id} label={labelFor(annotation.layer_id, annotation.term_id)} />);
  return <CarriedChecksReadOnly items={items} />;
}

export function CaseViewer({ projectKey, caseId, variant, show, annotations, compare, compareShow, username, onNavigate, documents }: CaseViewerProps): JSX.Element {
  const access = useVersionAccess(projectKey, username);
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
  // Old links carry `annotations=` (a JSON ref key); an unreadable value matches no layer.
  const selection = show ?? (annotations !== undefined ? legacyLayerKey(annotations) ?? annotations : 'text');
  const [detailState, setDetail] = useState<{ identity: object; retry: number; value: CaseDetail } | null>(null);
  const [caseError, setCaseError] = useState<{ identity: object; error: unknown } | null>(null);
  const detail = detailState?.identity === identity ? detailState.value : null;
  const detailFresh = detailState?.identity === identity && detailState.retry === retry;
  const selectedId = variant !== undefined ? variant : detail ? pickVariant(detail, languagesOf(detail)[0] ?? '') : null;
  const current = detail?.variants.find(row => row.document_id === selectedId);
  const closeComparison = () => {
    setCompareIdentity(null);
    if (compare !== undefined) onNavigate({ name: 'projectCase', key: projectKey, caseId, ...(variant !== undefined ? { variant } : {}),
      ...(selection !== 'text' ? { show: selection } : {}), ...(documents ? { documents } : {}) });
  };
  const contentIdentity = useMemo(() => ({ identity, selectedId, retry, allowed: access.allowed, loading: access.loading }), [identity, selectedId, retry, access.allowed, access.loading]);
  const [textState, setText] = useState<{ identity: object; value: VariantText } | null>(null);
  const [textError, setTextError] = useState<{ identity: object; error: unknown } | null>(null);
  const [tasks, setTasks] = useState<{ identity: object; value: TaskSummary[] } | null>(null);
  const [taskError, setTaskError] = useState<{ identity: object; error: unknown } | null>(null);
  // The server leaves out other people's work for non-leads (D3); leads also get older refs for the history links.
  const layers = useTextLayers(projectKey, access.loading || !current ? null : current.document_id, access.allowed, JSON.stringify([username, caseId, retry]));
  const ref = layers.refs ? refForLayer(selection, layers.refs) : null;
  const payloadIdentity = useMemo(() => ({ contentIdentity, selection }), [contentIdentity, selection]);
  const [payload, setPayload] = useState<{ identity: object; value: AnnotationVersion } | null>(null);
  const [payloadError, setPayloadError] = useState<{ identity: object; error: unknown } | null>(null);
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
    if (!current || access.loading) return;
    let active = true;
    setTextError(null);
    api.getVariantText(projectKey, current.document_id).then(value => { if (active) setText({ identity: contentIdentity, value }); }, error => { if (active) setTextError({ identity: contentIdentity, error }); });
    return () => { active = false; };
  }, [contentIdentity, current?.document_id, access.loading]);
  useEffect(() => {
    if (!current || !ref) return;
    let active = true;
    api.getAnnotationVersion(projectKey, current.document_id, ref.kind, ref.id).then(value => { if (active) setPayload({ identity: payloadIdentity, value }); }, error => { if (active) setPayloadError({ identity: payloadIdentity, error }); });
    return () => { active = false; };
  }, [payloadIdentity, ref?.kind, ref?.id]);
  // A deep-linked comparison stays open while the left side keeps its text version.
  const move = (documentId: string, selected = 'text') => {
    if (compareOpen) setCompareIdentity(identity);
    onNavigate({ name: 'projectCase', key: projectKey, caseId, variant: documentId, show: selected,
      ...(compare !== undefined && documentId === current?.document_id ? { compare, ...(compareShow !== undefined ? { compare_show: compareShow } : {}) } : {}),
      ...(documents ? { documents } : {}) });
  };
  const retryButton = <Button onClick={() => { if (access.error) access.retry(); setRetry(value => value + 1); }}>Retry</Button>;
  if (caseError?.identity === identity) return isNotAvailable(caseError.error)
    ? <NotFound title="Case not found or no access" reason="It does not exist in this project or you cannot see it." onNavigate={onNavigate} />
    : <section className="not-found"><ErrorNotice error={caseError.error} />{retryButton}</section>;
  if (access.loading || !detail) return <InlineMessage tone="info">Loading case...</InlineMessage>;
  if (!current) return <InlineMessage tone="info">This text version is not available to you.</InlineMessage>;
  const text = textState?.identity === contentIdentity ? textState.value : null;
  const supported = tasks?.identity === identity ? tasks.value.filter(row => row.project_key === projectKey && row.document_id === current.document_id) : [];
  const payloadFailed = payloadError?.identity === payloadIdentity;
  const layerLabel = layers.entries?.find(entry => entry.ref && layerKey(entry.ref) === selection)?.label ?? ref?.label ?? '';
  return <section className={`case-viewer${compareOpen ? " case-comparing" : ""}`} aria-label="Case viewer">
    <TextViewToolbar projectKey={projectKey} caseId={detail.case_id} language={current.language} documents={documents} onNavigate={onNavigate}>
      <VersionSelect caseDetail={detail} value={current.document_id} onChange={id => move(id)} />
      <ShowSelect entries={layers.entries ?? []} value={selection} otherLabel={ref?.label} onChange={key => move(current.document_id, key)} />
      {access.allowed && <Button ref={compareButton} size="sm" aria-expanded={compareOpen} onClick={() => compareOpen ? closeComparison() : setCompareIdentity(identity)}>Compare</Button>}
      <SubmissionHistory projectKey={projectKey} caseId={caseId} documentId={current.document_id} language={current.language} version={current.version}
        username={username} canManage={access.canManage} onNavigate={onNavigate} documents={documents} />
      {supported.map((task, index) => <a key={task.assignment_id} href={routeHref({ name: 'task', assignmentId: task.assignment_id })} className="btn btn-secondary btn-sm" onKeyDown={onSpaceActivate}
        onClick={event => { if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); onNavigate({ name: 'task', assignmentId: task.assignment_id }); }}>
        {supported.length === 1 ? 'Open my task' : `Open my ${task.task === 'annotate' ? 'annotation' : task.task === 'translation_review' ? 'translation review' : 'consolidation'} task${supported.filter(row => row.task === task.task).length > 1 ? ` (${index + 1})` : ''}`}
      </a>)}
    </TextViewToolbar>
    <VariantDetails detail={detail} documentId={current.document_id} />
    {access.canManage && <TranslationCorrectionAction projectKey={projectKey} variant={current} username={username}
      requiredLanguages={reviewLanguages(current.document_id, new Map(detail.variants.map(row => [row.document_id, row])))} />}
    {!!access.error && <><ErrorNotice error={access.error} />{retryButton}</>}
    {taskError?.identity === identity && <><ErrorNotice error={taskError.error} />{retryButton}</>}
    {!!layers.error && <><ErrorNotice error={layers.error} />{retryButton}</>}
    {layers.refs && selection !== 'text' && !ref && <InlineMessage tone="info">This annotation version is not available to you.</InlineMessage>}
    {payloadFailed && <><ErrorNotice error={payloadError.error} />{retryButton}</>}
    {ref?.kind === 'submission' && <SubmissionCarriedChecks projectKey={projectKey} documentId={current.document_id} submissionId={ref.id} />}
    <div className="comparison-reading">
    {compareOpen && <div className="comparison-toolbar-slot" ref={setComparisonToolbar} />}
    {textError?.identity === contentIdentity ? <><ErrorNotice error={textError.error} />{retryButton}</> : text ? <>
      {ref && !snapshot && !payloadFailed && <InlineMessage tone="info">Loading annotation version...</InlineMessage>}
      <ReadOnlyAnnotationView onTextElement={setLeftElement} key={JSON.stringify([username, projectKey, caseId, selectedId, selection, retry])} text={text.text} annotations={snapshot?.annotations ?? []} evidence={snapshot?.evidence ?? []} labelFor={labelFor} proposalContext={ref?.kind === "proposals" && snapshot ? {projectKey,documentId:current.document_id,scope:JSON.stringify([username,projectKey,caseId,selectedId,selection,retry]),setId:ref.id} : undefined} />
    </> : <InlineMessage tone="info">Loading text...</InlineMessage>}
    {snapshot && <LayerFindings key={selection} label={layerLabel} annotations={snapshot.annotations} labelFor={labelFor} />}
      {compareOpen && <ComparePane layers projectKey={projectKey} username={username} caseDetail={detail} leftDocumentId={current.document_id}
        leftText={text?.text ?? ""} leftElement={text ? leftElement : null} suspended={!text || !detailFresh} leftContext={JSON.stringify([selectedId, selection, retry])} onClose={closeComparison} toolbarHost={comparisonToolbar}
        initialRight={compare !== undefined ? { documentId: compare, refKey: compareShow ?? 'text' } : undefined} />}
      </div>
  </section>;
}
