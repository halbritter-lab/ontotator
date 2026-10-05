"""Shared helpers for the release / standalone build scripts."""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import stat
import subprocess
import sys
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = REPO_ROOT / "frontend"
FRONTEND_DIST = FRONTEND_DIR / "dist"
WEB_DIR = REPO_ROOT / "src" / "ontocurator" / "web"
DEFAULT_OUT_DIR = REPO_ROOT / "dist"

# Earliest timestamp representable in a ZIP file.
_ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)


def run_command(cmd: list[str], cwd: Path, env: dict[str, str] | None = None) -> None:
    """Run a subprocess command and stream output, failing on error."""
    print(f"--> Running: {' '.join(cmd)} (in {cwd})", flush=True)
    result = subprocess.run(cmd, cwd=cwd, env=env)
    if result.returncode != 0:
        print(
            f"Error: Command failed with exit code {result.returncode}",
            file=sys.stderr,
        )
        sys.exit(result.returncode)


def check_uv_lock() -> None:
    """Fail if uv.lock is out of date with pyproject.toml (reproducible deps).

    Run the build scripts via ``uv run --locked python scripts/...`` so the
    environment itself is also synced exactly from the lock file.
    """
    run_command(["uv", "lock", "--check"], cwd=REPO_ROOT)


def build_frontend(*, npm_ci: bool = True) -> Path:
    """Build the production SPA into ``frontend/dist``.

    ``npm ci`` always runs unless explicitly skipped (developer convenience):
    an existing ``node_modules`` may be stale or contain unlocked packages.
    """
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    if npm_ci:
        run_command([npm_cmd, "ci"], cwd=FRONTEND_DIR)
    elif not (FRONTEND_DIR / "node_modules").is_dir():
        print("Error: --skip-npm-ci given but frontend/node_modules is missing.")
        sys.exit(1)
    run_command([npm_cmd, "run", "build"], cwd=FRONTEND_DIR)

    dist_index = FRONTEND_DIST / "index.html"
    if not dist_index.is_file():
        print(f"Error: Build succeeded but {dist_index} not found!", file=sys.stderr)
        sys.exit(1)
    return FRONTEND_DIST


def sync_embedded_web_assets(src_dist: Path = FRONTEND_DIST) -> None:
    """Replace ``src/ontocurator/web`` (tracked in git) with a fresh SPA build."""
    print(f"--> Updating embedded web assets in {WEB_DIR} (tracked in git!)")
    if WEB_DIR.exists():
        shutil.rmtree(WEB_DIR)
    shutil.copytree(src_dist, WEB_DIR)


def zip_timestamp() -> tuple[int, int, int, int, int, int]:
    """Fixed archive timestamp; honours SOURCE_DATE_EPOCH when set."""
    epoch = os.environ.get("SOURCE_DATE_EPOCH")
    if not epoch:
        return _ZIP_EPOCH
    t = time.gmtime(max(int(epoch), 315532800))  # >= 1980-01-01
    return (t.tm_year, t.tm_mon, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec)


def archive_entries(root: Path, prefix: str) -> list[tuple[str, Path]]:
    """Sorted ``(arcname, path)`` list for ``root``; directories end with '/'.

    Symlinks (macOS .app frameworks) are listed but not followed.
    """
    entries: list[tuple[str, Path]] = [(f"{prefix}/", root)]
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        base = Path(dirpath)
        for name in dirnames:
            p = base / name
            rel = p.relative_to(root).as_posix()
            entries.append((f"{prefix}/{rel}" + ("" if p.is_symlink() else "/"), p))
        for name in filenames:
            p = base / name
            entries.append((f"{prefix}/{p.relative_to(root).as_posix()}", p))
    return sorted(entries, key=lambda e: e[0])


def write_deterministic_zip(root: Path, zip_path: Path, prefix: str) -> Path:
    """Zip ``root`` as ``prefix/...`` with sorted entries and fixed metadata."""
    date_time = zip_timestamp()
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = zip_path.with_suffix(".zip.tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for arcname, path in archive_entries(root, prefix):
            info = zipfile.ZipInfo(arcname, date_time=date_time)
            info.create_system = 3  # Unix: permissions below are meaningful
            if path.is_symlink():
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                z.writestr(info, os.readlink(path))
            elif arcname.endswith("/"):
                info.external_attr = ((stat.S_IFDIR | 0o755) << 16) | 0x10
                z.writestr(info, b"")
            else:
                mode = path.stat().st_mode
                executable = bool(mode & 0o111) and sys.platform != "win32"
                executable = executable or path.suffix.lower() in {".exe", ".dll"}
                perm = 0o755 if executable else 0o644
                info.external_attr = (stat.S_IFREG | perm) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, path.read_bytes())
    tmp.replace(zip_path)
    return zip_path


# --------------------------------------------------------------------------- #
# Preconfigured bundles (preloaded ontologies, packages and settings)
# --------------------------------------------------------------------------- #

SETTINGS_FILENAME = "ontocurator-settings.json"
BUNDLE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")

_DELIVERY_RULES = """\
This folder is for the INITIAL DELIVERY only. Imported data is immutable:
replacing or editing a file here later does NOT change data that was already
imported into the workspace.

To ship changed content:
  - work packages: create a new work package with a new package ID
    (a changed package with an already imported package ID is NOT imported;
    Ontocurator shows a warning instead);
  - ontologies: add the new ontology file (a changed file is registered as a
    new version; existing packages keep using the version they were created
    with).

Never edit the workspace folder by hand.
"""

ONTOLOGIES_README = (
    """\
Ontologies folder
=================

Every OBO Graph JSON ontology file (*.json, e.g. hp.json) placed in this
folder is registered when Ontocurator starts: it is copied into
workspace/ontologies and stays available even if the file here is removed.
Invalid files are skipped with a message in the console window.

"""
    + _DELIVERY_RULES
)

PACKAGES_README = (
    """\
Work packages folder
====================

Every work package (*.zip) placed in this folder is imported when
Ontocurator starts. Packages that were already imported unchanged are
skipped, so starting again is safe. Invalid files are skipped with a message
in the console window. Ontologies (ontologies folder) are registered before
packages are imported.

"""
    + _DELIVERY_RULES
)


class PreloadError(ValueError):
    """A file given for preloading is missing or invalid."""


@dataclass(frozen=True)
class Preload:
    """Files to ship inside a portable bundle."""

    packages: tuple[Path, ...] = ()
    ontologies: tuple[Path, ...] = ()
    settings: Path | None = None

    @property
    def empty(self) -> bool:
        return not (self.packages or self.ontologies or self.settings)


def check_bundle_name(name: str) -> str:
    if not BUNDLE_NAME_RE.match(name):
        raise PreloadError(
            f"Invalid bundle name '{name}': use letters, digits, '.', '_' and '-' "
            "(it becomes the ZIP file and folder name)."
        )
    return name


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _check_unique_names(paths: tuple[Path, ...], what: str) -> None:
    seen: dict[str, Path] = {}
    for path in paths:
        key = path.name.lower()
        if key in seen and seen[key].resolve() != path.resolve():
            raise PreloadError(
                f"Two {what} files are both named '{path.name}' "
                f"({seen[key]} and {path}); rename one of them."
            )
        seen[key] = path


def validate_preload(preload: Preload) -> list[str]:
    """Check every preload file like Ontocurator will at start.

    Raises PreloadError for unusable files; returns warnings (e.g. unknown
    settings keys). Requires the ontocurator package (``uv run``).
    """
    from ontocurator.distribution_settings import read_settings_file
    from ontocurator.domain.documents import OntologyRef
    from ontocurator.ontology.service import OntologyService
    from ontocurator.packages.reader import PackageReader

    warnings: list[str] = []
    _check_unique_names(preload.packages, "work package")
    _check_unique_names(preload.ontologies, "ontology")

    package_ids: dict[str, Path] = {}
    for path in preload.packages:
        if path.suffix.lower() != ".zip" or not path.is_file():
            raise PreloadError(f"Work package not found or not a .zip: {path}")
        try:
            pkg = PackageReader.read(path)
        except Exception as exc:
            raise PreloadError(f"{path} is not a readable work package: {exc}") from exc
        if pkg.manifest.format_version != "ontocurator-work-package/v2":
            raise PreloadError(
                f"{path} has format {pkg.manifest.format_version}; "
                "only ontocurator-work-package/v2 is supported."
            )
        pid = pkg.manifest.package_id
        if pid in package_ids:
            raise PreloadError(
                f"{package_ids[pid]} and {path} both contain package ID '{pid}'."
            )
        package_ids[pid] = path

    for path in preload.ontologies:
        if path.suffix.lower() != ".json" or not path.is_file():
            raise PreloadError(f"Ontology not found or not a .json file: {path}")
        try:
            OntologyService.load(
                path, OntologyRef(release="preload", sha256=_sha256(path))
            )
        except Exception as exc:
            raise PreloadError(f"{path} is not a usable ontology: {exc}") from exc

    if preload.settings is not None:
        if not preload.settings.is_file():
            raise PreloadError(f"Settings file not found: {preload.settings}")
        try:
            settings, unknown = read_settings_file(preload.settings)
        except ValueError as exc:
            raise PreloadError(
                f"Invalid settings file {preload.settings}: {exc}"
            ) from exc
        warnings.extend(unknown)
        if settings.open_package and settings.open_package not in package_ids:
            warnings.append(
                f"open_package '{settings.open_package}' is not one of the work "
                "packages added here; make sure the bundle contains it."
            )
    return warnings


def write_folder_readmes(bundle_dir: Path) -> None:
    """``ontologies/`` and ``packages/`` with their README.txt."""
    for folder, text in (
        ("ontologies", ONTOLOGIES_README),
        ("packages", PACKAGES_README),
    ):
        (bundle_dir / folder).mkdir(exist_ok=True)
        (bundle_dir / folder / "README.txt").write_text(text, encoding="utf-8")


def apply_preload(bundle_dir: Path, preload: Preload) -> None:
    """Copy validated preload files into an extracted/built bundle folder.

    Produces exactly the layout of the manual steps (unzip, drop files into
    packages/ and ontologies/, add ontocurator-settings.json, zip again).
    """
    write_folder_readmes(bundle_dir)
    targets = [(p, bundle_dir / "packages" / p.name) for p in preload.packages]
    targets += [(p, bundle_dir / "ontologies" / p.name) for p in preload.ontologies]
    if preload.settings is not None:
        targets.append((preload.settings, bundle_dir / SETTINGS_FILENAME))
    for source, dest in targets:
        if dest.exists() and dest.read_bytes() != source.read_bytes():
            raise PreloadError(
                f"The bundle already contains a different {dest.relative_to(bundle_dir)}."
            )
        shutil.copyfile(source, dest)


def extract_bundle(zip_path: Path, target: Path) -> Path:
    """Extract a portable bundle ZIP (one top-level folder); return that folder.

    File modes stored in the archive are restored (executables on macOS/Linux).
    """
    with zipfile.ZipFile(zip_path) as z:
        roots = {name.split("/", 1)[0] for name in z.namelist() if name.strip("/")}
        if len(roots) != 1:
            raise PreloadError(
                f"{zip_path} is not an Ontocurator bundle (expected exactly one "
                f"top-level folder, found {len(roots)})."
            )
        for info in z.infolist():
            parts = info.filename.split("/")
            if info.filename.startswith("/") or ".." in parts or ":" in info.filename:
                raise PreloadError(f"Unsafe path in {zip_path}: {info.filename}")
            mode = (info.external_attr >> 16) & 0o777
            path = target.joinpath(*[p for p in parts if p])
            if stat.S_ISLNK(info.external_attr >> 16):
                path.parent.mkdir(parents=True, exist_ok=True)
                os.symlink(z.read(info).decode("utf-8"), path)
            elif info.is_dir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(z.read(info))
                if mode and sys.platform != "win32":
                    os.chmod(path, mode)
    return target / roots.pop()
