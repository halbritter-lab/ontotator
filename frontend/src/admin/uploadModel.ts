import type { ImportPlan, UploadView } from "../api/client";
import { humanize, plural } from "../app/labels";
import { checkLabel } from "../translation/labels";
import { ERROR_MESSAGES } from "./errors";
import { originLabels, translationStatusLabels } from "./variantMetadata";

export type UploadKind = "t1" | "text";
type Issue = NonNullable<ImportPlan["errors"]>[number];
type PlannedSet = NonNullable<ImportPlan["proposal_sets"]>[number];

/** "Import 50 cases" / "Import 3 texts"; the word follows the upload format. */
export const unitWord = (kind: UploadKind) => (kind === "text" ? "text" : "case");

/** One text of the upload, in words only (no hashes or internal IDs). */
export interface UploadTextRow {
  key: string;
  caseId: string;
  language: string;
  kind: string;
  /** Kind filter key: source, translation or correction. */
  group: "source" | "translation" | "correction";
  status: string;
  existing: boolean;
  normalised: boolean;
  failedChecks: string[];
}

/** The rows of "Texts in this upload": one per planned document, with its variant metadata when the bundle has it. */
export function uploadTextRows(plan: ImportPlan, kind: UploadKind): UploadTextRow[] {
  const variants = new Map((plan.variants ?? []).map(variant => [variant.document_id, variant]));
  return (plan.documents ?? []).map(document => {
    const variant = variants.get(document.document_id);
    const origin = variant?.origin ?? "native";
    const group: UploadTextRow["group"] = origin === "correction" ? "correction" : origin === "native" ? "source" : "translation";
    const existing = document.action === "unchanged";
    return {
      key: `${document.document_id}\u0000${document.language}`,
      caseId: variant?.case_id ?? document.document_id,
      language: document.language,
      kind: kind === "text" ? "Text" : origin === "native" ? "Source" : originLabels[origin],
      group,
      status: existing ? "Already in the project" : variant?.status ? translationStatusLabels[variant.status] : "New",
      existing,
      normalised: document.normalised,
      failedChecks: variant?.failed_checks ?? [],
    };
  }).sort((a, b) => a.caseId.localeCompare(b.caseId) || a.language.localeCompare(b.language));
}

/** Number of distinct cases (bundle) or texts (plain text) the upload touches. */
export function caseCount(plan: ImportPlan, kind: UploadKind): number {
  if (plan.work_plan) return new Set(plan.work_plan.cases.map(item => item.case_id)).size;
  const rows = uploadTextRows(plan, kind);
  return kind === "text" ? rows.length : new Set(rows.map(row => row.caseId)).size;
}

export function importButtonLabel(plan: ImportPlan | null | undefined, kind: UploadKind): string {
  return plan ? `Import ${plural(caseCount(plan, kind), unitWord(kind))}` : "Import";
}

export interface SummaryItem { label: string; value: string }

/** The preview's summary row: cases, texts per language, proposals and texts already in the project. */
export function uploadSummary(plan: ImportPlan, kind: UploadKind): SummaryItem[] {
  const rows = uploadTextRows(plan, kind);
  const perLanguage = new Map<string, number>();
  for (const row of rows) perLanguage.set(row.language, (perLanguage.get(row.language) ?? 0) + 1);
  const languages = [...perLanguage].sort(([a], [b]) => a.localeCompare(b)).map(([language, count]) => `${language} ${count}`).join(", ");
  const items: SummaryItem[] = [];
  if (kind === "t1") items.push({ label: "Cases", value: String(caseCount(plan, kind)) });
  items.push({ label: kind === "text" ? "Texts" : "Texts per language", value: kind === "text" ? `${rows.length}${languages ? ` (${languages})` : ""}` : languages || "0" });
  if (kind === "t1") items.push({ label: "Proposals", value: String(plan.counts?.proposals ?? 0) });
  items.push({ label: "Already in the project", value: String(plan.counts?.documents_skipped ?? rows.filter(row => row.existing).length) });
  return items;
}

/** One line of "Notes"; `details` are shown behind its "Show" button. */
export interface UploadNote { id: string; text: string; details: string[]; tone?: "warning" }

/** One issue as a detail line: the text and proposal it concerns, without the file-internal path ("annotation_set.annotations[35].term_id"). */
const issueText = (issue: Issue) => {
  const message = issue.message.replace(/^(annotation_set|document|schema_version)[\w.[\]]*: /, "");
  const where = [issue.unit, issue.annotation_id && `proposal ${issue.annotation_id}`].filter(Boolean).join(", ");
  return where ? `${where}: ${message}` : message;
};
export const issueTitle = (code: string) => ERROR_MESSAGES[code] ?? humanize(code);

/** Checker warnings in plain words; each says whether anything needs doing (#196). Others fall back to their title. */
const WARNING_NOTES: Readonly<Record<string, (count: number) => string>> = {
  modifier_as_annotation: count => `${plural(count, "proposal")} name${count === 1 ? "s" : ""} a modifier term, such as Severe, as the finding. No action needed now: annotators are asked to check each one before they submit.`,
  empty_after_normalization: count => `${plural(count, "evidence span")} cover${count === 1 ? "s" : ""} only spaces or punctuation. No action needed now: annotators check the evidence of each proposal.`,
  newer_minor: count => `${plural(count, "text")} use${count === 1 ? "s" : ""} a newer version of the Ontospan format. Parts this version does not know are kept but not shown. No action needed.`,
  ontology_release_mismatch: count => `${plural(count, "text")} name${count === 1 ? "s" : ""} another ontology release than this project. Check the imported terms in the first tasks.`,
};

/** Notes on a committable preview, one line each (OQ1: unknown languages warn, they do not refuse). */
export function uploadNotes(plan: ImportPlan, kind: UploadKind, projectLanguages: readonly string[]): UploadNote[] {
  const rows = uploadTextRows(plan, kind);
  const label = (row: UploadTextRow) => `${row.caseId} ${row.language}`;
  const notes: UploadNote[] = [];
  if (kind === "t1" && projectLanguages.length) {
    const unknown = [...new Set(rows.map(row => row.language).filter(language => !projectLanguages.includes(language)))].sort();
    if (unknown.length) {
      const count = rows.filter(row => unknown.includes(row.language)).length;
      notes.push({ id: "languages", tone: "warning", text: `${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"} not a project language: ${plural(count, "text")} will be imported anyway.`,
        details: unknown.map(language => `${language}: ${plural(rows.filter(row => row.language === language).length, "text")}. Add the language in Settings to plan work for it.`) });
    }
  }
  const failed = rows.filter(row => row.failedChecks.length);
  if (failed.length) notes.push({ id: "checks", text: `${plural(failed.length, "translation")} failed an automatic check.`, details: failed.map(row => `${label(row)}: ${row.failedChecks.map(checkLabel).join(", ")}`) });
  const existing = rows.filter(row => row.existing);
  if (existing.length) notes.push({ id: "existing", text: `${plural(existing.length, "text")} ${existing.length === 1 ? "is" : "are"} already in the project and stay${existing.length === 1 ? "s" : ""} unchanged.`, details: existing.map(label) });
  const normalised = rows.filter(row => row.normalised);
  if (normalised.length) notes.push({ id: "normalised", text: `${plural(normalised.length, "text")} normalized to Unicode NFC.`, details: normalised.map(label) });
  const duplicates = plan.duplicates ?? [];
  if (duplicates.length) notes.push({ id: "duplicates", text: `${plural(duplicates.length, "text")} with the same text as another text.`, details: duplicates.map(item => `${item.document_id}: ${item.same_text_as.length ? `same text as ${item.same_text_as.join(", ")}` : "duplicate input"}`) });
  const warnings = new Map<string, Issue[]>();
  for (const issue of plan.warnings ?? []) warnings.set(issue.code, [...(warnings.get(issue.code) ?? []), issue]);
  for (const [code, issues] of warnings) notes.push({ id: `warning-${code}`, text: WARNING_NOTES[code]?.(issues.length) ?? `${issueTitle(code)} (${issues.length})`, details: issues.map(issueText) });
  const refused = (plan.proposal_sets ?? []).flatMap(set => set.refused.map(item => ({ set, item })));
  if (refused.length) {
    const proposals = new Set(refused.map(({ set, item }) => `${set.document_id}\u0000${item.annotation_id}`)).size;
    notes.push({ id: "refused", text: `${plural(proposals, "proposal")} refused by the project rules.`, details: refused.map(({ set, item }) => `${set.document_id}: ${humanize(item.rule)}${Object.keys(item.detail).length ? ` (${Object.entries(item.detail).map(([key, value]) => `${key}: ${String(value)}`).join(", ")})` : ""}`) });
  }
  return notes;
}

/** One line per proposal source (tool or person), counted over its sets. */
export interface ProposalSource { name: string; proposals: number; texts: number; refused: number; alreadyImported: number }

function actorName(actors: PlannedSet["actors"], kind: string): string {
  const named = actors.map(actor => {
    const text = (key: string) => (typeof actor[key] === "string" && (actor[key] as string).length ? actor[key] as string : null);
    const name = text("name") ?? (actor.kind === "tool" ? "Unnamed tool" : "Unnamed person");
    return [name, text("version"), text("model") && `model ${text("model")}`].filter(Boolean).join(" ");
  });
  return named.length ? [...new Set(named)].join(", ") : humanize(kind);
}

export function proposalSources(plan: ImportPlan): ProposalSource[] {
  const sources = new Map<string, ProposalSource & { documents: Set<string> }>();
  for (const set of plan.proposal_sets ?? []) {
    const name = actorName(set.actors, set.set_kind);
    const entry = sources.get(name) ?? { name, proposals: 0, texts: 0, refused: 0, alreadyImported: 0, documents: new Set<string>() };
    entry.proposals += set.proposals.annotations.length;
    entry.refused += new Set(set.refused.map(item => item.annotation_id)).size;
    if (set.action === "already_imported") entry.alreadyImported += 1;
    entry.documents.add(set.document_id);
    entry.texts = entry.documents.size;
    sources.set(name, entry);
  }
  return [...sources.values()].map(({ documents: _documents, ...source }) => source).sort((a, b) => a.name.localeCompare(b.name));
}

export function proposalSourceLine(source: ProposalSource): string {
  return [`${source.name}: ${plural(source.proposals, "proposal")} in ${plural(source.texts, "text")}`,
    source.refused ? `${source.refused} refused` : null,
    source.alreadyImported ? `${plural(source.alreadyImported, "set")} already imported` : null].filter(Boolean).join(", ");
}

/** Problems of one uploaded file, grouped by kind of problem. */
export interface FileProblems { file: string; count: number; groups: { code: string; title: string; examples: string[]; count: number }[] }

const WHOLE_UPLOAD = "Whole upload";

/** Problems grouped per uploaded file, each with its counts and up to `examples` example lines. */
export function problemsByFile(plan: ImportPlan, files: UploadView["files"], examples = 3): FileProblems[] {
  const names = files.map(file => file.filename);
  const labels = new Map((plan.documents ?? []).map(document => [document.document_id, document.label]));
  const fileOf = (unit: string): string => {
    if (!unit) return WHOLE_UPLOAD;
    const direct = (value: string) => names.find(name => value === name || value.startsWith(`${name}/`));
    const found = direct(unit) ?? direct(labels.get(unit) ?? "");
    if (found) return found;
    return names.length === 1 ? names[0] : WHOLE_UPLOAD;
  };
  const where = (unit: string, file: string) => (unit === file ? "" : unit.startsWith(`${file}/`) ? unit.slice(file.length + 1) : unit);
  const byFile = new Map<string, Map<string, string[]>>();
  for (const issue of plan.errors ?? []) {
    const file = fileOf(issue.unit);
    const codes = byFile.get(file) ?? new Map<string, string[]>();
    const place = where(issue.unit, file);
    codes.set(issue.code, [...(codes.get(issue.code) ?? []), `${place ? `${place}: ` : ""}${issue.message}`]);
    byFile.set(file, codes);
  }
  const order = (file: string) => (file === WHOLE_UPLOAD ? -1 : names.indexOf(file));
  return [...byFile].sort(([a], [b]) => order(a) - order(b)).map(([file, codes]) => ({
    file,
    count: [...codes.values()].reduce((sum, lines) => sum + lines.length, 0),
    groups: [...codes].map(([code, lines]) => ({ code, title: issueTitle(code), examples: lines.slice(0, examples), count: lines.length })),
  }));
}

/** A fix hint when the chosen format does not match the files: bundles uploaded as plain text, or the other way round. */
export function formatHint(plan: ImportPlan, kind: UploadKind, files: UploadView["files"]): UploadKind | null {
  const errors = plan.errors ?? [];
  const names = files.map(file => file.filename.toLowerCase());
  if (kind === "t1") {
    const textish = names.some(name => name.endsWith(".txt")) || errors.some(issue => /\.txt\b/i.test(`${issue.unit} ${issue.message}`));
    return textish ? "text" : null;
  }
  const bundleish = names.some(name => name.endsWith(".json")) || errors.some(issue => issue.code === "UNSUPPORTED_FILE" && /(\.json|manifest\.json)$/i.test(issue.unit));
  return bundleish ? "t1" : null;
}
