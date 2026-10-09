"""Build the portable standalone distribution of Ontocurator with PyInstaller.

Steps:
1. ``uv lock --check`` (run the script via ``uv run --locked`` so the build
   environment matches ``uv.lock`` exactly).
2. Frontend: ``npm ci`` + ``npm run build`` into ``frontend/dist`` (skip with
   ``--skip-frontend`` to use the committed ``src/ontocurator/web`` assets).
   The source tree is only modified with ``--update-embedded-web``.
3. PyInstaller ``--onedir`` build (no UPX) into ``<out-dir>/standalone``;
   all intermediate files go to ``<out-dir>/build``.
4. Portable layout (portable.txt marker, ontologies/, packages/, workspace/,
   README.txt, license notices) and a deterministic ZIP
   ``<out-dir>/ontocurator-portable-<os>-<arch>.zip``.
   Optional preloads (``--package``, ``--ontology``, ``--translation``,
   ``--settings``) are validated before the build and copied into packages/,
   ontologies/ and ontocurator-settings.json; ``--bundle-name NAME`` names the ZIP and its
   top-level folder ``NAME``. ``scripts/provision_bundle.py`` does the same
   for an already built ZIP.
5. macOS additionally: ``Ontocurator.app`` (windowed bundle, per-user data in
   ~/Documents/Ontocurator) zipped as ``ontocurator-macos-<arch>-app.zip``.

Code signing is optional and only runs when the corresponding environment
variables are present (nothing is signed otherwise):

* Windows Authenticode: ``WINDOWS_SIGN_CERT`` (path to a .pfx),
  ``WINDOWS_SIGN_PASSWORD``, optional ``WINDOWS_SIGN_TIMESTAMP_URL``
  (default ``http://timestamp.digicert.com``); requires ``signtool`` on PATH.
* macOS: ``MACOS_CODESIGN_IDENTITY`` ("Developer ID Application: ...") for
  codesign with hardened runtime; additionally ``MACOS_NOTARY_PROFILE`` (a
  ``xcrun notarytool store-credentials`` keychain profile) to notarize and
  staple the .app.

Usage:
    uv run --locked python scripts/build_standalone.py --help
    uv run --locked python scripts/build_standalone.py --out-dir ../oc-dist
    uv run --locked python scripts/build_standalone.py --out-dir ../oc-dist \
        --package study-xy-round1.zip --ontology hp.json \
        --settings ontocurator-settings.json --bundle-name study-xy
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import platform
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_common import (
    DEFAULT_OUT_DIR,
    REPO_ROOT,
    WEB_DIR,
    Preload,
    PreloadError,
    apply_preload,
    build_frontend,
    check_bundle_name,
    check_uv_lock,
    run_command,
    sync_embedded_web_assets,
    validate_preload,
    write_deterministic_zip,
)
from license_notices import write_notices

APP_NAME = "ontocurator"
MAC_APP_NAME = "Ontocurator"
STORAGE_DIR = REPO_ROOT / "src" / "ontocurator" / "storage"
ENTRY_POINT = REPO_ROOT / "src" / "ontocurator" / "__main__.py"

HIDDEN_IMPORTS = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "sklearn.utils._typedefs",
]
# Note: PyInstaller's bundled hook for scipy.special._ufuncs requests
# 'scipy.special._cdflib', which no longer exists in recent SciPy releases; the
# resulting "Hidden import not found" warning is harmless.

PORTABLE_MARKER_TEXT = (
    "This file marks Ontocurator as a PORTABLE installation.\n\n"
    "While it exists (and this folder is writable), settings are stored in\n"
    "config.json and all data in the 'workspace' folder right here, next to\n"
    "the program. Delete this file to store data in your user profile instead\n"
    "(Documents/Ontocurator/workspace).\n"
)

PORTABLE_README = """\
Ontocurator - portable edition
==============================

Start
-----
Double-click "{exe}". A console window opens and your web browser shows
Ontocurator. You can also drag a work package (.zip), an ontology (.json)
or a workspace folder onto "{exe}".

Windows SmartScreen may warn about an unknown publisher when the build is not
code-signed: choose "More info" -> "Run anyway" only if you obtained this ZIP
from a trusted source.

Quit
----
Press Ctrl+C in the console window. Do not close the window while a save or
import is still running. (Closing the window also shuts down cleanly in most
cases, but Ctrl+C is the safe way.)

Only one Ontocurator runs per workspace: starting it again just opens the
browser for the running instance.

Where your data lives
---------------------
Everything is stored inside this folder:
  workspace/            database, imported packages and drafts
  workspace/ontologies/ ontology files (.json) - auto-loaded on start
  ontologies/           ontology .json files registered on every start,
                        translation files (e.g. hp-de.babelon.tsv) read on
                        every start
  packages/             work package .zip files imported on every start
  ontocurator-settings.json   optional presets (see below)
  config.json           settings (created on first start)

Preconfigured copies
--------------------
Files in "ontologies" and "packages" are registered/imported when
Ontocurator starts; already imported, unchanged packages are skipped. These
folders are for the INITIAL DELIVERY only: imported data is immutable, so
replacing or editing a file there later does NOT change data that was already
imported. To ship changed content, create a new work package with a new
package ID (a changed package with an already imported ID is NOT imported and
a warning is shown), or add a new ontology file (registered as a new version;
existing packages keep their version). Never edit "workspace" by hand.

The optional ontocurator-settings.json can preset, for example:
  {{ "default_mode": "independent", "allowed_modes": ["independent"],
    "annotator_id": null, "open_package": "study-xy-round1",
    "auto_open_browser": true }}
With a single allowed mode, the working mode cannot be changed. A preset
annotator_id is only suggested: each person still confirms who is annotating.
Command line options override this file, which overrides config.json.

To update to a new version, extract the new ZIP and copy the "workspace"
folder (and config.json) from the old folder into the new one.
Back up the "workspace" folder regularly.

Settings from an earlier installation
-------------------------------------
An older Ontocurator installation may have left settings in your user
profile (for example %APPDATA%\\ontocurator\\config.json). They are never
taken over automatically. If they differ from this copy's settings, the start
page shows "Settings from an earlier Ontocurator installation were found"
and lists them. Choose:
  Import settings      copies the listed ontology files into this copy's
                       workspace; port and browser setting apply at the next
                       start. Files that no longer exist are skipped.
  Ignore               hides the notice (until the old file changes).
  Open folder          shows the folder of the old settings file.
  Delete old settings  deletes only that one file, after asking. Workspaces
                       and annotations are not affected.
A copy with ontocurator-settings.json ignores old settings entirely.

On the command line (in this folder):
  {exe} config --path            show where settings and data are stored
  {exe} config --open            open the folder of the settings file in use
  {exe} config --delete-legacy   delete the old settings file (asks first)

Licenses
--------
See THIRD_PARTY_NOTICES.md and the LICENSES/ folder. The Human Phenotype
Ontology (HPO) is not bundled; when you use it, follow its license and
citation requirements: https://hpo.jax.org/license
"""


def _platform_tag() -> tuple[str, str]:
    os_name = {"win32": "windows", "darwin": "macos"}.get(sys.platform, sys.platform)
    arch = platform.machine().lower().replace("amd64", "x86_64")
    return os_name, arch


def pyinstaller_args(
    *,
    web_src: Path,
    dist_path: Path,
    work_path: Path,
    windowed: bool = False,
    name: str = APP_NAME,
) -> list[str]:
    """Command line for PyInstaller (kept separate for testing)."""
    sep = os.pathsep
    args = [
        sys.executable,
        "-m",
        "PyInstaller",
        f"--name={name}",
        "--onedir",
        "--clean",
        "--noconfirm",
        "--noupx",
        f"--distpath={dist_path}",
        f"--workpath={work_path}",
        f"--specpath={work_path}",
        f"--add-data={web_src}{sep}ontocurator/web",
        f"--add-data={STORAGE_DIR / 'schema_v4.sql'}{sep}ontocurator/storage",
        f"--add-data={STORAGE_DIR / 'ontology_resources.sql'}{sep}ontocurator/storage",
        f"--add-data={STORAGE_DIR / 'search_conditions.sql'}{sep}ontocurator/storage",
        "--copy-metadata=numpy",
        "--copy-metadata=scipy",
        "--copy-metadata=scikit-learn",
        # importlib.metadata.version("ontocurator") must work when frozen.
        "--copy-metadata=ontocurator",
        *(f"--hidden-import={h}" for h in HIDDEN_IMPORTS),
    ]
    if importlib.util.find_spec("tzdata") is not None:
        args.append("--collect-data=tzdata")
    else:
        # zoneinfo's hook asks for tzdata on Windows; the app never needs IANA
        # time zone data, so exclude it instead of warning about it.
        args.append("--exclude-module=tzdata")
    if windowed:
        args.append("--windowed")
    args.append(str(ENTRY_POINT))
    return args


def run_pyinstaller(
    web_src: Path, out_dir: Path, *, windowed: bool = False, name: str = APP_NAME
) -> Path:
    dist_path = out_dir / ("macos-app" if windowed else "standalone")
    work_path = out_dir / "build" / ("pyinstaller-app" if windowed else "pyinstaller")
    if dist_path.exists():
        shutil.rmtree(dist_path)
    run_command(
        pyinstaller_args(
            web_src=web_src,
            dist_path=dist_path,
            work_path=work_path,
            windowed=windowed,
            name=name,
        ),
        cwd=REPO_ROOT,
    )
    if windowed:
        bundle = dist_path / f"{name}.app"
        if not bundle.is_dir():
            sys.exit(f"Error: Expected {bundle} after PyInstaller build!")
        return bundle
    bundle_dir = dist_path / name
    exe = bundle_dir / (f"{name}.exe" if sys.platform == "win32" else name)
    if not exe.is_file():
        sys.exit(f"Error: Expected executable {exe} not found after PyInstaller build!")
    return bundle_dir


def add_license_files(target: Path, generated_licenses: Path | None) -> None:
    shutil.copy2(
        REPO_ROOT / "THIRD_PARTY_NOTICES.md", target / "THIRD_PARTY_NOTICES.md"
    )
    licenses = target / "LICENSES"
    if licenses.exists():
        shutil.rmtree(licenses)
    shutil.copytree(REPO_ROOT / "LICENSES", licenses)
    if generated_licenses is not None:
        for f in sorted(generated_licenses.iterdir()):
            shutil.copy2(f, licenses / f.name)


def prepare_portable_bundle(
    bundle_dir: Path,
    out_dir: Path,
    generated_licenses: Path | None = None,
    *,
    preload: Preload | None = None,
    bundle_name: str | None = None,
) -> Path:
    """Create the portable layout inside ``bundle_dir`` and zip it.

    ``preload`` files (validated beforehand) are copied into packages/,
    ontologies/ and ontocurator-settings.json. ``bundle_name`` names the ZIP
    and its top-level folder (default: ontocurator-portable-<os>-<arch>.zip
    containing ontocurator/).
    """
    exe_name = f"{APP_NAME}.exe" if sys.platform == "win32" else APP_NAME

    (bundle_dir / "portable.txt").write_text(PORTABLE_MARKER_TEXT, encoding="utf-8")
    workspace_dir = bundle_dir / "workspace"
    workspace_dir.mkdir(exist_ok=True)
    (workspace_dir / "README.txt").write_text(
        "Ontocurator stores its database and imported work packages here.\n"
        "Back up this folder; copy it into new versions when updating.\n",
        encoding="utf-8",
    )
    (bundle_dir / "README.txt").write_text(
        PORTABLE_README.format(exe=exe_name), encoding="utf-8"
    )
    add_license_files(bundle_dir, generated_licenses)
    apply_preload(bundle_dir, preload or Preload())

    if bundle_name:
        zip_path = out_dir / f"{bundle_name}.zip"
        prefix = bundle_name
    else:
        os_name, arch = _platform_tag()
        zip_path = out_dir / f"ontocurator-portable-{os_name}-{arch}.zip"
        prefix = APP_NAME
    print(f"--> Compressing portable bundle into {zip_path}")
    write_deterministic_zip(bundle_dir, zip_path, prefix=prefix)
    _report(zip_path)
    return zip_path


def sign_windows(exe: Path) -> None:
    cert = os.environ.get("WINDOWS_SIGN_CERT")
    if not cert:
        print("--> WINDOWS_SIGN_CERT not set: executable stays unsigned.")
        return
    cmd = [
        "signtool",
        "sign",
        "/fd",
        "SHA256",
        "/f",
        cert,
        "/tr",
        os.environ.get("WINDOWS_SIGN_TIMESTAMP_URL", "http://timestamp.digicert.com"),
        "/td",
        "SHA256",
    ]
    if os.environ.get("WINDOWS_SIGN_PASSWORD"):
        cmd += ["/p", os.environ["WINDOWS_SIGN_PASSWORD"]]
    run_command([*cmd, str(exe)], cwd=REPO_ROOT)


def sign_and_notarize_macos(target: Path, out_dir: Path) -> None:
    identity = os.environ.get("MACOS_CODESIGN_IDENTITY")
    if not identity:
        print("--> MACOS_CODESIGN_IDENTITY not set: bundle stays unsigned.")
        return
    run_command(
        [
            "codesign",
            "--force",
            "--deep",
            "--options",
            "runtime",
            "--timestamp",
            "--sign",
            identity,
            str(target),
        ],
        cwd=REPO_ROOT,
    )
    profile = os.environ.get("MACOS_NOTARY_PROFILE")
    if not profile or target.suffix != ".app":
        return
    submission = out_dir / "build" / f"{target.stem}-notarize.zip"
    run_command(
        ["ditto", "-c", "-k", "--keepParent", str(target), str(submission)],
        cwd=REPO_ROOT,
    )
    run_command(
        [
            "xcrun",
            "notarytool",
            "submit",
            str(submission),
            "--keychain-profile",
            profile,
            "--wait",
        ],
        cwd=REPO_ROOT,
    )
    run_command(["xcrun", "stapler", "staple", str(target)], cwd=REPO_ROOT)


def package_macos_app(
    app_bundle: Path, out_dir: Path, generated_licenses: Path | None
) -> Path:
    """Zip ``Ontocurator.app`` together with README and license notices."""
    staging = app_bundle.parent / "Ontocurator"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir()
    shutil.move(str(app_bundle), staging / app_bundle.name)
    (staging / "README.txt").write_text(
        "Ontocurator for macOS\n"
        "=====================\n\n"
        "Move Ontocurator.app to Applications (or anywhere) and open it. Your\n"
        "browser shows Ontocurator. Data is stored in ~/Documents/Ontocurator/\n"
        "workspace, settings in ~/Library/Application Support/ontocurator.\n\n"
        "Unsigned builds: right-click the app -> Open the first time.\n"
        "Quit: right-click the Dock icon -> Quit (or Force Quit if it does not\n"
        "react); the database is transactional, but avoid quitting while saving.\n\n"
        "Licenses: see THIRD_PARTY_NOTICES.md and LICENSES/. HPO license and\n"
        "citation requirements: https://hpo.jax.org/license\n",
        encoding="utf-8",
    )
    add_license_files(staging, generated_licenses)
    _, arch = _platform_tag()
    zip_path = out_dir / f"ontocurator-macos-{arch}-app.zip"
    write_deterministic_zip(staging, zip_path, prefix="Ontocurator")
    _report(zip_path)
    return zip_path


def _report(zip_path: Path) -> None:
    size_mb = zip_path.stat().st_size / (1024 * 1024)
    print("==================================================")
    print(f"  Archive:  {zip_path}")
    print(f"  Size:     {size_mb:.2f} MB")
    print("==================================================")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the portable Ontocurator distribution with PyInstaller.",
        epilog="Signing env vars: WINDOWS_SIGN_CERT, WINDOWS_SIGN_PASSWORD, "
        "WINDOWS_SIGN_TIMESTAMP_URL, MACOS_CODESIGN_IDENTITY, MACOS_NOTARY_PROFILE.",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help="Directory for artifacts and intermediate build files "
        "(default: <repo>/dist). May be outside the source tree.",
    )
    parser.add_argument(
        "--skip-frontend",
        action="store_true",
        help="Do not build the frontend; bundle the committed src/ontocurator/web.",
    )
    parser.add_argument(
        "--skip-npm-ci",
        action="store_true",
        help="Developer shortcut: reuse existing frontend/node_modules.",
    )
    parser.add_argument(
        "--update-embedded-web",
        action="store_true",
        help="Also copy the fresh frontend build into src/ontocurator/web (git-tracked).",
    )
    parser.add_argument(
        "--skip-lock-check", action="store_true", help="Skip 'uv lock --check'."
    )
    parser.add_argument(
        "--macos-app",
        action=argparse.BooleanOptionalAction,
        default=sys.platform == "darwin",
        help="Also build a windowed Ontocurator.app (macOS only; default on macOS).",
    )
    parser.add_argument(
        "--package",
        type=Path,
        action="append",
        default=[],
        metavar="ZIP",
        help="Work package to ship in packages/ (imported on start; repeatable).",
    )
    parser.add_argument(
        "--ontology",
        type=Path,
        action="append",
        default=[],
        metavar="JSON",
        help="Ontology to ship in ontologies/ (registered on start; repeatable).",
    )
    parser.add_argument(
        "--translation",
        type=Path,
        action="append",
        default=[],
        metavar="TSV",
        help="Translation file (babelon TSV, e.g. hp-de.babelon.tsv) to ship in "
        "ontologies/ (read on start; repeatable).",
    )
    parser.add_argument(
        "--settings",
        type=Path,
        default=None,
        metavar="JSON",
        help="Presets to ship as ontocurator-settings.json.",
    )
    parser.add_argument(
        "--bundle-name",
        default=None,
        metavar="NAME",
        help="Name of the ZIP (NAME.zip) and of its top-level folder.",
    )
    args = parser.parse_args(argv)
    args.preload = Preload(
        packages=tuple(p.resolve() for p in args.package),
        ontologies=tuple(p.resolve() for p in args.ontology),
        settings=args.settings.resolve() if args.settings else None,
        translations=tuple(p.resolve() for p in args.translation),
    )
    try:
        if args.bundle_name is not None:
            check_bundle_name(args.bundle_name)
        for warning in validate_preload(args.preload):
            print(f"Warning: {warning}")
    except PreloadError as exc:
        parser.error(str(exc))
    if args.skip_frontend and args.update_embedded_web:
        parser.error("--update-embedded-web requires building the frontend")
    if args.macos_app and sys.platform != "darwin":
        parser.error("--macos-app is only supported on macOS")
    args.out_dir = args.out_dir.resolve()
    return args


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    if not args.skip_lock_check:
        check_uv_lock()

    if args.skip_frontend:
        web_src = WEB_DIR
        if not (web_src / "index.html").is_file():
            sys.exit(f"Error: {web_src / 'index.html'} missing; build the frontend.")
        include_npm = (REPO_ROOT / "frontend" / "package-lock.json").is_file()
    else:
        web_src = build_frontend(npm_ci=not args.skip_npm_ci)
        include_npm = True
        if args.update_embedded_web:
            sync_embedded_web_assets(web_src)

    licenses_dir = out_dir / "build" / "licenses"
    if licenses_dir.exists():
        shutil.rmtree(licenses_dir)
    write_notices(licenses_dir, include_npm=include_npm)

    bundle_dir = run_pyinstaller(web_src, out_dir)
    if sys.platform == "win32":
        sign_windows(bundle_dir / f"{APP_NAME}.exe")
    elif sys.platform == "darwin":
        sign_and_notarize_macos(bundle_dir / APP_NAME, out_dir)
    prepare_portable_bundle(
        bundle_dir,
        out_dir,
        licenses_dir,
        preload=args.preload,
        bundle_name=args.bundle_name,
    )

    if args.macos_app:
        app_bundle = run_pyinstaller(web_src, out_dir, windowed=True, name=MAC_APP_NAME)
        sign_and_notarize_macos(app_bundle, out_dir)
        package_macos_app(app_bundle, out_dir, licenses_dir)


if __name__ == "__main__":
    main()
