import { useEffect, useState } from 'react';
import { api, type CaseDetail, type VersionRef } from '../api/client';

/** Workspace identity is not case identity: resolve the bounded server metadata first. */
export function useCaseVersions(project: string, documentId: string, context: { assignmentId: number } | undefined, identity: string) {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ identity: string; detail: CaseDetail; refs: VersionRef[] } | null>(null);
  const [error, setError] = useState<{ identity: string; error: unknown } | null>(null);
  useEffect(() => {
    if (!context) return;
    let active = true;
    setError(null);
    void api.getVariantMetadata(project, documentId).then(async metadata => {
      if (!active) return;
      const detail = await api.getCase(project, metadata.case_id);
      if (!active) return;
      let refs: VersionRef[] = [];
      try { refs = await api.listAnnotationVersions(project, documentId, context.assignmentId); }
      catch (failure) { if (active) setError({ identity, error: failure }); }
      if (active) setState({ identity, detail, refs });
    }).catch(failure => { if (active) setError({ identity, error: failure }); });
    return () => { active = false; };
  }, [project, documentId, identity, retry]);
  return { versions: state?.identity === identity ? state : null,
    versionError: error?.identity === identity ? error.error : null,
    setVersionError: (failure: unknown) => setError(failure ? { identity, error: failure } : null),
    retryVersions: () => { setState(null); setRetry(value => value + 1); } };
}
