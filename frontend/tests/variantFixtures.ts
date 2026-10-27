import type { AnnotationVersion, CaseDetail, VariantSummary, VersionRef } from '../src/api/client';

export const variant = (document_id = 'target', changes: Partial<VariantSummary> = {}): VariantSummary => ({
  document_id, case_id: 'EN 1/7', external_id: document_id, language: 'de', version: 1,
  origin: 'machine_translation', derived_from: 'source', translation: null,
  translation_status: 'accepted', status_reason: null, text_sha256: 'text', assigned_to_me: false, ...changes,
});
export const caseDetail: CaseDetail = { case_id: 'EN 1/7', variants: [
  variant('source', { language: 'en', origin: 'native', derived_from: null, translation_status: null }),
  variant(), variant('other-run'),
] };
export const ownRef: VersionRef = { kind: 'own', id: 'submission/1 %', label: 'My submitted version', created_at: '2026-10-16T00:00:00Z' };
export const historical: AnnotationVersion = { ref: ownRef, evidence: [], annotations: [{
  schema_version: 'ontotator-annotation/v3', document_id: 'target', text_sha256: 'text', version: 'annotation-v1',
  ontology_sha256: 'ontology', layer_config_sha256: 'layer', evidence: [],
  annotation: { annotation_id: 'old', document_id: 'target', layer_id: 'phenotype', type_id: 'default', term_id: 'HP:old',
    axes_values: { assertion: 'present' }, axes_defaulted: ['assertion'], evidence_refs: [],
    provenance: { actor: { actor_id: 'alice', kind: 'human' }, method: 'manual', source_refs: [] } },
}] };
