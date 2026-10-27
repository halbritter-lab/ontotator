import { useEffect } from "react";

/** "Documents · Ward notes · Ontotator": the given parts (empty ones dropped), most specific first. */
export function documentTitle(parts: readonly (string | null | undefined)[]): string {
  return [...parts.filter((part): part is string => !!part), "Ontotator"].join(" · ");
}

/** Sets the browser title (WCAG 2.4.2); on unmount the previous title returns (e.g. a login dialog over a page). */
export function useDocumentTitle(parts: readonly (string | null | undefined)[]): void {
  const title = documentTitle(parts);
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => { document.title = previous; };
  }, [title]);
}
