import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/api/client';
import { TranslationCorrectionAction } from '../src/variants/TranslationCorrectionAction';
import { variant } from './variantFixtures';
import { assignment } from './assignmentFixtures';

const document = variant('accepted-corrected', { origin: 'correction', version: 3, translation_status: 'accepted', text_sha256: 'immutable-text-hash' });
const props = { projectKey: 'p', variant: document, username: 'lead', requiredLanguages: ['en', 'de'] };
beforeEach(() => {
  vi.spyOn(api, 'listMembers').mockResolvedValue([{ username: 'reviewer', display_name: 'Bilingual reviewer', pseudonym: 'R', roles: ['annotator'], languages: ['en', 'de'] }]);
  vi.spyOn(api, 'assignTranslationCorrection').mockResolvedValue({ ...assignment, id: 27, task: 'translation_review', project_key: 'p', document_id: document.document_id, username: 'reviewer' });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('requests a repeat review of the exact accepted corrected text only after reviewer and reason are explicit', async () => {
  const genericAssign = vi.spyOn(api, 'createAssignments');
  render(<TranslationCorrectionAction {...props} />);
  expect(api.listMembers).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Request translation correction' }));
  await screen.findByLabelText('Translation reviewer');
  expect(screen.getByRole('button', { name: 'Assign correction review' })).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('Translation reviewer'), { target: { value: 'reviewer' } });
  fireEvent.change(screen.getByLabelText('Reason for another review'), { target: { value: 'Check the source wording again' } });
  fireEvent.click(screen.getByRole('button', { name: 'Assign correction review' }));
  await screen.findByText(/Translation correction assigned to Bilingual reviewer/);
  expect(api.assignTranslationCorrection).toHaveBeenCalledWith('p', 'accepted-corrected', { username: 'reviewer', expected_text_sha256: 'immutable-text-hash', reason: 'Check the source wording again', confirm_language: false });
  expect(genericAssign).not.toHaveBeenCalled();
});

it('keeps the exact identity and reason after a stale correction request without choosing a newer version', async () => {
  vi.mocked(api.assignTranslationCorrection).mockRejectedValue(new ApiError(409, 'This text has changed', 'REVISION_CONFLICT'));
  const getNewer = vi.spyOn(api, 'getCase');
  render(<TranslationCorrectionAction {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Request translation correction' }));
  await screen.findByLabelText('Translation reviewer');
  fireEvent.change(screen.getByLabelText('Translation reviewer'), { target: { value: 'reviewer' } });
  fireEvent.change(screen.getByLabelText('Reason for another review'), { target: { value: 'Preserved reason' } });
  fireEvent.click(screen.getByRole('button', { name: 'Assign correction review' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Reason for another review')).toHaveProperty('value', 'Preserved reason');
  expect(api.assignTranslationCorrection).toHaveBeenCalledTimes(1);
  expect(getNewer).not.toHaveBeenCalled();
});

it('requires explicit missing-language confirmation and does not offer native text as a translation correction', async () => {
  vi.mocked(api.listMembers).mockResolvedValue([{ username: 'reviewer', display_name: 'Bilingual reviewer', pseudonym: 'R', roles: ['annotator'], languages: ['de'] }]);
  const view = render(<TranslationCorrectionAction {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Request translation correction' }));
  await screen.findByLabelText('Translation reviewer');
  fireEvent.change(screen.getByLabelText('Translation reviewer'), { target: { value: 'reviewer' } });
  fireEvent.change(screen.getByLabelText('Reason for another review'), { target: { value: 'Check source wording' } });
  expect(screen.getByRole('button', { name: 'Assign correction review' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox', { name: /missing en/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Assign correction review' }));
  await screen.findByText(/Translation correction assigned/);
  expect(api.assignTranslationCorrection).toHaveBeenCalledWith('p', 'accepted-corrected', expect.objectContaining({ confirm_language: true }));
  view.rerender(<TranslationCorrectionAction {...props} variant={variant('native', { translation_status: null })} />);
  expect(screen.queryByRole('button', { name: 'Request translation correction' })).toBeNull();
});
