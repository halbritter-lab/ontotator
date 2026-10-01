"""Release build script for Local HPO Annotation Editor.

Automates:
1. Frontend compilation via npm build
2. Bundling built assets into src/ontocurator/web/
3. Wheel packaging via uv build
4. Integrity verification of wheel contents
"""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = REPO_ROOT / "frontend"
WEB_DIR = REPO_ROOT / "src" / "ontocurator" / "web"
DIST_DIR = REPO_ROOT / "dist"


def run_command(cmd: list[str], cwd: Path) -> None:
    """Run a subprocess command and stream output, failing on error."""
    print(f"--> Running: {' '.join(cmd)} in {cwd}")
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        print(
            f"Error: Command failed with exit code {result.returncode}", file=sys.stderr
        )
        sys.exit(result.returncode)


def build_frontend() -> None:
    """Build frontend production bundle."""
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"

    # If node_modules is missing, run npm ci
    if not (FRONTEND_DIR / "node_modules").is_dir():
        run_command([npm_cmd, "ci"], cwd=FRONTEND_DIR)

    run_command([npm_cmd, "run", "build"], cwd=FRONTEND_DIR)

    dist_index = FRONTEND_DIR / "dist" / "index.html"
    if not dist_index.is_file():
        print(f"Error: Build succeeded but {dist_index} not found!", file=sys.stderr)
        sys.exit(1)


def copy_web_assets() -> None:
    """Sync built frontend assets into src/ontocurator/web."""
    if WEB_DIR.exists():
        shutil.rmtree(WEB_DIR)
    WEB_DIR.mkdir(parents=True, exist_ok=True)

    src_dist = FRONTEND_DIR / "dist"
    for item in src_dist.iterdir():
        dest = WEB_DIR / item.name
        if item.is_dir():
            shutil.copytree(item, dest)
        else:
            shutil.copy2(item, dest)

    print(f"--> Bundled static assets into {WEB_DIR}")


def build_wheel() -> Path:
    """Build python wheel package using uv."""
    run_command(["uv", "build"], cwd=REPO_ROOT)

    wheels = sorted(
        DIST_DIR.glob("*.whl"), key=lambda p: p.stat().st_mtime, reverse=True
    )
    if not wheels:
        print("Error: No .whl found in dist/ directory after uv build", file=sys.stderr)
        sys.exit(1)

    return wheels[0]


def verify_wheel(wheel_path: Path) -> None:
    """Verify essential bundled assets inside wheel."""
    print(f"--> Verifying package contents of: {wheel_path.name}")
    with zipfile.ZipFile(wheel_path, "r") as z:
        namelist = set(z.namelist())

        required = [
            "ontocurator/__init__.py",
            "ontocurator/cli.py",
            "ontocurator/storage/migrations/001_initial.sql",
            "ontocurator/web/index.html",
        ]

        missing = [item for item in required if item not in namelist]
        if missing:
            print(
                f"Error: Wheel is missing required bundled files: {missing}",
                file=sys.stderr,
            )
            sys.exit(1)

        # Check that at least one CSS and JS asset exists in web/assets/
        has_js = any(
            name.startswith("ontocurator/web/assets/") and name.endswith(".js")
            for name in namelist
        )
        has_css = any(
            name.startswith("ontocurator/web/assets/") and name.endswith(".css")
            for name in namelist
        )
        if not has_js or not has_css:
            print("Error: Wheel is missing web assets (JS/CSS)", file=sys.stderr)
            sys.exit(1)

    raw = wheel_path.read_bytes()
    sha256 = hashlib.sha256(raw).hexdigest()
    size_kb = len(raw) / 1024

    print("==================================================")
    print("  Release Build Successful!")
    print(f"  Artifact: {wheel_path.name}")
    print(f"  Size:     {size_kb:.1f} KB")
    print(f"  SHA-256:  {sha256}")
    print("==================================================")


def main() -> None:
    """Build release pipeline."""
    build_frontend()
    copy_web_assets()
    wheel_path = build_wheel()
    verify_wheel(wheel_path)


if __name__ == "__main__":
    main()
