# T0: Term ID and External Link in the Tree View

As of: 2026-10-14 · Status: **Design approved** · Part of the roadmap `2026-10-14-roadmap-web-service-analysis.md`

## Current State

- `frontend/src/editor/TermTree.tsx:112-118`: The row shows only the label, the number of children and the "current" marker. The ID appears only in `data-term-id`.
- `frontend/src/editor/TreeBrowser.tsx:247-313`: The detail pane shows the ID without a link.
- Backend: `src/ontotator/ontology/tree.py`, with `TreeNode` and `TreeTermDetail`.

## Design

**Backend**
- A new pure function `external_term_url(term_id) -> str | None` maps the CURIE prefix to a URL:
  - `HP` → `https://hpo.jax.org/browse/term/{id}`
  - `MONDO` → `https://monarchinitiative.org/{id}`
  - all other prefixes → `https://www.ebi.ac.uk/ols4/search?q={id}`
  - `{id}` is URL-encoded.
- `TreeNode` and `TreeTermDetail` get the field `external_url: str | None`.
- Afterwards OpenAPI and the generated TS types are regenerated (`scripts/export_openapi.py`, `npm --prefix frontend run api:generate`).

**Frontend**
- After the label, the tree row shows the ID muted in monospace and next to it a ↗ link.
- The link has `target="_blank"`, `rel="noopener noreferrer"`, the `aria-label` "View <ID> on <host>" and a tooltip.
- A click on the link calls `stopPropagation()`. It therefore does not select the term and does not expand the node.
- Keyboard operation of the ARIA tree stays unchanged; the link is not in the roving tabindex.
- The detail pane shows the same link next to the ID.

**Not included**
- Configurable link templates per ontology. These come with the admin page (T3).

## Tests

- **pytest:** mapping per prefix (HP, MONDO, fallback) and URL encoding.
- **Vitest:** ID and link are rendered. A click on the link does not trigger `onSelect`.
- **Playwright:** The existing tree test additionally checks the ID text and `href` of an HPO row.
