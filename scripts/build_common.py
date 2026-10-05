"""Shared helpers for the release / standalone build scripts."""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys
import time
import zipfile
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
