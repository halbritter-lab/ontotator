"""Load the Human Phenotype Ontology and answer the routes that need no model.

Reads ``hp.json``, the OBO Graph JSON release published at
<https://github.com/obophenotype/human-phenotype-ontology/releases>. That file
is the whole ontology source for this tool: labels, synonyms, definitions and
``is_a`` edges all come from it, so the release the tool is running is a single
recorded string rather than a property of whichever files happen to be on disk.

Three of the search routes live here; none of them uses an embedding model:

``exact``   normalised string match against labels and synonyms
``id``      a term id typed straight in
``browse``  parents, children and siblings

They let an annotator reach any term directly, by name, id or position in the
hierarchy, independent of how a scored search ranks it.

Adapted from hpo-span-annotator (MIT); see THIRD_PARTY_NOTICES.md.
"""

from __future__ import annotations

import csv
import json
import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_CURIE_FORMAT = re.compile(r"^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$")
# The release date sits inside the version IRI:
# `http://purl.obolibrary.org/obo/hp/releases/2026-06-23/hp.json`
_RELEASE = re.compile(r"/releases/([0-9]{4}-[0-9]{2}-[0-9]{2})/")

# Synonym predicates, best first. `hasExactSynonym` is a name for the same
# concept; `hasRelatedSynonym` is looser and routinely points at a neighbour, so
# the two are kept apart rather than pooled into one bag of strings.
SYNONYM_RANK = {
    "hasExactSynonym": 0,
    "hasNarrowSynonym": 1,
    "hasBroadSynonym": 2,
    "hasRelatedSynonym": 3,
}

# basicPropertyValues predicates carrying identity history. OBO Graph JSON
# writes them as full IRIs; the short forms are accepted for hand-made files.
ALT_ID_PREDICATES = frozenset(
    {
        "http://www.geneontology.org/formats/oboInOwl#hasAlternativeId",
        "oboInOwl:hasAlternativeId",
        "hasAlternativeId",
    }
)
REPLACED_BY_PREDICATES = frozenset(
    {
        "http://purl.obolibrary.org/obo/IAO_0100001",
        "IAO:0100001",
        "http://www.geneontology.org/formats/oboInOwl#replacedBy",
        "term_replaced_by",
        "replaced_by",
    }
)
CONSIDER_PREDICATES = frozenset(
    {
        "http://www.geneontology.org/formats/oboInOwl#consider",
        "oboInOwl:consider",
        "consider",
    }
)


class OntologyError(RuntimeError):
    """The ontology file is missing, unreadable or not an HPO release."""


def curie(iri: str) -> str | None:
    """Extract canonical CURIE from IRI or explicit CURIE string."""
    if not iri:
        return None
    raw = iri.strip()
    if _CURIE_FORMAT.match(raw):
        return raw
    # Handle OBO-style IRIs where the final path component is PREFIX_LOCALID
    tail = raw.rsplit("/", 1)[-1] if "/" in raw else raw
    parts = tail.split("_")
    if len(parts) == 2 and parts[0].isalnum() and parts[1].isalnum():
        return f"{parts[0]}:{parts[1]}"
    return None


def normalise(text: str) -> str:
    """Casefold and collapse whitespace for the exact-match index.

    Diacritics are stripped for this index alone, and only here. The corpus is
    multilingual and a clinician typing on a keyboard without dead keys writes
    ``hipoacusia`` for ``hipoacusia`` either way, so an accent-blind *lookup* is
    what makes the independent route usable. The stored term and the document
    text are never folded: the same folding applied to a query destroys German
    and would destroy French and Spanish alike.
    """
    folded = unicodedata.normalize("NFKD", text or "")
    stripped = "".join(c for c in folded if not unicodedata.combining(c))
    return " ".join(stripped.casefold().split())


@dataclass(slots=True)
class Term:
    """One HPO class."""

    hpo_id: str
    label: str
    definition: str = ""
    synonyms: list[tuple[str, str]] = field(default_factory=list)  # (pred, value)
    parents: list[str] = field(default_factory=list)
    obsolete: bool = False
    # Retired identifiers merged into this term (``hasAlternativeId``).
    alt_ids: list[str] = field(default_factory=list)
    # For obsolete terms: the single designated successor, if any
    # (IAO:0100001 ``term replaced by``), and looser suggestions (``consider``).
    replaced_by: str | None = None
    consider: list[str] = field(default_factory=list)
    # Every ``term replaced by`` value; ``replaced_by`` keeps the first. A term
    # with more than one has no single successor (moving a project to a newer
    # release rewrites a term only through exactly one, #81).
    replaced_by_all: list[str] = field(default_factory=list)
    # Official translations, keyed by language code. Empty unless a babelon
    # file was loaded. These are additional names for the same class, never a
    # second class, so nothing downstream has to know a hit came from one.
    translations: dict[str, list[str]] = field(default_factory=dict)

    def exact_synonyms(self) -> list[str]:
        return [v for p, v in self.synonyms if p == "hasExactSynonym"]

    def search_terms(
        self,
        with_definition: bool = False,
        languages: Iterable[str] | None = None,
    ) -> list[str]:
        """The strings this term is findable by, best first.

        The definition is offered rather than included by default: definitions
        are long and would dominate a term's short names in a string index.

        ``languages`` adds the translated names for those codes. It is a
        parameter rather than a property of the term because callers want
        different answers: the lexical index wants every language it can get,
        since a French query shares no characters with an English label.
        """
        out = [self.label]
        for _, value in sorted(self.synonyms, key=lambda s: SYNONYM_RANK.get(s[0], 9)):
            out.append(value)
        for code in languages or ():
            out.extend(self.translations.get(code, ()))
        if with_definition and self.definition:
            out.append(self.definition)
        seen: set[str] = set()
        deduped: list[str] = []
        for t in out:
            if t and t not in seen:
                seen.add(t)
                deduped.append(t)
        return deduped

    def as_dict(self) -> dict[str, Any]:
        return {
            "hpo_id": self.hpo_id,
            "label": self.label,
            "definition": self.definition,
            "synonyms": [v for _, v in self.synonyms],
            "exact_synonyms": self.exact_synonyms(),
        }


class Ontology:
    """Ontology, indexed for the three routes that touch no model."""

    def __init__(
        self,
        terms: dict[str, Term],
        release: str,
        dominant_prefix: str | None = None,
    ) -> None:
        self.terms = terms
        self.release = release
        self.dominant_prefix = dominant_prefix

        # Alternative id -> primary id. An alt id that is itself a class, or
        # that two classes both claim, cannot be resolved and is left out.
        claimed: dict[str, set[str]] = {}
        for term in terms.values():
            for alt in term.alt_ids:
                if alt not in terms:
                    claimed.setdefault(alt, set()).add(term.hpo_id)
        self._alt_ids: dict[str, str] = {
            alt: next(iter(owners))
            for alt, owners in claimed.items()
            if len(owners) == 1
        }

        # Case-insensitive fallback over primary and alternative ids. Only keys
        # that resolve to exactly one primary term are kept: "HP:00000AB" and
        # "HP:00000ab" must not silently resolve "hp:00000Ab" to whichever
        # happened to be indexed last.
        ci_targets: dict[str, set[str]] = {}
        for term in terms.values():
            ci_targets.setdefault(term.hpo_id.casefold(), set()).add(term.hpo_id)
        for alt, primary in self._alt_ids.items():
            ci_targets.setdefault(alt.casefold(), set()).add(primary)
        self._ci_terms: dict[str, Term] = {
            key: terms[next(iter(ids))]
            for key, ids in ci_targets.items()
            if len(ids) == 1
        }
        self._children: dict[str, list[str]] = {}
        for term in terms.values():
            for parent in term.parents:
                self._children.setdefault(parent, []).append(term.hpo_id)
        for kids in self._children.values():
            kids.sort(key=lambda i: self.label_of(i).casefold())

        # Normalised string -> [(hpo_id, the term that matched, predicate)].
        # A list because synonyms genuinely collide across the ontology, and
        # picking one silently would hide the collision from the annotator, who
        # is the only one who can resolve it.
        self._exact: dict[str, list[tuple[str, str, str]]] = {}
        for term in terms.values():
            if term.obsolete:
                continue
            self._exact.setdefault(normalise(term.label), []).append(
                (term.hpo_id, term.label, "label")
            )
            for pred, value in term.synonyms:
                self._exact.setdefault(normalise(value), []).append(
                    (term.hpo_id, value, pred)
                )

    # --- basics ----------------------------------------------------------- #
    def __len__(self) -> int:
        return len(self.terms)

    def get(self, hpo_id: str) -> Term | None:
        if not hpo_id:
            return None
        trimmed = hpo_id.strip()
        # 1. Exact match (preserves case)
        term = self.terms.get(trimmed)
        if term is not None:
            return term
        # 2. Alternative (merged) id resolves to its primary term
        primary = self._alt_ids.get(trimmed)
        if primary is not None:
            return self.terms[primary]
        # 3. Case-insensitive match, only if unambiguous
        return self._ci_terms.get(trimmed.casefold())

    def label_of(self, hpo_id: str) -> str:
        term = self.get(hpo_id)
        return term.label if term else hpo_id

    def live_terms(self) -> list[Term]:
        """Non-obsolete terms, in id order."""
        return [
            t
            for t in sorted(self.terms.values(), key=lambda t: t.hpo_id)
            if not t.obsolete
        ]

    # --- the three model-free routes -------------------------------------- #
    def exact(self, query: str, limit: int = 32) -> list[dict[str, Any]]:
        """Terms whose label or a synonym equals the query after normalisation.

        Exact before synonym before looser predicate, which is a fact about the
        match rather than a score's opinion about relevance. That is why this
        route's order is kept while scored routes are shuffled.
        """
        hits = self._exact.get(normalise(query), [])
        ordered = sorted(
            hits,
            key=lambda h: 0 if h[2] == "label" else 1 + SYNONYM_RANK.get(h[2], 9),
        )
        # A label and its synonyms often normalise to the same string; keep
        # each term once, at its best-ranked match.
        unique: list[tuple[str, str, str]] = []
        seen: set[str] = set()
        for hit in ordered:
            if hit[0] not in seen:
                seen.add(hit[0])
                unique.append(hit)
        out = []
        for hpo_id, matched, pred in unique[:limit]:
            term = self.terms[hpo_id]
            out.append(
                {
                    **term.as_dict(),
                    "matched_term": matched,
                    "match_kind": "label" if pred == "label" else pred,
                }
            )
        return out

    def starts_with(self, query: str, limit: int = 32) -> list[dict[str, Any]]:
        """Prefix fallback for the exact route, so a partial word still lands."""
        needle = normalise(query)
        if len(needle) < 3:
            return []
        out: list[dict[str, Any]] = []
        seen: set[str] = set()
        for key in sorted(self._exact):
            if not key.startswith(needle):
                continue
            for hpo_id, matched, pred in self._exact[key]:
                if hpo_id in seen:
                    continue
                seen.add(hpo_id)
                out.append(
                    {
                        **self.terms[hpo_id].as_dict(),
                        "matched_term": matched,
                        "match_kind": f"prefix:{pred}",
                    }
                )
                if len(out) >= limit:
                    return out
        return out

    def children_of(self, hpo_id: str) -> list[str]:
        term = self.get(hpo_id)
        if not term:
            return []
        return list(self._children.get(term.hpo_id, []))

    def siblings_of(self, hpo_id: str) -> list[str]:
        """Every term sharing a parent with this one, itself excluded.

        Siblings are the reason a browse route exists at all. Open-vocabulary
        annotation needs the annotator to verify the *negative* -- that no
        neighbour fits better -- and a ranked list cannot support that judgement
        however long it is.
        """
        term = self.get(hpo_id)
        if not term:
            return []
        out: list[str] = []
        for parent in term.parents:
            for sibling in self._children.get(parent, []):
                if sibling != term.hpo_id and sibling not in out:
                    out.append(sibling)
        return out

    def ancestors_of(self, hpo_id: str, limit: int = 24) -> list[str]:
        """Ids from this term up to the root, breadth-first, deduplicated."""
        term = self.get(hpo_id)
        if not term:
            return []
        out: list[str] = []
        queue = list(term.parents)
        while queue and len(out) < limit:
            current = queue.pop(0)
            if current in out:
                continue
            out.append(current)
            parent = self.get(current)
            if parent:
                queue.extend(parent.parents)
        return out

    def detail(self, hpo_id: str) -> dict[str, Any] | None:
        """Everything the term-detail panel shows, in one lookup."""
        term = self.get(hpo_id)
        if not term:
            return None

        def brief(ids: Iterable[str]) -> list[dict[str, str]]:
            return [{"hpo_id": i, "label": self.label_of(i)} for i in ids]

        return {
            **term.as_dict(),
            "obsolete": term.obsolete,
            "alt_ids": list(term.alt_ids),
            "replaced_by": term.replaced_by,
            "consider": list(term.consider),
            "parents": brief(term.parents),
            "children": brief(self.children_of(term.hpo_id)),
            "siblings": brief(self.siblings_of(term.hpo_id)),
            "ancestors": brief(self.ancestors_of(term.hpo_id)),
        }


def load(path: Path, prefix: str | None = None) -> Ontology:
    """Parse an OBO Graph JSON release into an :class:`Ontology`.

    CLASS nodes carrying valid CURIEs are kept. If prefix is provided,
    only classes matching that prefix are kept.
    Dominant prefix is detected by counting loaded terms.
    """
    path = Path(path)
    if not path.is_file():
        raise OntologyError(f"{path} does not exist.")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise OntologyError(f"{path} is not valid JSON: {exc}") from exc

    graphs = payload.get("graphs") or []
    if not graphs:
        raise OntologyError(f"{path} carries no graphs; this is not an OBO Graph file")
    graph = graphs[0]

    version = ((graph.get("meta") or {}).get("version")) or ""
    match = _RELEASE.search(version)
    release = match.group(1) if match else (version or "unknown")

    terms: dict[str, Term] = {}
    for node in graph.get("nodes") or []:
        if node.get("type") != "CLASS":
            continue
        term_id = curie(node.get("id", ""))
        if not term_id:
            continue
        if prefix is not None and not term_id.startswith(f"{prefix}:"):
            continue
        meta = node.get("meta") or {}
        synonyms = [
            (str(s.get("pred") or "hasRelatedSynonym"), str(s.get("val") or ""))
            for s in meta.get("synonyms") or []
            if s.get("val")
        ]
        alt_ids: list[str] = []
        replaced_by: str | None = None
        replaced_by_all: list[str] = []
        consider: list[str] = []
        for prop in meta.get("basicPropertyValues") or []:
            pred = str(prop.get("pred") or "")
            value = curie(str(prop.get("val") or ""))
            if not value:
                continue
            if pred in ALT_ID_PREDICATES and value not in alt_ids:
                alt_ids.append(value)
            elif pred in REPLACED_BY_PREDICATES:
                if replaced_by is None:
                    replaced_by = value
                if value not in replaced_by_all:
                    replaced_by_all.append(value)
            elif pred in CONSIDER_PREDICATES and value not in consider:
                consider.append(value)
        terms[term_id] = Term(
            hpo_id=term_id,
            label=str(node.get("lbl") or term_id),
            definition=str((meta.get("definition") or {}).get("val") or ""),
            synonyms=synonyms,
            obsolete=bool(meta.get("deprecated")),
            alt_ids=alt_ids,
            replaced_by=replaced_by,
            consider=consider,
            replaced_by_all=replaced_by_all,
        )

    for edge in graph.get("edges") or []:
        if edge.get("pred") != "is_a":
            continue
        child = curie(edge.get("sub", ""))
        parent = curie(edge.get("obj", ""))
        if child and parent and child in terms and parent in terms:
            terms[child].parents.append(parent)

    if not terms:
        msg = f"{path} holds no classes"
        if prefix:
            msg += f" with prefix {prefix}"
        raise OntologyError(msg)

    # Detect unique dominant prefix
    prefix_counts: dict[str, int] = {}
    for tid in terms:
        p = tid.split(":", 1)[0]
        prefix_counts[p] = prefix_counts.get(p, 0) + 1

    sorted_counts = sorted(prefix_counts.items(), key=lambda it: it[1], reverse=True)
    if len(sorted_counts) == 1 or (
        len(sorted_counts) > 1 and sorted_counts[0][1] > sorted_counts[1][1]
    ):
        dominant_prefix = sorted_counts[0][0]
    else:
        dominant_prefix = None

    return Ontology(terms, release, dominant_prefix=dominant_prefix)


# --- translations ---------------------------------------------------------- #
# Babelon TSVs from https://github.com/obophenotype/hpo-translations.
#
# Two schemas live in that directory and they do not agree on anything but
# `subject_id` and `translation_value`:
#
#   hp-<lang>.babelon.tsv    subject_id, predicate_id, translation_status, ...
#   hp-<lang>.synonyms.tsv   subject_id, translation_value, comment, Status, ...
#
# So the status is read from either spelling, and the predicate is optional --
# the synonyms files carry none at all, and demanding one would silently drop
# every synonym in the corpus. Column *order* differs too (`subject_id` is the
# first column in the French babelon file and the third in the Spanish one),
# which is why everything here goes through the header.
BABELON_STATUS_COLUMNS = ("translation_status", "Status")
# A definition is prose about the term, not a name for it. Indexing it as a name
# lets a query match the explanation instead of the thing, which on a char n-gram
# index is a reliable way to surface the wrong term with a confident score.
BABELON_SKIP_PREDICATES = frozenset({"IAO:0000115"})
# Several names can share one cell. The German synonyms file states the
# convention in its own header row -- `AL oboInOwl:hasExactSynonym@de SPLIT=|` --
# and left unsplit the cell enters a char n-gram index as one long "name" that
# matches far too much and scores confidently while doing it.
BABELON_VALUE_SEPARATOR = "|"


def _babelon_language(row: dict[str, str], fallback: str) -> str:
    # The primary subtag in full: "nna" is Nynorsk, not "nn"; "pt-BR" is "pt".
    raw = (row.get("translation_language") or fallback or "").strip().lower()
    return raw.replace("_", "-").split("-", 1)[0]


def _babelon_status(row: dict[str, str]) -> str:
    for column in BABELON_STATUS_COLUMNS:
        value = (row.get(column) or "").strip().upper()
        if value:
            return value
    return ""


def load_translations(
    ontology: Ontology,
    paths: Iterable[Path],
) -> dict[str, int]:
    """Merge babelon TSVs onto the ontology's terms. Returns terms hit per language.

    **Parse by header name, never by column position.** The column order is not
    stable across the language files: in ``hp-fr.babelon.tsv`` ``subject_id`` is
    the first column, in ``hp-es.babelon.tsv`` it is the third. Reading by index
    silently yields a file's worth of nonsense rather than an error, which is
    exactly the failure that looks like a coverage problem.

    **Every name is kept.** A synonym is another chance for a query to match, so
    the only things dropped are the two that are not names: a definition, which
    is prose about the term, and a value that merely repeats one of the term's
    English names.

    That second case is detected rather than trusted. The files carry a
    ``NOT_TRANSLATED`` status, but it is wrong in both directions -- rows so
    marked in ``hp-fr.synonyms.tsv`` include both untranslated English
    (``Radial deviation of hands``) and perfectly good French
    (``épiphyses du 2nd doigt élargies``). Filtering on the status would index
    English under a French tag *and* discard real French. Comparing the value
    against the term's own English names decides it exactly: a duplicate adds no
    match chance because it is already indexed, and anything else is a name worth
    having whatever the status column claims.
    """
    counts: dict[str, set[str]] = {}
    for path in paths:
        path = Path(path)
        if not path.is_file():
            continue
        fallback = path.stem.split("-")[1].split(".")[0] if "-" in path.stem else ""
        with path.open(encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            if not reader.fieldnames or "subject_id" not in reader.fieldnames:
                raise OntologyError(
                    f"{path} has no subject_id column; "
                    f"got {reader.fieldnames}. This is not a babelon TSV."
                )
            for row in reader:
                if (row.get("predicate_id") or "").strip() in BABELON_SKIP_PREDICATES:
                    continue
                # A non-HP subject is the stray directive row these files carry
                # in place of a second header (`ID  AL oboInOwl:...`).
                term = ontology.get((row.get("subject_id") or "").strip())
                raw = (row.get("translation_value") or "").strip()
                if term is None or not raw or term.obsolete:
                    continue
                language = _babelon_language(row, fallback)
                if not language:
                    continue
                english = {normalise(n) for n in term.search_terms()}
                keep = [
                    value
                    for value in (v.strip() for v in raw.split(BABELON_VALUE_SEPARATOR))
                    if value and normalise(value) not in english
                ]
                if not keep:
                    # Do not create the language bucket. A row that contributed
                    # nothing must leave no trace, or "which languages does this
                    # term have" answers yes for a language it has no name in.
                    continue
                bucket = term.translations.setdefault(language, [])
                for value in keep:
                    if value not in bucket:
                        bucket.append(value)
                counts.setdefault(language, set()).add(term.hpo_id)
    return {lang: len(ids) for lang, ids in sorted(counts.items())}


def find_translation_files(directory: Path) -> list[Path]:
    """Every ``hp-<lang>.*.tsv`` in a directory, sorted."""
    directory = Path(directory)
    if not directory.is_dir():
        return []
    return sorted(directory.glob("hp-*.tsv"))
