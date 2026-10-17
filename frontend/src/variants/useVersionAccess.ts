import { useEffect, useState } from 'react';
import { api } from '../api/client';

/** Affordance only; every payload read still rechecks current server authority. */
export function useVersionAccess(projectKey: string, username: string): { allowed: boolean; loading: boolean; error: unknown; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const identity = JSON.stringify([projectKey, username, attempt]);
  const [state, setState] = useState<{ identity: string; allowed: boolean; error: unknown } | null>(null);
  useEffect(() => {
    let active = true;
    api.listProjects().then(projects => {
      const project = projects.find(row => row.project_key === projectKey);
      if (active) setState({ identity, allowed: !!project && (project.can_manage || project.roles.includes('lead') || project.roles.includes('adjudicator')), error: null });
    }, error => { if (active) setState({ identity, allowed: false, error }); });
    return () => { active = false; };
  }, [identity]);
  const current = state?.identity === identity ? state : null;
  return { allowed: current?.allowed ?? false, loading: !current, error: current?.error ?? null, retry: () => setAttempt(value => value + 1) };
}
