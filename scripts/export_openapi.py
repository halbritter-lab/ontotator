"""Export OpenAPI JSON schema from FastAPI app without database or
ontology dependencies.
"""

import json
from pathlib import Path

from ontocurator.api.app import create_app


def export_openapi() -> None:
    root_dir = Path(__file__).parent.parent
    output_dir = root_dir / "contracts"
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / "openapi.json"

    app = create_app(config=None)
    schema = app.openapi()

    target.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
    print(f"Exported OpenAPI schema to {target}")


if __name__ == "__main__":
    export_openapi()
