import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { api, type AnnotationSnapshot, type EditorProposal, type ProposalSetView } from "../api/client";

// No cache survives the editor/workspace lifetime, or crosses project/user keys.
class MetadataCache {
  entries = new Map<number, ProposalSetView | null>();
  pending = new Map<number, AbortController>();
  listeners = new Set<() => void>();
  revision = 0;
  owners = 0;
  constructor(readonly project: string, readonly allowPublicFetch = true, metadata: readonly ProposalSetView[] = [], proposals: readonly EditorProposal[] = []) {
    for (const source of proposals) {
      if (source.proposal_set_id == null) continue;
      const value = metadata.find(item => item.id === source.proposal_set_id && item.document_id === source.document_id);
      if (value || !allowPublicFetch) this.entries.set(source.proposal_set_id, value ?? null);
    }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  load(id: number) {
    if (!this.allowPublicFetch || this.entries.has(id) || this.pending.has(id)) return;
    const controller = new AbortController();
    this.pending.set(id, controller);
    void api.getProposalSet(this.project, id, controller.signal).then(
      value => this.finish(id, controller, value),
      () => this.finish(id, controller, null),
    );
  }
  private finish(id: number, controller: AbortController, value: ProposalSetView | null) {
    if (controller.signal.aborted) return;
    this.pending.delete(id);
    this.entries.set(id, value); // Immutable 404 and other failures stay quiet, once per lifetime.
    this.revision++;
    this.listeners.forEach(listener => listener());
  }
  retain() {
    this.owners++;
    return () => {
      this.owners--;
      // React StrictMode replays effects synchronously. A real departure cancels
      // after that replay window, without starting a second identical request.
      queueMicrotask(() => { if (this.owners === 0) this.cancel(); });
    };
  }
  cancel() {
    this.pending.forEach(controller => controller.abort());
    this.pending.clear();
  }
}
const Metadata = createContext<{cache: MetadataCache; proposals: readonly EditorProposal[]; revision: number} | null>(null);

export function ProposalMetadataProvider({scope, projectKey, proposals, metadata = [], allowPublicFetch = true, children}: {scope: string; projectKey: string; proposals: readonly EditorProposal[]; metadata?: readonly ProposalSetView[]; allowPublicFetch?: boolean; children: ReactNode}) {
  const metadataKey = JSON.stringify(metadata);
  const offeredKey = JSON.stringify(proposals.map(source => [source.proposal_set_id,source.document_id]));
  const cache = useMemo(() => new MetadataCache(projectKey, allowPublicFetch, metadata, proposals), [scope, projectKey, metadataKey, offeredKey, allowPublicFetch]);
  const revision = useSyncExternalStore(cache.subscribe, cache.snapshot, cache.snapshot);
  const ids = [...new Set(proposals.map(p => p.proposal_set_id).filter((id): id is number => id != null))].sort((a,b) => a-b).join(",");
  useEffect(() => {
    if (ids) ids.split(",").forEach(id => cache.load(Number(id)));
  }, [cache, ids]);
  useEffect(() => cache.retain(), [cache]);
  return <Metadata.Provider value={{cache, proposals, revision}}>{children}</Metadata.Provider>;
}

/** Match only an actual immutable source reference; never infer by term, actor or document. */
export function proposalFor(annotation: AnnotationSnapshot | null, proposals: readonly EditorProposal[]): EditorProposal | undefined {
  if (!annotation) return undefined;
  return proposals.find(p => p.annotation.annotation_id === annotation.annotation.annotation_id && p.version === annotation.version)
    ?? proposals.find(p => annotation.annotation.provenance.source_refs?.includes(`${p.annotation.annotation_id}:${p.version}`));
}
const text = (value: unknown): string | undefined => typeof value === "string" && value.length ? value : undefined;
export function matchingTool(source: EditorProposal, metadata: ProposalSetView | null | undefined) {
  const actor = source.annotation.provenance.actor;
  return actor.kind === "tool" ? metadata?.actors.find(a => a.kind === "tool" && a.actor_id === actor.actor_id) : undefined;
}
const toolLabel = (actor: Record<string, unknown> | undefined) => actor && [text(actor.name), text(actor.version)].filter(Boolean).join(" ");
export function useProposalMetadata(source?: EditorProposal) {
  const context = useContext(Metadata);
  const candidate = source?.proposal_set_id != null ? context?.cache.entries.get(source.proposal_set_id) : undefined;
  const metadata = candidate?.document_id === source?.document_id ? candidate : undefined;
  const tool = source ? matchingTool(source, metadata) : undefined;
  const label = toolLabel(tool);
  const duplicate = !!label && context?.proposals.some(other => other.proposal_set_id != null && other.proposal_set_id !== source?.proposal_set_id && other.document_id === source?.document_id && toolLabel(matchingTool(other, context.cache.entries.get(other.proposal_set_id))) === label);
  return {metadata, tool, label: label ? `${label}${duplicate && text(tool?.run_id) ? ` · ${tool?.run_id}` : ""}` : undefined};
}

export function ProposalSource({source}: {source?: EditorProposal | null}) {
  const {metadata, tool} = useProposalMetadata(source ?? undefined);
  if (!source || !metadata || source.proposal_set_id == null) return null;
  const name = toolLabel(tool);
  return <section className="detail-section" aria-label="Proposal source">
    <h3>Source</h3>
    {metadata.origin === "reanchor" && metadata.source_version !== null && <p>Carried over from version {metadata.source_version}</p>}
    <dl className="axis-list">
      {name && <><dt>Tool</dt><dd>{name}</dd></>}
      {text(tool?.model) && <><dt>Model</dt><dd>{text(tool?.model)}</dd></>}
      {text(tool?.run_id) && <><dt>Run</dt><dd>{text(tool?.run_id)}</dd></>}
      <dt>Imported</dt><dd><time dateTime={metadata.imported_at}>{new Date(metadata.imported_at).toLocaleString()}</time>{metadata.imported_by_pseudonym && <> · <span>{metadata.imported_by_pseudonym}</span></>}</dd>
      <dt>Set</dt><dd>{metadata.annotation_set_id}</dd>
      {metadata.bundle_id && <><dt>Bundle</dt><dd>{metadata.bundle_id}</dd></>}
    </dl>
    {!!source.notes?.length && <><h4>Notes</h4><ul>{source.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></>}
  </section>;
}
