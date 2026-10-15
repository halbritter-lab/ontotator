"""Deterministic synthetic T1 corpus and explicit disposable Compose-stack seeding."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import httpx
import ontospan


def assigned_documents(username: str, documents: list[str]) -> list[str]:
    """Stable disjoint document selection for the unchanged 30-user workload."""
    slot = int(username.removeprefix("load-")) - 1
    return [document for index, document in enumerate(documents) if index % 30 == slot]


def read_hpo(path: Path) -> tuple[list[tuple[str, str]], str, str]:
    raw = path.read_bytes()
    graph = json.loads(raw)["graphs"][0]
    match = re.search(r"(\d{4}-\d{2}-\d{2})", graph.get("meta", {}).get("version", ""))
    if not match or match[1] < "2026-06-23":
        raise ValueError("HPO release must be 2026-06-23 or newer")
    nodes = {
        n["id"]: n
        for n in graph["nodes"]
        if n.get("type") == "CLASS"
        and n.get("lbl")
        and not n.get("meta", {}).get("deprecated")
    }
    if len(nodes) < 15000:
        raise ValueError(
            "A representative real HPO is required (at least 15000 active terms); fixture refused"
        )
    children = {}
    for edge in graph.get("edges", []):
        if edge["pred"] == "is_a":
            children.setdefault(edge["obj"], []).append(edge["sub"])
    pending = ["http://purl.obolibrary.org/obo/HP_0000118"]
    descendants = set()
    while pending:
        node = pending.pop()
        if node not in descendants:
            descendants.add(node)
            pending.extend(children.get(node, []))
    terms = sorted(
        (key.rsplit("/", 1)[-1].replace("HP_", "HP:"), node["lbl"])
        for key, node in nodes.items()
        if key in descendants and len(node["lbl"]) >= 4
    )
    if len(terms) < 10000:
        raise ValueError("HPO phenotype subtree is not representative")
    return terms, match[1], hashlib.sha256(raw).hexdigest()


def build_assets(
    out: Path, terms: list[tuple[str, str]], release: str, sha: str
) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    axes = {
        "assertion": ["present", "absent", "uncertain"],
        "experiencer": ["patient", "family_member", "other", "unknown"],
        "temporality": ["current", "historical", "unknown"],
    }
    profile = {
        "profile_id": "load-hpo/v1",
        "version": "1.0.0",
        "ontologies": [
            {
                "ontology_id": "hp",
                "label": "Human Phenotype Ontology",
                "release": release,
                "sha256": sha,
            }
        ],
        "layers": [
            {
                "layer_id": "hpo",
                "label": "Phenotypes",
                "ontology_id": "hp",
                "access": "editable",
                "default_type_id": "phenotype",
                "annotation_types": [
                    {
                        "type_id": "phenotype",
                        "label": "Phenotype",
                        "axes": [
                            {"id": k, "label": k.capitalize(), "options": v}
                            for k, v in axes.items()
                        ],
                    }
                ],
            }
        ],
        "default_layer_id": "hpo",
    }
    from ontocurator.domain.profiles import TaskProfile
    from ontocurator.exchange.t1 import Pin, layers_for

    layers = [
        layer.model_dump(mode="json")
        for layer in layers_for(
            TaskProfile.model_validate(profile),
            {
                "hp": Pin(
                    sha256=sha,
                    allowed_roots=("HP:0000118",),
                    t1_profile="hpo-phenotype",
                )
            },
        )
    ]
    (out / "profile.json").write_text(json.dumps(profile), encoding="utf-8")
    rng = random.Random(20261014)
    units = []
    documents = []
    for i in range(1, 1001):
        doc_id = f"load-{i:04d}"
        selected = rng.sample(terms, 3)
        text = "; ".join(label for _, label in selected) + ". "
        target = rng.randint(max(1500, len(text)), 3000)
        filler = (
            "Synthetic case description for performance evaluation. No patient data. "
        )
        text += (filler * 50)[: target - len(text)]
        annotations = []
        offset = 0
        for j, (term, label) in enumerate(selected):
            start = text.index(label, offset)
            offset = start + len(label)
            annotations.append(
                {
                    "annotation_id": f"p{j + 1}",
                    "layer_id": "hpo",
                    "term_id": term,
                    "axes": {
                        key: {"value": values[0], "basis": "chosen"}
                        for key, values in axes.items()
                    },
                    "mentions": [
                        {
                            "segments": [
                                {"start": start, "end": offset, "text": label}
                            ],
                            "cue_segments": [],
                        }
                    ],
                    "provenance": {
                        "actor": {"actor_id": "load-tool", "kind": "tool"},
                        "method": "tool",
                        "source_refs": [],
                        "notes": ["Synthetic proposal"],
                    },
                }
            )
        units.append(
            ontospan.AnnotatedDocument.model_validate(
                {
                    "document": ontospan.make_document(doc_id, "en", text).model_dump(
                        mode="json"
                    ),
                    "annotation_set": {
                        "annotation_set_id": f"load-run-{doc_id}",
                        "set_kind": "tool_output",
                        "actors": [
                            {
                                "actor_id": "load-tool",
                                "kind": "tool",
                                "name": "ontocurator-load",
                                "version": "1.0.0",
                                "run_id": "load-20261014",
                            }
                        ],
                        "created_at": "2026-10-14T00:00:00Z",
                        "layers": layers,
                        "annotations": annotations,
                    },
                }
            )
        )
        documents.append(doc_id)
    ontospan.write_bundle(
        out / "bundle.zip",
        units,
        bundle_id="load-20261014",
        created_at=datetime(2026, 10, 14, tzinfo=UTC),
    )
    manifest = {
        "documents": documents,
        "users": [f"load-{i:02d}" for i in range(1, 31)],
        "terms": terms,
        "hpo_release": release,
        "hpo_sha256": sha,
        "seed": 20261014,
    }
    (out / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return manifest


def stream_to_container(compose: list[str], source: Path, target: str) -> None:
    """Write a file through exec stdin, including onto a read-only root's tmpfs."""
    with source.open("rb") as stream:
        result = subprocess.run(
            [
                *compose,
                "exec",
                "-T",
                "app",
                "python",
                "-c",
                "import sys; from pathlib import Path; Path(sys.argv[1]).write_bytes(sys.stdin.buffer.read())",
                target,
            ],
            stdin=stream,
            capture_output=True,
            text=True,
            check=False,
        )
    if result.returncode:
        raise RuntimeError(f"Compose file transfer failed (exit {result.returncode})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hpo", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path("loadtest/results/seed"))
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Validate HPO and create corpus without contacting a stack",
    )
    parser.add_argument(
        "--compose-project",
        help="Required when seeding; explicit disposable Compose project",
    )
    parser.add_argument(
        "--compose-file", type=Path, default=Path("docker-compose.dev.yml")
    )
    parser.add_argument("--host", default="http://127.0.0.1:8000")
    parser.add_argument(
        "--password",
        default=os.environ.get("ONTOCURATOR_LOAD_PASSWORD"),
        help="Synthetic accounts only; prefer ONTOCURATOR_LOAD_PASSWORD",
    )
    args = parser.parse_args()
    if not args.prepare_only and (not args.compose_project or not args.password):
        parser.error(
            "seeding requires --compose-project and --password or ONTOCURATOR_LOAD_PASSWORD"
        )
    if not args.prepare_only and len(args.password) < 12:
        parser.error("synthetic password must be at least 12 characters")
    try:
        terms, release, sha = read_hpo(args.hpo)
    except (ValueError, KeyError, OSError) as exc:
        parser.error(str(exc))
    manifest = build_assets(args.out, terms, release, sha)
    if args.prepare_only:
        print(
            f"Prepared 1000 documents and 3000 proposals; HPO {release}, SHA256 {sha}"
        )
        return
    compose = [
        "docker",
        "compose",
        "-f",
        str(args.compose_file.resolve()),
        "-p",
        args.compose_project,
    ]

    def run(*command: str) -> str:
        result = subprocess.run(
            [*compose, *command], capture_output=True, text=True, check=False
        )
        if result.returncode:
            # User creation output may contain a setup code. Never echo it on error.
            raise RuntimeError(
                f"Compose command failed: {command[0]} (exit {result.returncode})"
            )
        return result.stdout

    def admin(*command: str) -> str:
        return run("exec", "-T", "app", "ontocurator", "admin", *command)

    for local, remote in (
        (args.hpo, "/tmp/load-hp.json"),
        (args.out / "profile.json", "/tmp/load-profile.json"),
        (args.out / "bundle.zip", "/tmp/load-bundle.zip"),
    ):
        stream_to_container(compose, local, remote)
    admin("ontologies", "add", "/tmp/load-hp.json")
    admin(
        "projects",
        "create",
        "load",
        "--name",
        "Synthetic load",
        "--profile",
        "/tmp/load-profile.json",
        "--allowed-roots",
        "hp=HP:0000118",
        "--t1-profile",
        "hp=hpo-phenotype",
    )
    admin("import", "load", "/tmp/load-bundle.zip")
    for i in range(1, 31):
        username = f"load-{i:02d}"
        output = admin(
            "users",
            "create",
            username,
            "--display-name",
            username,
            "--pseudonym",
            username,
        )
        match = re.search(r"UTC\):\s*\n\s*(\S+)", output)
        if not match:
            raise RuntimeError("Could not parse CLI setup code")
        with httpx.Client(
            base_url=args.host, headers={"Origin": args.host.rstrip("/")}, timeout=120
        ) as client:
            response = client.post(
                "/api/v1/auth/redeem-code",
                json={
                    "username": username,
                    "code": match[1],
                    "new_password": args.password,
                },
            )
            response.raise_for_status()
            client.post(
                "/api/v1/auth/logout",
                headers={"X-CSRF-Token": response.json()["csrf_token"]},
            ).raise_for_status()
        admin("projects", "add-member", "load", username, "--role", "annotator")
        selected = assigned_documents(username, manifest["documents"])
        document_args = [value for document in selected for value in ("--document", document)]
        admin("assign", "load", username, "--confirm-language", *document_args)
    print(
        f"Seeded {args.compose_project}: 30 users, 1000 documents, 3000 proposals; HPO {release}. Workers load uploaded ontologies automatically on first use; warm up before measurement."
    )


if __name__ == "__main__":
    main()
