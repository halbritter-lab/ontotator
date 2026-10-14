"""Where a term can be looked up outside Ontocurator.

HPO and MONDO have term pages addressed by the CURIE. Every other ontology is
looked up through the EBI Ontology Lookup Service search, which finds a term
by its CURIE. Per-ontology link templates are a project setting from T3 on.
"""

from __future__ import annotations

from urllib.parse import quote

_TERM_PAGES = {
    "HP": "https://hpo.jax.org/browse/term/{id}",
    "MONDO": "https://monarchinitiative.org/{id}",
}
_FALLBACK = "https://www.ebi.ac.uk/ols4/search?q={id}"


def external_term_url(term_id: str) -> str | None:
    """The official page of a term, or None for something that is no CURIE."""
    prefix, _, local = term_id.partition(":")
    if not prefix or not local:
        return None
    template = _TERM_PAGES.get(prefix)
    if template is None:
        return _FALLBACK.format(id=quote(term_id, safe=""))
    # A plain CURIE stays readable; anything unusual is encoded.
    safe = ":" if local.isalnum() else ""
    return template.format(id=quote(term_id, safe=safe))
