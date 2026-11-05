"""The committed OpenAPI contract of Ontotator, for shapes and scopes in tests.

``synth`` builds the smallest instance a schema allows, so the fake API
answers every route with a body of the real shape; tests override only the
fields a tool reads. ``check`` validates a body against its schema.
"""

from __future__ import annotations

import json
import re
from functools import cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

CONTRACT = Path(__file__).resolve().parents[2] / "contracts" / "openapi.json"
REF = "#/components/schemas/"


@cache
def spec() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(CONTRACT.read_text(encoding="utf-8"))
    return loaded


@cache
def _patterns() -> list[tuple[re.Pattern[str], str, str]]:
    found = []
    for template, operations in spec()["paths"].items():
        regex = re.sub(r"\{[^}]+\}", "([^/]+)", template.rstrip("/"))
        for method in operations:
            found.append((re.compile(f"^{regex}/?$"), method.upper(), template))
    # Literal segments win over parameters, as in the router.
    found.sort(key=lambda item: item[2].count("{"))
    return found


def match(method: str, raw_path: str) -> str | None:
    """The contract's path template for a request path (percent-encoded)."""
    for pattern, listed, template in _patterns():
        if listed == method and pattern.match(raw_path):
            return template
    return None


def operation(method: str, template: str) -> dict[str, Any]:
    op: dict[str, Any] = spec()["paths"][template][method.lower()]
    return op


def scope(method: str, template: str) -> str | frozenset[str]:
    """The route's scope; a set when any one of several is enough."""
    value = operation(method, template)["x-ontotator-scope"]
    if isinstance(value, list):
        return frozenset(str(item) for item in value)
    return str(value)


def response_schema(method: str, template: str) -> dict[str, Any] | None:
    responses = operation(method, template)["responses"]
    for status in ("200", "201", "202"):
        content = responses.get(status, {}).get("content", {})
        if "application/json" in content:
            schema: dict[str, Any] = content["application/json"].get("schema", {})
            return schema
    return None


def resolve(schema: dict[str, Any]) -> dict[str, Any]:
    while "$ref" in schema:
        schema = spec()["components"]["schemas"][schema["$ref"].removeprefix(REF)]
    return schema


def named(name: str) -> dict[str, Any]:
    return {"$ref": REF + name}


def synth(schema: dict[str, Any], depth: int = 0) -> Any:
    """The smallest instance of ``schema``: required fields only, first choices."""
    schema = resolve(schema)
    if "const" in schema:
        return schema["const"]
    if "enum" in schema:
        return schema["enum"][0]
    if "default" in schema and depth > 0:
        return schema["default"]
    for key in ("anyOf", "oneOf"):
        if key in schema:
            options = [o for o in schema[key] if resolve(o).get("type") != "null"]
            return synth((options or schema[key])[0], depth + 1)
    kind = schema.get("type")
    if kind == "object" or "properties" in schema:
        props = schema.get("properties", {})
        return {
            name: synth(props[name], depth + 1) for name in schema.get("required", [])
        }
    if kind == "array":
        return []
    if kind == "string":
        if schema.get("format") == "date-time":
            return "2026-11-01T10:00:00Z"
        if schema.get("pattern") == "^[0-9a-f]{64}$":
            return "0" * 64
        return "x"
    if kind == "integer":
        return int(schema.get("minimum", 1))
    if kind == "number":
        return 1.0
    if kind == "boolean":
        return False
    if kind == "null":
        return None
    return {}


def check(instance: Any, schema: dict[str, Any]) -> None:
    """Raise if ``instance`` does not fit ``schema`` (a contract schema)."""
    document = {"components": spec()["components"], **schema}
    Draft202012Validator(document).validate(instance)
