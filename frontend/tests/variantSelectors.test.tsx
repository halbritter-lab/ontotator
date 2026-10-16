import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { caseDetail, ownRef } from './variantFixtures';
import { annotationOptions, refKey } from '../src/variants/versionState';

afterEach(cleanup);
it('uses exact variant IDs for equal version runs and controlled selector state', async () => {
  const { VariantSelectors } = await import('../src/variants/VariantSelectors');
  const onVersion = vi.fn(), onLanguage = vi.fn(), onAnnotation = vi.fn();
  const props = { caseDetail, currentDocumentId: 'target', annotationOptions: annotationOptions([ownRef], true),
    selectedAnnotation: 'draft', onVersion, onLanguage, onAnnotation };
  const view = render(<VariantSelectors {...props} />);
  const version = screen.getByLabelText('Text version') as HTMLSelectElement;
  expect(version.value).toBe('target');
  expect(new Set(Array.from(version.options).map(option => option.text)).size).toBe(2);
  fireEvent.change(version, { target: { value: 'other-run' } });
  expect(onVersion).toHaveBeenCalledWith('other-run');
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'en' } });
  expect(onLanguage).toHaveBeenCalledWith('en');
  fireEvent.change(screen.getByLabelText('Annotations'), { target: { value: refKey(ownRef) } });
  expect(onAnnotation).toHaveBeenCalledWith(refKey(ownRef));
  view.rerender(<VariantSelectors {...props} currentDocumentId="other-run" />);
  expect(screen.getByLabelText('Text version')).toBe(version);
  expect(version.value).toBe('other-run');
});
it('keeps disabled language/version singletons and a local Text only option', async () => {
  const { VariantSelectors } = await import('../src/variants/VariantSelectors');
  render(<VariantSelectors caseDetail={{ ...caseDetail, variants: [caseDetail.variants[0]] }} currentDocumentId="source"
    annotationOptions={[]} selectedAnnotation="text" onLanguage={vi.fn()} onVersion={vi.fn()} onAnnotation={vi.fn()} />);
  expect((screen.getByLabelText('Language') as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByLabelText('Text version') as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByLabelText('Annotations') as HTMLSelectElement).value).toBe('text');
});
