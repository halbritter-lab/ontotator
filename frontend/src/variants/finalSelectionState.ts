import { useCallback, useEffect, useState } from 'react';
import { api, type FinalPreflight } from '../api/client';

export const FINAL_SELECTION_CHANGED = 'ontocurator:final-selection-changed';
export function notifyFinalSelectionChanged(projectKey: string): void {
  window.dispatchEvent(new CustomEvent(FINAL_SELECTION_CHANGED, { detail: { projectKey } }));
}

/** Read the shared server projection; a successful explicit mutation invalidates
 * every mounted view of this project without inferring a replacement result.
 */
export function useFinalSelectionState(projectKey: string, username = '', enabled = true) {
  const [revision, setRevision] = useState(0);
  const identity = JSON.stringify([projectKey, username, revision, enabled]);
  const [result, setResult] = useState<{ identity: string; value?: FinalPreflight; error?: unknown } | null>(null);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ projectKey?: string }>).detail?.projectKey === projectKey) reload();
    };
    window.addEventListener(FINAL_SELECTION_CHANGED, changed);
    return () => window.removeEventListener(FINAL_SELECTION_CHANGED, changed);
  }, [projectKey, enabled, reload]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api.getWorkflowWarnings(projectKey).then(value => {
      if (!active) return;
      if (value.project !== projectKey) setResult({ identity, error: new Error('Final results are unavailable for this project.') });
      else setResult({ identity, value });
    }, error => { if (active) setResult({ identity, error }); });
    return () => { active = false; };
  }, [identity, projectKey, enabled]);
  const current = enabled && result?.identity === identity ? result : null;
  return { state: current?.value, error: current?.error, loading: enabled && !current, reload, identity };
}
