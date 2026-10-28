import { useId, useMemo, useState } from "react";
import { plural } from "../app/labels";
import { checkLabel } from "../translation/labels";
import { Button, Select, TextInput } from "../ui";
import type { UploadTextRow } from "./uploadModel";

export const TEXT_PAGE_SIZE = 25;

type Filter = "all" | "source" | "translation" | "correction" | "failed" | "existing" | "new" | "normalised";
const FILTERS: readonly { value: Filter; label: string; test: (row: UploadTextRow) => boolean }[] = [
  { value: "all", label: "All texts", test: () => true },
  { value: "source", label: "Sources", test: row => row.group === "source" },
  { value: "translation", label: "Translations", test: row => row.group === "translation" },
  { value: "correction", label: "Corrections", test: row => row.group === "correction" },
  { value: "failed", label: "Failed automatic check", test: row => row.failedChecks.length > 0 },
  { value: "existing", label: "Already in the project", test: row => row.existing },
  { value: "new", label: "New texts", test: row => !row.existing },
  { value: "normalised", label: "Normalized text", test: row => row.normalised },
];

/**
 * "Texts in this upload (n)": a collapsed disclosure whose table is rendered only while open (Q3), paged by
 * 25 rows with a case-ID filter and a kind/problem filter.
 */
export function UploadTextList({ rows, kind }: { rows: readonly UploadTextRow[]; kind: "t1" | "text" }): JSX.Element {
  const id = useId().replace(/:/g, "");
  const [open, setOpen] = useState(false);
  return <details className="upload-disclosure" open={open}>
    <summary onClick={event => { event.preventDefault(); setOpen(value => !value); }}>Texts in this upload ({rows.length})</summary>
    {open && <TextTable id={id} rows={rows} kind={kind} />}
  </details>;
}

function TextTable({ id, rows, kind }: { id: string; rows: readonly UploadTextRow[]; kind: "t1" | "text" }): JSX.Element {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const options = FILTERS.filter(option => option.value === "all" || rows.some(option.test));
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const test = FILTERS.find(option => option.value === filter)?.test ?? (() => true);
    return rows.filter(row => test(row) && (!needle || row.caseId.toLowerCase().includes(needle)));
  }, [rows, query, filter]);
  const pages = Math.max(1, Math.ceil(shown.length / TEXT_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const slice = shown.slice(current * TEXT_PAGE_SIZE, (current + 1) * TEXT_PAGE_SIZE);
  const first = shown.length ? current * TEXT_PAGE_SIZE + 1 : 0;
  const last = current * TEXT_PAGE_SIZE + slice.length;
  return <div className="upload-texts">
    <div className="upload-texts-filters">
      <TextInput id={`${id}-case`} label={kind === "text" ? "Text ID" : "Case ID"} type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
      <Select id={`${id}-filter`} label="Show" value={filter} onChange={event => { setFilter(event.target.value as Filter); setPage(0); }}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
    </div>
    <p className="upload-texts-range" role="status">{shown.length ? `${first}–${last} of ${plural(shown.length, "text")}` : "No texts match."}</p>
    {slice.length > 0 && <div className="data-table-scroll"><table className="data-table density-compact upload-texts-table">
      <caption className="visually-hidden">Texts in this upload</caption>
      <thead><tr><th scope="col">{kind === "text" ? "Text" : "Case"}</th><th scope="col">Language</th>{kind === "t1" && <th scope="col">Kind</th>}<th scope="col">Status</th><th scope="col">Notes</th></tr></thead>
      <tbody>{slice.map(row => <tr key={row.key}>
        <th scope="row">{row.caseId}</th><td>{row.language}</td>{kind === "t1" && <td>{row.kind}</td>}<td>{row.status}</td>
        <td>{[...row.failedChecks.map(checkLabel), ...(row.normalised ? ["Normalized to NFC"] : [])].join("; ")}</td>
      </tr>)}</tbody>
    </table></div>}
    {pages > 1 && <nav className="upload-texts-pages" aria-label="Text pages">
      <Button size="sm" aria-disabled={current === 0 ? true : undefined} onClick={() => { if (current > 0) setPage(current - 1); }}>Previous</Button>
      <span>Page {current + 1} of {pages}</span>
      <Button size="sm" aria-disabled={current >= pages - 1 ? true : undefined} onClick={() => { if (current < pages - 1) setPage(current + 1); }}>Next</Button>
    </nav>}
  </div>;
}
