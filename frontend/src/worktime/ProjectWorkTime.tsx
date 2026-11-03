import { useEffect, useState } from "react";
import { api, type ProjectWorkTime as WorkTime } from "../api/client";
import { formatWorkTime } from "./workTimer";

const MODE_LABELS: Record<WorkTime["modes"][number]["mode"], string> = {
  proposals: "Annotation from proposals",
  scratch: "Annotation from scratch",
  translation_review: "Translation review",
};

/** Progress › Working time (issue 298): sums per mode only, no person and no single work period. */
export function ProjectWorkTime({ projectKey, revision }: { projectKey: string; revision: number }): JSX.Element | null {
  const [value, setValue] = useState<WorkTime | null>(null);
  useEffect(() => {
    let active = true;
    // Optional on this page: without the sums the rest of Progress stays as it is.
    api.getProjectWorkTime(projectKey).then(result => { if (active) setValue(result); }, () => { if (active) setValue(null); });
    return () => { active = false; };
  }, [projectKey, revision]);
  if (!value || (!value.record && value.modes.length === 0)) return null;
  return <section className="progress-work-time" aria-labelledby="progress-work-time-heading">
    <h2 id="progress-work-time-heading">Working time</h2>
    {value.modes.length === 0
      ? <p className="muted">No working time recorded yet.</p>
      : <div className="data-table-scroll">
        <table className="data-table" aria-labelledby="progress-work-time-heading">
          <thead><tr><th scope="col">Task</th><th scope="col" className="num">Texts</th><th scope="col" className="num">Total active time</th><th scope="col" className="num">Median per text</th></tr></thead>
          <tbody>{value.modes.map(mode => <tr key={mode.mode}>
            <th scope="row">{MODE_LABELS[mode.mode]}</th>
            <td className="num" data-label="Texts">{mode.texts}</td>
            <td className="num" data-label="Total active time">{formatWorkTime(mode.total_seconds)}</td>
            <td className="num" data-label="Median per text">{formatWorkTime(mode.median_seconds_per_text)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    <p className="muted progress-people-note">Active time of all people together, summed per text. {value.record ? "" : "Recording is off; these are earlier times. "}Single work periods are only in the Working time research export.</p>
  </section>;
}
