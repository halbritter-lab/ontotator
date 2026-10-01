"""Export OpenAPI JSON schema from FastAPI app without database or
ontology dependencies.
"""

import json
import sys
from pathlib import Path

from ontocurator.api.app import create_app


def export_openapi(check: bool = False) -> None:
    root_dir = Path(__file__).parent.parent
    output_dir = root_dir / "contracts"
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / "openapi.json"

    app = create_app(config=None)
    schema = app.openapi()
    formatted = json.dumps(schema, indent=2) + "\n"

    if check:
        if not target.is_file():
            print(f"Error: {target} does not exist", file=sys.stderr)
            sys.exit(1)
        existing = target.read_text(encoding="utf-8")
        if existing != formatted:
            print(
                "Error: Live OpenAPI schema differs from committed "
                "contracts/openapi.json",
                file=sys.stderr,
            )
            sys.exit(1)
        print("OpenAPI schema is up-to-date")
        return

    target.write_text(formatted, encoding="utf-8")
    print(f"Exported OpenAPI schema to {target}")


if __name__ == "__main__":
    check_mode = "--check" in sys.argv
    export_openapi(check=check_mode)
