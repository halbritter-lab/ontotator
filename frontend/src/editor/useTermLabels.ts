import { useEffect, useMemo, useRef, useState } from "react";
import { api, type TermLookup } from "../api/client";
import type { components } from "../api/generated";
import type { TermInfo } from "./modifiers";

type ResolvedTerm = components["schemas"]["TermLabel"];

const keyOf = ({ layer_id, term_id }: TermLookup) => JSON.stringify([layer_id, term_id]);

export function useTermLabels(projectKey: string, terms: TermLookup[]) {
  const [labels, setLabels] = useState<Record<string, string | null>>({});
  const [roles, setRoles] = useState<Record<string, Omit<TermInfo, "label">>>({});
  const [retryTick, setRetryTick] = useState(0);
  const requested = useRef(new Set<string>());
  const attempts = useRef(new Map<string, number>());
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    requested.current.clear();
    attempts.current.clear();
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    setLabels({});
    setRoles({});
    return () => {
      generation.current += 1;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
    };
  }, [projectKey]);
  const termsKey = JSON.stringify(terms);
  const uniqueTerms = useMemo(() => {
    const unique = new Map<string, TermLookup>();
    for (const term of terms) unique.set(keyOf(term), term);
    return [...unique.values()];
  }, [termsKey]);

  useEffect(() => {
    const missing = uniqueTerms.filter((term) => {
      const key = keyOf(term);
      return !requested.current.has(key) && (attempts.current.get(key) ?? 0) < 3;
    });
    if (missing.length === 0) return;
    for (const term of missing) {
      const key = keyOf(term);
      requested.current.add(key);
      attempts.current.set(key, (attempts.current.get(key) ?? 0) + 1);
    }
    const requestGeneration = generation.current;
    const batches = Array.from({ length: Math.ceil(missing.length / 200) }, (_, index) => missing.slice(index * 200, (index + 1) * 200));
    void Promise.all(batches.map((batch) => api.resolveTermLabels(projectKey, batch))).then((responses) => {
      if (requestGeneration !== generation.current) return;
      setLabels((current) => {
        const next = { ...current };
        for (const resolved of responses) for (const term of resolved) next[keyOf(term)] = term.label;
        return next;
      });
      setRoles((current) => {
        const next = { ...current };
        for (const resolved of responses) for (const term of resolved as ResolvedTerm[]) {
          next[keyOf(term)] = { role: term.role ?? "finding", exclusiveClass: term.exclusive_class ?? null };
        }
        return next;
      });
    }).catch(() => {
      if (requestGeneration !== generation.current) return;
      for (const term of missing) requested.current.delete(keyOf(term));
      if (missing.some((term) => (attempts.current.get(keyOf(term)) ?? 0) < 3)) {
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          setRetryTick((current) => current + 1);
        }, 1500);
      }
    });
  }, [projectKey, uniqueTerms, retryTick]);

  const label = (layerId: string | undefined, termId: string) =>
    layerId ? labels[keyOf({ layer_id: layerId, term_id: termId })] ?? null : null;
  /** Label, role and exclusive class of a term (C10); undefined until resolved. */
  const info = (layerId: string | undefined, termId: string): TermInfo | undefined => {
    if (!layerId) return undefined;
    const key = keyOf({ layer_id: layerId, term_id: termId });
    const role = roles[key];
    return role ? { label: labels[key] ?? termId, ...role } : undefined;
  };
  return Object.assign(label, { info });
}
