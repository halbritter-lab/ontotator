import type { PracticeTask } from "../api/client";

/**
 * The steps of each practice task (issue 266), in one place. A step ticks itself from the task's real state as
 * the server reads it (the draft's findings and decisions, the saved translation, the task status), never by a
 * manual tick. `help` names the handbook section; tests/practice.test.tsx checks that every one exists.
 */
export interface PracticeStep {
  id: string;
  label: string;
  /** The concrete hint shown as "Next: …" while this is the first open step. */
  hint: string;
  help: { chapter: string; section: string };
  done: (task: PracticeTask) => boolean;
}

/** Terms of the invented texts (src/ontotator/application/practice_content.py). */
export const PRACTICE_TERMS = {
  seizure: "HP:0001250",
  hypotonia: "HP:0001252",
  areflexia: "HP:0001284",
  hearingImpairment: "HP:0000365",
} as const;

const submitted = (task: PracticeTask) => task.status === "submitted";
const decided = (task: PracticeTask, term: string, test: (outcome: string, action: string | null | undefined) => boolean) =>
  task.decisions.some(decision => decision.term_id === term && test(decision.outcome, decision.action));
/** A consolidation group the consolidator decided themself (not kept automatically). */
const resolved = (_outcome: string, action: string | null | undefined) => !!action && action !== "auto";

const ANNOTATOR = "annotator";
const CONSOLIDATOR = "consolidator";

export const PRACTICE_STEPS: Readonly<Record<PracticeTask["kind"], readonly PracticeStep[]>> = {
  scratch: [
    { id: "mark", label: "Mark a finding and choose its term", hint: "Select “Krampfanfall” in the text and choose the term Seizure.",
      help: { chapter: ANNOTATOR, section: "mark-text-and-add-a-finding" }, done: task => task.findings.length > 0 },
    { id: "absent", label: "Mark a finding as absent", hint: "“Ein Status epilepticus trat nicht auf”: add Status epilepticus and set Absent.",
      help: { chapter: ANNOTATOR, section: "set-values-and-confirm-defaults" }, done: task => task.findings.some(finding => finding.assertion === "absent") },
    { id: "defaults", label: "Confirm the prefilled values", hint: "Click Confirm defaults in each finding, or choose each value yourself.",
      help: { chapter: ANNOTATOR, section: "set-values-and-confirm-defaults" },
      done: task => task.findings.length > 0 && task.findings.every(finding => finding.defaulted.length === 0) },
    { id: "submit", label: "Finish & submit", hint: "Click Finish & submit, check the dialog and submit.",
      help: { chapter: ANNOTATOR, section: "submit-the-text" }, done: submitted },
  ],
  proposals: [
    { id: "confirm", label: "Confirm a proposal that is right", hint: "“drei Krampfanfälle” as Seizure is right. Select it and click Confirm.",
      help: { chapter: ANNOTATOR, section: "review-tool-proposals" },
      done: task => decided(task, PRACTICE_TERMS.seizure, outcome => outcome === "confirmed") },
    { id: "default", label: "Confirm a prefilled value", hint: "“Muskelhypotonie”: one value is tagged Defaulted. Check it, then click Confirm.",
      help: { chapter: ANNOTATOR, section: "review-tool-proposals" },
      done: task => decided(task, PRACTICE_TERMS.hypotonia, outcome => outcome === "confirmed") },
    // TODO(issue 266): once "Discard copy" is on main, extend this step to "…, then discard the copy".
    { id: "replace", label: "Correct a proposal with Edit & Replace",
      hint: "“Innenohrschwerhörigkeit” is sensorineural. Click Edit & Replace and choose Sensorineural hearing impairment in your copy.",
      help: { chapter: ANNOTATOR, section: "review-tool-proposals" },
      done: task => decided(task, PRACTICE_TERMS.hearingImpairment, outcome => outcome === "changed") },
    { id: "missed", label: "Add a finding the tool missed", hint: "“Die Muskeleigenreflexe fehlen” has no proposal: mark it and add Areflexia.",
      help: { chapter: ANNOTATOR, section: "mark-text-and-add-a-finding" }, done: task => task.findings.some(finding => !finding.replacement) },
    { id: "submit", label: "Finish & submit", hint: "Click Finish & submit, check the dialog and submit.",
      help: { chapter: ANNOTATOR, section: "submit-the-text" }, done: submitted },
  ],
  translation_review: [
    { id: "correct", label: "Correct the translation", hint: "The source says arms, the translation says “Beine” (legs). Change it to “Arme”.",
      help: { chapter: ANNOTATOR, section: "review-a-translation" },
      done: task => !!task.translation_text?.includes("Arme") && !task.translation_text.includes("Beine") },
    { id: "decision", label: "Choose a decision", hint: "Choose the decision that fits your correction.",
      help: { chapter: ANNOTATOR, section: "review-a-translation" }, done: task => !!task.translation_decision },
    { id: "submit", label: "Submit the review", hint: "Submit the review. It needs a Qualification in your Profile.",
      help: { chapter: ANNOTATOR, section: "review-a-translation" }, done: submitted },
  ],
  consolidation: [
    { id: "differ", label: "Decide where your colleagues differ", hint: "One colleague marked “Muskelhypotonie” as present, the other as absent. Read the text and decide.",
      help: { chapter: CONSOLIDATOR, section: "how-to-decide" }, done: task => decided(task, PRACTICE_TERMS.hypotonia, resolved) },
    { id: "partial", label: "Decide a finding only one colleague marked", hint: "Only one colleague marked “Reflexe fehlen”. Keep it or leave it out.",
      help: { chapter: CONSOLIDATOR, section: "leave-a-finding-out-of-the-result" }, done: task => decided(task, PRACTICE_TERMS.areflexia, resolved) },
    { id: "submit", label: "Submit the consolidation", hint: "When every group is decided, submit the consolidation.",
      help: { chapter: CONSOLIDATOR, section: "finish-a-consolidation" }, done: submitted },
  ],
};

/** Short names of the practice tasks, as My tasks and Profile › Practice list them. */
export const PRACTICE_TASK_NAMES: Readonly<Record<PracticeTask["kind"], string>> = {
  scratch: "Annotate from scratch",
  proposals: "Annotate from proposals",
  translation_review: "Translation review",
  consolidation: "Consolidation",
};

export interface PracticeProgress {
  steps: { step: PracticeStep; done: boolean }[];
  /** The first open step, or null when every step is done. */
  next: PracticeStep | null;
}

export function practiceProgress(task: PracticeTask): PracticeProgress {
  const steps = PRACTICE_STEPS[task.kind].map(step => ({ step, done: step.done(task) }));
  return { steps, next: steps.find(item => !item.done)?.step ?? null };
}

/** "1 of 4 tasks done". */
export const tasksDone = (done: number, total: number): string => `${done} of ${total} ${total === 1 ? "task" : "tasks"} done`;
