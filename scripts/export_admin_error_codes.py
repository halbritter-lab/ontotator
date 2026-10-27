"""Export the backend administration error catalog without runtime services."""

import json
import sys
from pathlib import Path

from ontotator.domain.admin_error_codes import ADMIN_ERROR_CODES


def export_admin_error_codes(*, check: bool = False) -> None:
    target = (
        Path(__file__).resolve().parents[1] / "contracts" / "admin-error-codes.json"
    )
    formatted = json.dumps(list(ADMIN_ERROR_CODES), indent=2) + "\n"
    if check:
        if not target.is_file() or target.read_text(encoding="utf-8") != formatted:
            raise SystemExit(
                "contracts/admin-error-codes.json differs from backend catalog"
            )
        print("Administration error catalog is up-to-date")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(formatted, encoding="utf-8")
    print(f"Exported administration error catalog to {target}")


if __name__ == "__main__":
    export_admin_error_codes(check="--check" in sys.argv)
