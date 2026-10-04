"""Standalone portable release packager for Ontocurator using PyInstaller.

Automates:
1. Frontend compilation via npm build
2. Bundling built static web assets into src/ontocurator/web/
3. Packaging Python application into portable standalone distribution via PyInstaller
4. Setting up portable directories (ontologies/, workspace/) and documentation
5. Compressing into a clean portable distribution ZIP archive
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = REPO_ROOT / "frontend"
WEB_DIR = REPO_ROOT / "src" / "ontocurator" / "web"
DIST_DIR = REPO_ROOT / "dist"
BUILD_DIR = REPO_ROOT / "build" / "pyinstaller"


def run_command(cmd: list[str], cwd: Path) -> None:
    """Run a subprocess command and stream output, failing on error."""
    print(f"--> Running: {' '.join(cmd)} in {cwd}")
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        print(
            f"Error: Command failed with exit code {result.returncode}",
            file=sys.stderr,
        )
        sys.exit(result.returncode)


def build_frontend() -> None:
    """Build frontend production bundle."""
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"

    if not (FRONTEND_DIR / "node_modules").is_dir():
        run_command([npm_cmd, "ci"], cwd=FRONTEND_DIR)

    run_command([npm_cmd, "run", "build"], cwd=FRONTEND_DIR)

    dist_index = FRONTEND_DIR / "dist" / "index.html"
    if not dist_index.is_file():
        print(
            f"Error: Build succeeded but {dist_index} not found!",
            file=sys.stderr,
        )
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


def run_pyinstaller() -> Path:
    """Invoke PyInstaller to create standalone onedir distribution."""
    sep = os.pathsep
    web_src = REPO_ROOT / "src" / "ontocurator" / "web"
    schema_v4 = REPO_ROOT / "src" / "ontocurator" / "storage" / "schema_v4.sql"
    onto_res = REPO_ROOT / "src" / "ontocurator" / "storage" / "ontology_resources.sql"

    data_args = [
        f"--add-data={web_src}{sep}ontocurator/web",
        f"--add-data={schema_v4}{sep}ontocurator/storage",
        f"--add-data={onto_res}{sep}ontocurator/storage",
    ]

    hidden_imports = [
        "--hidden-import=uvicorn.logging",
        "--hidden-import=uvicorn.loops",
        "--hidden-import=uvicorn.loops.auto",
        "--hidden-import=uvicorn.protocols",
        "--hidden-import=uvicorn.protocols.http",
        "--hidden-import=uvicorn.protocols.http.auto",
        "--hidden-import=uvicorn.lifespans",
        "--hidden-import=uvicorn.lifespans.on",
        "--hidden-import=sklearn.utils._typedefs",
    ]

    out_dist = DIST_DIR / "standalone"
    if out_dist.exists():
        shutil.rmtree(out_dist)

    pyinstaller_cmd = [
        "pyinstaller",
        "--name=ontocurator",
        "--onedir",
        "--clean",
        "--noconfirm",
        f"--distpath={out_dist}",
        f"--workpath={BUILD_DIR}",
        *data_args,
        *hidden_imports,
        str(REPO_ROOT / "src" / "ontocurator" / "__main__.py"),
    ]

    run_command(pyinstaller_cmd, cwd=REPO_ROOT)

    bundle_dir = out_dist / "ontocurator"
    exe_name = "ontocurator.exe" if sys.platform == "win32" else "ontocurator"
    target_exe = bundle_dir / exe_name
    if not target_exe.is_file():
        print(
            f"Error: Expected executable {target_exe} not found after PyInstaller build!",
            file=sys.stderr,
        )
        sys.exit(1)

    return bundle_dir


def prepare_portable_bundle(bundle_dir: Path) -> Path:
    """Set up portable distribution layout with ontologies/, workspace/, and README."""
    ontologies_dir = bundle_dir / "ontologies"
    ontologies_dir.mkdir(exist_ok=True)
    (ontologies_dir / "README.txt").write_text(
        "Place your OBO Graph JSON ontology files (such as hp.json, mondo.json) in this folder.\n"
        "Ontocurator will automatically discover and load them on startup.\n",
        encoding="utf-8",
    )

    workspace_dir = bundle_dir / "workspace"
    workspace_dir.mkdir(exist_ok=True)
    (workspace_dir / ".gitkeep").write_text("", encoding="utf-8")

    (bundle_dir / "README.txt").write_text(
        "Ontocurator Portable Distribution\n"
        "==================================\n\n"
        "Quick Start:\n"
        "1. (Optional) Place any ontology files (e.g. hp.json) into the 'ontologies' folder.\n"
        "2. Double-click the ontocurator application to launch the editor.\n"
        "3. The editor starts a local secured server and opens your web browser automatically.\n\n"
        "No installation or administrator privileges required.\n",
        encoding="utf-8",
    )

    # Package into ZIP archive
    os_name = sys.platform
    arch = platform.machine().lower()
    zip_name = f"ontocurator-portable-{os_name}-{arch}.zip"
    zip_path = DIST_DIR / zip_name

    print(f"--> Compressing portable bundle into {zip_path}")
    if zip_path.exists():
        zip_path.unlink()

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for file_path in bundle_dir.rglob("*"):
            rel = file_path.relative_to(bundle_dir.parent)
            z.write(file_path, arcname=str(rel))

    size_mb = zip_path.stat().st_size / (1024 * 1024)
    print("==================================================")
    print("  Standalone Portable Build Successful!")
    print(f"  Distribution Archive: {zip_path.name}")
    print(f"  Size:                 {size_mb:.2f} MB")
    print(f"  Location:             {zip_path}")
    print("==================================================")
    return zip_path


def main() -> None:
    """Execute complete standalone build pipeline."""
    build_frontend()
    copy_web_assets()
    bundle_dir = run_pyinstaller()
    prepare_portable_bundle(bundle_dir)


if __name__ == "__main__":
    main()
