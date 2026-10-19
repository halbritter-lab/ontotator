"""One deterministic warning projection for the lead dashboard and final export.

Inputs must already be authorized in the caller's database snapshot. Warnings
never decide which result is exported: only explicit selections do that.
"""

import hashlib
import json
from collections.abc import Mapping, Sequence
from typing import Any
from urllib.parse import quote


def state_digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
    ).hexdigest()


def project_warnings(
    project: str,
    inventory: Sequence[Mapping[str, Any]],
    selections: Sequence[Mapping[str, Any]],
    causes: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    slots = sorted({(item["case_id"], item["language"]) for item in inventory})
    selected = sorted(
        [dict(item) for item in selections],
        key=lambda item: (item["case_id"], item["language"]),
    )
    present = {(item["case_id"], item["language"]) for item in selected}
    omissions = [
        {"case_id": case, "language": language}
        for case, language in slots
        if (case, language) not in present
    ]
    warnings = []
    for omission in omissions:
        identity = {"project": project, "code": "MISSING_FINAL_SELECTION", **omission}
        warnings.append(
            {
                **omission,
                "id": state_digest(identity),
                "code": "MISSING_FINAL_SELECTION",
                "cause_revision": 1,
                "reason": "No final result selected. This language will be omitted if you continue.",
                "destination": f"#/projects/{quote(project, safe='')}/documents",
            }
        )
    for cause in causes:
        if (cause["case_id"], cause["language"]) not in slots:
            continue
        warnings.append(
            {
                **dict(cause),
                "id": state_digest(
                    {
                        "project": project,
                        "code": cause["code"],
                        "cause_id": cause["cause_id"],
                    }
                ),
            }
        )
    warnings.sort(
        key=lambda item: (item["case_id"], item["language"], item["code"], item["id"])
    )
    state = {
        "project": project,
        "selections": selected,
        "warnings": warnings,
        "omissions": omissions,
    }
    return {**state, "state_digest": state_digest(state)}
