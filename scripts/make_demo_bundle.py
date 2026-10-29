"""Rebuild examples/demo-project/demo-bundle.zip from bundle-source.json.

The bundle pins the official HPO 2026-09-01 release (see
examples/acceptance/full-hpo-sources.json), the release the demo guide loads.
Pass --hpo PATH to that hp.json to also check every proposed term.
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import ontospan

from ontotator.domain.profile_templates import hpo_phenotype
from ontotator.exchange.t1 import Pin, layers_for
from ontotator.ontology.store import OntologyFile

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "examples" / "demo-project"
CREATED = datetime(2026, 10, 29, 9, tzinfo=UTC)
# This script is the producer, not a claim that a clinical model ran.
TOOL = {
    "actor_id": "demo-tagger",
    "kind": "tool",
    "name": "Demo phenotype tagger",
    "version": "1.0.0",
    "model": "synthetic-rules",
    "run_id": "demo-2026-10",
}
# The official release asset, pinned in examples/acceptance/full-hpo-sources.json.
HPO_RELEASE = "2026-09-01"
HPO_SHA256 = "a7b3a012e7b4007a35a7cf8da35f2373b54cc16907f80d13d62470d31f833501"
HPO_FILE = OntologyFile(
    HPO_SHA256, "ontology", "HP", HPO_RELEASE, "hp.json", None, CREATED
)
NOTE = "Synthetic demonstration proposal, not a clinical prediction."


def _span(text: str, quote: str, occurrence: int) -> dict[str, Any]:
    start = -1
    for _ in range(occurrence):
        start = text.find(quote, start + 1)
        if start < 0:
            raise ValueError(f"{quote!r} occurrence {occurrence} not in text")
    return {"start": start, "end": start + len(quote), "text": quote}


def _annotation(index: int, text: str, item: dict[str, Any]) -> dict[str, Any]:
    return {
        "annotation_id": f"p{index:02d}",
        "layer_id": "hpo-layer",
        "term_id": item["term"],
        "axes": {
            axis: {"value": item[axis], "basis": "chosen"}
            for axis in ("assertion", "experiencer", "temporality")
        },
        "mentions": [
            {
                "segments": [_span(text, item["quote"], item.get("occurrence", 1))],
                "cue_segments": [],
            }
        ],
        "provenance": {
            "actor": {"actor_id": TOOL["actor_id"], "kind": "tool"},
            "method": "tool",
            "source_refs": [],
            "notes": [NOTE],
        },
    }


def units(source: dict[str, Any]) -> list[ontospan.AnnotatedDocument]:
    # The pin the New project form fills in for HPO: main branch, HPO scheme.
    pin = Pin(HPO_SHA256, ("HP:0000118",), "hpo-phenotype")
    profile = hpo_phenotype(HPO_FILE)
    layers = [
        layer.model_dump(mode="json") for layer in layers_for(profile, {"HP": pin})
    ]
    result = []
    for case in source["cases"]:
        shas: dict[str, str] = {}
        for item in case["texts"]:
            language = item["language"]
            # One text: its ID is the case ID, as for plain-text uploads.
            document_id = case["case_id"]
            if len(case["texts"]) > 1:
                document_id += f"-{language}"
            document = ontospan.make_document(
                document_id, language, item["text"]
            ).model_dump(mode="json")
            document["case_id"] = case["case_id"]
            shas[language] = document["text_sha256"]
            if "translation_of" in item:
                document["variant"] = {
                    "version": 1,
                    "origin": "machine_translation",
                    "derived_from": shas[item["translation_of"]],
                }
                document["translation"] = {
                    "provider": "demo-translator",
                    "model": "synthetic-rules",
                    "run_id": "demo-2026-10",
                    "checks": item.get("checks", []),
                }
            text = document["text"]
            result.append(
                ontospan.AnnotatedDocument.model_validate(
                    {
                        "document": document,
                        "annotation_set": {
                            "annotation_set_id": f"demo-{case['case_id']}-{language}",
                            "set_kind": "tool_output",
                            "actors": [TOOL],
                            "created_at": CREATED.isoformat(),
                            "layers": layers,
                            "annotations": [
                                _annotation(i, text, p)
                                for i, p in enumerate(item["proposals"], start=1)
                            ],
                        },
                    }
                )
            )
    return result


def check_terms(built: list[ontospan.AnnotatedDocument], hpo: Path) -> None:
    ontology = ontospan.ObographOntology.load(hpo)
    if ontology.release != HPO_RELEASE:
        raise SystemExit(f"{hpo} is release {ontology.release}, not {HPO_RELEASE}")
    for unit in built:
        for annotation in unit.annotation_set.annotations:
            if not ontology.is_active(annotation.term_id):
                raise SystemExit(f"{annotation.term_id} is not a live HPO term")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "output", nargs="?", type=Path, default=DEMO / "demo-bundle.zip"
    )
    parser.add_argument("--hpo", type=Path, help="hp.json of HPO 2026-09-01")
    args = parser.parse_args()
    source = json.loads((DEMO / "bundle-source.json").read_text(encoding="utf-8"))
    built = units(source)
    if args.hpo:
        check_terms(built, args.hpo)
    args.output.unlink(missing_ok=True)  # ontospan refuses to overwrite
    ontospan.write_bundle(
        args.output, built, bundle_id="ontotator-demo-v1", created_at=CREATED
    )


if __name__ == "__main__":
    main()
