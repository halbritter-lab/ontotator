import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api, type ProjectSummary } from '../src/api/client';
import { useVersionAccess } from '../src/variants/useVersionAccess';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const project = (key: string, roles: ProjectSummary['roles'], can_manage = false): ProjectSummary => ({ project_key: key, roles, can_manage } as ProjectSummary);

it.each([['annotator', false], ['lead', true], ['adjudicator', true]] as const)('derives current %s capability and denies while loading', async (role, allowed) => {
  vi.spyOn(api, 'listProjects').mockResolvedValue([project('p', [role])]);
  const { result } = renderHook(() => useVersionAccess('p', 'alice'));
  expect(result.current.allowed).toBe(false);
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.allowed).toBe(allowed);
});

it('keeps role unions and administrative capability within their project', async () => {
  vi.spyOn(api, 'listProjects').mockResolvedValue([project('p', ['annotator', 'adjudicator']), project('q', ['annotator']), project('admin', [], true)]);
  const { result, rerender } = renderHook(({ key }) => useVersionAccess(key, 'alice'), { initialProps: { key: 'p' } });
  await waitFor(() => expect(result.current.allowed).toBe(true));
  rerender({ key: 'q' });
  expect(result.current.allowed).toBe(false);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.allowed).toBe(false);
  rerender({ key: 'admin' });
  await waitFor(() => expect(result.current.allowed).toBe(true));
});

it('denies failures, recovers on retry, and discards a prior identity response', async () => {
  let finish!: (value: ProjectSummary[]) => void;
  const request = vi.spyOn(api, 'listProjects').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue([project('p', ['lead'])]);
  const { result, rerender } = renderHook(({ username }) => useVersionAccess('p', username), { initialProps: { username: 'alice' } });
  rerender({ username: 'bob' });
  await waitFor(() => expect(result.current.error).toBeTruthy());
  await act(async () => finish([project('p', ['lead'])]));
  expect(result.current.allowed).toBe(false);
  act(() => result.current.retry());
  expect(result.current.allowed).toBe(false);
  await waitFor(() => expect(result.current.allowed).toBe(true));
  expect(request).toHaveBeenCalledTimes(3);
});
