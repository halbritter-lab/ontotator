"""The project's audit trail for its leads and their tokens (issue 356).

Who changed the work plan, the assignments, the members or the final
results, and with which API token. People appear as person references
(D1): a lead sees pseudonyms and display names, never a login. The raw
audit label (``user:<login>``, ``cli:<os user>``) and the logins that some
events carry in their details reach system administrators only, as in the
per-user audit of the administration (``GET /admin/users/{username}/audit``).

Token requests themselves (``api_token.use``) are left out: the changes
they made name the token in ``api_token``, and the admin command line
keeps the requests.
"""

from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from sqlalchemy import ColumnElement, Row, and_, false, func, or_, select

from ontotator.api.identity import PrincipalDep
from ontotator.api.job_routes import authorized_project
from ontotator.api.person_views import PersonRefView
from ontotator.application.people import person_refs
from ontotator.auth.audit import Actor
from ontotator.authz.policy import Action
from ontotator.storage.tables import AuditEventRow, UserRow

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])

# Never listed here: see the module docstring.
HIDDEN_ACTIONS = ("api_token.use",)
# Detail keys that hold a login; dropped for everyone but system admins.
LOGIN_KEYS = frozenset({"username", "usernames", "owner", "owner_display_name"})
MAX_LIMIT = 500


class AuditTokenRef(BaseModel):
    """The API token a change was made with."""

    id: int
    name: str


class ProjectAuditEvent(BaseModel):
    """One audited change in the project, newest first.

    ``actor_kind``: ``person`` (an account, ``actor``), ``command_line``
    (the admin command line on the server) or ``system`` (start-up and
    recovery). ``target_id`` is left out (null) for a person target unless
    the caller is a system administrator. ``target_person`` is the person
    the event concerns: the target, or the person a task was made for
    (``details.user_id``). ``actor_label`` only for system administrators.
    """

    id: int
    at: datetime
    action: str
    actor_kind: Literal["person", "command_line", "system"]
    actor: PersonRefView | None = None
    actor_label: str | None = None
    target_type: str
    target_id: str | None = None
    target_person: PersonRefView | None = None
    api_token: AuditTokenRef | None = None
    details: dict[str, Any]


class ProjectAuditPage(BaseModel):
    events: list[ProjectAuditEvent]
    # Matching events in all; ``events`` is one page of them.
    total: int
    limit: int
    offset: int


def _without_logins(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _without_logins(item)
            for key, item in value.items()
            if key not in LOGIN_KEYS
        }
    if isinstance(value, list):
        return [_without_logins(item) for item in value]
    return value


def _action_filter(actions: list[str]) -> ColumnElement[bool]:
    """Exact action names; ``family.*`` matches every action of a family."""
    clauses: list[ColumnElement[bool]] = []
    for action in actions:
        if action.endswith(".*"):
            prefix = (
                action[:-1]
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_")
            )
            clauses.append(AuditEventRow.action.like(prefix + "%", escape="\\"))
        else:
            clauses.append(AuditEventRow.action == action)
    return or_(*clauses)


def _token_ref(details: dict[str, Any]) -> AuditTokenRef | None:
    token = details.get("api_token")
    if (
        isinstance(token, dict)
        and type(token.get("id")) is int
        and isinstance(token.get("name"), str)
    ):
        return AuditTokenRef(id=token["id"], name=token["name"])
    return None


def _concerned(row: Row[Any]) -> int | None:
    """The person an event concerns: its target, or the task's person."""
    if row.target_user_id is not None:
        return int(row.target_user_id)
    user_id = (row.details or {}).get("user_id")
    return user_id if type(user_id) is int else None


@router.get("/{key}/audit")
def project_audit(
    key: str,
    request: Request,
    principal: PrincipalDep,
    action: Annotated[
        list[str] | None,
        Query(description="Action names, e.g. 'work_plan.update'; 'assignment.*'."),
    ] = None,
    person: Annotated[
        str | None,
        Query(description="A person's pseudonym or login: what they did or got."),
    ] = None,
    api_token_id: Annotated[
        int | None, Query(description="Only changes made with this API token.")
    ] = None,
    since: Annotated[datetime | None, Query(description="From this time.")] = None,
    until: Annotated[
        datetime | None, Query(description="Before this time (exclusive).")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ProjectAuditPage:
    """The project's audit trail, newest first (leads and system admins)."""
    actor = Actor.user(principal.user_id, principal.username)
    admin = principal.is_system_admin
    with request.app.state.repo.db.transaction() as conn:
        project_id = authorized_project(
            conn, key, actor, Action.VIEW_PROGRESS, structure=False
        )
        where: list[ColumnElement[bool]] = [
            AuditEventRow.project_id == project_id,
            AuditEventRow.action.not_in(HIDDEN_ACTIONS),
        ]
        if action:
            where.append(_action_filter(action))
        if person is not None:
            wanted = person.strip()
            ids = (
                conn.execute(
                    select(UserRow.id).where(
                        or_(
                            UserRow.pseudonym == wanted,
                            UserRow.username == wanted.lower(),
                        )
                    )
                )
                .scalars()
                .all()
            )
            where.append(
                or_(
                    AuditEventRow.actor_user_id.in_(ids),
                    AuditEventRow.target_user_id.in_(ids),
                    AuditEventRow.details["user_id"].astext.in_(map(str, ids)),
                )
                if ids
                else false()
            )
        if api_token_id is not None:
            where.append(
                AuditEventRow.details["api_token"]["id"].astext == str(api_token_id)
            )
        if since is not None:
            where.append(AuditEventRow.at >= since)
        if until is not None:
            where.append(AuditEventRow.at < until)
        condition = and_(*where)
        total = conn.execute(
            select(func.count()).select_from(AuditEventRow).where(condition)
        ).scalar_one()
        rows = conn.execute(
            select(
                AuditEventRow.id,
                AuditEventRow.at,
                AuditEventRow.action,
                AuditEventRow.actor_user_id,
                AuditEventRow.actor_label,
                AuditEventRow.target_type,
                AuditEventRow.target_id,
                AuditEventRow.target_user_id,
                AuditEventRow.details,
            )
            .where(condition)
            .order_by(AuditEventRow.at.desc(), AuditEventRow.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        people = person_refs(
            conn,
            [
                user_id
                for row in rows
                for user_id in (row.actor_user_id, _concerned(row))
                if user_id is not None
            ],
            viewer_id=principal.user_id,
            viewer_is_lead=True,
        )
    events = []
    for row in rows:
        details: dict[str, Any] = dict(row.details or {})
        person_target = row.target_type == "user"
        events.append(
            ProjectAuditEvent(
                id=row.id,
                at=row.at,
                action=row.action,
                actor_kind="person"
                if row.actor_user_id is not None
                else "command_line"
                if row.actor_label.startswith("cli:")
                else "system",
                actor=people.get(row.actor_user_id)
                if row.actor_user_id is not None
                else None,
                actor_label=row.actor_label if admin else None,
                target_type=row.target_type,
                target_id=row.target_id if admin or not person_target else None,
                target_person=people.get(concerned)
                if (concerned := _concerned(row)) is not None
                else None,
                api_token=_token_ref(details),
                details=details if admin else _without_logins(details),
            )
        )
    return ProjectAuditPage(events=events, total=total, limit=limit, offset=offset)
