import type { CaseSummary, VariantSummary } from '../api/client';

export interface DocumentVersionNode {
  variant: VariantSummary;
  matching: boolean;
  issue: string | null;
  children: DocumentVersionNode[];
}
export interface LogicalTextNode {
  caseId: string;
  languages: { language: string; roots: DocumentVersionNode[] }[];
}

/** Group only the authorized inventory; IDs and version numbers never imply ancestry.
 * A filtered match keeps its ancestors for orientation, without making them selectable.
 */
export function buildDocumentTree(cases: readonly CaseSummary[], visibleIds: ReadonlySet<string>): LogicalTextNode[] {
  return cases.flatMap(item => {
    const variants = item.variants.filter(row => row.case_id === item.case_id);
    const byId = new Map(variants.map(row => [row.document_id, row]));
    const nodes = new Map(variants.map(variant => [variant.document_id, {
      variant, matching: visibleIds.has(variant.document_id), issue: null, children: [],
    } as DocumentVersionNode]));
    const roots: DocumentVersionNode[] = [];
    for (const row of variants) {
      const node = nodes.get(row.document_id)!;
      if (row.origin !== 'correction') { roots.push(node); continue; }
      const parent = byId.get(row.derived_from ?? '');
      if (!parent || parent.language !== row.language) {
        node.issue = 'Earlier version unavailable'; roots.push(node); continue;
      }
      const seen = new Set([row.document_id]);
      let cursor: VariantSummary | undefined = parent;
      let cyclic = false;
      while (cursor?.origin === 'correction') {
        if (seen.has(cursor.document_id)) { cyclic = true; break; }
        seen.add(cursor.document_id);
        const previous: VariantSummary | undefined = byId.get(cursor.derived_from ?? '');
        cursor = previous?.language === row.language ? previous : undefined;
      }
      if (cyclic) { node.issue = 'Correction ancestry unavailable'; roots.push(node); }
      else nodes.get(parent.document_id)!.children.push(node);
    }
    const prune = (node: DocumentVersionNode): DocumentVersionNode | null => {
      const children = node.children.map(prune).filter((child): child is DocumentVersionNode => child !== null);
      return node.matching || children.length > 0 ? { ...node, children } : null;
    };
    const retained = roots.map(prune).filter((node): node is DocumentVersionNode => node !== null);
    const languages = [...new Set(retained.map(node => node.variant.language))].sort().map(language => ({
      language, roots: retained.filter(node => node.variant.language === language),
    }));
    return languages.length ? [{ caseId: item.case_id, languages }] : [];
  });
}
