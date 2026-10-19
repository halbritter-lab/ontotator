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
  /** Requested preferences unavailable for this exact ontology pin. */
  unavailable?: string[];
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

export type LanguageClient = Pick<ApiClient, "listPackageOntologies" | "getPreferences" | "updatePreferences">;

/**
 * The search languages of one annotator. Returns a function that gives the
 * control for an ontology (by SHA-256), or undefined when that ontology has no
 * translation loaded; the search box then shows no language button.
 */
export function useSearchLanguages(
  client: LanguageClient,
  annotatorId: string,
  projectKey: string,
  documentLanguage?: string,
  documentId?: string,
): (ontologySha256: string | null | undefined) => SearchLanguageControl | undefined {
  const [ontologies, setOntologies] = useState<OntologyInfo[]>([]);
  const [stored, setStored] = useState<string[] | undefined>(undefined);
  // The latest selection, so two quick clicks build on each other.
  const storedRef = useRef<string[] | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setOntologies([]);
    storedRef.current = [];
    setStored([]);
    client.listPackageOntologies(projectKey).then(
      (list) => {
        if (!cancelled) setOntologies(list ?? []);
      },
      () => undefined,
    );
    client.getPreferences().then(
      (prefs) => {
        if (cancelled) return;
        const personal = prefs?.multilingual_search;
        const legacy = prefs?.search_languages_by_annotator?.[annotatorId];
        // Existing explicit choices remain intact. First use searches English
        // plus the document language, with automatic activation opt-in/off durable.
        storedRef.current = personal
          ? personal.enabled ? [...new Set([...(personal.preferred_languages ?? []), ...(personal.automatic_document_language && documentLanguage ? [documentLanguage] : [])])] : []
          : legacy ?? (documentLanguage ? [documentLanguage] : []);
        setStored(storedRef.current);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [client, annotatorId, projectKey, documentLanguage, documentId]);

  return useCallback(
    (ontologySha256) => {
      const sha = ontologySha256?.toLowerCase();
      const ontology = sha ? ontologies.find((item) => item.sha256.toLowerCase() === sha) : undefined;
      if (!ontology) return undefined;
      const options = (ontology?.translations ?? [])
        .map((item) => ({ language: item.language, termCount: item.term_count }))
        .sort((a, b) => a.language.localeCompare(b.language));
      const loaded = options.map((option) => option.language);
      const unavailable = (stored ?? []).filter(code => code !== "en" && !loaded.includes(code));
      if (options.length === 0 && unavailable.length === 0) return undefined;
      return {
        options,
        active: activeLanguages(loaded, stored),
        unavailable,
        onToggle: (language: string) => {
          const next = toggledSelection(loaded, storedRef.current, language);
          storedRef.current = next;
          setStored(next);
          // This is an ad-hoc override for this document. Personal defaults
          // are saved explicitly in Profile and are never overwritten here.
        },
      };
    },
    [client, annotatorId, ontologies, stored],
  );
}
