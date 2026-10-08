import type { TreeLevel, TreeNode } from "../api/client";

/** What the tree has loaded so far. */
export interface TreeData {
  nodes: Record<string, TreeNode>;
  /** Loaded children per term id. A missing entry means: not loaded yet. */
  children: Record<string, string[]>;
  roots: string[];
}

/**
 * One visible row. `key` is the path of term ids from the root, joined with "/":
 * a term with several parents has one row per place, and each is expanded on its own.
 */
export interface TreeRow {
  key: string;
  termId: string;
  label: string;
  /** 1 for a root. */
  depth: number;
  parentKey: string | null;
  childCount: number;
  expanded: boolean;
  posInSet: number;
  setSize: number;
}

export type TreeKeyAction =
  | { type: "focus"; key: string }
  | { type: "expand"; key: string }
  | { type: "collapse"; key: string }
  | { type: "select"; key: string }
  | { type: "close" };

export const emptyTree = (): TreeData => ({ nodes: {}, children: {}, roots: [] });

export const pathKey = (path: string[]): string => path.join("/");

export const termOfKey = (key: string): string => key.slice(key.lastIndexOf("/") + 1);

export const parentKeyOf = (key: string): string | null => {
  const cut = key.lastIndexOf("/");
  return cut < 0 ? null : key.slice(0, cut);
};

/** Keys of the nodes a path runs through, root first; the last one is the term itself. */
export const keysAlong = (path: string[]): string[] =>
  path.map((_, index) => pathKey(path.slice(0, index + 1)));

const withNodes = (nodes: Record<string, TreeNode>, list: TreeNode[]): Record<string, TreeNode> => {
  const next = { ...nodes };
  for (const node of list) next[node.term_id] = node;
  return next;
};

export function withRoots(data: TreeData, roots: TreeNode[]): TreeData {
  return { ...data, nodes: withNodes(data.nodes, roots), roots: roots.map((node) => node.term_id) };
}

/** Record the children of expanded nodes. Children loaded earlier stay. */
export function withLevels(data: TreeData, levels: TreeLevel[]): TreeData {
  let nodes = data.nodes;
  const children = { ...data.children };
  for (const level of levels) {
    nodes = withNodes(nodes, level.children);
    children[level.term_id] = level.children.map((node) => node.term_id);
  }
  return { ...data, nodes, children };
}

/** The rows on screen, depth-first. A branch is open only if its children are loaded. */
export function visibleRows(data: TreeData, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (ids: string[], parentKey: string | null, depth: number) => {
    const known = ids.filter((id) => data.nodes[id] !== undefined);
    known.forEach((termId, index) => {
      const node = data.nodes[termId];
      const key = parentKey === null ? termId : `${parentKey}/${termId}`;
      const kids = data.children[termId];
      const isExpanded = node.child_count > 0 && kids !== undefined && expanded.has(key);
      rows.push({
        key,
        termId,
        label: node.label,
        depth,
        parentKey,
        childCount: node.child_count,
        expanded: isExpanded,
        posInSet: index + 1,
        setSize: known.length,
      });
      if (isExpanded && kids) walk(kids, key, depth + 1);
    });
  };
  walk(data.roots, null, 1);
  return rows;
}

const MOVES = ["ArrowDown", "ArrowUp", "Home", "End"];

/** What a key press means in the tree (ARIA tree pattern), or null if it is not the tree's. */
export function keyAction(rows: TreeRow[], focusedKey: string | null, key: string): TreeKeyAction | null {
  if (key === "Escape") return { type: "close" };
  if (rows.length === 0) return null;
  const index = rows.findIndex((row) => row.key === focusedKey);
  if (index < 0) return MOVES.includes(key) ? { type: "focus", key: rows[0].key } : null;
  const row = rows[index];
  switch (key) {
    case "ArrowDown":
      return index + 1 < rows.length ? { type: "focus", key: rows[index + 1].key } : null;
    case "ArrowUp":
      return index > 0 ? { type: "focus", key: rows[index - 1].key } : null;
    case "Home":
      return { type: "focus", key: rows[0].key };
    case "End":
      return { type: "focus", key: rows[rows.length - 1].key };
    case "ArrowRight": {
      if (row.childCount === 0) return null;
      if (!row.expanded) return { type: "expand", key: row.key };
      const next = rows[index + 1];
      return next && next.parentKey === row.key ? { type: "focus", key: next.key } : null;
    }
    case "ArrowLeft":
      if (row.expanded) return { type: "collapse", key: row.key };
      return row.parentKey === null ? null : { type: "focus", key: row.parentKey };
    case "Enter":
    case " ":
      return { type: "select", key: row.key };
    default:
      return null;
  }
}
