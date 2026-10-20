/**
 * Pipeline blocks of an expanded Documents row (spec "Screens › Documents › Expanded row"):
 * one block per planned stage ("Translation review", "Annotation", "Final result") with a
 * status badge, people, times and links; the current stage carries an accent top edge.
 * Facts already in the table (next step, owner, plan chips) are not repeated.
 */
import { useId, type ReactNode } from "react";
import type { DocumentRowView, DocumentVersionView, NextStepView, RowSubmissionView } from "../api/client";
import { personLabel as identityLabel } from "../app/identity";
import { assignmentStatusLabels, labelFor, plural, taskLabels } from "../app/labels";
import { formatTime, kindLabels, personLabel, type SubmissionKind } from "../app/submissionLabels";
import { Button, StatusBadge, type StatusTone } from "../ui";
import { statusBadgeText, versionName } from "./labels";
import { acceptanceLabel, acceptanceOf, isDiscarded } from "./TextVersions";

export type BlockStage = "translation_review" | "annotation" | "final";
export type AssignTaskKind = "translation_review" | "annotate" | "review";

/** A line from the row's issues that belongs to a block (translation lines, missing final). */
export interface StageLine { key: string; content: ReactNode }

export interface StageBlocksProps {
  row: DocumentRowView;
  /** Loaded submissions of the row (times of submitted work); null while loading. */
  submissions?: readonly RowSubmissionView[] | null;
  /** Issue lines shown inside a block. */
  lines?: Partial<Record<BlockStage, readonly StageLine[]>>;
  /** Opens More › Text versions (also where the assignment actions are). */
  onOpenTextVersions?: () => void;
  onShowTranslationReviews?: (documentId: string) => void;
  /** Assign dialog for this row; `newReviewOfAccepted` for a new review of an accepted translation (D25). */
  onAssign?: (row: DocumentRowView, task: AssignTaskKind, options?: { newReviewOfAccepted?: boolean }) => void;
  /** Focuses the "Submissions (n)" heading; without it no Submissions link is shown. */
  onFocusSubmissions?: () => void;
  /** Content shown at the end of the Translation review block (the row's Resolve options); dropped without that block. */
  translationSlot?: ReactNode;
  now?: Date;
}

const STAGE_TITLES: Readonly<Record<BlockStage, string>> = {
  translation_review: "Translation review",
  annotation: "Annotation",
  final: "Final result",
};
const STAGE_ORDER: Readonly<Record<NextStepView["stage"], number>> = { translation_review: 0, annotation: 1, final: 2, done: 3 };
const CURRENT_BADGE: Readonly<Record<NextStepView["kind"], [string, StatusTone]>> = {
  decision: ["Your decision", "warning"],
  assign: ["To assign", "info"],
  in_progress: ["In progress", "info"],
  done: ["Done", "success"],
};

/** Id of a block heading (focus target of row actions on that stage). */
export function stageBlockHeadingId(caseId: string, language: string, stage: BlockStage): string {
  return `documents-stage-${encodeURIComponent(caseId)}-${encodeURIComponent(language)}-${stage}`;
}

/** Effective plan flags of a row: sources never review, discarded rows are off. */
export function effectivePlan(row: DocumentRowView): { review: boolean; annotate: boolean; discarded: boolean } {
  const plan = row.plan_row;
  const discarded = !!plan?.discarded;
  if (!plan) return { review: false, annotate: row.in_plan, discarded };
  return { review: plan.review && plan.review_applicable && !row.is_source && !discarded, annotate: plan.annotate && !discarded, discarded };
}

/** Newest versions of the row's undiscarded roots. */
function liveNewest(row: DocumentRowView): DocumentVersionView[] {
  return row.versions.filter(version => version.is_newest_in_chain && !isDiscarded(row, version));
}

/** The blocks a row shows, in pipeline order; none for rows not in plan or discarded. */
export function plannedStages(row: DocumentRowView): BlockStage[] {
  const plan = effectivePlan(row);
  if (plan.discarded || !row.in_plan) return [];
  const steps = row.steps?.length ? row.steps : row.next_step ? [row.next_step] : [];
  const showTranslation = !row.is_source && (plan.review || steps.some(step => step.stage === "translation_review") || liveNewest(row).some(version => acceptanceOf(version) != null));
  return [
    ...(showTranslation ? ["translation_review" as const] : []),
    ...(plan.annotate ? ["annotation" as const, "final" as const] : []),
  ];
}

export function StageBlocks({ row, submissions = null, lines = {}, onOpenTextVersions, onShowTranslationReviews, onAssign, onFocusSubmissions, translationSlot, now }: StageBlocksProps): JSX.Element {
  const id = useId();
  const plan = effectivePlan(row);
  const steps = row.steps?.length ? row.steps : row.next_step ? [row.next_step] : [];
  const current = row.next_step ?? null;
  const newest = liveNewest(row);
  const acceptances = newest.map(acceptanceOf);

  if (plan.discarded || !row.in_plan) {
    return <div className="stage-blocks stage-blocks--none">
      <p className="stage-blocks-note">
        <StatusBadge tone="neutral">{plan.discarded ? "Discarded" : "Not in plan"}</StatusBadge>
        {plan.discarded && <span>Every version of this language is discarded.</span>}
      </p>
    </div>;
  }

  const stages = plannedStages(row);

  const badgeOf = (stage: BlockStage): [string, StatusTone] => {
    if (current && current.stage === stage) return CURRENT_BADGE[current.kind];
    const passed = current != null && STAGE_ORDER[current.stage] > STAGE_ORDER[stage];
    if (stage === "translation_review" && newest.length > 0 && newest.every(version => version.translation_status === "accepted")) return ["Accepted", "success"];
    return passed ? ["Done", "success"] : ["Not started", "neutral"];
  };

  const multiple = row.versions.length > 1 || row.parallel_roots;
  const nameOf = (version: DocumentVersionView) => versionName(version.version, version.chain_name, row.parallel_roots);
  /** "v1" (or the chain name) only where the work is not on the row's single newest text. */
  const versionSuffix = (documentId: string): string | null => {
    const version = row.versions.find(entry => entry.document_id === documentId);
    if (!version || !multiple) return null;
    if (!row.parallel_roots && newest.length === 1 && newest[0].document_id === documentId) return null;
    return nameOf(version);
  };
  const submittedAt = (authorLabel: string, documentId: string): string | null => {
    const times = (submissions ?? []).filter(item => item.author_label === authorLabel && item.document_id === documentId).map(item => item.recorded_at).sort();
    return times.length ? times[times.length - 1] : null;
  };

  const linkButton = (label: string, onClick: () => void, name?: string) =>
    <Button size="sm" variant="quiet" aria-label={name} onClick={onClick}>{label}</Button>;

  const translationContent = (): ReactNode => {
    const work = row.work.filter(item => item.task === "translation_review");
    const statusLines = newest.flatMap((version, index) => {
      const acceptance = acceptances[index];
      if (acceptance) return [<li key={version.document_id}>{multiple ? `${nameOf(version)} · ` : ""}{acceptanceLabel(acceptance, now)}</li>];
      if (!multiple) return [];
      const status = statusBadgeText(version.translation_status, version.latest_review_decision, version.accepted_without_review);
      return status ? [<li key={version.document_id}>{nameOf(version)} · {status}</li>] : [];
    });
    const reviewed = newest.find(version => version.translation_status != null);
    const newReview = onAssign && !work.some(item => item.status !== "submitted")
      && newest.some((version, index) => version.translation_status === "accepted" && (acceptances[index]?.source === "lead" || acceptances[index]?.source === "override"));
    return <>
      {!plan.review && <p className="stage-block-line">Review is off in this plan.</p>}
      {statusLines.length > 0 && <ul className="stage-block-list">{statusLines}</ul>}
      {work.length > 0 && <ul className="stage-block-list" aria-label="Translation reviewers">{work.map(item => <li key={item.assignment_id}>
        {[personLabel(item.author_label, item.is_me, item.person), labelFor(assignmentStatusLabels, item.status), versionSuffix(item.document_id)].filter(Boolean).join(" · ")}
        {item.held && <StatusBadge tone="warning">Paused</StatusBadge>}
      </li>)}</ul>}
      {blockLines("translation_review")}
      <div className="stage-block-links">
        {onOpenTextVersions && linkButton(`Text versions (${row.versions.length})`, onOpenTextVersions)}
        {reviewed && onShowTranslationReviews && linkButton("Translation reviews", () => onShowTranslationReviews(reviewed.document_id))}
        {newReview && linkButton("Assign a new review…", () => onAssign(row, "translation_review", { newReviewOfAccepted: true }))}
      </div>
      {translationSlot}
    </>;
  };

  const annotationContent = (): ReactNode => {
    const work = row.work.filter(item => item.task !== "translation_review");
    const counted = steps.find(step => step.stage === "annotation" && step.target != null);
    const annotators = work.filter(item => item.task === "annotate").length;
    const count = counted ? `${counted.assigned ?? 0} of ${counted.target} assigned` : annotators ? `${plural(annotators, "annotator")} assigned` : "Not assigned yet";
    const reviewable = onAssign && work.some(item => item.task === "annotate" && item.status === "submitted");
    return <>
      <p className="stage-block-line">{count}</p>
      {work.length > 0 && <ul className="stage-block-list" aria-label="Annotators">{work.map(item => {
        const at = item.status === "submitted" ? submittedAt(item.author_label, item.document_id) : null;
        const status = at ? `Submitted ${formatTime(at, { now })}` : labelFor(assignmentStatusLabels, item.status);
        return <li key={item.assignment_id}>
          {[personLabel(item.author_label, item.is_me, item.person), labelFor(taskLabels, item.task), status,
            item.round_ordinal != null && item.status !== "submitted" ? `Round ${item.round_ordinal}` : null, versionSuffix(item.document_id)].filter(Boolean).join(" · ")}
          {item.held && <StatusBadge tone="warning">Paused</StatusBadge>}
        </li>;
      })}</ul>}
      {blockLines("annotation")}
      <div className="stage-block-links">
        {work.length > 0 && onOpenTextVersions && linkButton("Assignment actions", onOpenTextVersions)}
        {reviewable && linkButton("Assign annotation review…", () => onAssign(row, "review"))}
      </div>
    </>;
  };

  const finalContent = (): ReactNode => {
    const final = row.final;
    const missing = lines.final ?? [];
    let text: string | null = null;
    if (final) {
      const kind = (final.kind ?? "annotation") as SubmissionKind;
      const round = kind === "consolidation" ? null : final.round_ordinal == null ? "Initial submission" : `Round ${final.round_ordinal}`;
      const author = identityLabel(final.author ?? (final.author_label ? { pseudonym: final.author_label, is_me: final.is_mine } : null), { fallback: "Unknown" });
      text = [kindLabels[kind] ?? kind, round, author, final.selected_at ? `chosen ${formatTime(final.selected_at, { now })}` : null].filter(Boolean).join(" · ");
    }
    return <>
      {text ? <p className="stage-block-line">{text}</p> : !missing.length && <p className="stage-block-line">No final result yet.</p>}
      {blockLines("final")}
      {onFocusSubmissions && <div className="stage-block-links">{linkButton("Submissions", onFocusSubmissions)}</div>}
    </>;
  };

  function blockLines(stage: BlockStage): ReactNode {
    const entries = lines[stage] ?? [];
    return entries.length > 0 && <ul className="stage-block-list stage-block-issues">{entries.map(entry => <li key={entry.key}>{entry.content}</li>)}</ul>;
  }

  const content: Record<BlockStage, () => ReactNode> = { translation_review: translationContent, annotation: annotationContent, final: finalContent };

  return <div className="stage-blocks">
    {stages.map(stage => {
      const [badge, tone] = badgeOf(stage);
      const isCurrent = current?.stage === stage;
      const headingId = stageBlockHeadingId(row.case_id, row.language, stage);
      return <div key={stage} role="group" aria-labelledby={`${id}-${stage}`} aria-current={isCurrent ? "step" : undefined}
        className={isCurrent ? "stage-block stage-block--current" : "stage-block"}>
        <div className="stage-block-head">
          <h3 id={headingId} tabIndex={-1}><span id={`${id}-${stage}`}>{STAGE_TITLES[stage]}</span></h3>
          <StatusBadge tone={tone}>{badge}</StatusBadge>
        </div>
        {content[stage]()}
      </div>;
    })}
    {plan.review && !plan.annotate && <p className="stage-blocks-note">Not annotated in this plan</p>}
  </div>;
}
