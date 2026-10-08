import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, OntologyInfo } from "../api/client";

export interface SearchLanguageOption {
  language: string;
  /** Terms with at least one name in this language. */
  termCount: number;
}

/** What the language button of the search box needs. English is implied and always on. */
export interface SearchLanguageControl {
  /** The translation languages loaded for the ontology, sorted by code. */
  options: SearchLanguageOption[];
  /** The loaded languages this annotator searches in. */
  active: string[];
  onToggle: (language: string) => void;
}

/** No stored selection means all loaded languages; stored codes that are not loaded are ignored. */
export const activeLanguages = (loaded: string[], stored: string[] | undefined): string[] =>
  stored === undefined ? loaded : loaded.filter((language) => stored.includes(language));

/** The selection to store after one loaded language was switched; codes that are not loaded stay stored. */
export const toggledSelection = (
  loaded: string[],
  stored: string[] | undefined,
  language: string,
): string[] => {
  const active = activeLanguages(loaded, stored);
  const next = active.includes(language)
    ? active.filter((code) => code !== language)
    : [...active, language];
  const notLoaded = (stored ?? []).filter((code) => !loaded.includes(code));
  return [...loaded.filter((code) => next.includes(code)), ...notLoaded];
};

export type LanguageClient = Pick<ApiClient, "listOntologies" | "getPreferences" | "updatePreferences">;

/**
 * The search languages of one annotator. Returns a function that gives the
 * control for an ontology (by SHA-256), or undefined when that ontology has no
 * translation loaded; the search box then shows no language button.
 */
export function useSearchLanguages(
  client: LanguageClient,
  annotatorId: string,
): (ontologySha256: string | null | undefined) => SearchLanguageControl | undefined {
  const [ontologies, setOntologies] = useState<OntologyInfo[]>([]);
  const [stored, setStored] = useState<string[] | undefined>(undefined);
  // The latest selection, so two quick clicks build on each other.
  const storedRef = useRef<string[] | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    client.listOntologies().then(
      (list) => {
        if (!cancelled) setOntologies(list ?? []);
      },
      () => undefined,
    );
    client.getPreferences().then(
      (prefs) => {
        if (cancelled) return;
        storedRef.current = prefs?.search_languages_by_annotator?.[annotatorId];
        setStored(storedRef.current);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [client, annotatorId]);

  return useCallback(
    (ontologySha256) => {
      const sha = ontologySha256?.toLowerCase();
      const ontology = sha ? ontologies.find((item) => item.sha256.toLowerCase() === sha) : undefined;
      const options = (ontology?.translations ?? [])
        .map((item) => ({ language: item.language, termCount: item.term_count }))
        .sort((a, b) => a.language.localeCompare(b.language));
      if (options.length === 0) return undefined;
      const loaded = options.map((option) => option.language);
      return {
        options,
        active: activeLanguages(loaded, stored),
        onToggle: (language: string) => {
          const next = toggledSelection(loaded, storedRef.current, language);
          storedRef.current = next;
          setStored(next);
          void client
            .updatePreferences({ search_languages_by_annotator: { [annotatorId]: next } })
            .catch(() => undefined);
        },
      };
    },
    [client, annotatorId, ontologies, stored],
  );
}
