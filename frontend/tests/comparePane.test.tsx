import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError, type VariantText } from '../src/api/client';
import { caseDetail, historical, ownRef, variant } from './variantFixtures';
import { refKey } from '../src/variants/versionState';
import { ComparePane } from '../src/variants/ComparePane';

const props = { projectKey: 'pkg', username: 'alice', caseDetail, leftDocumentId: 'target',
  leftText: 'left\n\nsecond', leftElement: null, leftContext: 'draft', onClose: vi.fn() };
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(api, 'getVariantText').mockImplementation(async (_project, doc) => ({ document_id: doc, text: `Immutable ${doc}`, text_sha256: 'text' }));
  vi.spyOn(api, 'listAnnotationVersions').mockResolvedValue([ownRef]);
  vi.spyOn(api, 'getAnnotationVersion').mockResolvedValue(historical);
  vi.spyOn(api, 'resolveTermLabels').mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('defaults a translation to exact source Text only and renders live paragraph markers/count warning', async () => {
  render(<ComparePane {...props} />);
  await screen.findByText('Immutable source');
  expect(api.getVariantText).toHaveBeenCalledWith('pkg', 'source');
  expect(api.getAnnotationVersion).not.toHaveBeenCalled();
  expect(screen.getByLabelText<HTMLSelectElement>('Annotations').value).toBe('text');
  expect(screen.getByText('Paragraphs differ (2 / 1); scrolling is approximate.')).toBeTruthy();
  expect((screen.getByRole('checkbox', { name: 'Couple scrolling' }) as HTMLInputElement).checked).toBe(true);
  expect(document.querySelectorAll('[data-paragraph]')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close comparison' }));
  expect(props.onClose).toHaveBeenCalled();
});
it('follows correction metadata to original translation source, refusing cycles without a guessed sibling', async () => {
  const corrected = variant('correction', { origin: 'correction', derived_from: 'middle', translation: null, version: 3 });
  const middle = variant('middle', { origin: 'correction', derived_from: 'target', version: 2 });
  const detail = { ...caseDetail, variants: [...caseDetail.variants, middle, corrected] };
  const mounted = render(<ComparePane {...props} caseDetail={detail} leftDocumentId="correction" />);
  await screen.findByText('Immutable source');
  mounted.rerender(<ComparePane {...props} caseDetail={{ ...detail, variants: [...caseDetail.variants, { ...middle, derived_from: 'correction' }, corrected] }} leftDocumentId="correction" />);
  await screen.findByText('Original source is not available; choose a comparison text.');
  expect(screen.queryByText('Immutable source')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Compare current text' }));
  await screen.findByText('Immutable correction');
});
it('defaults native text to newest actually offered timestamp, stable ties and no draft option', async () => {
  const newer = { ...ownRef, id: 'new', label: 'New immutable', created_at: '2026-10-17T00:00:00Z' };
  vi.mocked(api.listAnnotationVersions).mockResolvedValue([ownRef, newer, { ...newer, id: 'tie', label: 'Same time' }]);
  render(<ComparePane {...props} leftDocumentId="source" />);
  await screen.findByText('HP:old');
  expect(api.getAnnotationVersion).toHaveBeenCalledWith('pkg', 'source', 'own', 'new');
  expect(screen.queryByRole('option', { name: 'My draft' })).toBeNull();
  expect([...screen.getByLabelText<HTMLSelectElement>('Annotations').options].map(option => option.text)).toEqual(['Text only', ownRef.label, 'New immutable', 'Same time']);
});
it('uses exact selected equal-v1 document IDs and current offered refs, preserving text on payload refusal', async () => {
  render(<ComparePane {...props} />); await screen.findByText('Immutable source');
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'de' } });
  await screen.findByText('Immutable other-run');
  fireEvent.change(screen.getByLabelText('Text version'), { target: { value: 'target' } });
  await screen.findByText('Immutable target');
  vi.mocked(api.getAnnotationVersion).mockRejectedValue(new ApiError(404, 'No longer offered', 'VERSION_NOT_FOUND'));
  fireEvent.change(screen.getByLabelText('Annotations'), { target: { value: refKey(ownRef) } });
  await waitFor(() => expect(api.getAnnotationVersion).toHaveBeenCalledWith('pkg', 'target', 'own', ownRef.id));
  await screen.findByText('This annotation version is not available to you.');
  expect(screen.queryByText('HP:old')).toBeNull(); expect(screen.getByText('Immutable target')).toBeTruthy();
});
it('drops late protected replies and explicit choices survive refs arriving', async () => {
  let finish!: (value: VariantText) => void;
  vi.mocked(api.getVariantText).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const mounted = render(<ComparePane {...props} />);
  await waitFor(() => expect(api.getVariantText).toHaveBeenCalledWith('pkg', 'source'));
  mounted.rerender(<ComparePane {...props} username="bob" leftDocumentId="other-run" />);
  await screen.findByText('Immutable source');
  await act(async () => finish({ document_id: 'source', text: 'STALE PRIVATE', text_sha256: 'text' }));
  expect(screen.queryByText('STALE PRIVATE')).toBeNull();
});

it('keeps an explicit Text only choice when native refs arrive later', async () => {
  let finish!: (value: typeof ownRef[]) => void;
  vi.mocked(api.listAnnotationVersions).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<ComparePane {...props} leftDocumentId="source" />);
  await screen.findByText('Immutable source');
  fireEvent.change(screen.getByLabelText('Annotations'), { target: { value: 'text' } });
  await act(async () => finish([ownRef]));
  expect(screen.getByLabelText<HTMLSelectElement>('Annotations').value).toBe('text');
  expect(api.getAnnotationVersion).not.toHaveBeenCalled();
});
it('controls actual paired scrollports with the checkbox without modifying the left text', async () => {
  const left = document.createElement('div'); document.body.appendChild(left);
  left.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
  for (const [index, offset] of [0, 200].entries()) {
    const marker = document.createElement('span'); marker.dataset.paragraph = String(index);
    marker.getBoundingClientRect = () => ({ top: 100 + offset - left.scrollTop } as DOMRect); left.appendChild(marker);
  }
  vi.mocked(api.getVariantText).mockResolvedValue({ document_id: 'source', text: 'one\n\ntwo\n\nthree', text_sha256: 'text' });
  const mounted = render(<ComparePane {...props} leftElement={left} />);
  await waitFor(() => expect(mounted.container.querySelectorAll('[data-paragraph]')).toHaveLength(3));
  const right = mounted.container.querySelector<HTMLElement>('.text-container')!;
  right.getBoundingClientRect = () => ({ top: 600 } as DOMRect);
  right.querySelectorAll<HTMLElement>('[data-paragraph]').forEach((marker, index) => {
    marker.getBoundingClientRect = () => ({ top: 600 + index * 300 - right.scrollTop } as DOMRect);
  });
  left.scrollTop = 225; fireEvent.scroll(left); expect(right.scrollTop).toBe(600);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Couple scrolling' }));
  right.scrollTop = 0; fireEvent.scroll(left); expect(right.scrollTop).toBe(0);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Couple scrolling' }));
  fireEvent.scroll(left); expect(right.scrollTop).toBe(600);
  left.remove();
});

it('preserves explicit right choices across left annotation/context and case metadata refresh while reauthorizing payload', async () => {
  const mounted = render(<ComparePane {...props} />);
  await screen.findByText('Immutable source');
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'de' } });
  await screen.findByText('Immutable other-run');
  fireEvent.change(screen.getByLabelText('Text version'), { target: { value: 'target' } });
  await screen.findByText('Immutable target');
  fireEvent.change(screen.getByLabelText('Annotations'), { target: { value: refKey(ownRef) } });
  await screen.findByText('HP:old');
  let finishRefs!: (value: typeof ownRef[]) => void;
  let finishPayload!: (value: typeof historical) => void;
  vi.mocked(api.listAnnotationVersions).mockImplementationOnce(() => new Promise(resolve => { finishRefs = resolve; }));
  vi.mocked(api.getAnnotationVersion).mockImplementationOnce(() => new Promise(resolve => { finishPayload = resolve; }));
  mounted.rerender(<ComparePane {...props} leftContext="immutable snapshot" caseDetail={{ ...caseDetail, variants: [...caseDetail.variants] }} />);
  expect(screen.getByLabelText<HTMLSelectElement>('Text version').value).toBe('target');
  expect(screen.getByLabelText<HTMLSelectElement>('Annotations').value).toBe(refKey(ownRef));
  expect(screen.queryByText('HP:old')).toBeNull();
  await waitFor(() => expect(api.listAnnotationVersions).toHaveBeenLastCalledWith('pkg', 'target'));
  await act(async () => finishRefs([ownRef]));
  await waitFor(() => expect(api.getAnnotationVersion).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('HP:old')).toBeNull();
  await act(async () => finishPayload(historical));
  await screen.findByText('HP:old');
});
