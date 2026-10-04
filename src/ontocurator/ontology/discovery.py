from __future__ import annotations

import json
from pathlib import Path


def is_probable_obo_graph(path: Path) -> bool:
    """Check if file is a readable JSON file with OBO Graph structure."""
    if not path.is_file() or path.suffix.lower() != ".json":
        return False
    try:
        with open(path, encoding="utf-8") as f:
            head = f.read(1024)
            if '"graphs"' in head and '"nodes"' in head:
                return True
        # For small files or pretty-printed files where nodes might be after 1024 chars
        if path.stat().st_size < 100 * 1024 * 1024:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
                return isinstance(data, dict) and "graphs" in data
        return False
    except Exception:
        return False


def discover_ontologies(search_dirs: list[Path]) -> list[Path]:
    """Scan directories for valid ontology JSON files."""
    found: list[Path] = []
    seen_resolved: set[Path] = set()

    for directory in search_dirs:
        if not directory.is_dir():
            continue
        for candidate in directory.glob("*.json"):
            resolved = candidate.resolve()
            if resolved in seen_resolved:
                continue
            if is_probable_obo_graph(resolved):
                seen_resolved.add(resolved)
                found.append(resolved)

    return found
