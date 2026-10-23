import type { components } from '../api/generated';

type Variant = components['schemas']['VariantSummary'];
type Ref = components['schemas']['VersionRef'];
type CaseVariants = { readonly variants: readonly Variant[] };

export interface VariantOption {
  documentId: string;
  version: number;
  origin: Variant['origin'];
  status: Variant['translation_status'];
  label: string;
}

export type AnnotationOption =
  | { kind: 'draft'; value: 'draft'; label: 'My draft' }
  | { kind: 'ref'; value: string; label: string; ref: Ref };

const originLabels: Record<Variant['origin'], string> = {
  native: 'native', machine_translation: 'machine translation',
  human_translation: 'human translation', correction: 'corrected',
};
const lexical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function variantsInOrder(detail: CaseVariants, language: string): Variant[] {
  return detail.variants.filter(row => row.language === language).sort((left, right) =>
    right.version - left.version || lexical(left.external_id, right.external_id) || lexical(left.document_id, right.document_id));
}

export function languagesOf(detail: CaseVariants, currentDocumentId?: string): string[] {
  const languages = [...new Set(detail.variants.map(row => row.language))].sort(lexical);
  const current = detail.variants.find(row => row.document_id === currentDocumentId)?.language;
  return current === undefined ? languages : [current, ...languages.filter(language => language !== current)];
}

export function versionsOf(detail: CaseVariants, language: string): VariantOption[] {
  const variants = variantsInOrder(detail, language);
  const baseLabels = variants.map(row => [
    `v${row.version}`, originLabels[row.origin], row.translation_status?.replaceAll('_', ' '),
  ].filter(Boolean).join(', '));
  const counts = (labels: readonly string[]) => {
    const result = new Map<string, number>();
    for (const label of labels) result.set(label, (result.get(label) ?? 0) + 1);
    return result;
  };
  const baseCounts = counts(baseLabels);
  const labels = baseLabels.map((label, index) =>
    baseCounts.get(label)! > 1 ? `${label}, ${variants[index].external_id}` : label);
  const labelCounts = counts(labels);
  const finalLabels = labels.map((label, index) =>
    labelCounts.get(label)! > 1 ? `${label} (${variants[index].document_id})` : label);
  const finalCounts = counts(finalLabels);
  return variants.map((row, index) => ({
    documentId: row.document_id, version: row.version, origin: row.origin, status: row.translation_status,
    // Ordinary labels start with v; global numeric prefixes cannot collide with them or each other.
    label: finalCounts.get(finalLabels[index])! > 1 ? `${index + 1}. ${finalLabels[index]}` : finalLabels[index],
  }));
}

export function pickVariant(detail: CaseVariants, language: string, version?: number): string | null {
  if (!language) return null;
  const variants = variantsInOrder(detail, language);
  const selected = version === undefined
    ? variants.find(row => row.translation_status === 'accepted') ?? variants[0]
    : variants.find(row => row.version === version);
  return selected?.document_id ?? null;
}

/** Real reference tokens never overlap the local draft/text tokens. */
export function refKey(ref: Pick<Ref, 'kind' | 'id'>): string {
  return JSON.stringify([ref.kind, ref.id]);
}

export function refForKey(key: string, refs: readonly Ref[]): Ref | null {
  let tuple: unknown;
  try {
    tuple = JSON.parse(key);
  } catch {
    return null;
  }
  if (!Array.isArray(tuple) || tuple.length !== 2 || typeof tuple[0] !== 'string' || typeof tuple[1] !== 'string') return null;
  return refs.find(ref => ref.kind === tuple[0] && ref.id === tuple[1]) ?? null;
}

export function annotationOptions(refs: readonly Ref[], hasDraft: boolean): AnnotationOption[] {
  const result: AnnotationOption[] = hasDraft ? [{ kind: 'draft', value: 'draft', label: 'My draft' }] : [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const value = refKey(ref);
    if (seen.has(value)) continue;
    seen.add(value);
    result.push({ kind: 'ref', value, label: ref.label, ref });
  }
  return result;
}
