import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, type TreeTermDetail } from "../api/client";
import type { WorkspaceKey } from "./searchState";
import { TermTree } from "./TermTree";
import {
  emptyTree,
  keysAlong,
  parentKeyOf,
  termOfKey,
  visibleRows,
  withLevels,
  withRoots,
  type TreeData,
} from "./treeState";

export interface TreeBrowserProps {
  /** Out of sight and out of reach for now; the walk and its state are kept. */
  collapsed?: boolean;
  workspaceKey: WorkspaceKey;
  /** The annotation this walk belongs to. */
  annotationId: string;
  layerId: string;
  /** The term the walk starts at. */
  startTermId: string;
  /** The term that annotation carries right now. */
  currentTermId: string | null;
  /** False while that annotation is not the one being edited. */
  canAssign: boolean;
  /** Move the keyboard focus into the tree once it has loaded. */
  focusOnOpen: boolean;
  onClose: () => void;
  /** Assign the term. The walk's id binds the selection to what was shown. */
  onUseTerm: (termId: string, browseId: string) => Promise<void>;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const START_NOTICE: Record<string, string> = {
  obsolete: "is obsolete",
  unknown: "is not part of this ontology",
};

/**
 * One walk through the ontology tree, as a panel docked into the case layout. It
 * opens once, when the component mounts; the parent starts another walk by giving
 * the component a new key.
 */
export const TreeBrowser: React.FC<TreeBrowserProps> = ({
  collapsed = false,
  workspaceKey,
  annotationId,
  layerId,
  startTermId,
  currentTermId,
  canAssign,
  focusOnOpen,
  onClose,
  onUseTerm,
}) => {
  const [data, setData] = useState<TreeData>(emptyTree);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, TreeTermDetail>>({});
  const [browseId, setBrowseId] = useState<string | null>(null);
  const [startStatus, setStartStatus] = useState<string | null>(null);
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  const [reveal, setReveal] = useState<{ key: string; focus: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sectionRef = useRef<HTMLElement | null>(null);
  const opened = useRef(false);

  // Collapsed, nothing in here keeps the keyboard focus.
  useEffect(() => {
    const active = document.activeElement;
    if (collapsed && active instanceof HTMLElement && sectionRef.current?.contains(active)) active.blur();
  }, [collapsed]);

  // One walk per mount. The guard keeps React's development double-run of
  // effects from logging a second walk; nothing is cancelled on cleanup for
  // the same reason.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    api
      .openTree({ workspace_key: workspaceKey, annotation_id: annotationId, layer_id: layerId, term_id: startTermId })
      .then((walk) => {
        const keys = keysAlong(walk.path);
        const startKey = keys.length > 0 ? keys[keys.length - 1] : null;
        const firstKey = startKey ?? walk.roots[0]?.term_id ?? null;
        setData(withLevels(withRoots(emptyTree(), walk.roots), walk.levels));
        setExpanded(new Set(keys));
        setBrowseId(walk.browse_id);
        setStartStatus(walk.start_status);
        if (walk.detail) setDetails({ [walk.detail.term_id]: walk.detail });
        setSelectedKey(startKey);
        setFocusedKey(firstKey);
        if (firstKey) setReveal({ key: firstKey, focus: focusOnOpen });
      })
      .catch((reason) => setError(messageOf(reason)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadNode = async (key: string, options: { expand?: boolean; viaParentId?: string }) => {
    if (!browseId) return null;
    setError(null);
    setLoadingKeys((current) => new Set(current).add(key));
    try {
      const node = await api.loadTreeNode({
        workspace_key: workspaceKey,
        annotation_id: annotationId,
        layer_id: layerId,
        browse_id: browseId,
        term_id: termOfKey(key),
        expand: options.expand ?? false,
        via_parent_id: options.viaParentId ?? null,
      });
      setDetails((current) => ({ ...current, [node.detail.term_id]: node.detail }));
      return node;
    } catch (reason) {
      setError(messageOf(reason));
      return null;
    } finally {
      setLoadingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const select = (key: string) => {
    setSelectedKey(key);
    setFocusedKey(key);
    if (!details[termOfKey(key)]) void loadNode(key, {});
  };

  const expand = async (key: string) => {
    const termId = termOfKey(key);
    if (data.children[termId] === undefined) {
      const node = await loadNode(key, { expand: true });
      if (!node) return;
      setData((current) => withLevels(current, [{ term_id: termId, children: node.children }]));
    }
    setExpanded((current) => new Set(current).add(key));
  };

  const collapse = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    // The focused row may be inside the branch that just closed.
    if (focusedKey && focusedKey.startsWith(`${key}/`)) setFocusedKey(key);
  };

  /** "Also under": open the path through another parent of the selected term and go there. */
  const showUnder = async (parentId: string) => {
    if (!selectedKey) return;
    const node = await loadNode(selectedKey, { viaParentId: parentId });
    if (!node || node.path.length === 0) return;
    const keys = keysAlong(node.path);
    const target = keys[keys.length - 1];
    setData((current) => withLevels(current, node.levels));
    setExpanded((current) => new Set([...current, ...keys.slice(0, -1)]));
    setSelectedKey(target);
    setFocusedKey(target);
    setReveal({ key: target, focus: true });
  };

  const rows = useMemo(() => visibleRows(data, expanded), [data, expanded]);
  const selectedTermId = selectedKey ? termOfKey(selectedKey) : null;
  const detail = selectedTermId ? details[selectedTermId] ?? null : null;
  const selectedParentKey = selectedKey ? parentKeyOf(selectedKey) : null;
  const pathParentId = selectedParentKey ? termOfKey(selectedParentKey) : null;
  const otherParents = (detail?.parents ?? []).filter((parent) => parent.term_id !== pathParentId);
  const isCurrent = selectedTermId !== null && selectedTermId === currentTermId;
  const canUse = canAssign && browseId !== null && selectedTermId !== null && !isCurrent && !saving;

  const assignTerm = async () => {
    if (!canUse || !selectedTermId || !browseId) return;
    setSaving(true);
    setError(null);
    try {
      await onUseTerm(selectedTermId, browseId);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setSaving(false);
    }
  };

  const hint = !canAssign
    ? "Select one of your annotations to assign a term from the tree."
    : isCurrent
      ? "This is the annotation's current term."
      : null;

  return (
    <div className="tree-host" hidden={collapsed}>
      <section ref={sectionRef} className="tree-browser" role="region" aria-label="Ontology tree">
        <header className="tree-browser__header">
          <h2>Ontology tree</h2>
          <button type="button" className="btn btn-secondary btn-sm" aria-label="Close tree" onClick={onClose}>
            ✕
          </button>
        </header>

        {startStatus && START_NOTICE[startStatus] && (
          <div className="tree-notice" role="status">
            {`${startTermId} ${START_NOTICE[startStatus]}. The tree starts at the top.`}
          </div>
        )}
        {error && (
          <div className="tree-error" role="alert">
            {error}
          </div>
        )}

        <div className="tree-browser__body">
          <div className="tree-browser__tree">
            {browseId === null ? (
              !error && <div className="tree-loading">Loading tree…</div>
            ) : (
              <TermTree
                rows={rows}
                focusedKey={focusedKey}
                selectedKey={selectedKey}
                currentTermId={currentTermId}
                loadingKeys={loadingKeys}
                reveal={reveal}
                label="Terms"
                onFocusKey={setFocusedKey}
                onExpand={(key) => {
                  void expand(key);
                }}
                onCollapse={collapse}
                onSelect={select}
                onClose={onClose}
              />
            )}
          </div>

          <div className="tree-detail">
            <div className="tree-detail__body">
              {detail ? (
                <>
                  <h3 className="tree-detail__name">{detail.label}</h3>
                  <div className="tree-detail__id">{detail.term_id}</div>
                  {detail.definition && <p className="tree-detail__definition">{detail.definition}</p>}
                  {detail.synonyms.length > 0 && (
                    <div className="tree-detail__group">
                      <h4>Synonyms</h4>
                      <ul>
                        {detail.synonyms.map((synonym) => (
                          <li key={synonym}>{synonym}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Object.keys(detail.translations).length > 0 && (
                    <div className="tree-detail__group">
                      <h4>Translated names</h4>
                      <dl>
                        {Object.entries(detail.translations)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([language, names]) => (
                          <React.Fragment key={language}>
                            <dt>{language}</dt>
                            <dd>{names.join("; ")}</dd>
                          </React.Fragment>
                        ))}
                      </dl>
                    </div>
                  )}
                  {otherParents.length > 0 && (
                    <div className="tree-detail__group">
                      <h4>Also under</h4>
                      <ul>
                        {otherParents.map((parent) => (
                          <li key={parent.term_id}>
                            <button
                              type="button"
                              className="tree-link"
                              onClick={() => {
                                void showUnder(parent.term_id);
                              }}
                            >
                              {parent.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="tree-detail__empty">
                  {selectedKey ? "Loading…" : "Select a term in the tree to see its details."}
                </p>
              )}
            </div>
            <div className="tree-detail__actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canUse}
                onClick={() => {
                  void assignTerm();
                }}
              >
                Use this term
              </button>
              {hint && <span className="tree-detail__hint">{hint}</span>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
