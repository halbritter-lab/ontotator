"""Build the wheel from the committed sources and check what it contains.

Steps:
1. ``uv lock --check``: uv.lock matches pyproject.toml.
2. ``uv build --wheel`` into ``--out-dir``. The wheel embeds the web UI from
   the git-tracked ``src/ontocurator/web``; nothing is rebuilt here.
3. The wheel must contain the CLI, every database migration and the web UI
   (``index.html`` plus at least one ``.js`` and one ``.css`` asset).

Usage:
    uv run python scripts/check_wheel.py --out-dir build/check-wheel
"""

from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PACKAGE_DIR = REPO_ROOT / "src" / "ontocurator"
MIGRATION_VERSIONS = PACKAGE_DIR / "storage" / "migrations" / "versions"

REQUIRED_WHEEL_FILES = [
    "ontocurator/__init__.py",
    "ontocurator/cli.py",
    "ontocurator/storage/migrations/env.py",
    "ontocurator/storage/migrations/script.py.mako",
    *sorted(
        f"ontocurator/storage/migrations/versions/{path.name}"
        for path in MIGRATION_VERSIONS.glob("*.py")
    ),
    "ontocurator/web/index.html",
]


def run_command(cmd: list[str]) -> None:
    """Run ``cmd`` in the repository; exit with its code if it fails."""
    print(f"--> Running: {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, cwd=REPO_ROOT)
    if result.returncode != 0:
        sys.exit(result.returncode)


def build_wheel(out_dir: Path) -> Path:
    """Build the wheel with uv into ``out_dir`` and return it."""
    before = set(out_dir.glob("ontocurator-*.whl"))
    run_command(["uv", "build", "--wheel", "--out-dir", str(out_dir)])
    wheels = sorted(
        out_dir.glob("ontocurator-*.whl"), key=lambda p: p.stat().st_mtime, reverse=True
    )
    if not wheels:
        sys.exit(f"Error: No ontocurator wheel found in {out_dir} after uv build")
    new = [w for w in wheels if w not in before]
    return (new or wheels)[0]


def missing_wheel_files(namelist: set[str]) -> list[str]:
    """Required entries (and asset kinds) missing from a wheel listing."""
    missing = [item for item in REQUIRED_WHEEL_FILES if item not in namelist]
    for ext in (".js", ".css"):
        if not any(
            n.startswith("ontocurator/web/assets/") and n.endswith(ext)
            for n in namelist
        ):
            missing.append(f"ontocurator/web/assets/*{ext}")
    return missing


def verify_wheel(wheel_path: Path) -> None:
    """Exit with an error if the wheel lacks a required file."""
    print(f"--> Checking the contents of {wheel_path.name}")
    with zipfile.ZipFile(wheel_path) as z:
        missing = missing_wheel_files(set(z.namelist()))
    if missing:
        sys.exit(f"Error: The wheel is missing required files: {missing}")
    raw = wheel_path.read_bytes()
    print(f"    {wheel_path} ({len(raw) / 1024:.1f} KB)")
    print(f"    SHA-256: {hashlib.sha256(raw).hexdigest()}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--out-dir",
        type=Path,
        required=True,
        help="Directory for the wheel.",
    )
    args = parser.parse_args(argv)
    out_dir: Path = args.out_dir.resolve()
    if not (PACKAGE_DIR / "web" / "index.html").is_file():
        sys.exit(
            f"Error: {PACKAGE_DIR / 'web' / 'index.html'} is missing; "
            "build the frontend first."
        )
    out_dir.mkdir(parents=True, exist_ok=True)
    run_command(["uv", "lock", "--check"])
    verify_wheel(build_wheel(out_dir))


if __name__ == "__main__":
    main()
