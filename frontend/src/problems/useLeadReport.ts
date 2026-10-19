import { useCallback, useEffect, useRef, useState } from "react";
import { api, type PauseCandidate, type ProblemReportView } from "../api/client";

export interface LeadReportState {
  report: ProblemReportView | null;
  /** The last load failure; only shown while no report is loaded. */
  error: unknown;
  loading: boolean;
  /** Loads the report again; resolves to the fresh view, or null when the load failed or was superseded. */
  reload: () => Promise<ProblemReportView | null>;
  /** Replaces the view with an action response; discards loads still in flight. */
  replace: (view: ProblemReportView) => void;
  candidates: PauseCandidate[] | null;
  candidatesError: unknown;
  candidatesLoading: boolean;
  /** Loads the "Pause other tasks" candidates; cached until `force` or the next action. */
  loadCandidates: (force?: boolean) => void;
}

/** The lead's view of one report plus the lazily loaded pause candidates. Late responses never overwrite newer ones. */
export function useLeadReport(reportId: string, enabled = true): LeadReportState {
  const [report, setReport] = useState<ProblemReportView | null>(null);
  const [error, setError] = useState<unknown>(undefined);
  const [loading, setLoading] = useState(enabled);
  const [candidates, setCandidates] = useState<PauseCandidate[] | null>(null);
  const [candidatesError, setCandidatesError] = useState<unknown>(undefined);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const alive = useRef(true), loadSeq = useRef(0), candidateSeq = useRef(0), candidatesLoaded = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const reload = useCallback(async (): Promise<ProblemReportView | null> => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const view = await api.getProblemReport(reportId);
      if (!alive.current || seq !== loadSeq.current) return null;
      setReport(view); setError(undefined); setLoading(false);
      return view;
    } catch (failure) {
      if (alive.current && seq === loadSeq.current) { setError(failure); setLoading(false); }
      return null;
    }
  }, [reportId]);

  useEffect(() => {
    setReport(null); setCandidates(null); candidatesLoaded.current = false;
    if (!enabled) { setLoading(false); return; }
    void reload();
    return () => { loadSeq.current++; candidateSeq.current++; };
  }, [enabled, reload]);

  const replace = useCallback((view: ProblemReportView) => {
    loadSeq.current++;
    setReport(view); setError(undefined); setLoading(false);
    // Pause state changed: the next picker opening asks again.
    candidatesLoaded.current = false;
  }, []);

  const loadCandidates = useCallback((force = false) => {
    if (candidatesLoaded.current && !force) return;
    candidatesLoaded.current = true;
    const seq = ++candidateSeq.current;
    setCandidatesLoading(true); setCandidatesError(undefined);
    api.listPauseCandidates(reportId).then(list => {
      if (!alive.current || seq !== candidateSeq.current) return;
      setCandidates(list); setCandidatesLoading(false);
    }, failure => {
      if (!alive.current || seq !== candidateSeq.current) return;
      candidatesLoaded.current = false;
      setCandidatesError(failure); setCandidatesLoading(false);
    });
  }, [reportId]);

  return { report, error, loading, reload, replace, candidates, candidatesError, candidatesLoading, loadCandidates };
}
