"""Response bodies of the real shape (synthesized from the contract, then filled)."""

from __future__ import annotations

from typing import Any

from contract import named, synth


def build(schema_name: str, /, **fields: Any) -> dict[str, Any]:
    body: dict[str, Any] = synth(named(schema_name))
    body.update(fields)
    return body


def row(
    case_id: str,
    language: str = "en",
    *,
    document_id: str | None = None,
    work: list[dict[str, Any]] | None = None,
    final: dict[str, Any] | None = None,
) -> dict[str, Any]:
    version = build(
        "DocumentVersionView",
        document_id=document_id or f"{case_id}-{language}-v1",
        version=1,
        is_newest_in_chain=True,
    )
    return build(
        "DocumentRowView",
        case_id=case_id,
        language=language,
        is_source=True,
        versions=[version],
        work=work or [],
        final=final,
    )


def work(status: str, person: str, task: str = "annotate") -> dict[str, Any]:
    return build(
        "WorkItemView",
        task=task,
        status=status,
        person=build("PersonRefView", pseudonym=person),
    )


def page(rows: list[dict[str, Any]], number: int = 1, count: int = 1) -> dict[str, Any]:
    groups = [
        build("DocumentGroupView", case_id=item["case_id"], rows=[item])
        for item in rows
    ]
    return build(
        "DocumentRowsPage",
        groups=groups,
        page=number,
        page_count=count,
        group_count=len(groups),
        text_count=len(rows),
    )


def submission(
    submission_id: str,
    document_id: str,
    *,
    kind: str = "annotation",
    eligible: bool = True,
    findings: int = 3,
) -> dict[str, Any]:
    return build(
        "FinalPanelSubmissionView",
        submission_id=submission_id,
        document_id=document_id,
        kind=kind,
        eligible=eligible,
        finding_count=findings,
        is_latest_in_round=True,
    )


def panel(
    submissions: list[dict[str, Any]],
    *,
    all_match: bool,
    total: int = 3,
    matching: int = 3,
) -> dict[str, Any]:
    return build(
        "FinalPanelView",
        submissions=submissions,
        all_match=all_match,
        all_match_submission_id=submissions[0]["submission_id"]
        if all_match and submissions
        else None,
        agreement=build(
            "AgreementView",
            total=total,
            matching=matching,
            context_differences=0,
            detail_differences=[],
        ),
        unresolved=[],
    )
