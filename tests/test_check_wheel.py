"""The wheel check of scripts/check.sh: required files and asset kinds."""

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "check_wheel.py"
_spec = importlib.util.spec_from_file_location("check_wheel", SCRIPT)
assert _spec is not None and _spec.loader is not None
check_wheel = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_wheel)


def test_a_complete_wheel_misses_nothing() -> None:
    complete = {
        *check_wheel.REQUIRED_WHEEL_FILES,
        "ontotator/web/assets/index-1.js",
        "ontotator/web/assets/index-1.css",
    }

    assert check_wheel.missing_wheel_files(complete) == []
    assert "ontotator/storage/migrations/env.py" in check_wheel.REQUIRED_WHEEL_FILES
    assert "ontotator/web/index.html" in check_wheel.REQUIRED_WHEEL_FILES


def test_missing_files_and_asset_kinds_are_reported() -> None:
    names = {
        *check_wheel.REQUIRED_WHEEL_FILES,
        "ontotator/web/assets/index-1.js",
    } - {"ontotator/cli.py"}

    assert check_wheel.missing_wheel_files(names) == [
        "ontotator/cli.py",
        "ontotator/web/assets/*.css",
    ]
