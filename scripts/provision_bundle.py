"""Preconfigure an already built portable Ontocurator ZIP (no rebuild).

Adds work packages, ontologies, translation files and an optional
ontocurator-settings.json to a copy of a portable bundle, validated exactly like ``build_standalone.py``
does, and writes ``<out-dir>/<bundle-name>.zip`` whose top-level folder is
``<bundle-name>``. The input ZIP is not modified. Needs only Python and the
project environment (no Node.js, no PyInstaller):

    uv run python scripts/provision_bundle.py ontocurator-portable-windows-x86_64.zip \\
        --package study-xy-round1.zip --ontology hp.json \\
        --settings ontocurator-settings.json --bundle-name study-xy

The result is the same as doing it by hand: extract the ZIP, copy the .zip
files into packages/ and the .json ontologies and .tsv translation files
into ontologies/, add
ontocurator-settings.json next to the executable, and zip the folder again.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_common import (
    Preload,
    PreloadError,
    apply_preload,
    check_bundle_name,
    extract_bundle,
    validate_preload,
    write_deterministic_zip,
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Add preloaded work packages, ontologies and settings to a "
        "built portable Ontocurator ZIP.",
    )
    parser.add_argument("bundle", type=Path, help="Built portable bundle (.zip).")
    parser.add_argument(
        "--package",
        type=Path,
        action="append",
        default=[],
        metavar="ZIP",
        help="Work package to ship in packages/ (repeatable).",
    )
    parser.add_argument(
        "--ontology",
        type=Path,
        action="append",
        default=[],
        metavar="JSON",
        help="Ontology to ship in ontologies/ (repeatable).",
    )
    parser.add_argument(
        "--translation",
        type=Path,
        action="append",
        default=[],
        metavar="TSV",
        help="Translation file (babelon TSV, e.g. hp-de.babelon.tsv) to ship in "
        "ontologies/ (repeatable).",
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
        required=True,
        metavar="NAME",
        help="Name of the new ZIP (NAME.zip) and of its top-level folder.",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help="Output directory (default: the folder of the input ZIP).",
    )
    args = parser.parse_args(argv)
    args.preload = Preload(
        packages=tuple(p.resolve() for p in args.package),
        ontologies=tuple(p.resolve() for p in args.ontology),
        settings=args.settings.resolve() if args.settings else None,
        translations=tuple(p.resolve() for p in args.translation),
    )
    if args.preload.empty:
        parser.error(
            "nothing to add: give --package, --ontology, --translation "
            "and/or --settings"
        )
    if not args.bundle.is_file():
        parser.error(f"bundle not found: {args.bundle}")
    try:
        check_bundle_name(args.bundle_name)
        for warning in validate_preload(args.preload):
            print(f"Warning: {warning}")
    except PreloadError as exc:
        parser.error(str(exc))
    out_dir = (args.out_dir or args.bundle.parent).resolve()
    args.output = out_dir / f"{args.bundle_name}.zip"
    if args.output == args.bundle.resolve():
        parser.error(
            "the output would overwrite the input; choose another --bundle-name"
        )
    return args


def main(argv: list[str] | None = None) -> Path:
    args = parse_args(argv)
    with tempfile.TemporaryDirectory(prefix="ontocurator-provision-") as tmp:
        try:
            root = extract_bundle(args.bundle, Path(tmp))
            apply_preload(root, args.preload)
        except PreloadError as exc:
            sys.exit(f"Error: {exc}")
        write_deterministic_zip(root, args.output, prefix=args.bundle_name)
    print(f"Wrote preconfigured bundle {args.output}")
    return args.output


if __name__ == "__main__":
    main()
