# Third-Party Notices

This project incorporates components from the following third-party software:

## hpo-span-annotator

- **Source:** https://github.com/JohannKaspar/hpo-span-annotator
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

## Bundled runtime dependencies (standalone and wheel builds)

The portable standalone distribution bundles the Python runtime, the Python
packages Ontocurator depends on, and the production JavaScript packages compiled
into the web UI. Their names, versions, licenses and full license texts are
generated at build time by `scripts/license_notices.py` and shipped in the
archive's `LICENSES/` folder:

- `LICENSES/python-packages.txt` - Python runtime dependencies (e.g. FastAPI,
  Starlette, Uvicorn, Pydantic, NumPy, SciPy, scikit-learn, Typer, platformdirs)
- `LICENSES/npm-packages.txt` - JavaScript packages in the web UI (e.g. React)
- `LICENSES/python-runtime.txt` - CPython (PSF License) and PyInstaller
  bootloader (GPL with linking exception) notices

## Ontologies (not bundled)

Ontocurator does not ship ontology releases (test fixtures in `tests/fixtures/`
are small synthetic excerpts). When you load the Human Phenotype Ontology (HPO),
its license and citation requirements apply: https://hpo.jax.org/license -
please cite the current HPO publication when using HPO-based annotations in
publications. Other ontologies (e.g. MONDO) are governed by their own licenses.
