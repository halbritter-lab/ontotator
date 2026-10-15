"""Fingerprint prepared ontology state without holding a lock while loading."""

from sqlalchemy import Connection, select

from ontocurator.domain.canonical import canonical_hash
from ontocurator.domain.errors import DomainError, RevisionConflict
from ontocurator.storage.tables import (
    ProjectOntologyRow,
    ProjectRow,
    ProjectSearchConditionsRow,
)


def project_state(conn: Connection, key: str) -> tuple[str, str]:
    rows = conn.execute(
        select(
            ProjectRow.task_profile_sha256,
            ProjectOntologyRow.ontology_id,
            ProjectOntologyRow.sha256,
            ProjectOntologyRow.allowed_roots,
            ProjectOntologyRow.t1_profile,
            ProjectSearchConditionsRow.conditions,
        )
        .outerjoin(ProjectOntologyRow, ProjectOntologyRow.project_id == ProjectRow.id)
        .outerjoin(
            ProjectSearchConditionsRow,
            ProjectSearchConditionsRow.project_id == ProjectRow.id,
        )
        .where(ProjectRow.project_key == key)
        .order_by(ProjectOntologyRow.ontology_id)
    ).all()
    if not rows:
        raise DomainError("PROJECT_NOT_FOUND", f"There is no project '{key}'.")
    structural = canonical_hash(
        {"profile": rows[0][0], "pins": [list(row[1:5]) for row in rows]}
    )
    return structural, canonical_hash(rows[0][5])


def require_state(
    conn: Connection,
    key: str,
    expected: tuple[str, str],
    preparation_error: RevisionConflict | None = None,
) -> None:
    if preparation_error is not None:
        raise preparation_error
    if project_state(conn, key) != expected:
        raise RevisionConflict(
            "Project profile, pins or captured search conditions changed; retry the command."
        )
