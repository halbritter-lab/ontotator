"""Generate aggregate third-party license notices for distributed artifacts.

* Python: the runtime dependency closure of ``ontotator`` as installed in the
  current (build) environment, read via ``importlib.metadata`` - license
  metadata plus the full text of every license/notice file the wheel ships.
* npm: the production (non-dev) packages from ``frontend/package-lock.json``
  that end up in the bundled web UI, with license texts from ``node_modules``.

Usage:
    uv run python scripts/license_notices.py --out-dir build/licenses
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from importlib import metadata
from pathlib import Path

from packaging.requirements import Requirement

REPO_ROOT = Path(__file__).resolve().parent.parent
LICENSE_FILE_RE = re.compile(r"^(licen[cs]e|copying|notice|authors)", re.IGNORECASE)


@dataclass
class PackageNotice:
    name: str
    version: str
    license: str
    homepage: str = ""
    texts: list[tuple[str, str]] = field(default_factory=list)


def _canonical(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def python_runtime_closure(root: str = "ontotator") -> list[metadata.Distribution]:
    """Installed distributions required (transitively) by ``root`` at runtime."""
    seen: dict[str, metadata.Distribution] = {}
    stack = [root]
    while stack:
        name = _canonical(stack.pop())
        if name in seen:
            continue
        try:
            dist = metadata.distribution(name)
        except metadata.PackageNotFoundError:
            continue
        seen[name] = dist
        for raw in dist.requires or []:
            req = Requirement(raw)
            if req.marker is not None and not req.marker.evaluate({"extra": ""}):
                continue
            stack.append(req.name)
    seen.pop(_canonical(root), None)
    return sorted(seen.values(), key=lambda d: _canonical(d.metadata["Name"]))


def _python_license(dist: metadata.Distribution) -> str:
    md = dist.metadata
    expr = md.get("License-Expression")
    if expr:
        return expr
    lic = (md.get("License") or "").strip()
    if lic and "\n" not in lic and len(lic) < 120:
        return lic
    classifiers = [
        c.split("::")[-1].strip()
        for c in md.get_all("Classifier") or []
        if c.startswith("License ::")
    ]
    if classifiers:
        return " / ".join(classifiers)
    return "see license text below" if lic else "UNKNOWN"


def python_notices(root: str = "ontotator") -> list[PackageNotice]:
    notices = []
    for dist in python_runtime_closure(root):
        md = dist.metadata
        homepage = md.get("Home-page") or ""
        for url in md.get_all("Project-URL") or []:
            if not homepage:
                homepage = url.split(",", 1)[-1].strip()
        notice = PackageNotice(
            name=md["Name"],
            version=dist.version,
            license=_python_license(dist),
            homepage=homepage,
        )
        for f in sorted(dist.files or [], key=str):
            parts = Path(str(f)).parts
            in_meta = parts and parts[0].endswith((".dist-info", ".egg-info"))
            if in_meta and (
                "licenses" in parts or LICENSE_FILE_RE.match(Path(str(f)).name)
            ):
                try:
                    text = Path(str(dist.locate_file(f))).read_text(
                        encoding="utf-8", errors="replace"
                    )
                except OSError:
                    continue
                notice.texts.append((str(f), text))
        notices.append(notice)
    return notices


def npm_notices(frontend_dir: Path = REPO_ROOT / "frontend") -> list[PackageNotice]:
    """Production npm packages (bundled into the web UI) from the lock file."""
    lock = json.loads((frontend_dir / "package-lock.json").read_text(encoding="utf-8"))
    notices = []
    for key, entry in sorted(lock.get("packages", {}).items()):
        if not key or entry.get("dev") or entry.get("devOptional"):
            continue
        name = entry.get("name") or key.rsplit("node_modules/", 1)[-1]
        pkg_dir = frontend_dir / key
        license_name = entry.get("license") or ""
        homepage = ""
        pkg_json = pkg_dir / "package.json"
        if pkg_json.is_file():
            data = json.loads(pkg_json.read_text(encoding="utf-8"))
            license_name = license_name or str(data.get("license") or "")
            homepage = str(data.get("homepage") or "")
        notice = PackageNotice(
            name=name,
            version=str(entry.get("version", "")),
            license=license_name or "UNKNOWN",
            homepage=homepage,
        )
        if pkg_dir.is_dir():
            for f in sorted(pkg_dir.iterdir()):
                if f.is_file() and LICENSE_FILE_RE.match(f.name):
                    notice.texts.append(
                        (f.name, f.read_text(encoding="utf-8", errors="replace"))
                    )
        notices.append(notice)
    return notices


def render(title: str, intro: str, notices: list[PackageNotice]) -> str:
    lines = [title, "=" * len(title), "", intro, ""]
    lines.append("Summary")
    lines.append("-------")
    for n in notices:
        lines.append(f"- {n.name} {n.version}: {n.license}")
    lines.append("")
    for n in notices:
        header = f"{n.name} {n.version}"
        lines += ["", header, "-" * len(header), f"License: {n.license}"]
        if n.homepage:
            lines.append(f"Homepage: {n.homepage}")
        if not n.texts:
            lines.append("(No license file shipped with the package.)")
        for fname, text in n.texts:
            lines += ["", f"--- {fname} ---", text.rstrip()]
    return "\n".join(lines) + "\n"


def write_notices(
    out_dir: Path, *, include_npm: bool = True, frontend_dir: Path | None = None
) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    py = out_dir / "python-packages.txt"
    py.write_text(
        render(
            "Bundled Python packages",
            "Runtime dependencies of Ontotator included in this distribution.",
            python_notices(),
        ),
        encoding="utf-8",
    )
    written.append(py)

    runtime = out_dir / "python-runtime.txt"
    py_license = Path(sys.base_prefix) / "LICENSE.txt"
    if not py_license.is_file():
        py_license = Path(sys.base_prefix) / "lib" / "python3" / "LICENSE.txt"
    runtime.write_text(
        f"Python {sys.version.split()[0]} runtime (Python Software Foundation License)\n"
        "https://docs.python.org/3/license.html\n"
        + (
            "\n" + py_license.read_text(encoding="utf-8", errors="replace")
            if py_license.is_file()
            else ""
        ),
        encoding="utf-8",
    )
    written.append(runtime)

    if include_npm:
        npm = out_dir / "npm-packages.txt"
        npm.write_text(
            render(
                "Bundled JavaScript packages",
                "Production npm packages compiled into the Ontotator web UI.",
                npm_notices(frontend_dir or REPO_ROOT / "frontend"),
            ),
            encoding="utf-8",
        )
        written.append(npm)
    return written


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--no-npm", action="store_true", help="Skip npm notices.")
    args = parser.parse_args(argv)
    for p in write_notices(args.out_dir, include_npm=not args.no_npm):
        print(f"--> Wrote {p}")


if __name__ == "__main__":
    main()
