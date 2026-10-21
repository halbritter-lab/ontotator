"""Immutable final-export input encoding; workers never reselect latest work."""

from dataclasses import asdict
from typing import Any

from ontocurator.domain.annotations import AnnotationSnapshot
from ontocurator.domain.documents import Document
from ontocurator.domain.errors import DomainError
from ontocurator.domain.profiles import TaskProfile
from ontocurator.domain.variants import VariantInfo
from ontocurator.domain.workspace import Submission
from ontocurator.exchange.t1 import ImportedDocument, Pin
from ontocurator.storage.repository import ProjectExport


def freeze_content(
    content: ProjectExport, *, source_reviews: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    refs: set[tuple[str, str]] = set()
    documents = {sub.origin_key.document_id for sub in content.submissions}
    for sub in content.submissions:
        refs.update((d.target.annotation_id, d.target.version) for d in sub.decisions)
        refs.update(
            (r.source_ref.annotation_id, r.source_ref.version)
            for r in sub.reanchor_inputs
        )
        for snap in sub.snapshots:
            for ref in snap.annotation.provenance.source_refs:
                source, _, version = ref.rpartition(":")
                if (source, version) in content.proposals:
                    refs.add((source, version))
    pending = list(refs)
    while pending:
        identity = pending.pop()
        source_snapshot = content.proposals.get(identity)
        if source_snapshot is None:
            continue  # mandatory inputs are checked by the mapper/round resolver
        documents.add(source_snapshot.annotation.document_id)
        for ref in source_snapshot.annotation.provenance.source_refs:
            source, _, version = ref.rpartition(":")
            pair = (source, version)
            if pair in content.proposals and pair not in refs:
                refs.add(pair)
                pending.append(pair)
    included_reviews: dict[str, dict[str, Any]] = {}
    while True:
        before = set(documents)
        documents.update(
            entry.variant.derived_from
            for identity, entry in content.documents.items()
            if identity in documents and entry.variant and entry.variant.derived_from
        )
        for resolution in source_reviews or []:
            review = resolution["payload"]
            cause = review["cause"]
            if (
                cause["document_id"] not in documents
                and review.get("created_variant_id") not in documents
            ):
                continue
            included_reviews[resolution["cause_id"]] = resolution
            documents.update(
                (
                    cause["document_id"],
                    cause["old_source_document_id"],
                    cause["new_source_document_id"],
                )
            )
            if review.get("created_variant_id"):
                documents.add(review["created_variant_id"])
        if documents == before:
            break
    if documents - content.documents.keys():
        raise DomainError(
            "INVALID_EXPORT_SNAPSHOT", "A reviewed source text is unavailable."
        )
    return {
        "source_reviews": [included_reviews[key] for key in sorted(included_reviews)],
        "profile": content.profile.model_dump(mode="json"),
        "pins": {key: asdict(pin) for key, pin in content.pins.items()},
        "documents": {
            key: {
                "document": entry.document.model_dump(mode="json"),
                "source_text_sha256": entry.source_text_sha256,
                "variant": asdict(entry.variant) if entry.variant else None,
            }
            for key, entry in content.documents.items()
            if key in documents
        },
        "submissions": [sub.model_dump(mode="json") for sub in content.submissions],
        "proposals": [
            {
                "id": key[0],
                "version": key[1],
                "snapshot": snap.model_dump(mode="json"),
                "notes": content.proposal_notes.get(key, []),
            }
            for key, snap in sorted(content.proposals.items())
            if key in refs
        ],
        "contributors": content.contributors,
        # References only, never guideline texts (G20).
        "guideline_refs": content.guideline_refs,
        "guideline_versions": content.guideline_versions,
    }


def thaw_content(payload: dict[str, Any]) -> ProjectExport:
    return ProjectExport(
        profile=TaskProfile.model_validate(payload["profile"]),
        pins={key: Pin(**pin) for key, pin in payload["pins"].items()},
        documents={
            key: ImportedDocument(
                Document.model_validate(entry["document"]),
                entry["source_text_sha256"],
                VariantInfo(**entry["variant"]) if entry["variant"] else None,
            )
            for key, entry in payload["documents"].items()
        },
        submissions=[Submission.model_validate(sub) for sub in payload["submissions"]],
        proposals={
            (entry["id"], entry["version"]): AnnotationSnapshot.model_validate(
                entry["snapshot"]
            )
            for entry in payload["proposals"]
        },
        proposal_notes={
            (entry["id"], entry["version"]): entry["notes"]
            for entry in payload["proposals"]
        },
        contributors=[tuple(entry) for entry in payload["contributors"]],
        guideline_refs=payload["guideline_refs"],
        guideline_versions=payload["guideline_versions"],
    )
