import { useId } from 'react';
import type { CaseDetail } from '../api/client';
import { Select } from '../ui';
import { languagesOf, versionsOf, type AnnotationOption } from './versionState';

export interface VariantSelectorsProps {
  caseDetail: CaseDetail;
  currentDocumentId: string;
  annotationOptions: readonly AnnotationOption[];
  selectedAnnotation: string;
  onLanguage: (language: string) => void;
  onVersion: (documentId: string) => void;
  onAnnotation: (selection: string) => void;
  disabled?: boolean;
}
export function VariantSelectors({ caseDetail, currentDocumentId, annotationOptions, selectedAnnotation,
  onLanguage, onVersion, onAnnotation, disabled = false }: VariantSelectorsProps): JSX.Element {
  const id = useId();
  const current = caseDetail.variants.find(row => row.document_id === currentDocumentId);
  const languages = languagesOf(caseDetail, currentDocumentId);
  const versions = current ? versionsOf(caseDetail, current.language) : [];
  return <div className="variant-selectors density-compact">
    <Select id={`${id}-language`} label="Language" value={current?.language ?? ''}
      disabled={disabled || languages.length <= 1} onChange={event => onLanguage(event.target.value)}>
      {!current && <option value="">Unavailable</option>}
      {languages.map(language => <option key={language} value={language}>{language}</option>)}
    </Select>
    <Select id={`${id}-version`} label="Text version" value={currentDocumentId}
      disabled={disabled || versions.length <= 1} onChange={event => onVersion(event.target.value)}>
      {!current && <option value={currentDocumentId}>Unavailable</option>}
      {versions.map(row => <option key={row.documentId} value={row.documentId}>{row.label}</option>)}
    </Select>
    <Select id={`${id}-annotations`} label="Annotations" value={selectedAnnotation}
      disabled={disabled} onChange={event => onAnnotation(event.target.value)}>
      <option value="text">Text only</option>
      {annotationOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      {selectedAnnotation !== 'text' && !annotationOptions.some(option => option.value === selectedAnnotation)
        && <option value={selectedAnnotation}>Unavailable</option>}
    </Select>
  </div>;
}
