/**
 * The Modifiers row of a consolidation group as a pure model (spec "Consolidation scenarios",
 * selection rule; DN-1, DN-2, DN-3): one ✓ toggle per distinct modifier (same term and same
 * segments), variants of one term exclude each other, "No modifiers" excludes every modifier.
 * Segments are [start, end) code points.
 */

export interface ModifierView {
  term_id: string;
  term_label: string;
  kind: "modifier" | "cohort";
  exclusive_class: "severity" | "onset" | null;
  segments: [number, number][];
}

export interface MemberSet {
  inputId: string;
  personId: string;
  personName: string;
  modifiers: readonly ModifierView[];
}

/** One distinct modifier (same term and same segments) and the members holding it. */
export interface ModifierToggle {
  id: string; // modifierKey
  modifier: ModifierView;
  personIds: string[];
  inputIds: string[];
  majority: string | null; // "(2 of 3)": held by more than half of >= 3 members (D-e)
}

export const NO_MODIFIERS = "none";

export interface ModifierChoices {
  toggles: ModifierToggle[]; // label order (D-d), then segment order
  /** Members without modifiers (the "No modifiers" toggle); null when every member has some. */
  none: { personIds: string[]; majority: string | null } | null;
}

export function modifierKey(modifier: { term_id: string; segments: readonly [number, number][] }): string {
  return `${modifier.term_id}@${modifier.segments.map(([start, end]) => `${start}-${end}`).join(",")}`;
}

const majorityOf = (holders: number, members: number): string | null =>
  members >= 3 && holders * 2 > members ? `(${holders} of ${members})` : null;

const compareSegments = (a: readonly [number, number][], b: readonly [number, number][]): number => {
  const x = a.flat(), y = b.flat();
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};

const byLabel = (a: ModifierView, b: ModifierView): number =>
  a.term_label.localeCompare(b.term_label, undefined, { sensitivity: "base" })
  || a.term_id.localeCompare(b.term_id)
  || compareSegments(a.segments, b.segments);

export function modifierChoices(members: readonly MemberSet[]): ModifierChoices {
  const toggles = new Map<string, ModifierToggle>();
  const without: string[] = [];
  for (const member of members) {
    if (!member.modifiers.length) without.push(member.personId);
    for (const modifier of member.modifiers) {
      const id = modifierKey(modifier);
      const toggle = toggles.get(id) ?? { id, modifier, personIds: [], inputIds: [], majority: null };
      toggle.personIds.push(member.personId);
      toggle.inputIds.push(member.inputId);
      toggles.set(id, toggle);
    }
  }
  return {
    toggles: [...toggles.values()]
      .map((t) => ({ ...t, majority: majorityOf(t.inputIds.length, members.length) }))
      .sort((a, b) => byLabel(a.modifier, b.modifier)),
    none: without.length ? { personIds: without, majority: majorityOf(without.length, members.length) } : null,
  };
}

/** Selection after pressing `id` (a toggle id or NO_MODIFIERS); pressing a pressed id releases it.
 *  Pressing a modifier releases the other variants of its term and NO_MODIFIERS; pressing NO_MODIFIERS releases every modifier. */
export function press(selection: ReadonlySet<string>, id: string, choices: ModifierChoices): Set<string> {
  if (selection.has(id)) return new Set([...selection].filter((s) => s !== id));
  if (id === NO_MODIFIERS) return new Set([NO_MODIFIERS]);
  const toggle = choices.toggles.find((t) => t.id === id);
  if (!toggle) return new Set(selection);
  const sameTerm = new Set(choices.toggles.filter((t) => t.modifier.term_id === toggle.modifier.term_id).map((t) => t.id));
  return new Set([...[...selection].filter((s) => s !== NO_MODIFIERS && !sameTerm.has(s)), id]);
}

/** Toggle ids that read "other text chosen": another variant of their term is pressed. */
export function otherTextChosen(selection: ReadonlySet<string>, choices: ModifierChoices): Set<string> {
  const pressedTerms = new Set(choices.toggles.filter((t) => selection.has(t.id)).map((t) => t.modifier.term_id));
  return new Set(
    choices.toggles.filter((t) => !selection.has(t.id) && pressedTerms.has(t.modifier.term_id)).map((t) => t.id),
  );
}

/** The chosen modifiers sorted by label (D-d); [] for "No modifiers"; null while nothing is pressed. */
export function chosenModifiers(selection: ReadonlySet<string>, choices: ModifierChoices): ModifierView[] | null {
  if (selection.has(NO_MODIFIERS)) return [];
  const chosen = choices.toggles.filter((t) => selection.has(t.id)).map((t) => t.modifier);
  return chosen.length ? chosen : null;
}

/** "Two severities" / "Two onsets" (R12), in that order. */
export function setWarnings(modifiers: readonly ModifierView[]): string[] {
  const count = (cls: "severity" | "onset") => modifiers.filter((m) => m.exclusive_class === cls).length;
  return [count("severity") > 1 ? "Two severities" : null, count("onset") > 1 ? "Two onsets" : null].filter(
    (w): w is string => w !== null,
  );
}

const quote = (text: string, segments: readonly [number, number][]): string => {
  const chars = Array.from(text);
  return segments.map(([start, end]) => chars.slice(start, end).join("")).join(" … ");
};

/** "Severe “schwere”" / "Recurrent" / "Severe (no text)" (spanless while another member linked the term). */
export function modifierText(modifier: ModifierView, text: string, noTextTerms?: ReadonlySet<string>): string {
  if (modifier.segments.length) return `${modifier.term_label} “${quote(text, modifier.segments)}”`;
  return noTextTerms?.has(modifier.term_id) ? `${modifier.term_label} (no text)` : modifier.term_label;
}

/** "Severe “schwere”, Recurrent" (agreed line, result line, collapsed line). */
export function setText(modifiers: readonly ModifierView[], text: string, noTextTerms?: ReadonlySet<string>): string {
  return modifiers.map((m) => modifierText(m, text, noTextTerms)).join(", ");
}

/** "Take Severe “schwere” from Ana Weber for Modifiers (2 of 3)"; "Take No modifiers from Cem Arslan for Modifiers". No "·" (DN-10). */
export function toggleName(label: string, personName: string, majority: string | null): string {
  return `Take ${label} from ${personName} for Modifiers${majority ? ` ${majority}` : ""}`;
}

export interface CrossLink {
  personId: string;
  personName: string;
  termLabel: string;
  quote: string;
  groupId: string;
  findingLabel: string;
}

/** Members of other groups who linked a modifier with the same term and text span as one in `groupId`
 *  ("Ben Roth linked “schwere” (Severe) to Hypotonia."). Spanless modifiers never link. */
export function crossLinks(
  groupId: string,
  groups: readonly { groupId: string; members: readonly (MemberSet & { termLabel: string })[] }[],
  text: string,
): CrossLink[] {
  const here = new Set(
    (groups.find((g) => g.groupId === groupId)?.members ?? [])
      .flatMap((m) => m.modifiers)
      .filter((m) => m.segments.length)
      .map(modifierKey),
  );
  const links = new Map<string, CrossLink>();
  for (const group of groups) {
    if (group.groupId === groupId) continue;
    for (const member of group.members) {
      for (const modifier of member.modifiers) {
        const key = modifierKey(modifier);
        if (!here.has(key)) continue;
        links.set(`${member.personId}|${key}|${group.groupId}`, {
          personId: member.personId,
          personName: member.personName,
          termLabel: modifier.term_label,
          quote: quote(text, modifier.segments),
          groupId: group.groupId,
          findingLabel: member.termLabel,
        });
      }
    }
  }
  return [...links.values()];
}
