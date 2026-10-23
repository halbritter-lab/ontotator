"""Worker for an immutable, explicitly acknowledged final-result snapshot."""

import hashlib
import io
import json
import zipfile
from dataclasses import replace
from typing import Any

import ontospan
from sqlalchemy import select

from ontocurator.application.workflow_warnings import state_digest
from ontocurator.authz.scoped import ScopedRepository
from ontocurator.domain.errors import DomainError
from ontocurator.exchange.final_content import thaw_content
from ontocurator.exchange.final_export_guide import guide_files
from ontocurator.exchange.proposal_checks import proposal_check_records
from ontocurator.jobs.queue import Job, JobContext
from ontocurator.storage.final_tables import ExportSelectionSnapshotRow


def final_t1_export(job: Job, ctx: JobContext) -> dict[str, Any]:
    from ontocurator.exchange.jobs import (
        _audit,
        draft_input_ref,
        requester,
        serialize_t1_content,
        store_file,
    )

    if set(job.payload) != {"project", "snapshot_id", "snapshot_sha256"}:
        raise DomainError("INVALID_EXPORT_SNAPSHOT")
    project = job.payload["project"]
    actor, access = requester(ctx.db, job)
    with ctx.db.transaction() as conn:
        row = (
            conn.execute(
                select(ExportSelectionSnapshotRow).where(
                    ExportSelectionSnapshotRow.snapshot_id
                    == job.payload["snapshot_id"],
                    ExportSelectionSnapshotRow.project_id == job.project_id,
                    ExportSelectionSnapshotRow.requester_id == actor.user_id,
                )
            )
            .mappings()
            .first()
        )
        if (
            row is None
            or row["sha256"] != job.payload["snapshot_sha256"]
            or state_digest(row["payload"]) != row["sha256"]
        ):
            raise DomainError("INVALID_EXPORT_SNAPSHOT")
        payload = row["payload"]
        if payload["project"] != project:
            raise DomainError("INVALID_EXPORT_SNAPSHOT")
        requested = [item["submission_id"] for item in payload["immutable_submissions"]]
        current = ScopedRepository(ctx.db, access, actor).t1_export_content_exact(
            project, requested
        )
        found = {
            sub.submission_id: state_digest(sub.model_dump(mode="json"))
            for sub in current.submissions
        }
        if any(
            found.get(item["submission_id"]) != item["sha256"]
            for item in payload["immutable_submissions"]
        ):
            raise DomainError(
                "INVALID_EXPORT_SNAPSHOT",
                "An immutable input is unavailable or changed.",
            )
        content = thaw_content(payload["content"])
        for key, entry in content.documents.items():
            live = current.documents.get(key)
            if live is None or live.document != entry.document:
                raise DomainError(
                    "INVALID_EXPORT_SNAPSHOT",
                    "An immutable source text is unavailable or changed.",
                )
        for proposal_key, snap in content.proposals.items():
            if current.proposals.get(proposal_key) != snap:
                raise DomainError(
                    "INVALID_EXPORT_SNAPSHOT",
                    "An immutable source finding is unavailable or changed.",
                )
        proposal_checks = proposal_check_records(
            conn, job.project_id, project, content.submissions
        )
    selected_ids = set(payload["selected_submission_ids"])
    overrides: dict[str, str] = {}
    input_receipt = []
    for entries in payload["round_inputs"].values():
        for entry in entries:
            source_id = entry["source_submission_id"]
            # An input of a frozen draft (kind ``text_change``) names the draft
            # snapshot instead of a source submission; the draft is in no bundle.
            source: dict[str, Any]
            if source_id is None:
                external = draft_input_ref(project, entry)
                source = {"source_draft_snapshot_id": entry["source_draft_snapshot_id"]}
            else:
                bundle_kind = "selected" if source_id in selected_ids else "provenance"
                external = ontospan.annotation_ref(
                    f"submission-{source_id}",
                    entry["source_ref"]["annotation_id"],
                    bundle_id=f"{bundle_kind}-{row['snapshot_id']}",
                )
                source = {"source_submission_id": source_id}
            overrides[f"input-{entry['input_id']}"] = external
            overrides[f"round-input:{entry['input_id']}"] = external
            input_receipt.append(
                {
                    "input_id": entry["input_id"],
                    "input_alias": f"input-{entry['input_id']}",
                    **source,
                    "source_ref": entry["source_ref"],
                    "exported_ref": external,
                }
            )
    selected_content = replace(
        content,
        submissions=[
            sub for sub in content.submissions if sub.submission_id in selected_ids
        ],
    )
    result = serialize_t1_content(
        ctx.db,
        actor,
        project,
        selected_content,
        job.id,
        final_snapshot_id=row["snapshot_id"],
        source_ref_overrides=overrides,
        round_kinds=payload["round_kinds"],
    )
    selected = ctx.db.blobs.path(result["sha256"]).read_bytes()
    sources = b"".join(
        (json.dumps(entry, sort_keys=True, ensure_ascii=False) + "\n").encode()
        for entry in payload["content"]["documents"].values()
    )
    files = {"selected.t1.zip": selected, "source-texts.jsonl": sources}
    closure = [
        sub for sub in content.submissions if sub.submission_id not in selected_ids
    ]
    if closure:
        provenance = serialize_t1_content(
            ctx.db,
            actor,
            project,
            replace(content, submissions=closure),
            job.id,
            final_snapshot_id=row["snapshot_id"],
            final_bundle_kind="provenance",
            source_ref_overrides=overrides,
            round_kinds=payload["round_kinds"],
        )
        files["provenance.t1.zip"] = ctx.db.blobs.path(
            provenance["sha256"]
        ).read_bytes()
    files.update(
        guide_files(
            payload,
            snapshot_id=row["snapshot_id"],
            snapshot_sha256=row["sha256"],
            snapshot_created_at=row["created_at"],
        )
    )
    receipt = {
        "format": "ontocurator-final-export/v1",
        "snapshot_id": row["snapshot_id"],
        "snapshot_sha256": row["sha256"],
        "selections": payload["state"]["selections"],
        "warnings": payload["state"]["warnings"],
        "omissions": payload["state"]["omissions"],
        "human_inputs": input_receipt,
        "source_reviews": payload["content"].get("source_reviews", []),
        "review_decisions": {
            sub.submission_id: [
                decision.model_dump(mode="json") for decision in sub.decisions
            ]
            for sub in content.submissions
        },
        "provenance_only_submission_ids": [sub.submission_id for sub in closure],
        # Additive; left out without proposal checks so older exports stay identical.
        **({"proposal_checks": proposal_checks} if proposal_checks else {}),
        "files": {
            name: hashlib.sha256(data).hexdigest() for name, data in files.items()
        },
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
        archive.writestr(
            "receipt.json", json.dumps(receipt, sort_keys=True, ensure_ascii=False)
        )
    digest = store_file(ctx.db, output.getvalue())
    result = {
        **result,
        "sha256": digest,
        "snapshot_id": row["snapshot_id"],
        "omissions": receipt["omissions"],
    }
    _audit(
        ctx.db,
        actor,
        "project.final_export",
        project,
        {
            "job_id": job.id,
            "snapshot_id": row["snapshot_id"],
            "artifact_sha256": digest,
        },
    )
    return result
