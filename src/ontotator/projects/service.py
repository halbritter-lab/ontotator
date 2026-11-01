"""Transactional project settings and structural policy."""

import re
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Literal

import ontospan
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Connection, delete, func, insert, select, update

from ontotator.auth.accounts import normalize_languages
from ontotator.auth.audit import Actor, record_audit
from ontotator.authz.memberships import grant_roles
from ontotator.authz.policy import Action
from ontotator.authz.project_authority import require_project_management
from ontotator.domain.annotation_modes import AnnotationMode
from ontotator.domain.canonical import canonical_hash
from ontotator.domain.documents import Document
from ontotator.domain.errors import DomainError, RevisionConflict
from ontotator.domain.profiles import TaskProfile, profile_hash
from ontotator.domain.work_plans import ImportPlanSetting
from ontotator.domain.workspace import Draft
from ontotator.exchange.t1 import Pin, T1Profile, check_t1_profile
from ontotator.ontology.conditions import (
    SearchCondition,
    TranslationResource,
    validate_resources,
)
from ontotator.ontology.service import OntologyService
from ontotator.ontology.store import OntologyStore
from ontotator.ontology.translation_freeze import (
    REFRESH_ACTION,
    SUPERSEDED,
    condition_history,
    frozen_files,
    not_included,
    ontology_prefixes,
    same_translations,
    translation_changes,
)
from ontotator.packages.models import PackageManifest
from ontotator.projects.repin import (
    RepinReport,
    build_report,
    open_draft,
    rewrite_draft,
)
from ontotator.storage.database import Database
from ontotator.storage.repository import Repository, _lock_id
from ontotator.storage.tables import (
    DraftRow,
    OntologyFileRow,
    ProjectOntologyRow,
    ProjectResourceRow,
    ProjectRow,
    ProjectSearchConditionsRow,
    SubmissionRow,
    TranslationReviewRow,
    UserRow,
)

HiddenValues = dict[str, dict[str, list[str]]]
CreationDefaults = dict[str, dict[str, dict[str, str]]]


class ProjectPin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ontology_id: str
    sha256: str
    allowed_roots: list[str] = Field(default_factory=list)
    t1_profile: T1Profile = "generic"


class PinnedOntology(ProjectPin):
    release: str


class FrozenTranslation(BaseModel):
    """A translation file a project's search conditions hold (#254)."""

    ontology_id: str
    filename: str
    sha256: str
    languages: list[str]


class FrozenTranslations(BaseModel):
    """The translations frozen at the project's first use of its ontology.

    A later upload does not reach the project; ``not_included`` names the
    current server files of its ontologies that it does not use.
    """

    files: list[FrozenTranslation]
    not_included: list[str] = Field(default_factory=list)
    # The last move to the newest translations, when the current files came
    # from one (not from the first use).
    updated: "TranslationsUpdate | None" = None
    # The files searches used before, newest first.
    history: list["EarlierTranslations"] = Field(default_factory=list)


class TranslationsUpdate(BaseModel):
    """When and by whom the project moved to the newest translations."""

    at: datetime
    # The audit actor label, e.g. ``user:lena`` or ``cli:operator``.
    by: str


class EarlierTranslations(BaseModel):
    """Translation files the project's searches used until ``until``.

    ``reason`` is what ended them: a move to the newest translations
    (``refresh``) or a change of the ontology version or task profile
    (``ontology``). Searches that ran with them keep their
    ``search_condition_id``, one of ``condition_ids``.
    """

    until: datetime
    by: str
    reason: Literal["refresh", "ontology"]
    condition_ids: list[str]
    files: list[FrozenTranslation]


FrozenTranslations.model_rebuild()


class ProjectSettingsChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = ""
    description: str | None = None
    languages: list[str] = Field(default_factory=list)
    allow_spanless_findings: bool = True
    require_spanless_note: bool = True
    require_chosen_axes: bool = False
    adjudicator_not_annotator: bool = False
    contiguous_mentions_only: bool = False
    annotate_accepted_translations_only: bool = True
    hidden_axis_values: HiddenValues = Field(default_factory=dict)
    creation_defaults: CreationDefaults = Field(default_factory=dict)
    # ``None`` keeps the stored value (the settings page sends full replaces).
    annotations_per_text: int | None = Field(None, ge=1, le=5)
    import_plan: ImportPlanSetting | None = None
    tool_proposal_mode: AnnotationMode | None = None


class ProjectSettings(ProjectSettingsChange):
    annotations_per_text: int = 1
    import_plan: ImportPlanSetting = "review_and_annotate_translations"
    # A factory default keeps the field optional in the generated types
    # (older fixtures omit it; absent means "proposals").
    tool_proposal_mode: AnnotationMode = Field(default_factory=lambda: "proposals")
    project_key: str
    profile: TaskProfile
    pins: list[PinnedOntology]
    locked: bool
    axis_defaults: dict[str, dict[str, str]]
    annotation_policy_revision: int = 1
    # ``None``: not frozen yet, the first use takes the server's translations.
    frozen_translations: FrozenTranslations | None = None


def validate_creation_defaults(
    profile: TaskProfile, defaults: CreationDefaults, hidden: HiddenValues
) -> None:
    """Validate every configured preset against its exact editable layer/type."""
    layers = {layer.layer_id: layer for layer in profile.layers}
    for layer_id, kinds in defaults.items():
        layer = layers.get(layer_id)
        path = f"creation_defaults.{layer_id}"
        if layer is None or layer.access != "editable":
            raise DomainError("SETTINGS_INVALID", {"path": path})
        definitions = {kind.type_id: kind for kind in layer.annotation_types}
        for type_id, values in kinds.items():
            definition = definitions.get(type_id)
            path = f"creation_defaults.{layer_id}.{type_id}"
            if definition is None:
                raise DomainError("SETTINGS_INVALID", {"path": path})
            axes = {axis.id: axis for axis in definition.axes}
            for axis_id, value in values.items():
                axis = axes.get(axis_id)
                if (
                    axis is None
                    or value not in axis.options
                    or value in hidden.get(layer_id, {}).get(axis_id, [])
                ):
                    raise DomainError("SETTINGS_INVALID", {"path": f"{path}.{axis_id}"})


def _allowed_default(
    profile: TaskProfile, hidden: HiddenValues, layer_id: str, type_id: str
) -> dict[str, list[str]] | None:
    """Axis -> values a preset may hold for one editable layer/type, else ``None``."""
    layer = next((item for item in profile.layers if item.layer_id == layer_id), None)
    if layer is None or layer.access != "editable":
        return None
    kind = next(
        (item for item in layer.annotation_types if item.type_id == type_id), None
    )
    if kind is None:
        return None
    hidden_here = hidden.get(layer_id, {})
    return {
        axis.id: [
            value for value in axis.options if value not in hidden_here.get(axis.id, [])
        ]
        for axis in kind.axes
    }


def prune_creation_defaults(
    profile: TaskProfile, defaults: CreationDefaults, hidden: HiddenValues
) -> CreationDefaults:
    """Keep only the presets that still validate; drop emptied types and layers."""
    pruned: CreationDefaults = {}
    for layer_id, kinds in defaults.items():
        for type_id, values in kinds.items():
            allowed = _allowed_default(profile, hidden, layer_id, type_id)
            if allowed is None:
                continue
            kept = {
                axis_id: value
                for axis_id, value in values.items()
                if value in allowed.get(axis_id, [])
            }
            if kept:
                pruned.setdefault(layer_id, {})[type_id] = kept
    return pruned


def clinical_creation_defaults(
    profile: TaskProfile, hidden: HiddenValues
) -> CreationDefaults:
    """``ontospan.default_axes()`` for every editable type that allows them (U5)."""
    clinical = {key: value.value for key, value in ontospan.default_axes().items()}
    return prune_creation_defaults(
        profile,
        {
            layer.layer_id: {
                kind.type_id: dict(clinical) for kind in layer.annotation_types
            }
            for layer in profile.layers
            if layer.access == "editable"
        },
        hidden,
    )


def axis_defaults(
    profile: TaskProfile, pins: Mapping[str, Pin]
) -> dict[str, dict[str, str]]:
    """Only T1's declared defaults; generic axes have no implicit defaults."""
    defaults = {key: value.value for key, value in ontospan.default_axes().items()}
    resolved = {}
    for layer in profile.layers:
        pin = pins.get(layer.ontology_id)
        if pin is None or pin.t1_profile != "hpo-phenotype":
            continue
        axes = {axis.id for kind in layer.annotation_types for axis in kind.axes}
        resolved[layer.layer_id] = {
            key: value for key, value in defaults.items() if key in axes
        }
    return resolved


def validate_hidden_values(
    profile: TaskProfile, pins: Mapping[str, Pin], hidden: HiddenValues
) -> None:
    defaults = axis_defaults(profile, pins)
    layers = {layer.layer_id: layer for layer in profile.layers}
    for layer_id, axes in hidden.items():
        layer = layers.get(layer_id)
        for axis_id, values in axes.items():
            definitions = (
                []
                if layer is None
                else [
                    axis
                    for kind in layer.annotation_types
                    for axis in kind.axes
                    if axis.id == axis_id
                ]
            )
            path = f"hidden_axis_values.{layer_id}.{axis_id}"
            if not definitions:
                raise DomainError("SETTINGS_INVALID", {"path": path})
            for value in values:
                if (
                    not any(value in axis.options for axis in definitions)
                    or defaults.get(layer_id, {}).get(axis_id) == value
                ):
                    raise DomainError("SETTINGS_INVALID", {"path": f"{path}.{value}"})
        if layer is None:
            raise DomainError(
                "SETTINGS_INVALID", {"path": f"hidden_axis_values.{layer_id}"}
            )


def check_allowed_roots(store: OntologyStore, pins: Mapping[str, Pin]) -> None:
    """Every allowed root of a pin is a term of its pinned release (#97).

    A root the release lacks has an empty subtree, so every finding would be
    refused (or, before the check, silently accepted).
    """
    for ontology_id, pin in sorted(pins.items()):
        missing = store.missing_roots(pin.sha256, pin.allowed_roots)
        if missing:
            raise DomainError(
                "ALLOWED_ROOTS_UNKNOWN",
                {"ontology_id": ontology_id, "missing": missing},
            )


def _spelled_as(pins: Mapping[str, Pin], profile: TaskProfile) -> dict[str, Pin]:
    """``pins`` keyed by the profile's spelling of each ontology id (#189).

    ``hp`` and ``HP`` are one ontology, so a profile that spells the pinned id
    in another case replaces the profile of the project; the pin follows it.
    """
    spelling = {o.ontology_id.casefold(): o.ontology_id for o in profile.ontologies}
    result: dict[str, Pin] = {}
    for oid, pin in pins.items():
        name = spelling.get(oid.casefold(), oid)
        if name in result:
            return dict(pins)
        result[name] = pin
    return result


def _superseded(earlier: list[str], old: Pin | None, sha256: str) -> list[str]:
    """The digests a pin replaced, oldest first, after it moves to ``sha256``."""
    history = list(earlier)
    if old is not None and old.sha256 != sha256 and old.sha256 not in history:
        history.append(old.sha256)
    return [digest for digest in history if digest != sha256]


def _keep_dropped(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    """``new`` with the translation files of ``old`` it has no file of that name for."""
    names = {str(item["filename"]).lower() for item in new.get("translations") or []}
    kept = [
        item
        for item in old.get("translations") or []
        if str(item.get("filename", "")).lower() not in names
    ]
    if not kept:
        return new
    payload = SearchCondition.model_validate(new).model_dump(exclude={"condition_id"})
    payload["translations"] += [
        TranslationResource.model_validate(item).model_dump() for item in kept
    ]
    return SearchCondition.model_validate(
        {"condition_id": canonical_hash(payload), **payload}
    ).model_dump(mode="json")


class RepinRequest(BaseModel):
    """Apply a re-pin whose dry run the lead has seen."""

    model_config = ConfigDict(extra="forbid")
    pins: list[ProjectPin]
    report_sha256: str


class ProjectService:
    def __init__(self, db: Database, store: OntologyStore) -> None:
        self.db, self.store, self.repo = db, store, Repository(db)

    @staticmethod
    def _project(conn: Connection, key: str) -> Any:
        row = (
            conn.execute(select(ProjectRow).where(ProjectRow.project_key == key))
            .mappings()
            .one_or_none()
        )
        if row is None:
            raise DomainError("PROJECT_NOT_FOUND", f"There is no project '{key}'.")
        return row

    @staticmethod
    def _locked(conn: Connection, project_id: int) -> bool:
        return (
            conn.execute(
                select(SubmissionRow.submission_id)
                .where(SubmissionRow.project_id == project_id)
                .limit(1)
            ).first()
            is not None
            or conn.execute(
                select(TranslationReviewRow.id)
                .where(TranslationReviewRow.project_id == project_id)
                .limit(1)
            ).first()
            is not None
        )

    def settings(self, key: str) -> ProjectSettings:
        with (
            self.db.transaction() if self.db.in_transaction() else self.db.snapshot()
        ) as conn:
            row = self._project(conn, key)
            profile = TaskProfile.model_validate(row["task_profile"])
            pins = self.repo._pins(conn, row["id"])
            releases = dict(
                conn.execute(
                    select(OntologyFileRow.sha256, OntologyFileRow.release).where(
                        OntologyFileRow.sha256.in_(
                            [pin.sha256 for pin in pins.values()]
                        )
                    )
                )
                .tuples()
                .all()
            )
            fields = {name: row[name] for name in ProjectSettingsChange.model_fields}
            return ProjectSettings(
                **fields,
                project_key=key,
                profile=profile,
                pins=[
                    PinnedOntology(
                        ontology_id=oid,
                        sha256=pin.sha256,
                        release=releases[pin.sha256] or "",
                        allowed_roots=list(pin.allowed_roots),
                        t1_profile=pin.t1_profile,
                    )
                    for oid, pin in sorted(pins.items())
                ],
                locked=self._locked(conn, row["id"]),
                axis_defaults=axis_defaults(profile, pins),
                annotation_policy_revision=row["annotation_policy_revision"],
                frozen_translations=self._frozen_translations(conn, row["id"], profile),
            )

    def _frozen_translations(
        self, conn: Connection, project_id: int, profile: TaskProfile
    ) -> FrozenTranslations | None:
        """Read the captured conditions only; never capture them (#254)."""
        conditions = conn.execute(
            select(ProjectSearchConditionsRow.conditions).where(
                ProjectSearchConditionsRow.project_id == project_id
            )
        ).scalar_one_or_none()
        if conditions is None:
            return None
        ontology_ids = {
            item.sha256.lower(): item.ontology_id for item in profile.ontologies
        }

        def files(stored: list[Any]) -> list[FrozenTranslation]:
            return [
                FrozenTranslation(
                    ontology_id=ontology_ids.get(
                        item.ontology_sha256, item.ontology_sha256
                    ),
                    filename=item.filename,
                    sha256=item.sha256,
                    languages=list(item.languages),
                )
                for item in frozen_files(stored)
            ]

        prefixes = ontology_prefixes(conn, self.store.loaded_prefixes())
        history = condition_history(conn, project_id)
        last = history[-1] if history else None
        return FrozenTranslations(
            files=files(conditions),
            not_included=not_included(conn, conditions, prefixes),
            updated=(
                TranslationsUpdate(at=last.at, by=last.actor_label)
                if last is not None and last.action == REFRESH_ACTION
                else None
            ),
            history=[
                EarlierTranslations(
                    until=item.at,
                    by=item.actor_label,
                    reason="refresh" if item.action == REFRESH_ACTION else "ontology",
                    condition_ids=[
                        str(c.get("condition_id", "")) for c in item.conditions
                    ],
                    files=files(item.conditions),
                )
                for item in reversed(history)
            ],
        )

    def refresh_translations(self, actor: Actor, key: str) -> ProjectSettings:
        """Move the project to the newest translations (#254).

        The conditions a first use would capture now replace those of each
        ontology whose translation files differ; an ontology whose files are
        the same keeps its condition. A file the project uses that the server
        no longer offers stays (its bytes are captured): a refresh adds and
        replaces files, it never drops a language. The replaced conditions are kept whole
        in the ``project.translations_refresh`` audit entry, so searches that
        ran with them stay resolvable, and their captured files stay among
        the project's resources. Drafts, submissions and search events are
        not touched. Allowed at any time, also with submitted work.

        Refused with ``TRANSLATIONS_NOT_FROZEN`` before the first use and
        with ``TRANSLATIONS_CURRENT`` when no file would change.
        """
        # Take up files another worker stored, then capture without any lock
        # (parsing a translation can take seconds).
        self.store.sync_translations()
        with self.db.transaction() as conn:
            row = self._project(conn, key)
        profile = TaskProfile.model_validate(row["task_profile"])
        captured, resources = self.store.registry.capture_current(profile)
        fresh = {c.ontology_sha256: c.model_dump(mode="json") for c in captured}
        with self.db.transaction() as conn:
            conn.execute(
                select(func.pg_advisory_xact_lock_shared(_lock_id("members", key)))
            )
            conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", key))))
            locked_row = self._project(conn, key)
            project_id = locked_row["id"]
            require_project_management(
                conn, actor, key, project_id, Action.MANAGE_PROJECT_SETTINGS
            )
            if locked_row["task_profile_sha256"] != row["task_profile_sha256"]:
                raise RevisionConflict(
                    "The ontology or task profile changed meanwhile; try again."
                )
            current = conn.execute(
                select(ProjectSearchConditionsRow.conditions).where(
                    ProjectSearchConditionsRow.project_id == project_id
                )
            ).scalar_one_or_none()
            if current is None:
                raise DomainError(
                    "TRANSLATIONS_NOT_FROZEN",
                    "The project has not frozen its translations yet. Its first "
                    "term search takes the newest files.",
                )
            refreshed: list[dict[str, Any]] = []
            for condition in current:
                new = fresh.get(str(condition.get("ontology_sha256")))
                merged = None if new is None else _keep_dropped(condition, new)
                if merged is None or same_translations(condition, merged):
                    refreshed.append(condition)
                else:
                    refreshed.append(merged)
            changes = translation_changes(current, refreshed)
            if changes.empty:
                raise DomainError(
                    "TRANSLATIONS_CURRENT",
                    "The project already uses the newest translations.",
                )
            conditions = [SearchCondition.model_validate(c) for c in refreshed]
            declared = {
                item.resource_path
                for condition in conditions
                for item in condition.translations
            }
            needed = {
                path: data for path, data in resources.items() if path in declared
            }
            # A kept file the server no longer offers: its captured bytes.
            for path, sha in conn.execute(
                select(
                    ProjectResourceRow.resource_path, ProjectResourceRow.sha256
                ).where(
                    ProjectResourceRow.project_id == project_id,
                    ProjectResourceRow.resource_path.in_(declared - needed.keys()),
                )
            ).tuples():
                needed[path] = self.db.blobs.get(sha)
            validate_resources(conditions, profile, needed)
            files = {
                path: (self.db.put_blob(conn, data), len(data))
                for path, data in needed.items()
            }
            conn.execute(
                update(ProjectSearchConditionsRow)
                .where(ProjectSearchConditionsRow.project_id == project_id)
                .values(conditions=refreshed)
            )
            Repository._store_files(conn, project_id, files)

            def summary(stored: list[Any]) -> list[dict[str, str]]:
                return [
                    {"filename": item.filename, "sha256": item.sha256}
                    for item in frozen_files(stored)
                ]

            record_audit(
                conn,
                actor,
                REFRESH_ACTION,
                target_type="project",
                target_id=key,
                project_id=project_id,
                details={
                    "added": changes.added,
                    "replaced": changes.replaced,
                    "removed": changes.removed,
                    "files_before": summary(current),
                    "files_after": summary(refreshed),
                    "condition_ids_before": [c["condition_id"] for c in current],
                    "condition_ids_after": [c["condition_id"] for c in refreshed],
                    SUPERSEDED: current,
                },
                at=datetime.now(UTC),
            )
            return self.settings(key)

    def create(
        self,
        actor: Actor,
        *,
        key: str,
        name: str,
        description: str | None,
        profile: TaskProfile,
        pins: Mapping[str, Pin],
        languages: list[str],
        practice: bool = False,
    ) -> ProjectSettings:
        """``practice``: a practice project (issue 266); its creator, a process,
        is no member."""
        if re.fullmatch(r"[a-z0-9][a-z0-9-]{1,62}", key) is None:
            raise DomainError(
                "PROJECT_KEY_INVALID",
                "Use 2-63 lower-case letters, digits or hyphens; start with a letter or digit.",
            )
        normalized = normalize_languages(languages)
        check_allowed_roots(self.store, pins)

        def created(conn: Connection, project_id: int) -> None:
            conn.execute(
                update(ProjectRow)
                .where(ProjectRow.id == project_id)
                .values(
                    languages=sorted(normalized),
                    creation_defaults=clinical_creation_defaults(profile, {}),
                )
            )
            record_audit(
                conn,
                actor,
                "project.create",
                target_type="project",
                target_id=key,
                project_id=project_id,
                details={"name": name, "profile_id": profile.profile_id},
            )
            if actor.user_id is not None:
                username = conn.execute(
                    select(UserRow.username).where(UserRow.id == actor.user_id)
                ).scalar_one()
                grant_roles(
                    conn,
                    actor,
                    project_id,
                    actor.user_id,
                    username,
                    ["lead"],
                    datetime.now(UTC),
                )

        with self.db.transaction():
            self.repo.create_project(
                key,
                name,
                description,
                profile,
                pins,
                on_create=created,
                practice=practice,
            )
            return self.settings(key)

    def update_settings(
        self, actor: Actor, key: str, change: ProjectSettingsChange
    ) -> ProjectSettings:
        fields = change.model_dump(exclude_unset=True)
        for name in ("annotations_per_text", "import_plan", "tool_proposal_mode"):
            if fields.get(name, 0) is None:
                del fields[name]
        if "languages" in fields:
            fields["languages"] = sorted(normalize_languages(change.languages))
        with self.db.transaction() as conn:
            conn.execute(
                select(func.pg_advisory_xact_lock_shared(_lock_id("members", key)))
            )
            conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", key))))
            row = self._project(conn, key)
            require_project_management(
                conn, actor, key, row["id"], Action.MANAGE_PROJECT_SETTINGS
            )
            combined = dict(row) | fields
            validate_hidden_values(
                TaskProfile.model_validate(row["task_profile"]),
                self.repo._pins(conn, row["id"]),
                combined["hidden_axis_values"],
            )
            validate_creation_defaults(
                TaskProfile.model_validate(row["task_profile"]),
                combined["creation_defaults"],
                combined["hidden_axis_values"],
            )
            policy_fields = {
                "creation_defaults",
                "require_chosen_axes",
                "hidden_axis_values",
                "allow_spanless_findings",
                "require_spanless_note",
                "contiguous_mentions_only",
            }
            if any(
                name in fields and fields[name] != row[name] for name in policy_fields
            ):
                fields["annotation_policy_revision"] = (
                    row["annotation_policy_revision"] + 1
                )
            if fields:
                conn.execute(
                    update(ProjectRow)
                    .where(ProjectRow.id == row["id"])
                    .values(**fields, updated_at=datetime.now(UTC))
                )
                record_audit(
                    conn,
                    actor,
                    "project.update",
                    target_type="project",
                    target_id=key,
                    project_id=row["id"],
                    details={
                        "fields": sorted(
                            name
                            for name in fields
                            if name != "annotation_policy_revision"
                        ),
                        "annotation_policy_revision": fields.get(
                            "annotation_policy_revision",
                            row["annotation_policy_revision"],
                        ),
                    },
                )
            return self.settings(key)

    def _validate_pins(
        self, conn: Connection, profile: TaskProfile, pins: Mapping[str, Pin]
    ) -> None:
        check_t1_profile(profile, pins)
        if set(pins) != {ont.ontology_id for ont in profile.ontologies}:
            raise DomainError(
                "PIN_MISMATCH", "Pin every profile ontology, and no others."
            )
        for ontology in profile.ontologies:
            pin = pins[ontology.ontology_id]
            stored = (
                conn.execute(
                    select(OntologyFileRow).where(OntologyFileRow.sha256 == pin.sha256)
                )
                .mappings()
                .one_or_none()
            )
            if (
                stored is None
                or stored["kind"] != "ontology"
                or pin.sha256 != ontology.sha256
                or stored["release"] != ontology.release
            ):
                raise DomainError("PIN_MISMATCH", {"ontology_id": ontology.ontology_id})

    def _release_services(
        self, conn: Connection, project_id: int, pins: Mapping[str, Pin]
    ) -> dict[str, OntologyService]:
        """The new release of every pin whose digest differs from the stored one."""
        old = self.repo._pins(conn, project_id)
        services: dict[str, OntologyService] = {}
        for ontology_id, pin in sorted(pins.items()):
            current = old.get(ontology_id)
            if current is None or current.sha256 == pin.sha256:
                continue
            service = self.store.service(pin.sha256)
            if service is None:
                raise DomainError("PIN_MISMATCH", {"ontology_id": ontology_id})
            services[ontology_id] = service
        return services

    def _repin_report(
        self,
        conn: Connection,
        row: Any,
        pins: Mapping[str, Pin],
        services: Mapping[str, OntologyService],
    ) -> RepinReport:
        old = self.repo._pins(conn, row["id"])
        digests = {pin.sha256 for pin in old.values()} | {
            pin.sha256 for pin in pins.values()
        }
        releases = dict(
            conn.execute(
                select(OntologyFileRow.sha256, OntologyFileRow.release).where(
                    OntologyFileRow.sha256.in_(sorted(digests))
                )
            )
            .tuples()
            .all()
        )
        return build_report(
            conn,
            project_key=row["project_key"],
            project_id=row["id"],
            locked=self._locked(conn, row["id"]),
            profile=TaskProfile.model_validate(row["task_profile"]),
            old_pins=old,
            new_pins=pins,
            releases={sha: release or "" for sha, release in releases.items()},
            services=services,
        )

    @staticmethod
    def _check_locked_repin(old: Mapping[str, Pin], pins: Mapping[str, Pin]) -> None:
        """After the first submission only the release of a pin may change."""
        for ontology_id, pin in pins.items():
            current = old.get(ontology_id)
            if current is None or (
                tuple(current.allowed_roots) != tuple(pin.allowed_roots)
                or current.t1_profile != pin.t1_profile
            ):
                raise DomainError(
                    "PROJECT_IN_USE",
                    "After the first submission only the ontology release can change.",
                )

    def preview_pins(
        self, actor: Actor, key: str, pins: Mapping[str, Pin]
    ) -> RepinReport:
        """The dry run of :meth:`apply_pins`: what the new releases do to drafts."""
        check_allowed_roots(self.store, pins)
        self._load_releases(pins)
        with self.db.transaction() as conn:
            row = self._project(conn, key)
            require_project_management(
                conn, actor, key, row["id"], Action.MANAGE_PROJECT_SETTINGS
            )
            profile = TaskProfile.model_validate(row["task_profile"])
            if set(pins) != {ont.ontology_id for ont in profile.ontologies}:
                raise DomainError(
                    "PIN_MISMATCH", "Pin every profile ontology, and no others."
                )
            check_t1_profile(profile, pins)
            if self._locked(conn, row["id"]):
                self._check_locked_repin(self.repo._pins(conn, row["id"]), pins)
            services = self._release_services(conn, row["id"], pins)
            return self._repin_report(conn, row, pins, services)

    def apply_pins(
        self, actor: Actor, key: str, pins: Mapping[str, Pin], report_sha256: str
    ) -> ProjectSettings:
        """Move the project to ``pins``, also once work has been submitted (#81).

        ``report_sha256`` is the digest of the report :meth:`preview_pins`
        gave; when the drafts or pins changed since, the move is refused
        (``REPIN_REPORT_STALE``) and the lead looks at the new report.
        """
        self._load_releases(pins)
        return self._structure(actor, key, pins=pins, repin_report=report_sha256)

    def _load_releases(self, pins: Mapping[str, Pin]) -> None:
        """Parse the chosen releases before any lock is taken (it can take seconds)."""
        for pin in pins.values():
            self.store.service(pin.sha256)

    def _structure(
        self,
        actor: Actor,
        key: str,
        *,
        profile: TaskProfile | None = None,
        pins: Mapping[str, Pin] | None = None,
        repin_report: str | None = None,
    ) -> ProjectSettings:
        if pins is not None:
            check_allowed_roots(self.store, pins)
        with self.db.transaction() as conn:
            # Existing imports take global import first, then this project lock.
            conn.execute(
                select(func.pg_advisory_xact_lock_shared(_lock_id("members", key)))
            )
            conn.execute(select(func.pg_advisory_xact_lock(_lock_id("project", key))))
            row = self._project(conn, key)
            require_project_management(
                conn, actor, key, row["id"], Action.MANAGE_PROJECT_SETTINGS
            )
            old_pins = self.repo._pins(conn, row["id"])
            report: RepinReport | None = None
            release_services: dict[str, OntologyService] = {}
            if repin_report is not None and pins is not None:
                if self._locked(conn, row["id"]):
                    self._check_locked_repin(old_pins, pins)
                release_services = self._release_services(conn, row["id"], pins)
                report = self._repin_report(conn, row, pins, release_services)
                if report.report_sha256 != repin_report:
                    raise DomainError(
                        "REPIN_REPORT_STALE",
                        {
                            "message": "The drafts or pins changed since the report.",
                            "report_sha256": report.report_sha256,
                        },
                    )
            elif self._locked(conn, row["id"]):
                raise DomainError(
                    "PROJECT_IN_USE",
                    "Pins and profile cannot change after the first submission.",
                )
            selected_profile = profile or TaskProfile.model_validate(
                row["task_profile"]
            )
            selected_pins = (
                pins if pins is not None else self.repo._pins(conn, row["id"])
            )
            if profile is not None:
                selected_pins = _spelled_as(selected_pins, profile)
            # Pins re-spelled to the profile's ontology ids keep their history.
            earlier_id = {oid.casefold(): oid for oid in old_pins}
            if pins is not None:
                definitions = []
                for definition in selected_profile.ontologies:
                    pin = pins.get(definition.ontology_id)
                    stored = (
                        None
                        if pin is None
                        else conn.execute(
                            select(OntologyFileRow.release, OntologyFileRow.kind).where(
                                OntologyFileRow.sha256 == pin.sha256
                            )
                        ).one_or_none()
                    )
                    if pin is None or stored is None or stored.kind != "ontology":
                        raise DomainError(
                            "PIN_MISMATCH", {"ontology_id": definition.ontology_id}
                        )
                    definitions.append(
                        definition.model_copy(
                            update={
                                "sha256": pin.sha256,
                                "release": stored.release or "",
                                "resource_path": None,
                            }
                        )
                    )
                selected_profile = selected_profile.model_copy(
                    update={"ontologies": definitions}
                )
            self._validate_pins(conn, selected_profile, selected_pins)
            validate_hidden_values(
                selected_profile, selected_pins, row["hidden_axis_values"]
            )
            # Presets the new structure no longer allows are dropped (U5), not refused.
            creation_defaults = prune_creation_defaults(
                selected_profile, row["creation_defaults"], row["hidden_axis_values"]
            )
            validate_creation_defaults(
                selected_profile, creation_defaults, row["hidden_axis_values"]
            )
            manifest = PackageManifest.model_validate(row["manifest"]).model_copy(
                update={
                    "task_profile": selected_profile,
                    "task_profile_sha256": profile_hash(selected_profile),
                    "search_conditions": None,
                }
            )
            conn.execute(
                update(ProjectRow)
                .where(ProjectRow.id == row["id"])
                .values(
                    task_profile=selected_profile.model_dump(mode="json"),
                    task_profile_sha256=profile_hash(selected_profile),
                    manifest=manifest.model_dump(mode="json"),
                    manifest_sha256=canonical_hash(manifest.model_dump()),
                    creation_defaults=creation_defaults,
                    annotation_policy_revision=row["annotation_policy_revision"] + 1,
                    updated_at=datetime.now(UTC),
                )
            )
            superseded = dict(
                conn.execute(
                    select(
                        ProjectOntologyRow.ontology_id,
                        ProjectOntologyRow.superseded_sha256,
                    ).where(ProjectOntologyRow.project_id == row["id"])
                )
                .tuples()
                .all()
            )
            conn.execute(
                delete(ProjectOntologyRow).where(
                    ProjectOntologyRow.project_id == row["id"]
                )
            )
            if selected_pins:
                conn.execute(
                    insert(ProjectOntologyRow),
                    [
                        {
                            "project_id": row["id"],
                            "ontology_id": oid,
                            "sha256": pin.sha256,
                            "allowed_roots": list(pin.allowed_roots),
                            "t1_profile": pin.t1_profile,
                            "superseded_sha256": _superseded(
                                list(
                                    superseded.get(earlier_id.get(oid.casefold(), oid))
                                    or []
                                ),
                                old_pins.get(earlier_id.get(oid.casefold(), oid)),
                                pin.sha256,
                            ),
                        }
                        for oid, pin in selected_pins.items()
                    ],
                )
            if report is not None:
                self._rewrite_drafts(
                    conn, key, row["id"], selected_profile, release_services
                )
                record_audit(
                    conn,
                    actor,
                    "project.repin",
                    target_type="project",
                    target_id=key,
                    project_id=row["id"],
                    details={
                        "report_sha256": report.report_sha256,
                        "locked": report.locked,
                        "changes": [c.model_dump() for c in report.changes],
                        "rewrites": [r.model_dump() for r in report.rewrites],
                        "flagged": len(report.flagged),
                        "submitted": [s.model_dump() for s in report.submitted],
                    },
                )
            # The new structure is searched with conditions its first use
            # captures. The ended ones stay in the audit entry below, and their
            # captured files among the project's resources: search events
            # that ran with them still name them (#254).
            ended_conditions = conn.execute(
                delete(ProjectSearchConditionsRow)
                .where(ProjectSearchConditionsRow.project_id == row["id"])
                .returning(ProjectSearchConditionsRow.conditions)
            ).scalar_one_or_none()
            record_audit(
                conn,
                actor,
                "project.update",
                target_type="project",
                target_id=key,
                project_id=row["id"],
                details={
                    "fields": ["profile" if profile is not None else "pins"]
                    + (
                        ["creation_defaults"]
                        if creation_defaults != row["creation_defaults"]
                        else []
                    ),
                    **({SUPERSEDED: ended_conditions} if ended_conditions else {}),
                },
            )
            return self.settings(key)

    def _rewrite_drafts(
        self,
        conn: Connection,
        key: str,
        project_id: int,
        profile: TaskProfile,
        services: Mapping[str, OntologyService],
    ) -> None:
        """Rewrite the open-draft terms the new releases move (see ``projects.repin``)."""
        if not services:
            return
        ontology_of_layer = {
            layer.layer_id: layer.ontology_id for layer in profile.layers
        }
        drafts = conn.execute(
            select(DraftRow.draft_key, DraftRow.document_id)
            .where(DraftRow.project_id == project_id, open_draft(project_id))
            .order_by(DraftRow.draft_key)
        ).all()
        target = {oid: service.ref.sha256 for oid, service in services.items()}
        documents: dict[str, Document | None] = {}
        for draft_key, document_id in drafts:
            if document_id not in documents:
                documents[document_id] = self.repo.get_document(key, document_id)
            document = documents[document_id]
            if document is None:
                continue
            self._rewrite_draft(
                conn,
                project_id,
                draft_key,
                document,
                profile,
                ontology_of_layer,
                services,
                target,
            )

    def _rewrite_draft(
        self,
        conn: Connection,
        project_id: int,
        draft_key: str,
        document: Document,
        profile: TaskProfile,
        ontology_of_layer: Mapping[str, str],
        services: Mapping[str, OntologyService],
        target: Mapping[str, str],
    ) -> None:
        changes: list[dict[str, str]] = []

        def operation(draft: Draft) -> Draft | None:
            result, found = rewrite_draft(
                draft, document, profile, ontology_of_layer, services
            )
            changes.extend(found)
            return result

        def command() -> dict[str, Any]:
            return {
                "command": "move_to_release",
                "pins": dict(target),
                "rewrites": changes,
            }

        self.repo._rewrite_draft_in(
            conn,
            project_id,
            draft_key,
            operation,
            command,
            "release-" + canonical_hash({"draft": draft_key, "pins": dict(target)}),
        )

    def update_pins(
        self, actor: Actor, key: str, pins: Mapping[str, Pin]
    ) -> ProjectSettings:
        return self._structure(actor, key, pins=pins)

    def update_profile(
        self, actor: Actor, key: str, profile: TaskProfile
    ) -> ProjectSettings:
        return self._structure(actor, key, profile=profile)
