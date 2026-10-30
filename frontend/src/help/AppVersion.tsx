import { useEffect, useState } from "react";
import { api, type About } from "../api/client";

/** "Ontotator 0.3.0 · commit cc65cea": what users quote when they report a problem. Nothing while it loads or fails. */
export function AppVersion(): JSX.Element | null {
  const [about, setAbout] = useState<About | null>(null);
  useEffect(() => {
    let active = true;
    api.getAbout().then(next => { if (active) setAbout(next); }, () => undefined);
    return () => { active = false; };
  }, []);
  if (!about) return null;
  return <p className="help-version" title={about.revision ?? undefined}>
    Ontotator {about.version}{about.revision && <> · commit {about.revision.slice(0, 7)}</>}
  </p>;
}
