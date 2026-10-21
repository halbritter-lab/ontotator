import { useEffect, useState } from "react";
import { api, type GuidelineDocument as GuidelineDocumentView, type GuidelineSummary } from "../api/client";
import { ErrorNotice } from "../admin/ErrorNotice";
import { personLabel } from "../app/identity";
import { GuidelineDocument, InlineMessage } from "../ui";
import "./guidelines.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Local day, e.g. "20 Oct"; the year is added outside the current year ("2 Mar 2025"). Invalid input is returned unchanged. */
export function formatGuidelineDay(value: string, now: Date = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${year}`;
}

/** "Withdrawn 21 Oct by Jana Popp (ann-0002)" plus ": {reason}"; `null` for a version in force. */
export function withdrawnNote(summary: Pick<GuidelineSummary, "withdrawn">): string | null {
  const withdrawn = summary.withdrawn;
  if (!withdrawn) return null;
  const base = `Withdrawn ${formatGuidelineDay(withdrawn.at)} by ${personLabel(withdrawn.by)}`;
  return withdrawn.reason ? `${base}: ${withdrawn.reason}` : base;
}

export interface GuidelineReaderProps {
  projectKey: string;
  version: number;
  /** The version in force; `null` when none is (none published or the current one withdrawn). */
  currentVersion: number | null;
  /** Level of the "Guidelines vN" heading (default 2); Markdown headings start one level below. */
  headingLevel?: 2 | 3;
}

/**
 * One guideline version for reading: heading, meta line, older-version banner and the text,
 * or the withdrawn line. Showing a version's text records `opened` for it (spec G16), so the
 * Settings reading view, the task drawer and the guidelines page need no call of their own.
 */
export function GuidelineReader({ projectKey, version, currentVersion, headingLevel = 2 }: GuidelineReaderProps): JSX.Element {
  const [loaded, setLoaded] = useState<{ key: string; version: number; document: GuidelineDocumentView } | null>(null);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let active = true;
    setLoaded(null); setError(undefined);
    void api.getGuideline(projectKey, version).then(document => {
      if (!active) return;
      setLoaded({ key: projectKey, version, document });
      if (document.body !== null && !document.withdrawn) void api.recordGuidelineRead(projectKey, version, "opened").catch(() => undefined);
    }).catch((failure: unknown) => { if (active) setError(failure); });
    return () => { active = false; };
  }, [projectKey, version]);

  const Heading = headingLevel === 3 ? "h3" : "h2";
  const document = loaded?.key === projectKey && loaded.version === version ? loaded.document : null;
  const withdrawn = document !== null && (document.withdrawn != null || document.body === null);
  return <div className="guideline-reader">
    <Heading className="guideline-reader-heading">Guidelines v{version}</Heading>
    {error !== undefined ? <ErrorNotice error={error} />
      : document === null ? <InlineMessage tone="info">Loading guidelines…</InlineMessage>
      : withdrawn ? <p className="guideline-reader-withdrawn">v{version} was withdrawn by the project lead.</p>
      : <>
        <p className="guideline-reader-meta">{[`Published ${formatGuidelineDay(document.created_at)}`, document.change_note].filter(Boolean).join(" · ")}</p>
        {currentVersion !== null && currentVersion !== version && <InlineMessage tone="info">This is v{version}. The current version is v{currentVersion}.</InlineMessage>}
        <GuidelineDocument kind={document.kind} body={document.body!} headingOffset={headingLevel - 1} />
      </>}
  </div>;
}
