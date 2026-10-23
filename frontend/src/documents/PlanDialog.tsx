import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, ApiError, type BulkPlanRequest, type BulkPreview, type BulkResult, type ConsequencesView, type LanguageChangeRequest } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { plural } from "../app/labels";
import { personLabel, textLabel } from "../app/identity";
import { Button, Checkbox, Dialog, InlineMessage, Textarea, type TriState } from "../ui";
import { allKeep, changedChoices, languageName, planReport, SOURCE_KEY, type PlanChoices } from "./planSummary";
import { ANNOTATION_LABELS, PlanOption, proposalsHelp, REVIEW_HELP, SCRATCH_HELP } from "./PlanSteps";

export interface PlanDialogProps {
  projectKey: string;
  caseIds: readonly string[];
  /** Preset cells (selection bar quick action or acceptance entry); missing cells are "keep". */
  initial?: PlanChoices;
  onClose: () => void;
  /** Called after a successful save; the caller closes the dialog, shows the Undo toast and keeps the selection. */
  onSaved: (result: BulkResult, summary: string) => void;
}

type LanguagePreview = BulkPreview["languages"][number];

const DEBOUNCE_MS = 250;
const CHANGED_MESSAGE = "This plan changed. Reloaded the current plan.";
const CHECKING = "Checking consequences…";

const hasConsequences = (c: ConsequencesView): boolean => !!(c.withdrawn.length || c.finals_leaving.length || c.restored.length || c.open_reports?.length);
/** "Keep (12 on, 8 off)": the current values in the selection. */
const keepLabel = (counts: { on: number; off: number } | null): string => {
  const parts = counts ? [counts.on && `${counts.on} on`, counts.off && `${counts.off} off`].filter(Boolean) : [];
  return parts.length ? `Keep (${parts.join(", ")})` : "Keep";
};
type AnnotationChoice = "keep" | "off" | "on" | "proposals" | "scratch";
/** "on" = annotate with each text's mode kept (a quick-action preset); the mode radios set a mode. */
const annotationChoice = (choice: PlanChoices[string] | undefined): AnnotationChoice => {
  if (choice?.annotate === "off") return "off";
  if (choice?.annotate !== "on") return "keep";
  return choice.annotation_mode === "proposals" || choice.annotation_mode === "scratch" ? choice.annotation_mode : "on";
};
const annotationCells: Record<Exclude<AnnotationChoice, "on">, { annotate: TriState; annotation_mode: "keep" | "proposals" | "scratch" }> = {
  keep: { annotate: "keep", annotation_mode: "keep" },
  off: { annotate: "off", annotation_mode: "keep" },
  proposals: { annotate: "on", annotation_mode: "proposals" },
  scratch: { annotate: "on", annotation_mode: "scratch" },
};

const taskNames: Record<string, [string, string]> = {
  translation_review: ["open translation review", "open translation reviews"],
  annotate: ["open annotation", "open annotations"],
  review: ["open consolidation", "open consolidations"],
};

/** Warning lines per language (spec "Editing after work started"). */
function consequenceGroups(consequences: ConsequencesView): { language: string; cases: number; lines: string[] }[] {
  const languages = new Set<string>();
  const cases = new Map<string, Set<string>>();
  const touch = (language: string, caseId: string) => { languages.add(language); cases.set(language, (cases.get(language) ?? new Set()).add(caseId)); };
  consequences.withdrawn.forEach(item => touch(item.language, item.case_id));
  consequences.finals_leaving.forEach(item => touch(item.language, item.case_id));
  consequences.restored.forEach(item => touch(item.language, item.case_id));
  (consequences.open_reports ?? []).forEach(item => touch(item.language, item.case_id));
  return [...languages].sort().map(language => {
    const lines: string[] = [];
    for (const task of ["translation_review", "annotate", "review"]) {
      const items = consequences.withdrawn.filter(item => item.language === language && item.task === task);
      if (!items.length) continue;
      const people = [...new Set(items.map(item => personLabel(item.person)))].join(" · ");
      const [one, many] = taskNames[task];
      lines.push(`${items.length} ${items.length === 1 ? one : many} will be withdrawn (${people}${task === "translation_review" ? "" : items.length === 1 ? "; draft kept" : "; drafts kept"}).`);
    }
    const finals = consequences.finals_leaving.filter(item => item.language === language);
    if (finals.length) lines.push(`${plural(finals.length, "final result")} (${finals.map(item => textLabel(item)).join(" · ")}) ${finals.length === 1 ? "stays" : "stay"} in history but ${finals.length === 1 ? "is" : "are"} no longer exported.`);
    for (const item of consequences.restored.filter(row => row.language === language)) lines.push(`${item.language} of ${item.case_id} returns to the plan. Its earlier final result needs your confirmation.`);
    const reports = (consequences.open_reports ?? []).filter(item => item.language === language);
    if (reports.length) lines.push(`${plural(reports.length, "open problem report")} (${reports.map(item => `${textLabel(item)}${item.held ? ", task paused" : ""}`).join(" · ")}) ${reports.length === 1 ? "stays" : "stay"} open under Problem reports.`);
    return { language, cases: cases.get(language)?.size ?? 0, lines };
  });
}

/** Plan many cases at once (spec D19, F5): per language the steps in words with Keep, live preview, confirmation inside the dialog. */
export function PlanDialog({ projectKey, caseIds, initial, onClose, onSaved }: PlanDialogProps): JSX.Element {
  const ids = useId().replace(/:/g, "");
  const summaryId = `${ids}-summary`;
  const reasonId = `${ids}-save-reason`;
  const caseKey = JSON.stringify(caseIds);
  const [choices, setChoices] = useState<PlanChoices>(() => ({ ...(initial ?? {}) }));
  const [preview, setPreview] = useState<{ request: string; data: BulkPreview } | null>(null);
  const [previewError, setPreviewError] = useState<unknown>();
  const [reload, setReload] = useState(0);
  const [step, setStep] = useState<{ kind: "edit" } | { kind: "confirm"; consequences: ConsequencesView }>({ kind: "edit" });
  const [understood, setUnderstood] = useState(false);
  const [accept, setAccept] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const hasPreview = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);

  const languages = preview?.data.languages ?? [];
  const totalCases = preview?.data.cases ?? caseIds.length;
  const diff: PlanChoices = useMemo(() => changedChoices(choices), [choices]);
  const requestLanguages: Record<string, LanguageChangeRequest> = diff;
  const requestKey = JSON.stringify(requestLanguages);

  useEffect(() => {
    const id = ++generation.current;
    const run = () => {
      api.previewWorkPlans(projectKey, { case_ids: [...caseIds], languages: requestLanguages }).then(data => {
        if (!alive.current || generation.current !== id) return;
        hasPreview.current = true;
        setPreview({ request: requestKey, data }); setPreviewError(undefined);
      }, (failure: unknown) => { if (alive.current && generation.current === id) setPreviewError(failure); });
    };
    if (!hasPreview.current) { run(); return; }
    const timer = window.setTimeout(run, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey, caseKey, requestKey, reload]);

  const fresh = preview !== null && preview.request === requestKey;
  const nothing = allKeep(diff);
  const ruleOn = preview?.data.rule_on ?? true;
  const acceptance = fresh && ruleOn ? preview.data.languages.filter(language => language.not_accepted > 0) : [];
  const acceptable = (language: LanguagePreview) => language.not_accepted - language.not_acceptable > 0;
  const acceptLanguages = acceptance.filter(language => acceptable(language) && accept[language.key]).map(language => language.key);
  const sum = (count: (language: LanguagePreview) => number | undefined) => languages.reduce((total, language) => total + (count(language) ?? 0), 0);
  const summary = nothing ? "Nothing to change yet." : fresh ? planReport(plural(sum(language => language.will_change), "text"), sum(language => language.mode_locked), sum(language => language.mode_no_proposals)) : CHECKING;

  let blocked: string | null = null;
  if (step.kind === "confirm") blocked = understood ? null : "Confirm that you understand the consequences first.";
  else if (nothing) blocked = "Nothing to change yet.";
  else if (!fresh) blocked = CHECKING;
  else {
    const stuck = acceptance.find(language => language.not_acceptable > 0);
    const open = acceptance.find(language => !(accept[language.key] && acceptable(language) && reason.trim()));
    if (stuck) blocked = `${stuck.key}: resolve the rejected, queried or in-review translations first, or turn Review on.`;
    else if (open) blocked = `${open.key}: accept the translations as reviewed outside Ontocurator with a reason, or turn Review on.`;
  }

  const setCells = (key: string, cells: PlanChoices[string]) => {
    setChoices(currentChoices => ({ ...currentChoices, [key]: { ...currentChoices[key], ...cells } }));
    setNotice(null); setError(undefined);
  };

  const submit = async (confirm: boolean) => {
    if (!preview || saving) return;
    setSaving(true); setError(undefined); setNotice(null);
    const body: BulkPlanRequest = {
      case_ids: [...caseIds],
      languages: requestLanguages,
      ...(acceptLanguages.length ? { accept_external_review: { languages: acceptLanguages, reason: reason.trim() } } : {}),
      expected_revisions: preview.data.revisions,
      confirm,
    };
    try {
      const result = await api.saveWorkPlans(projectKey, body);
      if (!alive.current) return;
      onSaved(result, planReport(`${plural(result.changed_rows, "text")} changed`, result.mode_locked?.length ?? 0, result.mode_no_proposals?.length ?? 0));
    } catch (failure: unknown) {
      if (!alive.current) return;
      if (failure instanceof ApiError && failure.code === "WORK_PLAN_CONFIRMATION_REQUIRED" && typeof failure.details === "object" && failure.details !== null) {
        setStep({ kind: "confirm", consequences: failure.details as unknown as ConsequencesView }); setUnderstood(false);
      } else if (failure instanceof ApiError && failure.code === "WORK_PLAN_CHANGED") {
        setNotice(CHANGED_MESSAGE); setStep({ kind: "edit" }); setReload(value => value + 1);
      } else setError(failure);
    } finally { if (alive.current) setSaving(false); }
  };
  const save = () => {
    if (blocked || saving) return;
    if (step.kind === "confirm") { void submit(true); return; }
    if (preview && hasConsequences(preview.data.consequences)) { setStep({ kind: "confirm", consequences: preview.data.consequences }); setUnderstood(false); return; }
    void submit(false);
  };

  const confirming = step.kind === "confirm";
  const groups = confirming ? consequenceGroups(step.consequences) : [];
  const withdrawing = confirming && step.consequences.withdrawn.length > 0;
  const title = `Work plan · ${plural(caseIds.length, "case")}`;

  const footer = <>
    <span id={reasonId} className="work-plan-save-reason" hidden={!blocked || blocked === summary}>{blocked}</span>
    {confirming ? <Button onClick={() => { setStep({ kind: "edit" }); setUnderstood(false); }}>Back</Button> : <Button onClick={onClose}>Cancel</Button>}
    <Button variant="primary" loading={saving} aria-disabled={blocked ? true : undefined} aria-describedby={blocked ? reasonId : undefined} onClick={save}>Save for {plural(caseIds.length, "case")}</Button>
  </>;

  return <Dialog open title={title} size="md" onClose={onClose} footer={footer}>
    <div className="work-plan-dialog">
      {notice && <InlineMessage tone="info">{notice}</InlineMessage>}
      {!preview && previewError === undefined && <p className="field-hint">{CHECKING}</p>}
      {previewError !== undefined && <><ErrorNotice error={previewError} /><Button size="sm" onClick={() => setReload(value => value + 1)}>Retry</Button></>}
      {preview && !confirming && languages.map(language => {
        const count = language.cases_in_selection === totalCases ? String(language.cases_in_selection) : `${language.cases_in_selection} of ${totalCases}`;
        const group = `${ids}-${language.key}`;
        const review = choices[language.key]?.review ?? "keep";
        const annotation = annotationChoice(choices[language.key]);
        const option = (step: "review" | "annotation", value: string, label: string, checked: boolean, onChoose: () => void, help?: string) =>
          <PlanOption group={`${group}-${step}`} value={value} label={label} help={help} checked={checked} onChoose={onChoose} />;
        return <section key={language.key} className="work-plan-language" aria-labelledby={`${group}-name`} aria-describedby={summaryId}>
          <h3 id={`${group}-name`} className="work-plan-language-name">{languageName(language)} <span className="work-plan-count">In selection: {count}</span></h3>
          {language.key !== SOURCE_KEY && <fieldset className="plan-step">
            <legend>Translation review</legend>
            {option("review", "keep", keepLabel(language.review), review === "keep", () => setCells(language.key, { review: "keep" }))}
            {option("review", "on", "On", review === "on", () => setCells(language.key, { review: "on" }), REVIEW_HELP.on)}
            {option("review", "off", "Off", review === "off", () => setCells(language.key, { review: "off" }), REVIEW_HELP.off)}
          </fieldset>}
          <fieldset className="plan-step">
            <legend>Annotation</legend>
            {option("annotation", "keep", keepLabel(language.annotate), annotation === "keep", () => setCells(language.key, annotationCells.keep))}
            {option("annotation", "off", ANNOTATION_LABELS.off, annotation === "off", () => setCells(language.key, annotationCells.off))}
            {annotation === "on" && option("annotation", "on", "Annotate", true, () => undefined)}
            {option("annotation", "proposals", ANNOTATION_LABELS.proposals, annotation === "proposals", () => setCells(language.key, annotationCells.proposals), proposalsHelp())}
            {option("annotation", "scratch", ANNOTATION_LABELS.scratch, annotation === "scratch", () => setCells(language.key, annotationCells.scratch), SCRATCH_HELP)}
          </fieldset>
        </section>;
      })}
      <p id={summaryId} className="work-plan-summary" aria-live="polite"><strong>Will change:</strong> {summary}</p>
      {!confirming && acceptance.map(language => {
        const rejected = language.not_acceptable - language.in_review;
        const checkboxId = `${ids}-accept-${language.key}`;
        return <div key={language.key} className="work-plan-acceptance" role="group" aria-label={`Acceptance, ${language.key}`}>
          <p className="work-plan-acceptance-title">{language.key}: {language.not_accepted} of {language.cases_in_selection} translations are not marked as reviewed in the package. Annotation needs an accepted translation.</p>
          {rejected > 0 && <p>{rejected} rejected or queried: resolve them first.</p>}
          {language.in_review > 0 && <p>{language.in_review} in review: wait for the review or withdraw it first.</p>}
          {acceptable(language) && <Checkbox id={checkboxId} label="These translations were reviewed outside Ontocurator — accept them as they are" checked={!!accept[language.key]} onChange={event => setAccept(value => ({ ...value, [language.key]: event.target.checked }))} />}
          {language.marked_in_package > 0 && <p className="field-hint">{language.marked_in_package} already marked as reviewed in the package metadata need nothing.</p>}
          <p className="field-hint">The acceptance is recorded with your name, the reason and the time.</p>
        </div>;
      })}
      {!confirming && acceptLanguages.length > 0 && <Textarea id={`${ids}-reason`} label="Reason" required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} />}
      {confirming && <div className="work-plan-confirm">
        {groups.map(group => <div key={group.language} className="work-plan-warning">
          <strong>{group.language} has work in {group.cases} of these cases.</strong>
          <ul>{group.lines.map(line => <li key={line}>{line}</li>)}</ul>
        </div>)}
        <Checkbox id={`${ids}-understood`} label={withdrawing ? "I understand — withdraw the open tasks" : "I understand"} checked={understood} onChange={event => setUnderstood(event.target.checked)} />
      </div>}
      {error !== undefined && <ErrorNotice error={error} />}
    </div>
  </Dialog>;
}
