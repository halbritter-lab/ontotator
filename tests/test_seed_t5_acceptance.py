"""DB-free guards for the host-only local acceptance seed adapter."""

import hashlib
import json
import runpy
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "seed_t5_acceptance.py"


@pytest.fixture
def seed():
    return runpy.run_path(str(SCRIPT))


def config(seed, **changes):
    values = dict(
        project="ontocurator-t5-acceptance-check",
        image="sha256:" + "a" * 64,
        source_sha="b" * 40,
        app_port=18080,
        pg_port=15543,
    )
    return seed["configuration"](**(values | changes))


@pytest.mark.parametrize(
    "changes",
    [
        {"project": "existing-production"},
        {"project": "ontocurator-t5-acceptance/other"},
        {"image": "ontocurator-dev:local"},
        {"source_sha": "main"},
        {"app_port": 80000},
        {"app_port": 15543},
        {"pg_port": 0},
    ],
)
def test_rejects_ambiguous_or_unsafe_stack_identity(seed, changes):
    with pytest.raises(ValueError):
        config(seed, **changes)


def test_host_is_derived_from_explicit_loopback_port(seed):
    assert config(seed)["host"] == "http://127.0.0.1:18080"


@pytest.mark.parametrize(
    "users,projects,ontologies",
    [
        ("admin\tp\tAdmin\tactive, admin\ndemo-reviewer\tp\tR\tactive", "", ""),
        ("admin\tp\tAdmin\tactive, admin", "other\tOther\t2 documents\t1 member", ""),
        ("admin\tp\tAdmin\tactive, admin", "", "some stored ontology"),
        ("someone\tp\tOther\tactive, admin", "", ""),
    ],
)
def test_refuses_populated_or_unexpected_stack_before_any_seed(
    seed, users, projects, ontologies
):
    with pytest.raises(ValueError, match="fresh"):
        seed["require_fresh"](users, projects, ontologies)


def test_only_expected_bootstrap_identity_is_fresh(seed):
    seed["require_fresh"]("admin\tp\tAdministrator\tactive, admin\n", "", "")


def test_local_output_must_be_new_and_inside_ignored_acceptance_area(seed, tmp_path):
    root = tmp_path / "checkout"
    root.mkdir()
    allowed = root / "build" / "t5-acceptance" / "run"
    assert seed["output_path"](root, allowed) == allowed
    with pytest.raises(ValueError):
        seed["output_path"](root, root / "examples" / "credentials")
    allowed.mkdir(parents=True)
    with pytest.raises(ValueError, match="exists"):
        seed["output_path"](root, allowed)


def test_identity_requires_exact_images_project_and_finished_migration(seed):
    cfg = config(seed)
    services = {
        name: {
            "Image": cfg["image"],
            "Config": {
                "Labels": {
                    "com.docker.compose.project": cfg["project"],
                    "com.docker.compose.service": name,
                }
            },
            "State": {"Status": "running", "Health": {"Status": "healthy"}},
        }
        for name in ("app", "migrate", "postgres")
    }
    services["migrate"]["State"] = {"Status": "exited", "ExitCode": 0}
    seed["require_service_identity"](cfg, services)
    services["app"]["Image"] = "sha256:" + "c" * 64
    with pytest.raises(ValueError, match="image"):
        seed["require_service_identity"](cfg, services)
    services["app"]["Image"] = cfg["image"]
    services["migrate"]["State"]["ExitCode"] = 1
    with pytest.raises(ValueError, match="migration"):
        seed["require_service_identity"](cfg, services)
    services["migrate"]["State"]["ExitCode"] = 0
    services["postgres"]["Config"]["Labels"]["com.docker.compose.project"] = "other"
    with pytest.raises(ValueError, match="project"):
        seed["require_service_identity"](cfg, services)


def test_public_input_manifest_matches_byte_stable_shipped_inputs(seed):
    manifest = seed["verify_inputs"]()
    assert manifest["documents"] == 6
    assert manifest["tool_proposals"] == 6
    assert manifest["writer_git"] == "4105ec1259fc04d927d78258fcf4c99f8f014b6a"


def test_full_input_set_requires_its_separate_manifest_and_hashes_every_translation(
    seed, tmp_path
):
    names = ["hp.json", "profile.json", "demo.zip", "cases.json", "hp-de.babelon.tsv"]
    for name in names:
        (tmp_path / name).write_bytes(name.encode())
    manifest = {
        "input_kind": "full-hpo/v1",
        "translations": ["hp-de.babelon.tsv"],
        "sha256": {name: hashlib.sha256(name.encode()).hexdigest() for name in names},
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    assert seed["verify_inputs"](tmp_path)["translations"] == ["hp-de.babelon.tsv"]
    (tmp_path / "hp-de.babelon.tsv").write_bytes(b"changed")
    with pytest.raises(ValueError, match="hash mismatch"):
        seed["verify_inputs"](tmp_path)


def test_original_four_file_manifest_cannot_be_relaxed_by_adding_translations(
    seed, tmp_path
):
    manifest = {
        "translations": ["hp-de.babelon.tsv"],
        "sha256": {"hp-de.babelon.tsv": "a" * 64},
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError):
        seed["verify_inputs"](tmp_path)


def test_full_input_manifest_rejects_traversal_and_unlisted_files(seed, tmp_path):
    for names in [["../hp-de.babelon.tsv"], ["hp-dtp.babelon.tsv"]]:
        (tmp_path / "manifest.json").write_text(
            json.dumps(
                {"input_kind": "full-hpo/v1", "translations": names, "sha256": {}}
            )
        )
        with pytest.raises(ValueError):
            seed["verify_inputs"](tmp_path)


def test_dirty_snapshot_digest_identifies_actual_source_bytes_without_ignored_runtime(
    seed, tmp_path
):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    (tmp_path / ".gitignore").write_text("private-runtime/\n")
    (tmp_path / "source.py").write_text("first")
    before = seed["source_tree_digest"](tmp_path)
    (tmp_path / "private-runtime").mkdir()
    (tmp_path / "private-runtime" / "credentials.json").write_text("private")
    assert seed["source_tree_digest"](tmp_path) == before
    (tmp_path / "source.py").write_text("second")
    assert seed["source_tree_digest"](tmp_path) != before


def test_snapshot_identity_is_explicit_and_requires_a_sha256(seed):
    cfg = config(seed, snapshot_sha256="c" * 64)
    assert cfg["snapshot_sha256"] == "c" * 64
    with pytest.raises(ValueError):
        config(seed, snapshot_sha256="main")


def test_candidate_image_requires_both_base_revision_and_exact_dirty_snapshot(seed):
    cfg = config(seed, snapshot_sha256="c" * 64)
    image = {
        "Config": {
            "Labels": {
                "org.opencontainers.image.revision": cfg["source_sha"],
                "org.opencontainers.image.source-snapshot-sha256": cfg[
                    "snapshot_sha256"
                ],
            }
        }
    }
    seed["require_image_identity"](cfg, image)
    image["Config"]["Labels"]["org.opencontainers.image.source-snapshot-sha256"] = (
        "d" * 64
    )
    with pytest.raises(ValueError, match="snapshot"):
        seed["require_image_identity"](cfg, image)


def test_full_hpo_builder_regenerates_bundle_profile_and_translation_inventory_offline(
    seed, tmp_path
):
    import shutil

    import ontospan

    builder = runpy.run_path(str(SCRIPT.with_name("prepare_full_hpo_acceptance.py")))
    source = tmp_path / "sources"
    source.mkdir()
    fixtures = SCRIPT.parents[1] / "tests/fixtures"
    (source / "hp.json").write_bytes((fixtures / "hp.json").read_bytes() + b"\n")
    for name in ["hp-de.babelon.tsv", "hp-es.babelon.tsv"]:
        shutil.copyfile(fixtures / name, source / name)

    def descriptor(name):
        return {"filename": name, "sha256": seed["digest"](source / name)}

    manifest = {
        "schema": "ontocurator-full-hpo-sources/v1",
        "release": "2026-06-23",
        "ontology": descriptor("hp.json"),
        "translations": [
            descriptor("hp-de.babelon.tsv"),
            descriptor("hp-es.babelon.tsv"),
        ],
    }
    source_manifest = tmp_path / "source-manifest.json"
    source_manifest.write_text(json.dumps(manifest))
    output = tmp_path / "new-inputs"
    builder["prepare_inputs"](source, output, source_manifest)
    generated = seed["verify_inputs"](output)
    profile = json.loads((output / "profile.json").read_text())
    assert profile["profile_id"] == "t5-full-hpo-acceptance/v1"
    assert profile["ontologies"][0]["sha256"] == descriptor("hp.json")["sha256"]
    _, units = ontospan.read_bundle(output / "demo.zip")
    assert len(units) == 6
    assert all(
        layer.ontology.sha256 == descriptor("hp.json")["sha256"]
        for unit in units
        for layer in unit.annotation_set.layers
    )
    assert generated["translations"] == ["hp-de.babelon.tsv", "hp-es.babelon.tsv"]
    assert (output / "demo.zip").read_bytes() != (
        SCRIPT.parents[1] / "examples/t5-acceptance/demo.zip"
    ).read_bytes()
    with pytest.raises(ValueError, match="exists"):
        builder["prepare_inputs"](source, output, source_manifest)


def test_compose_adapter_keeps_explicit_identity_and_overrides_ambient_ports(
    seed, tmp_path, monkeypatch
):
    cfg = config(seed)
    monkeypatch.setenv("ONTOCURATOR_DEV_PORT", "9999")
    monkeypatch.setenv("GITHUB_TOKEN_FILE", "unrelated-private-token")
    cfg.update(
        base_compose="checked-out-base.yml",
        override="immutable-image.json",
        env_file="run.env",
    )
    cfg["environment"] = seed["compose_environment"](cfg, tmp_path)
    stack = seed["Stack"](cfg)
    assert stack.command == [
        "docker",
        "compose",
        "--project-name",
        cfg["project"],
        "--env-file",
        "run.env",
        "-f",
        "checked-out-base.yml",
        "-f",
        "immutable-image.json",
    ]
    assert stack.env["ONTOCURATOR_DEV_PORT"] == "18080"
    assert stack.env["GITHUB_TOKEN_FILE"] == str(tmp_path / "unused-build-token")
    assert stack.env["ONTOCURATOR_MIGRATE_TARGET"] == "head"


def test_private_files_cannot_overwrite_an_existing_attempt(seed, tmp_path):
    path = tmp_path / "credentials.json"
    seed["write_private"](path, {"test": "first"})
    with pytest.raises(FileExistsError):
        seed["write_private"](path, {"test": "replacement"})
    assert '"first"' in path.read_text()


def test_command_failure_never_exposes_captured_setup_code(seed, monkeypatch):
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args[0], 1, stdout=b"private-code", stderr=b"private-code"
        ),
    )
    with pytest.raises(RuntimeError) as error:
        seed["checked"](["docker", "compose"], env={})
    assert "private-code" not in str(error.value)


def test_existing_attempt_refuses_before_docker_or_network(seed, tmp_path, monkeypatch):
    (tmp_path / "seed-started.json").write_text("{}")
    globals_ = seed["seed"].__globals__
    monkeypatch.setitem(
        globals_, "load_prepared", lambda directory: {"directory": str(tmp_path)}
    )

    def forbidden(*args, **kwargs):
        pytest.fail(
            "No Docker or network operation may run on an existing seed attempt"
        )

    monkeypatch.setitem(globals_, "Stack", forbidden)
    with pytest.raises(ValueError, match="already attempted"):
        seed["seed"](tmp_path)
