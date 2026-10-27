"""The synthetic stack corpus must be an importable, correctly pinned T1 bundle."""

import hashlib
import subprocess
import sys
from pathlib import Path

import ontospan
import pytest

from ontotator.domain.profiles import TaskProfile
from ontotator.exchange.t1 import (
    Pin,
    check_importable,
    document_from_unit,
    pin_differences,
    unit_to_proposals,
)

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"


@pytest.mark.parametrize("generated", [False, True], ids=["committed", "generated"])
def test_smoke_corpus_is_valid_and_importable(tmp_path: Path, generated: bool) -> None:
    # Catches invalid pins, missing producer provenance, evidence offsets, or
    # profile-incompatible proposals in the generator's actual delivery.
    target = FIXTURES / "smoke-bundle.zip"
    if generated:
        target = tmp_path / "smoke.zip"
        subprocess.run(
            [sys.executable, str(ROOT / "scripts/make_smoke_bundle.py"), str(target)],
            cwd=ROOT,
            check=True,
        )
    _, units = ontospan.read_bundle(target)
    profile = TaskProfile.model_validate_json(
        (FIXTURES / "smoke-profile.json").read_text(encoding="utf-8")
    )
    hp_sha = hashlib.sha256((FIXTURES / "hp.json").read_bytes()).hexdigest()
    assert profile.ontologies[0].sha256 == hp_sha
    assert [u.document.document_id for u in units] == ["smoke-001", "smoke-002"]
    assert [u.document.text for u in units] == [
        "Hypotonia and seizure were observed in this synthetic patient.",
        "No additional findings in this synthetic follow-up.",
    ]
    check_importable(units)
    pins = {"hp": Pin(sha256=hp_sha, allowed_roots=(), t1_profile="generic")}
    proposals = []
    for unit in units:
        assert not pin_differences(unit.annotation_set.layers, profile, pins)
        report = ontospan.validate(
            unit.model_dump(mode="json"),
            ontologies={"hp": ontospan.ObographOntology.load(FIXTURES / "hp.json")},
        )
        assert not report.errors, report.errors
        mapped = unit_to_proposals(
            unit, profile, document_from_unit(unit), bundle_id="smoke-v1"
        )
        proposals.extend(mapped.annotations)
    assert len(proposals) == 1
    assert proposals[0].annotation.term_id == "HP:0001250"
    actor = units[0].annotation_set.actors[0]
    assert actor.name and actor.version
