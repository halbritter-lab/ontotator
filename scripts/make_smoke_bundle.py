"""Rebuild the committed, entirely synthetic real-stack smoke corpus."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
from pathlib import Path

import ontospan

from ontotator.domain.profiles import TaskProfile
from ontotator.exchange.t1 import Pin, layers_for

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"


def make_bundle(target: Path) -> None:
    profile = TaskProfile.model_validate_json(
        (FIXTURES / "smoke-profile.json").read_text(encoding="utf-8")
    )
    layers = layers_for(profile, {"hp": Pin(profile.ontologies[0].sha256)})
    # This script is the producer, not a claim that a clinical model ran.
    actor = {
        "actor_id": "smoke-fixture",
        "kind": "tool",
        "name": "make_smoke_bundle",
        "version": "1.0.0",
    }
    units = []
    for document_id, text in [
        ("smoke-001", "Hypotonia and seizure were observed in this synthetic patient."),
        ("smoke-002", "No additional findings in this synthetic follow-up."),
    ]:
        annotations = []
        if document_id == "smoke-001":
            annotations.append(
                {
                    "annotation_id": "seizure-proposal",
                    "layer_id": "hpo-layer",
                    "term_id": "HP:0001250",
                    "axes": {"assertion": {"value": "present", "basis": "chosen"}},
                    "mentions": [
                        {
                            "segments": [{"start": 14, "end": 21, "text": "seizure"}],
                            "cue_segments": [],
                        }
                    ],
                    "provenance": {
                        "actor": {"actor_id": actor["actor_id"], "kind": "tool"},
                        "method": "tool",
                        "source_refs": [],
                        "notes": ["Synthetic smoke fixture; no model inference."],
                    },
                }
            )
        units.append(
            ontospan.AnnotatedDocument.model_validate(
                {
                    "document": ontospan.make_document(
                        document_id, "en", text
                    ).model_dump(mode="json"),
                    "annotation_set": {
                        "annotation_set_id": f"smoke-fixture-{document_id}",
                        "set_kind": "tool_output",
                        "actors": [actor],
                        "created_at": "2026-10-14T12:00:00Z",
                        "layers": [layer.model_dump(mode="json") for layer in layers],
                        "annotations": annotations,
                    },
                }
            )
        )
    ontospan.write_bundle(
        target,
        units,
        bundle_id="smoke-v1",
        created_at=datetime(2026, 10, 14, 12, tzinfo=UTC),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "output", nargs="?", type=Path, default=FIXTURES / "smoke-bundle.zip"
    )
    make_bundle(parser.parse_args().output)
