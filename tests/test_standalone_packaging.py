"""Tests for the build scripts' real logic (no PyInstaller run needed)."""

import json
import sys
import zipfile
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import build_common  # noqa: E402
import build_release  # noqa: E402
import build_standalone  # noqa: E402
import license_notices  # noqa: E402

from ontocurator.config_store import detect_portable_root  # noqa: E402

EXE = "ontocurator.exe" if sys.platform == "win32" else "ontocurator"


def _fake_onedir(root: Path) -> Path:
    bundle = root / "standalone" / "ontocurator"
    (bundle / "_internal" / "ontocurator" / "web").mkdir(parents=True)
    (bundle / "_internal" / "ontocurator" / "web" / "index.html").write_text("<html>")
    (bundle / "_internal" / "base_library.zip").write_bytes(b"PK")
    (bundle / EXE).write_bytes(b"\x00binary")
    return bundle


def test_archive_entries_are_sorted_and_prefixed(tmp_path: Path) -> None:
    root = tmp_path / "b"
    (root / "z").mkdir(parents=True)
    (root / "a.txt").write_text("a")
    (root / "z" / "c.txt").write_text("c")
    (root / "empty").mkdir()
    names = [n for n, _ in build_common.archive_entries(root, "app")]
    assert names == ["app/", "app/a.txt", "app/empty/", "app/z/", "app/z/c.txt"]


def test_deterministic_zip_is_byte_identical(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "b"
    root.mkdir()
    (root / "x.txt").write_text("hello")
    monkeypatch.delenv("SOURCE_DATE_EPOCH", raising=False)
    z1 = build_common.write_deterministic_zip(root, tmp_path / "1.zip", "p")
    (root / "x.txt").touch()  # mtime must not matter
    z2 = build_common.write_deterministic_zip(root, tmp_path / "2.zip", "p")
    assert z1.read_bytes() == z2.read_bytes()
    with zipfile.ZipFile(z1) as z:
        assert {i.date_time for i in z.infolist()} == {(1980, 1, 1, 0, 0, 0)}

    monkeypatch.setenv("SOURCE_DATE_EPOCH", "1767225600")  # 2026-01-01
    z3 = build_common.write_deterministic_zip(root, tmp_path / "3.zip", "p")
    with zipfile.ZipFile(z3) as z:
        assert z.infolist()[0].date_time[:3] == (2026, 1, 1)


def test_prepare_portable_bundle_layout_and_archive(tmp_path: Path) -> None:
    bundle = _fake_onedir(tmp_path)
    generated = tmp_path / "gen-licenses"
    generated.mkdir()
    (generated / "python-packages.txt").write_text("fastapi MIT")

    zip_path = build_standalone.prepare_portable_bundle(bundle, tmp_path, generated)

    assert zip_path.parent == tmp_path
    assert zip_path.name.startswith("ontocurator-portable-")
    with zipfile.ZipFile(zip_path) as z:
        names = set(z.namelist())
    for expected in [
        f"ontocurator/{EXE}",
        "ontocurator/portable.txt",
        "ontocurator/README.txt",
        "ontocurator/ontologies/README.txt",
        "ontocurator/workspace/",
        "ontocurator/THIRD_PARTY_NOTICES.md",
        "ontocurator/LICENSES/hpo-span-annotator-MIT.txt",
        "ontocurator/LICENSES/python-packages.txt",
        "ontocurator/_internal/ontocurator/web/index.html",
    ]:
        assert expected in names, expected
    assert all("\\" not in n for n in names)
    readme = (bundle / "README.txt").read_text(encoding="utf-8")
    assert "Ctrl+C" in readme and "hpo.jax.org/license" in readme

    # The extracted folder is recognised as portable by the frozen app.
    assert detect_portable_root(bundle, frozen=True) == bundle


def test_pyinstaller_args(tmp_path: Path) -> None:
    web = tmp_path / "web"
    args = build_standalone.pyinstaller_args(
        web_src=web, dist_path=tmp_path / "d", work_path=tmp_path / "w"
    )
    assert "--noupx" in args
    assert "--onedir" in args
    assert "--copy-metadata=ontocurator" in args
    import importlib.util

    for arg in args:
        if arg.startswith("--hidden-import="):
            module = arg.split("=", 1)[1]
            assert importlib.util.find_spec(module) is not None, module
    assert any(a.startswith("--add-data=" + str(web)) for a in args)
    assert f"--specpath={tmp_path / 'w'}" in args
    assert any("tzdata" in a for a in args)
    assert "--windowed" not in args
    assert "--windowed" in build_standalone.pyinstaller_args(
        web_src=web, dist_path=tmp_path, work_path=tmp_path, windowed=True
    )


def test_build_standalone_cli_options(tmp_path: Path) -> None:
    args = build_standalone.parse_args(
        ["--out-dir", str(tmp_path), "--skip-frontend", "--skip-lock-check"]
    )
    assert args.out_dir == tmp_path.resolve()
    assert args.skip_frontend and not args.update_embedded_web
    with pytest.raises(SystemExit):
        build_standalone.parse_args(["--skip-frontend", "--update-embedded-web"])
    with pytest.raises(SystemExit) as exc:
        build_standalone.parse_args(["--help"])
    assert exc.value.code == 0


def test_build_release_wheel_check() -> None:
    complete = {
        *build_release.REQUIRED_WHEEL_FILES,
        "ontocurator/web/assets/index-1.js",
        "ontocurator/web/assets/index-1.css",
    }
    assert build_release.missing_wheel_files(complete) == []
    assert build_release.missing_wheel_files(
        complete - {"ontocurator/web/assets/index-1.css"}
    ) == ["ontocurator/web/assets/*.css"]


def test_python_license_notices_cover_runtime_deps_only() -> None:
    names = {
        license_notices._canonical(n.name) for n in license_notices.python_notices()
    }
    assert {"fastapi", "uvicorn", "pydantic", "numpy", "platformdirs"} <= names
    assert "pytest" not in names
    assert "pyinstaller" not in names


def test_npm_license_notices_skip_dev_packages(tmp_path: Path) -> None:
    lock = {
        "lockfileVersion": 3,
        "packages": {
            "": {"name": "app"},
            "node_modules/react": {"version": "18.3.1", "license": "MIT"},
            "node_modules/vite": {"version": "5.0.0", "license": "MIT", "dev": True},
        },
    }
    (tmp_path / "package-lock.json").write_text(json.dumps(lock))
    pkg = tmp_path / "node_modules" / "react"
    pkg.mkdir(parents=True)
    (pkg / "LICENSE").write_text("MIT License text")
    notices = license_notices.npm_notices(tmp_path)
    assert [(n.name, n.license) for n in notices] == [("react", "MIT")]
    assert notices[0].texts == [("LICENSE", "MIT License text")]
    rendered = license_notices.render("T", "intro", notices)
    assert "MIT License text" in rendered
