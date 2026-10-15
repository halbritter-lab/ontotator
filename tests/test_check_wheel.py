"""The wheel check of scripts/check.sh: required files and asset kinds."""

import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import check_wheel  # noqa: E402


def test_a_complete_wheel_misses_nothing() -> None:
    complete = {
        *check_wheel.REQUIRED_WHEEL_FILES,
        "ontocurator/web/assets/index-1.js",
        "ontocurator/web/assets/index-1.css",
    }

    assert check_wheel.missing_wheel_files(complete) == []
    assert "ontocurator/storage/migrations/env.py" in check_wheel.REQUIRED_WHEEL_FILES
    assert "ontocurator/web/index.html" in check_wheel.REQUIRED_WHEEL_FILES


def test_missing_files_and_asset_kinds_are_reported() -> None:
    names = {
        *check_wheel.REQUIRED_WHEEL_FILES,
        "ontocurator/web/assets/index-1.js",
    } - {"ontocurator/cli.py"}

    assert check_wheel.missing_wheel_files(names) == [
        "ontocurator/cli.py",
        "ontocurator/web/assets/*.css",
    ]
