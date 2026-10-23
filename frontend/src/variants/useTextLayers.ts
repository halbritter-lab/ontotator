import { useEffect, useState } from 'react';
import { api, type TextLayerEntry, type VersionRef } from '../api/client';

/** Layer key of a ref (route `show` / `compare_show`): `proposals` or `{kind}:{id}`. */
export const layerKey = (ref: Pick<VersionRef, 'kind' | 'id'>): string => ref.kind === 'proposals' ? 'proposals' : `${ref.kind}:${ref.id}`;

/** The listed ref behind a layer key; null for `text` and for keys this viewer is not offered. */
export const refForLayer = (key: string, refs: readonly VersionRef[]): VersionRef | null =>
  key === 'text' ? null : refs.find(ref => layerKey(ref) === key) ?? null;

/** Refs of the entries this viewer may open. */
export const layerRefs = (entries: readonly TextLayerEntry[]): VersionRef[] =>
  entries.flatMap(entry => entry.available && entry.ref ? [entry.ref] : []);

/** An old `annotations=` value (`text` or a JSON `[kind, id]` tuple) as a layer key; undefined when it is neither. */
export function legacyLayerKey(value: string): string | undefined {
  if (value === 'text') return 'text';
  try {
    const tuple: unknown = JSON.parse(value);
    return Array.isArray(tuple) && tuple.length === 2 && typeof tuple[0] === 'string' && typeof tuple[1] === 'string'
      ? layerKey({ kind: tuple[0] as VersionRef['kind'], id: tuple[1] }) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The server's "Show" list of a text version (spec §4, D3: the server leaves out other people's work).
 * `withOlder` adds the older refs a lead opens from the submission history; those are not layers.
 * `documentId` null waits (for example while access is loading).
 */
export function useTextLayers(projectKey: string, documentId: string | null, withOlder: boolean, identity: string) {
  const key = JSON.stringify([projectKey, documentId, withOlder, identity]);
  const [state, setState] = useState<{ key: string; entries?: TextLayerEntry[]; refs?: VersionRef[]; error?: unknown } | null>(null);
  useEffect(() => {
    if (documentId === null) return;
    let active = true;
    Promise.all([api.listTextLayers(projectKey, documentId),
      withOlder ? api.listAnnotationVersions(projectKey, documentId).catch(() => [] as VersionRef[]) : [] as VersionRef[]])
      .then(([entries, older]) => { if (active) setState({ key, entries, refs: [...layerRefs(entries), ...older] }); },
        error => { if (active) setState({ key, error }); });
    return () => { active = false; };
  }, [key]);
  const current = state?.key === key ? state : null;
  return { entries: current?.entries ?? null, refs: current?.refs ?? null, error: current?.error ?? null };
}
