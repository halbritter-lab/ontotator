"""The demo project's upload files import cleanly through the real readers."""

import runpy
import zipfile
from pathlib import Path

import pytest

from ontotator.domain.project_rules import ProjectRules
from ontotator.exchange.plan import ProjectImportState, plan_import, read_t1_upload
from ontotator.exchange.t1 import Pin
from ontotator.exchange.text import read_text_upload

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "examples" / "demo-project"


@pytest.fixture(scope="module")
def make():
    return runpy.run_path(str(ROOT / "scripts" / "make_demo_bundle.py"))


def test_committed_bundle_matches_its_source(make, tmp_path):
    rebuilt = tmp_path / "demo-bundle.zip"
    make["ontospan"].write_bundle(
        rebuilt,
        make["units"](
            make["json"].loads((DEMO / "bundle-source.json").read_text("utf-8"))
        ),
        bundle_id="ontotator-demo-v1",
        created_at=make["CREATED"],
    )
    with (
        zipfile.ZipFile(DEMO / "demo-bundle.zip") as old,
        zipfile.ZipFile(rebuilt) as new,
    ):
        assert old.namelist() == new.namelist()
        for name in old.namelist():
            assert old.read(name) == new.read(name), name


def test_bundle_plans_texts_translations_and_proposals(make):
    profile = make["hpo_phenotype"](make["HPO_FILE"])
    pin = Pin(make["HPO_SHA256"], ("HP:0000118",), "hpo-phenotype")
    units, issues = read_t1_upload(DEMO / "demo-bundle.zip", {"HP": pin}, profile)
    plan = plan_import(units, ProjectImportState(), profile, ProjectRules(), issues)
    assert plan.committable, plan.errors
    # Terms need the full HPO release; make_demo_bundle.py --hpo checks them.
    assert {i.code for i in plan.warnings} == {"hierarchy_not_checked"}
    assert len(plan.documents) == 10
    assert len({v.case_id for v in plan.variants}) == 7
    assert plan.counts["proposals"] == 31
    translations = [u for u in units if u.variant is not None]
    assert sorted(u.document.document_id for u in translations) == [
        "NEURO-2026-009-en",
        "NEURO-2026-010-en",
        "NEURO-2026-011-en",
    ]


def test_plain_texts_read_as_english_cases():
    files = sorted((DEMO / "texts").glob("*.txt"))
    units, issues = read_text_upload(
        [(f.name, f.read_bytes()) for f in files], "en", languages=["en", "de"]
    )
    assert not issues
    assert [u.document.document_id for u in units] == [
        f"NEURO-2026-00{n}" for n in range(1, 5)
    ]
