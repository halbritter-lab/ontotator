"""Regenerate separate acceptance inputs from checksum-pinned full HPO sources.

Run with the project Python environment. This is an offline preparation command:
download the official files listed in full-hpo-sources.json into --source-dir first.
It creates a NEW ignored input directory and never touches a running stack.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "examples/t5-acceptance"
SOURCES = TEMPLATE / "full-hpo-sources.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare_inputs(
    source: Path, output: Path, source_manifest: Path = SOURCES
) -> dict[str, Any]:
    import ontospan

    from ontocurator.domain.profiles import TaskProfile
    from ontocurator.ontology.translations import apply_translations, translation_counts
    from ontocurator.vendor.hpo_span_annotator.hpo import load

    if output.exists():
        raise ValueError("Output exists; choose a new candidate input directory")
    specification = json.loads(source_manifest.read_text(encoding="utf-8"))
    if specification.get("schema") != "ontocurator-full-hpo-sources/v1":
        raise ValueError("A separate pinned full-HPO source manifest is required")
    resources = [specification["ontology"], *specification["translations"]]
    names = set()
    for item in resources:
        name = item["filename"]
        if (
            name != "hp.json"
            and not re.fullmatch(r"hp-[a-z]{2}\.(babelon|synonyms)\.tsv", name)
        ) or name in names:
            raise ValueError("Invalid or duplicate full-HPO resource filename")
        names.add(name)
        if digest(source / name) != item["sha256"]:
            raise ValueError(f"Official source hash mismatch: {name}")
    if specification["ontology"]["filename"] != "hp.json":
        raise ValueError("The full-HPO ontology must be hp.json")
    ontology = load(source / "hp.json")
    live_ids = {term.hpo_id for term in ontology.live_terms()}
    loaded, skipped = apply_translations(
        ontology, [source / item["filename"] for item in specification["translations"]]
    )
    profile = json.loads((TEMPLATE / "profile.json").read_text(encoding="utf-8"))
    profile["profile_id"] = "t5-full-hpo-acceptance/v1"
    pin = specification["ontology"]["sha256"]
    profile["ontologies"][0].update(release=specification["release"], sha256=pin)
    TaskProfile.model_validate(profile)
    _, original_units = ontospan.read_bundle(TEMPLATE / "demo.zip")
    units = []
    term_ids = set()
    for original in original_units:
        item = original.model_dump(mode="json")
        item["annotation_set"]["annotation_set_id"] += (
            "-full-hpo-" + specification["release"]
        )
        for layer in item["annotation_set"]["layers"]:
            layer["ontology"].update(version=specification["release"], sha256=pin)
        for annotation in item["annotation_set"]["annotations"]:
            term_id = annotation["term_id"]
            if term_id not in live_ids:
                raise ValueError(
                    f"Synthetic proposal is not a live term in the full release: {term_id}"
                )
            term_ids.add(term_id)
        units.append(ontospan.AnnotatedDocument.model_validate(item))
    output.mkdir(parents=True)
    (output / "profile.json").write_text(
        json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output / "cases.json").write_text(
        json.dumps(
            json.loads((TEMPLATE / "cases.json").read_text(encoding="utf-8")), indent=2
        )
        + "\n",
        encoding="utf-8",
    )
    translations = [item.filename for item in loaded]
    for name in ["hp.json", *translations]:
        shutil.copyfile(source / name, output / name)
    ontospan.write_bundle(
        output / "demo.zip",
        units,
        bundle_id="t5-full-hpo-acceptance-" + specification["release"],
        created_at=datetime(2026, 10, 18, tzinfo=UTC),
    )
    writer = importlib.metadata.distribution("ontospan")
    direct = json.loads(writer.read_text("direct_url.json") or "{}")
    manifest = {
        "input_kind": "full-hpo/v1",
        "format": "ontospan/1.1",
        "writer": "ontospan " + writer.version,
        "writer_git": direct.get("vcs_info", {}).get("commit_id"),
        "documents": len(units),
        "tool_proposals": sum(len(unit.annotation_set.annotations) for unit in units),
        "source_manifest_sha256": digest(source_manifest),
        "release": specification["release"],
        "ontology_sha256": pin,
        "total_terms": len(ontology.terms),
        "live_terms": len(live_ids),
        "synthetic_term_ids": sorted(term_ids),
        "translation_counts": translation_counts(ontology),
        "translations": translations,
        "skipped_resources": [
            {"filename": item.filename, "reason": item.reason} for item in skipped
        ],
        "sha256": {
            name: digest(output / name)
            for name in [
                "hp.json",
                "profile.json",
                "demo.zip",
                "cases.json",
                *translations,
            ]
        },
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--source-manifest", type=Path, default=SOURCES)
    args = parser.parse_args()
    allowed = (ROOT / "build/t5-acceptance").resolve()
    if (
        args.output_dir.resolve() == allowed
        or not args.output_dir.resolve().is_relative_to(allowed)
    ):
        parser.error("Output must be a new directory below ignored build/t5-acceptance")
    manifest = prepare_inputs(args.source_dir, args.output_dir, args.source_manifest)
    print(
        json.dumps(
            {
                key: manifest[key]
                for key in [
                    "release",
                    "ontology_sha256",
                    "live_terms",
                    "documents",
                    "translation_counts",
                ]
            }
        )
    )


if __name__ == "__main__":
    main()
