import type { CaseDetail } from '../api/client';

const ORIGIN_WORDS: Record<CaseDetail['variants'][number]['origin'], string> = {
  native: 'source text', machine_translation: 'machine translation', human_translation: 'human translation', correction: 'corrected',
};
const lexical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

/** Source first, then the other languages with their versions oldest first; equal labels get the external id. */
export function versionOptions(detail: CaseDetail): { documentId: string; label: string }[] {
  const rows = [...detail.variants].sort((left, right) => Number(right.origin === 'native') - Number(left.origin === 'native')
    || lexical(left.language, right.language) || left.version - right.version || lexical(left.external_id, right.external_id));
  const labels = rows.map(row => `${row.language}, version ${row.version} (${ORIGIN_WORDS[row.origin]})`);
  return rows.map((row, index) => ({ documentId: row.document_id,
    label: labels.filter(label => label === labels[index]).length > 1 ? `${labels[index]} ${row.external_id}` : labels[index] }));
}

/** One select for language and version, e.g. "de, version 1 (machine translation)" (spec §4). */
export function VersionSelect({ caseDetail, value, onChange }: { caseDetail: CaseDetail; value: string; onChange: (documentId: string) => void }): JSX.Element {
  const options = versionOptions(caseDetail);
  return <select className="form-select" aria-label="Language and version" value={value} onChange={event => onChange(event.target.value)}>
    {!options.some(option => option.documentId === value) && <option value={value}>Unavailable</option>}
    {options.map(option => <option key={option.documentId} value={option.documentId}>{option.label}</option>)}
  </select>;
}
