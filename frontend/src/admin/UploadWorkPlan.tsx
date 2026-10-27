import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CommitUploadPlan, UploadWorkPlan as WorkPlan } from "../api/client";
import { plural } from "../app/labels";
import { Checkbox, PlanChip, Textarea } from "../ui";

type PlanLanguage = WorkPlan["languages"][number];
type PlanCase = WorkPlan["cases"][number];
type Flags = { review: boolean | null; annotate: boolean };

export interface UploadWorkPlanResult {
  /** Overrides for the commit body; empty maps when the defaults fit. */
  plan: CommitUploadPlan;
  /** Why the import cannot start yet (names the language), or null. */
  blockedReason: string | null;
}

export interface UploadWorkPlanProps {
  workPlan: WorkPlan;
  /** Project rule "annotate accepted translations only"; the acceptance is asked only while it is on. */
  ruleOn?: boolean;
  /** The caller may accept translations as reviewed outside Ontotator (lead). */
  canAccept?: boolean;
  /** "{case_id}:{language}" rows accepted by an "Accept without review" override in this upload. */
  acceptedRows?: ReadonlySet<string>;
  disabled?: boolean;
  onChange: (result: UploadWorkPlanResult) => void;
}

const SOURCE = "source";
const rowKey = (item: { case_id: string; language: string }) => `${item.case_id}:${item.language}`;
const keyOf = (item: PlanCase) => (item.review === null ? SOURCE : item.language);
const languageLabel = (language: PlanLanguage) => (language.key === SOURCE ? "Sources" : `${language.key} MT`);

/** "Import 50 cases" / "Import 3 texts" from the cases the upload touches. */
export function importLabel(workPlan: WorkPlan, kind: "t1" | "text"): string {
  const count = new Set(workPlan.cases.map(item => item.case_id)).size;
  return `Import ${plural(count, kind === "text" ? "text" : "case")}`;
}

/** The upload preview's "Work plan" step (spec "Planning at import"): chips by language, per-case exceptions and the external-review acceptance. */
export function UploadWorkPlan({ workPlan, ruleOn = true, canAccept = false, acceptedRows, disabled = false, onChange }: UploadWorkPlanProps): JSX.Element {
  const ids = useId().replace(/:/g, "");
  const [languageChoices, setLanguageChoices] = useState<Record<string, Flags>>({});
  const [caseChoices, setCaseChoices] = useState<Record<string, Flags & { case_id: string; language: string }>>({});
  const [accept, setAccept] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  // The per-case table is rendered only while open: an upload can hold thousands of rows.
  const [casesOpen, setCasesOpen] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const languageFlags = (language: PlanLanguage): Flags => languageChoices[language.key] ?? { review: language.review, annotate: language.annotate };
  const caseFlags = (item: PlanCase): Flags => {
    const own = caseChoices[rowKey(item)];
    if (own) return own;
    const chosen = languageChoices[keyOf(item)];
    return chosen ? { review: item.review === null ? null : chosen.review, annotate: chosen.annotate } : { review: item.review, annotate: item.annotate };
  };
  const newCases = workPlan.cases.filter(item => item.new_row);

  // Translations that would be annotated without review and are not accepted (rule on).
  const needs = useMemo(() => {
    const counts = new Map<string, number>();
    if (!ruleOn) return counts;
    for (const item of newCases) {
      if (item.review === null || item.accepted || acceptedRows?.has(rowKey(item))) continue;
      const flags = caseFlags(item);
      if (flags.annotate && !flags.review) counts.set(item.language, (counts.get(item.language) ?? 0) + 1);
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workPlan, languageChoices, caseChoices, ruleOn, acceptedRows]);
  const acceptLanguages = [...needs.keys()].filter(language => canAccept && accept[language]).sort();
  const unresolved = [...needs.keys()].sort().find(language => !(canAccept && accept[language] && reason.trim()));
  const blockedReason = unresolved ? `Work plan, ${unresolved}: accept the translations as reviewed outside Ontotator with a reason, or turn Review on.` : null;

  const plan: CommitUploadPlan = useMemo(() => ({
    plan_languages: Object.fromEntries(Object.entries(languageChoices).filter(([key, flags]) => {
      const language = workPlan.languages.find(item => item.key === key);
      return !language || flags.review !== language.review || flags.annotate !== language.annotate;
    })),
    plan_cases: Object.values(caseChoices).map(item => ({ case_id: item.case_id, language: item.language, review: item.review, annotate: item.annotate })),
    ...(acceptLanguages.length && reason.trim() ? { accept_external_review: { languages: acceptLanguages, reason: reason.trim() } } : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [languageChoices, caseChoices, acceptLanguages.join(","), reason, workPlan]);
  const resultKey = JSON.stringify([plan, blockedReason]);
  useEffect(() => { onChangeRef.current({ plan, blockedReason }); }, [resultKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLanguage = (language: PlanLanguage, flag: "review" | "annotate") => {
    if (disabled) return;
    const flags = languageFlags(language);
    const next = { ...flags, [flag]: !flags[flag] };
    setLanguageChoices(current => {
      const rest = { ...current };
      delete rest[language.key];
      // Back at the default: per-case rows follow their own defaults again (marked translations keep Review off).
      return next.review === language.review && next.annotate === language.annotate ? rest : { ...rest, [language.key]: next };
    });
  };
  const toggleCase = (item: PlanCase, flag: "review" | "annotate") => {
    if (disabled) return;
    const flags = caseFlags(item);
    setCaseChoices(current => ({ ...current, [rowKey(item)]: { case_id: item.case_id, language: item.language, ...flags, [flag]: !flags[flag] } }));
  };
  const existing = workPlan.existing_rows_kept;

  return <section className="detail-section work-plan-upload" aria-labelledby={`${ids}-heading`}>
    <h3 id={`${ids}-heading`}>Work plan</h3>
    <div className="work-plan-table-scroll"><table className="data-table density-compact work-plan-table">
      <thead><tr><th scope="col">Language</th><th scope="col">Versions in bundle</th><th scope="col">Translation review</th><th scope="col">Annotate</th></tr></thead>
      <tbody>{workPlan.languages.map(language => {
        const flags = languageFlags(language);
        const name = language.key === SOURCE ? "Sources" : language.key;
        const conditional = language.key === SOURCE && !languageChoices[SOURCE] && language.source_rule === "if_no_translation" && language.annotate;
        return <tr key={language.key}>
          <th scope="row">{languageLabel(language)} ({language.rows})</th>
          <td className="work-plan-count">{language.versions}</td>
          <td>{language.key === SOURCE ? <span className="work-plan-none">–</span> : <PlanChip kind="review" pressed={!!flags.review} name={`Translation review, ${name}`} busy={disabled} onToggle={() => toggleLanguage(language, "review")} />}</td>
          <td><PlanChip kind="annotate" pressed={flags.annotate} name={`Annotate, ${name}`} busy={disabled} onToggle={() => toggleLanguage(language, "annotate")} />{conditional && <span className="work-plan-note"> if no translation</span>}</td>
        </tr>;
      })}</tbody>
    </table></div>
    {existing > 0 && <p className="field-hint">{plural(existing, "language version")} already in the project {existing === 1 ? "keeps its" : "keep their"} plan.</p>}
    {[...needs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([languageKey, count]) => {
      const language = workPlan.languages.find(item => item.key === languageKey);
      return <div key={languageKey} className="work-plan-acceptance" role="group" aria-label={`Acceptance, ${languageKey}`}>
        <p className="work-plan-acceptance-title">{languageKey}: {count} of {language?.rows ?? count} translations are not marked as reviewed in the package. Annotation needs an accepted translation.</p>
        {canAccept ? <Checkbox id={`${ids}-accept-${languageKey}`} label="These translations were reviewed outside Ontotator — accept them as they are" checked={!!accept[languageKey]} disabled={disabled} onChange={event => setAccept(current => ({ ...current, [languageKey]: event.target.checked }))} />
          : <p>Turn translation review on for {languageKey}, or ask a project lead to accept them.</p>}
        {!!language?.marked_in_package && <p className="field-hint">{language.marked_in_package} already marked as reviewed in the package metadata need nothing.</p>}
        {canAccept && <p className="field-hint">The acceptance is recorded with your name, the reason and the time.</p>}
      </div>;
    })}
    {acceptLanguages.length > 0 && <Textarea id={`${ids}-reason`} label="Reason" required maxLength={2000} value={reason} disabled={disabled} onChange={event => setReason(event.target.value)} />}
    <details className="work-plan-cases" open={casesOpen}><summary onClick={event => { event.preventDefault(); setCasesOpen(open => !open); }}>Adjust per case…</summary>
      {casesOpen && <div className="work-plan-table-scroll"><table className="data-table density-compact work-plan-table">
        <thead><tr><th scope="col">Text</th><th scope="col">Translation review</th><th scope="col">Annotate</th></tr></thead>
        <tbody>{workPlan.cases.map(item => {
          const label = `${item.case_id} ${item.language}`;
          if (!item.new_row) return <tr key={rowKey(item)}><th scope="row">{label}</th><td colSpan={2} className="field-hint">keeps its plan</td></tr>;
          const flags = caseFlags(item);
          return <tr key={rowKey(item)}>
            <th scope="row">{label}</th>
            <td>{item.review === null ? <span className="work-plan-none">–</span> : <PlanChip kind="review" pressed={!!flags.review} name={`Translation review, ${label}`} busy={disabled} onToggle={() => toggleCase(item, "review")} />}</td>
            <td><PlanChip kind="annotate" pressed={flags.annotate} name={`Annotate, ${label}`} busy={disabled} onToggle={() => toggleCase(item, "annotate")} /></td>
          </tr>;
        })}</tbody>
      </table></div>}
    </details>
  </section>;
}
