/**
 * Copy of the text-change dialogs (spec "Copy › Text change"); pronouns are neutral ("them").
 * `from` and `to` are version names ("v1", "v2").
 */
import { plural } from "../app/labels";

export const RELOADED_MESSAGE = "The text or the task changed. Reloaded.";
export const CHECKING = "Checking…";

export const handleTitle = (text: string): string => `Handle text change: ${text}`;
export const openWorkLine = (person: string, from: string, to: string): string => `${person} has an open annotation on ${from}. The text is now ${to}.`;
export const moveLabel = (to: string): string => `Move to ${to}`;
export const moveDescription = (person: string): string =>
  `${person} continues on the corrected text. Their draft findings are carried and marked “check after text change”.`;
export const unplacedLine = (unplaced: number, findings: number, person: string): string =>
  `${unplaced} of ${plural(findings, "finding")} could not be placed and need ${person}’s decision.`;
export const finishLabel = (person: string, from: string): string => `Let ${person} finish on ${from}`;
export const finishDescription = (person: string, to: string): string => `When ${person} submits, the result is carried to ${to} for them to check.`;
export const WITHDRAW_LABEL = "Withdraw";
/**
 * Issue 235: why only Withdraw is offered, in plain words: what the task is, why it cannot follow the new text,
 * and what the lead does next.
 */
export const fromProposalsLine = (person: string, from: string, to: string): string =>
  `${person} checks tool proposals that were made for the text of ${from}. The proposals mark places in that text, so they cannot be moved to ${to}, and the task cannot either. That is why Withdraw is the only choice.`;
export const notNewerLine = (from: string, to: string): string =>
  `The correction ${from} was not accepted, so this task cannot move to ${to}. That is why Withdraw is the only choice.`;
export const nextAfterWithdrawLine = (to: string): string => `Next: click Apply to withdraw the task, then assign an annotation of ${to}.`;
export const withdrawDescription = (person: string, to: string): string => `${person}’s task ends. Nothing of the draft is carried to ${to}; ${to} needs a new annotation.`;
export const heldLine = (person: string): string => `${person}’s task is paused by a problem report. Decide the report first.`;

export const movedMessage = (person: string, to: string): string => `${person} continues on ${to}.`;
export const finishingMessage = (person: string, from: string, to: string): string =>
  `${person} finishes on ${from}. The result is carried to ${to} when they submit.`;
export const withdrawnMessage = (person: string, to: string): string => `${person}’s task is withdrawn. ${to} needs a new annotation.`;

export const carryTitle = (to: string, text: string): string => `Carry to ${to}: ${text}`;
export function submittedLine(person: string, from: string, round: number | null, findings: number | null): string {
  const facts = [round ? `Round ${round}` : null, findings != null ? plural(findings, "finding") : null].filter(Boolean).join(", ");
  return `${person} submitted on ${from}${facts ? ` (${facts})` : ""}.`;
}
export const authorLabel = (person: string): string => `${person} (author)`;
export const authorDescription = (to: string): string => `Their findings are carried to ${to} for them to check.`;
export const SOMEONE_ELSE = "Someone else…";
export const someoneElseDescription = (to: string): string => `Another annotator continues on ${to} from this result.`;
export const ALREADY_ANNOTATING = "already annotating this text";
export const fromScratchLabel = (to: string): string => `Annotate ${to} from scratch`;
export const FROM_SCRATCH_DESCRIPTION = "Nothing is carried; the assign dialog opens next.";
export const carriedMessage = (person: string, to: string, findings: number): string =>
  `${person} continues on ${to} with ${plural(findings, "carried finding")}.`;
export const CHOOSE_PERSON = "Choose a person first.";
