import type { MouseEvent, ReactNode } from 'react';
import { routeHref, type ProjectDocumentsQuery, type Route } from '../app/router';
import { LanguageTag } from '../ui';

export interface TextViewToolbarProps {
  projectKey: string; caseId: string; language: string;
  documents?: ProjectDocumentsQuery; onNavigate: (route: Route) => void;
  /** Version and Show selects, Compare and further actions, in reading order. */
  children: ReactNode;
}

/** The text view's one toolbar (spec §4): Documents, case id with language, the selects, Compare, Text card. */
export function TextViewToolbar({ projectKey, caseId, language, documents, onNavigate, children }: TextViewToolbarProps): JSX.Element {
  const link = (route: Route, text: ReactNode, className = 'btn btn-secondary btn-sm') => <a className={className} href={routeHref(route)} onClick={(event: MouseEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate(route);
  }}>{text}</a>;
  return <div className="case-toolbar text-view-toolbar" role="group" aria-label="Text view">
    {link({ name: 'projectDocuments', key: projectKey, ...documents }, <><span aria-hidden="true">‹ </span>Documents</>, 'btn btn-quiet btn-sm')}
    <h1>{caseId}</h1>
    <LanguageTag code={language} />
    {children}
    {link({ name: 'projectDocuments', key: projectKey, ...documents, panel: `${caseId}:${language}` }, 'Text card')}
  </div>;
}
