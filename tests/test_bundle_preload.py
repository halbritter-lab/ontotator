"""Preconfigured bundles: build-time preloads and provisioning an existing ZIP."""

from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import build_common  # noqa: E402
import build_standalone  # noqa: E402
import provision_bundle  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"
HP = FIXTURES / "hp.json"
DEMO = FIXTURES / "demo_package.zip"
EXE = "ontocurator.exe" if sys.platform == "win32" else "ontocurator"


def _fake_onedir(root: Path) -> Path:
    bundle = root / "standalone" / "ontocurator"
    (bundle / "_internal").mkdir(parents=True)
    (bundle / "_internal" / "base_library.zip").write_bytes(b"PK")
    (bundle / EXE).write_bytes(b"\x00binary")
    return bundle


def _settings(tmp_path: Path, data: object) -> Path:
    path = tmp_path / "settings-src.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _preload(tmp_path: Path) -> build_common.Preload:
    return build_common.Preload(
        packages=(DEMO,),
        ontologies=(HP,),
        settings=_settings(
            tmp_path,
            {"allowed_modes": ["independent"], "open_package": "demo-klinik-pakete-01"},
        ),
    )


def test_standard_bundle_has_folder_readmes(tmp_path: Path) -> None:
    bundle = _fake_onedir(tmp_path)
    zip_path = build_standalone.prepare_portable_bundle(bundle, tmp_path, None)
    with zipfile.ZipFile(zip_path) as z:
        names = set(z.namelist())
        packages_readme = z.read("ontocurator/packages/README.txt").decode()
        ontologies_readme = z.read("ontocurator/ontologies/README.txt").decode()
        main_readme = z.read("ontocurator/README.txt").decode()
    assert "ontocurator/packages/" in names
    for raw in (packages_readme, ontologies_readme):
        text = " ".join(raw.split())
        assert "initial delivery" in text.lower()
        assert "does NOT change data that was already imported" in text
        assert "new package ID" in text
        assert "Never edit the workspace folder by hand" in text
    assert "ontocurator-settings.json" in main_readme
    assert "packages" in main_readme


def test_preloaded_build_layout_and_name(tmp_path: Path) -> None:
    bundle = _fake_onedir(tmp_path)
    preload = _preload(tmp_path)
    zip_path = build_standalone.prepare_portable_bundle(
        bundle, tmp_path, None, preload=preload, bundle_name="study-xy"
    )
    assert zip_path.name == "study-xy.zip"
    with zipfile.ZipFile(zip_path) as z:
        names = set(z.namelist())
        assert z.read("study-xy/packages/demo_package.zip") == DEMO.read_bytes()
        assert z.read("study-xy/ontologies/hp.json") == HP.read_bytes()
        settings = json.loads(z.read("study-xy/ontocurator-settings.json"))
    assert settings["allowed_modes"] == ["independent"]
    assert f"study-xy/{EXE}" in names
    assert "study-xy/packages/README.txt" in names


def test_provisioning_an_existing_bundle_matches_a_preloaded_build(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("SOURCE_DATE_EPOCH", raising=False)
    preload = _preload(tmp_path)

    built_dir = tmp_path / "built"
    built_dir.mkdir()
    built = build_standalone.prepare_portable_bundle(
        _fake_onedir(built_dir),
        built_dir,
        None,
        preload=preload,
        bundle_name="study-xy",
    )

    plain_dir = tmp_path / "plain"
    plain_dir.mkdir()
    plain = build_standalone.prepare_portable_bundle(
        _fake_onedir(plain_dir), plain_dir, None
    )
    out_dir = tmp_path / "out"
    provision_bundle.main(
        [
            str(plain),
            "--package",
            str(DEMO),
            "--ontology",
            str(HP),
            "--settings",
            str(preload.settings),
            "--bundle-name",
            "study-xy",
            "--out-dir",
            str(out_dir),
        ]
    )
    provisioned = out_dir / "study-xy.zip"
    assert provisioned.read_bytes() == built.read_bytes()
    assert plain.is_file()  # the input is left untouched


@pytest.mark.parametrize("kind", ["package", "ontology", "settings"])
def test_invalid_preloads_are_rejected(tmp_path: Path, kind: str) -> None:
    bad = tmp_path / ("bad.zip" if kind == "package" else "bad.json")
    if kind == "package":
        bad.write_bytes(b"not a zip")
        preload = build_common.Preload(packages=(bad,))
    elif kind == "ontology":
        bad.write_text('{"hello": 1}', encoding="utf-8")
        preload = build_common.Preload(ontologies=(bad,))
    else:
        bad.write_text(json.dumps({"allowed_modes": ["telepathy"]}), encoding="utf-8")
        preload = build_common.Preload(settings=bad)
    with pytest.raises(build_common.PreloadError):
        build_common.validate_preload(preload)


def test_duplicate_preload_names_are_rejected(tmp_path: Path) -> None:
    other = tmp_path / "x" / "hp.json"
    other.parent.mkdir()
    other.write_bytes(HP.read_bytes())
    with pytest.raises(build_common.PreloadError, match=r"hp.json"):
        build_common.validate_preload(build_common.Preload(ontologies=(HP, other)))


def test_unknown_settings_keys_only_warn(tmp_path: Path) -> None:
    preload = build_common.Preload(settings=_settings(tmp_path, {"colour": "blue"}))
    warnings = build_common.validate_preload(preload)
    assert any("colour" in w for w in warnings)


def test_open_package_not_in_preloads_warns(tmp_path: Path) -> None:
    preload = build_common.Preload(
        settings=_settings(tmp_path, {"open_package": "elsewhere"})
    )
    warnings = build_common.validate_preload(preload)
    assert any("elsewhere" in w for w in warnings)


def test_build_standalone_preload_options(tmp_path: Path) -> None:
    settings = _settings(tmp_path, {"allowed_modes": ["independent"]})
    args = build_standalone.parse_args(
        [
            "--package",
            str(DEMO),
            "--ontology",
            str(HP),
            "--settings",
            str(settings),
            "--bundle-name",
            "study-xy",
            "--out-dir",
            str(tmp_path),
        ]
    )
    assert args.preload.packages == (DEMO.resolve(),)
    assert args.preload.ontologies == (HP.resolve(),)
    assert args.preload.settings == settings.resolve()
    assert args.bundle_name == "study-xy"
    with pytest.raises(SystemExit):
        build_standalone.parse_args(["--bundle-name", "../evil"])
    bad = tmp_path / "bad.zip"
    bad.write_bytes(b"nope")
    with pytest.raises(SystemExit):
        build_standalone.parse_args(["--package", str(bad)])


def test_provision_bundle_rejects_bad_input(tmp_path: Path) -> None:
    not_a_bundle = tmp_path / "two-roots.zip"
    with zipfile.ZipFile(not_a_bundle, "w") as z:
        z.writestr("a/x.txt", "x")
        z.writestr("b/y.txt", "y")
    with pytest.raises(SystemExit):
        provision_bundle.main(
            [str(not_a_bundle), "--package", str(DEMO), "--bundle-name", "s"]
        )
