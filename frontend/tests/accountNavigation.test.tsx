import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, AuthError, ApiClient } from '../src/api/client';
import { AuthGate } from '../src/app/AuthGate';
import { testUser } from './session';

vi.mock('../src/App', () => ({ App: ({ user, onLogout }: any) => <div>
  <span>{user.display_name} workspace</span><button onClick={onLogout}>Log out</button>
</div> }));

beforeEach(() => { window.history.replaceState(null, '', '#/tasks/42'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); api.setCsrfToken(null); });

async function login(username: string) {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
  await screen.findByText(`${username} workspace`);
}

it('clears a stale task after explicit logout followed by another account, keeping same-user recovery', async () => {
  vi.spyOn(api, 'me').mockResolvedValue(testUser('alice'));
  vi.spyOn(api, 'logout').mockResolvedValue();
  vi.spyOn(api, 'login').mockResolvedValueOnce(testUser('alice')).mockResolvedValueOnce(testUser('bob'));
  render(<AuthGate />);
  await screen.findByText('alice workspace');
  fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
  await screen.findByRole('button', { name: 'Log in' });
  await login('alice');
  expect(window.location.hash).toBe('#/tasks/42');
  fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
  await screen.findByRole('button', { name: 'Log in' });
  await login('bob');
  expect(window.location.hash).toBe('#/');
});

it('retains a fresh-tab deep link without a previous identity', async () => {
  vi.spyOn(api, 'me').mockRejectedValue(new AuthError('Login required', undefined, 'NOT_AUTHENTICATED', 401));
  vi.spyOn(api, 'login').mockResolvedValue(testUser('bob'));
  render(<AuthGate />);
  await screen.findByRole('button', { name: 'Log in' });
  await login('bob');
  expect(window.location.hash).toBe('#/tasks/42');
});

it('lands on tasks after a cross-tab identity change and a rejected CSRF write', async () => {
  api.setCsrfToken('alice-token');
  vi.spyOn(api, 'me').mockResolvedValueOnce(testUser('alice', { csrf_token: 'alice-token' }))
    .mockResolvedValueOnce(testUser('bob', { csrf_token: 'bob-token' }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403,
    json: async () => ({ code: 'CSRF_FAILED', details: 'Token changed' }) }));
  render(<AuthGate />);
  await screen.findByText('alice workspace');
  await act(async () => { await new ApiClient().updatePreferences({ mode_by_package: {} }).catch(() => {}); });
  await waitFor(() => expect(screen.queryByText('bob workspace')).toBeTruthy());
  expect(window.location.hash).toBe('#/');
});

