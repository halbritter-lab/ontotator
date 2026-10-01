# Third-Party Notices

This project incorporates components from the following third-party software:

## hpo-span-annotator

- **Source:** `https://github.com/...` (local checkout `../hpo-span-annotator`)
- **Revision:** `27c5dad8bb2086f1f6fad3629ce66a730bdef642`
- **License:** MIT License (see `LICENSES/hpo-span-annotator-MIT.txt`)
- **Vendored modules:**
  - `src/ontocurator/vendor/hpo_span_annotator/hpo.py`
  - `src/ontocurator/vendor/hpo_span_annotator/lexical.py`
  - `src/ontocurator/vendor/hpo_span_annotator/search.py`
  - `frontend/src/vendor/spans.js` (adapted in Aufgabe 5)
- **Modifications:**
  - Integrated into isolated namespace under `ontocurator.vendor`.
  - Non-semantic search and lexical indexing retained; dense embeddings, hub and server dependencies excluded.
  - Generalized CURIE parsing, case preservation, dominant prefix detection, and variable-width numeric ID matching without hardcoded HPO assumptions.
