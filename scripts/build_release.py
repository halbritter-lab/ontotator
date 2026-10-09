"""Build and verify the Ontocurator wheel.

Steps:
1. ``uv lock --check`` (run via ``uv run --locked`` for an exact environment).
2. Frontend ``npm ci`` + ``npm run build`` (``--skip-npm-ci`` for dev) and
   copy into ``src/ontocurator/web`` - the wheel embeds the web UI from that
   git-tracked folder, so this step intentionally updates the source tree.
   Use ``--skip-frontend`` to package the committed assets unchanged.
3. ``uv build --wheel`` into ``--out-dir`` and verify the bundled files.

Usage:
    uv run --locked python scripts/build_release.py --help
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_common import (
    DEFAULT_OUT_DIR,
    REPO_ROOT,
    WEB_DIR,
    build_frontend,
    check_uv_lock,
    run_command,
    sync_embedded_web_assets,
)

REQUIRED_WHEEL_FILES = [
    "ontocurator/__init__.py",
    "ontocurator/cli.py",
    "ontocurator/storage/schema_v4.sql",
    "ontocurator/storage/ontology_resources.sql",
    "ontocurator/storage/search_conditions.sql",
    "ontocurator/web/index.html",
]


def build_wheel(out_dir: Path) -> Path:
    """Build the wheel with uv into ``out_dir``."""
    before = set(out_dir.glob("ontocurator-*.whl"))
    run_command(["uv", "build", "--wheel", "--out-dir", str(out_dir)], cwd=REPO_ROOT)
    wheels = sorted(
        out_dir.glob("ontocurator-*.whl"), key=lambda p: p.stat().st_mtime, reverse=True
    )
    if not wheels:
        sys.exit(f"Error: No ontocurator wheel found in {out_dir} after uv build")
    new = [w for w in wheels if w not in before]
    return (new or wheels)[0]


def missing_wheel_files(namelist: set[str]) -> list[str]:
    """Return required entries (and asset kinds) missing from a wheel listing."""
    missing = [item for item in REQUIRED_WHEEL_FILES if item not in namelist]
    for ext in (".js", ".css"):
        if not any(
            n.startswith("ontocurator/web/assets/") and n.endswith(ext)
            for n in namelist
        ):
            missing.append(f"ontocurator/web/assets/*{ext}")
    return missing


def verify_wheel(wheel_path: Path) -> None:
    """Verify essential bundled assets inside wheel."""
    print(f"--> Verifying package contents of: {wheel_path.name}")
    with zipfile.ZipFile(wheel_path, "r") as z:
        missing = missing_wheel_files(set(z.namelist()))
    if missing:
        sys.exit(f"Error: Wheel is missing required bundled files: {missing}")

    raw = wheel_path.read_bytes()
    print("==================================================")
    print("  Release Build Successful!")
    print(f"  Artifact: {wheel_path}")
    print(f"  Size:     {len(raw) / 1024:.1f} KB")
    print(f"  SHA-256:  {hashlib.sha256(raw).hexdigest()}")
    print("==================================================")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build and verify the wheel.")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help="Directory for the wheel (default: <repo>/dist).",
    )
    parser.add_argument(
        "--skip-frontend",
        action="store_true",
        help="Package the committed src/ontocurator/web without rebuilding.",
    )
    parser.add_argument(
        "--skip-npm-ci",
        action="store_true",
        help="Developer shortcut: reuse existing frontend/node_modules.",
    )
    parser.add_argument(
        "--skip-lock-check", action="store_true", help="Skip 'uv lock --check'."
    )
    args = parser.parse_args(argv)
    args.out_dir = args.out_dir.resolve()
    return args


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    if not args.skip_lock_check:
        check_uv_lock()
    if not args.skip_frontend:
        sync_embedded_web_assets(build_frontend(npm_ci=not args.skip_npm_ci))
    elif not (WEB_DIR / "index.html").is_file():
        sys.exit(f"Error: {WEB_DIR / 'index.html'} missing; build the frontend.")
    verify_wheel(build_wheel(args.out_dir))


if __name__ == "__main__":
    main()
