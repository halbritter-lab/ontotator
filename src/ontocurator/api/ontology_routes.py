"""System-admin ontology upload, bounded before adding any file."""

from contextlib import ExitStack
from datetime import datetime
from tempfile import TemporaryFile
from typing import Annotated

from fastapi import APIRouter, File, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from ontocurator.api.identity import PrincipalDep, require_system_admin
from ontocurator.auth.audit import Actor
from ontocurator.domain.errors import PayloadTooLarge
from ontocurator.ontology.store import OntologyStore
from ontocurator.storage.tables import ProjectOntologyRow, ProjectRow

router = APIRouter(prefix="/api/v1/admin/ontologies", tags=["admin-ontologies"])


class AdminOntology(BaseModel):
    sha256: str
    kind: str
    prefix: str
    release: str | None
    filename: str
    language: str | None
    uploaded_at: datetime
    projects: list[str]


def _listed(store: OntologyStore) -> list[AdminOntology]:
    with store.db.transaction() as conn:
        projects: dict[str, list[str]] = {}
        for sha, key in conn.execute(
            select(ProjectOntologyRow.sha256, ProjectRow.project_key)
            .distinct()
            .join(ProjectRow, ProjectRow.id == ProjectOntologyRow.project_id)
            .order_by(ProjectRow.project_key)
        ).tuples():
            projects.setdefault(sha, []).append(key)
        return [
            AdminOntology(**vars(item), projects=projects.get(item.sha256, []))
            for item in store.list()
        ]


@router.get("/")
def list_ontologies(principal: PrincipalDep, request: Request) -> list[AdminOntology]:
    require_system_admin(principal)
    return _listed(request.app.state.ontology_store)


@router.post("/")
async def upload_ontologies(
    principal: PrincipalDep,
    request: Request,
    files: Annotated[list[UploadFile], File(alias="files[]")],
) -> list[AdminOntology]:
    require_system_admin(principal)
    store: OntologyStore = request.app.state.ontology_store
    limit: int = request.app.state.config.max_ontology_bytes
    total = 0
    temporary = []
    with ExitStack() as cleanup:
        try:
            for uploaded in files:
                handle = cleanup.enter_context(TemporaryFile())
                temporary.append((uploaded.filename or "ontology.json", handle))
                while chunk := await uploaded.read(min(1024 * 1024, limit - total + 1)):
                    total += len(chunk)
                    if total > limit:
                        raise PayloadTooLarge(
                            "Ontology uploads exceed the configured byte limit."
                        )
                    handle.write(chunk)
                handle.seek(0)
            actor = Actor.user(principal.user_id, principal.username)
            shas = []
            for name, handle in temporary:
                item = await run_in_threadpool(store.add, actor, name, handle.read())
                shas.append(item.sha256)
            listed = await run_in_threadpool(_listed, store)
            return [item for item in listed if item.sha256 in shas]
        finally:
            for uploaded in files:
                await uploaded.close()
