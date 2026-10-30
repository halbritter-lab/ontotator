/**
 * Data of the consolidation view (acceptance fixes spec "WP-E Frontend", X8): the read, the group commands
 * (resolve / annotate / reopen as MutationEnvelopes on the round's workspace), "Add finding" through the
 * existing draft save, and the submit. Commands run one after another on the latest draft revision; after
 * each one the view is read again, so states, kinds and read-only reasons always come from the server.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type ConsolidationAnnotatePayload, type ConsolidationReopenPayload, type ConsolidationResolvePayload, type ConsolidationView, type Draft, type MutationEnvelope, type Submission } from "../api/client";
import type { WorkspaceView } from "../app/CaseScreen";
import { randomId } from "../editor/ids";

export type GroupOutcome =
  | { kind: "conflict"; onReview: () => void }
  | { kind: "error"; onRetry: () => void };

export type AxisWarning = {
  acknowledgement: { draft_revision: number; policy_revision: number; warning_digest: string };
  /** Value warnings (`axis_not_chosen`). */
  count: number;
  /** Findings with a modifier warning (cohort term or two of one kind, D-f). */
  modifiers: number;
  /** Findings whose term is a modifier term (`modifier_as_finding`, #57). */
  asFinding: number;
};

const MODIFIER_RULES = new Set(["modifier_as_finding", "cohort_modifier", "exclusive_modifier_class"]);

export type SubmitResult = { kind: "submitted"; submission: Submission } | { kind: "warning"; warning: AxisWarning };

export interface NewFinding {
  annotationId: string;
  layerId: string;
  typeId: string;
  termId: string;
  searchId?: string;
  segments: { start: number; end: number }[];
  axes: Record<string, string | null>;
}

/** The advisory value and modifier warnings of a submit (`AXIS_CONFIRMATION_WARNING`), or null. */
export function axisWarningOf(error: unknown): AxisWarning | null {
  if (!(error instanceof ApiError) || error.code !== "AXIS_CONFIRMATION_WARNING" || typeof error.details !== "object" || !error.details) return null;
  const acknowledgement = error.details.acknowledgement as AxisWarning["acknowledgement"] | undefined;
  if (!acknowledgement || !Number.isSafeInteger(acknowledgement.draft_revision) || !Number.isSafeInteger(acknowledgement.policy_revision)
    || typeof acknowledgement.warning_digest !== "string" || !acknowledgement.warning_digest) return null;
  const warnings = (Array.isArray(error.details.warnings) ? error.details.warnings : []) as { annotation_id?: string; rule?: string }[];
  const modifiers = warnings.filter(warning => MODIFIER_RULES.has(warning?.rule ?? ""));
  const findings = (rule: (name: string) => boolean) => new Set(modifiers.filter(warning => rule(warning.rule ?? "")).map(warning => warning.annotation_id)).size;
  return { acknowledgement, count: warnings.length - modifiers.length, modifiers: findings(rule => rule !== "modifier_as_finding"),
    asFinding: findings(rule => rule === "modifier_as_finding") };
}

const isConflict = (error: unknown) => error instanceof ApiError && error.status === 409;

export function useConsolidation(roundId: string, options: { workspaceView?: WorkspaceView | null } = {}) {
  const [view, setView] = useState<ConsolidationView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(options.workspaceView ?? null);
  const [draft, setDraft] = useState<Draft | null>(options.workspaceView?.draft ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, GroupOutcome>>({});
  const [load, setLoad] = useState(0);
  const revision = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const apply = (value: ConsolidationView) => { revision.current = value.draft_revision; setView(value); };

  useEffect(() => {
    let active = true;
    setError(null);
    api.getConsolidation(roundId).then(value => {
      if (!active) return;
      apply(value); setOutcomes({});
      if (!value.read_only && !options.workspaceView && value.workspace_id) {
        // The editor view supplies layers, axis definitions and creation defaults for "Add finding",
        // "Edit values…" and "Other term…"; the view works without it.
        api.openWorkRound(roundId).then(opened => {
          if (!active) return;
          setWorkspace(opened.view); setDraft(current => current ?? opened.view.draft);
        }, () => undefined);
      }
    }, failure => { if (active) setError(failure); });
    return () => { active = false; };
  }, [roundId, load]);

  const refresh = useCallback(async () => {
    try { const value = await api.getConsolidation(roundId); if (alive.current) { apply(value); setRefreshError(null); } }
    catch (failure) { if (alive.current) setRefreshError(failure); }
  }, [roundId]);

  const reload = useCallback(() => setLoad(value => value + 1), []);

  /** Runs one workspace command after the previous one; true when it was saved. */
  const command = useCallback((groupId: string, call: (workspaceId: string, envelope: MutationEnvelope) => Promise<Draft>, payload: object): Promise<boolean> => {
    const workspaceId = view?.workspace_id;
    if (!workspaceId || view?.read_only) return Promise.resolve(false);
    const mutationId = randomId();
    let envelope: MutationEnvelope | undefined;
    const attempt = (): Promise<boolean> => {
      const run = queue.current.then(async () => {
        if (!alive.current) return false;
        setBusy(groupId);
        setOutcomes(current => { const next = { ...current }; delete next[groupId]; return next; });
        envelope ??= { mutation_id: mutationId, expected_revision: revision.current, payload: payload as Record<string, unknown> };
        try {
          const saved = await call(workspaceId, envelope);
          if (!alive.current) return false;
          revision.current = saved.revision; setDraft(saved);
          await refresh();
          return true;
        } catch (failure) {
          if (!alive.current) return false;
          const outcome: GroupOutcome = isConflict(failure)
            ? { kind: "conflict", onReview: () => { setOutcomes({}); reload(); } }
            : { kind: "error", onRetry: () => { void attempt(); } };
          setOutcomes(current => ({ ...current, [groupId]: outcome }));
          return false;
        } finally { if (alive.current) setBusy(current => current === groupId ? null : current); }
      });
      queue.current = run.catch(() => undefined);
      return run;
    };
    return attempt();
  }, [view?.workspace_id, view?.read_only, refresh, reload]);

  const resolve = useCallback((groupId: string, payload: ConsolidationResolvePayload) =>
    command(groupId, (id, envelope) => api.resolveConsolidationGroup(id, envelope), payload), [command]);
  const annotate = useCallback((groupId: string, payload: ConsolidationAnnotatePayload) =>
    command(groupId, (id, envelope) => api.annotateConsolidationGroup(id, envelope), payload), [command]);
  const reopen = useCallback((groupId: string, payload: ConsolidationReopenPayload) =>
    command(groupId, (id, envelope) => api.reopenConsolidationGroup(id, envelope), payload), [command]);

  const reopenAll = useCallback(() => command("reopen-all", (id, envelope) => api.reopenAllConsolidationGroups(id, envelope),
    { command: "consolidation_reopen_all" }), [command]);
  const undoReopenAll = useCallback(() => command("reopen-all", (id, envelope) => api.undoReopenAllConsolidationGroups(id, envelope),
    { command: "consolidation_undo_reopen_all" }), [command]);

  /** "Add finding": the editor's `create_annotation` command on the same draft. */
  const addFinding = useCallback((finding: NewFinding): Promise<boolean> => command("add-finding", (id, envelope) => api.applyCommand(id, envelope), {
    command: "create_annotation",
    annotation_id: finding.annotationId,
    evidence_id: `ev-${randomId()}`,
    layer_id: finding.layerId,
    type_id: finding.typeId,
    term_id: finding.termId,
    ...(finding.searchId ? { search_event_id: finding.searchId } : {}),
    segments: finding.segments,
    axes_values: finding.axes,
    chosen_axis_ids: [],
  }), [command]);

  /** The values of an added finding (#178): the editor's `set_axes`; every set value counts as chosen, not a default. */
  const setAddedValues = useCallback((annotationId: string, axes: Readonly<Record<string, string | null>>): Promise<boolean> =>
    command("add-finding", (id, envelope) => api.applyCommand(id, envelope), {
      command: "set_axes",
      annotation_id: annotationId,
      axes_values: axes,
      chosen_axis_ids: Object.keys(axes).filter(axis => !!axes[axis]),
    }), [command]);

  const submit = useCallback(async (acknowledgement?: AxisWarning["acknowledgement"]): Promise<SubmitResult> => {
    const workspaceId = view?.workspace_id;
    if (!workspaceId) throw new Error("This consolidation is read-only.");
    const envelope: MutationEnvelope = { mutation_id: randomId(), expected_revision: revision.current, payload: {
      command: "submit_workspace",
      // The summary dialog is the explicit "whole text checked" confirmation.
      document_checked: true,
      ...(acknowledgement ? { warning_acknowledgement: acknowledgement } : {}),
    } };
    const run = queue.current.then(async (): Promise<SubmitResult> => {
      try {
        const submission = await api.submitWorkspace(workspaceId, envelope);
        await refresh();
        return { kind: "submitted", submission };
      } catch (failure) {
        const warning = axisWarningOf(failure);
        if (warning) return { kind: "warning", warning };
        throw failure;
      }
    });
    queue.current = run.catch(() => undefined);
    return run;
  }, [view?.workspace_id, refresh]);

  const dismissOutcome = useCallback((groupId: string) => setOutcomes(current => { const next = { ...current }; delete next[groupId]; return next; }), []);

  return { view, error, refreshError, workspace, draft, busy, outcomes, reload, refresh, resolve, annotate, reopen, reopenAll, undoReopenAll, addFinding, setAddedValues, submit, dismissOutcome };
}

export type ConsolidationData = ReturnType<typeof useConsolidation>;
