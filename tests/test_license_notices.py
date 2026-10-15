"""Third-party licence notices for the distributed wheel and web UI."""

import json
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import license_notices  # noqa: E402


def test_python_license_notices_cover_runtime_deps_only() -> None:
    names = {
        license_notices._canonical(n.name) for n in license_notices.python_notices()
    }
    assert {"fastapi", "uvicorn", "pydantic", "numpy", "sqlalchemy"} <= names
    assert "pytest" not in names
    assert "mypy" not in names


def test_npm_license_notices_skip_dev_packages(tmp_path: Path) -> None:
    lock = {
        "lockfileVersion": 3,
        "packages": {
            "": {"name": "app"},
            "node_modules/react": {"version": "18.3.1", "license": "MIT"},
            "node_modules/vite": {"version": "5.0.0", "license": "MIT", "dev": True},
        },
    }
    (tmp_path / "package-lock.json").write_text(json.dumps(lock))
    pkg = tmp_path / "node_modules" / "react"
    pkg.mkdir(parents=True)
    (pkg / "LICENSE").write_text("MIT License text")
    notices = license_notices.npm_notices(tmp_path)
    assert [(n.name, n.license) for n in notices] == [("react", "MIT")]
    assert notices[0].texts == [("LICENSE", "MIT License text")]
    rendered = license_notices.render("T", "intro", notices)
    assert "MIT License text" in rendered
