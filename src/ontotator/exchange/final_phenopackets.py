"""Phenopackets derived from a final-result snapshot (#308).

The same frozen snapshot as the final T1 export, converted with
``ontospan.phenopacket``: derived and lossy. Each text gets one Phenopacket
v2; ontospan's report of what it left out goes next to it and into a
summary. Ontotator adds no mapping of its own. Its one addition: findings
the consolidator left unresolved carry a reviewer resolution, which
Phenopackets cannot hold (ontospan refuses the whole text), so they are left
out before the conversion and counted as ``left_out_unresolved``.
"""

import hashlib
import io
import json
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, fields
from datetime import datetime
from typing import Any

import ontospan
from ontospan.profiles import hpo

from ontotator.exchange.final_export import load_frozen_final
from ontotator.exchange.final_export_guide import _heading, _utc, _wrap
from ontotator.jobs.queue import Job, JobContext, StructuredJobError

FINAL_PHENOPACKET_FORMAT = "ontotator-final-phenopackets/v1"
ONTOSPAN_COUNTERS = tuple(item.name for item in fields(ontospan.ExportReport))


def packet_entry(index: int) -> str:
    return f"phenopackets/{index:05d}.json"


def report_entry(index: int) -> str:
    return f"reports/{index:05d}.json"


@dataclass(frozen=True)
class Packet:
    """One text's Phenopacket and what the conversion left out."""

    document_id: str
    packet: dict[str, Any]
    report: ontospan.ExportReport
    left_out_unresolved: int


def _hpo_view(
    unit: ontospan.AnnotatedDocument, views: Mapping[str, ontospan.OntologyView]
) -> ontospan.OntologyView:
    """The view of the unit's first hpo-phenotype layer (else any layer's).

    A unit without such a layer exports no features; the view then only
    names labels that are never asked for.
    """
    for layer in unit.annotation_set.layers:
        if layer.profile == hpo.NAME:
            return views[layer.ontology.id]
    return next(iter(views.values()))


def to_packets(
    units: Sequence[ontospan.AnnotatedDocument],
    views: Sequence[Mapping[str, ontospan.OntologyView]],
    *,
    bundle_id: str,
    created_at: datetime,
) -> list[Packet]:
    """One Phenopacket per unit; its id and subject id are the document id.

    Texts are not grouped by patient: Ontotator has no patient identity, so
    every text is a subject of its own.
    """
    packets = []
    for unit, unit_views in zip(units, views, strict=True):
        annotations = unit.annotation_set.annotations
        kept = tuple(a for a in annotations if a.review_resolution is None)
        document = unit.document.model_copy(
            update={"subject_id": unit.document.document_id}
        )
        convertible = unit.model_copy(
            update={
                "document": document,
                "annotation_set": unit.annotation_set.model_copy(
                    update={"annotations": kept}
                ),
            }
        )
        try:
            packet, report = ontospan.to_phenopacket(
                convertible,
                _hpo_view(unit, unit_views),
                bundle_id=bundle_id,
                created_at=created_at,
            )
        except ValueError as exc:
            # For example two HPO releases in one text.
            raise StructuredJobError(
                "PHENOPACKET_UNREPRESENTABLE",
                {"document_id": document.document_id, "reason": str(exc)},
            ) from exc
        packets.append(
            Packet(
                document_id=document.document_id,
                packet=packet,
                report=report,
                left_out_unresolved=len(annotations) - len(kept),
            )
        )
    return packets


def _dump(data: Any) -> bytes:
    return (
        json.dumps(data, sort_keys=True, ensure_ascii=False, indent=2) + "\n"
    ).encode()


def _readme(
    payload: Mapping[str, Any],
    *,
    snapshot_id: str,
    snapshot_sha256: str,
    snapshot_created_at: datetime,
    bundle_id: str,
    totals: Mapping[str, int],
) -> bytes:
    key = payload["project"]
    name = payload.get("project_name") or key
    state = payload["state"]
    out: list[str] = [*_heading("Ontotator Phenopacket export", "="), ""]
    out += [
        f"Project:          {name if name == key else f'{name} ({key})'}",
        f"Snapshot ID:      {snapshot_id}",
        f"Snapshot SHA-256: {snapshot_sha256}",
        f"Snapshot time:    {_utc(snapshot_created_at)}",
        "",
        *_heading("Summary"),
        f"{'Phenopackets (one per text):':<38}{len(state['selections'])}",
        f"{'Findings exported as features:':<38}{totals['exported']}",
        f"{'Findings left out (see report.json):':<38}"
        f"{sum(totals[k] for k in LEFT_OUT)}",
        f"{'Omitted text and language pairs:':<38}{len(state['omissions'])}",
        "",
        *_heading("What is in this archive"),
        "README.txt            This guide.",
        "phenopackets/N.json   One Phenopacket (schema v2, protobuf JSON) per text.",
        "reports/N.json        For the Phenopacket of the same number: what the",
        "                      conversion exported and left out, by category.",
        "report.json           All texts with their counts, and the totals.",
        "receipt.json          The snapshot and the SHA-256 of every other file.",
        "",
        *_heading("How to read it"),
        *_wrap(
            "These files are derived from the final results and lossy. The final "
            "export (T1 bundle) of the same snapshot is the complete record; "
            "Phenopackets are for tools that read phenotypic features.",
            "- ",
            "  ",
        ),
        *_wrap(
            "Every text is one Phenopacket. Its id and subject.id are the text's "
            "document_id. Texts of the same patient are not grouped into one "
            "Phenopacket: Ontotator does not know which texts belong to one "
            "patient.",
            "- ",
            "  ",
        ),
        *_wrap(
            "Only findings of hpo-phenotype layers whose experiencer is the "
            "patient become features. Findings about family members or other "
            "persons, with an unknown experiencer, with assertion uncertain, or "
            "left unresolved in consolidation are left out; findings of other "
            "layers are skipped. reports/ and report.json count each category.",
            "- ",
            "  ",
        ),
        *_wrap(
            'Assertion absent becomes "excluded": true. A historical finding is '
            'exported as a feature, since a Phenopacket cannot say "in the '
            'past"; "historical" counts them. Severity and onset modifiers fill '
            "the fields of the same name; other modifiers, frequency included, "
            "are listed under modifiers.",
            "- ",
            "  ",
        ),
        *_wrap(
            "Each feature's evidence names ECO:0000218 (manual assertion) or, for "
            "a tool finding, ECO:0007636 (automatic assertion), and refers to the "
            f"finding in the final export's bundle {bundle_id} "
            "(selected.t1.zip of the same snapshot).",
            "- ",
            "  ",
        ),
        "",
        *_heading("Omitted"),
    ]
    omissions = sorted(state["omissions"], key=lambda o: (o["case_id"], o["language"]))
    out += [
        line
        for o in omissions
        for line in _wrap(
            f"{o['case_id']} ({o['language']}): no final result was selected. "
            "No other submission was substituted."
        )
    ] or ["None."]
    out += [
        "",
        *_heading("Verify"),
        *_wrap(
            'Compute the SHA-256 of each file and compare it with "files" in '
            "receipt.json. receipt.json itself is not listed there."
        ),
    ]
    return ("\n".join(out) + "\n").encode("utf-8")


# The counters of a report that are findings left out.
LEFT_OUT = (
    "omitted_family",
    "omitted_other_person",
    "omitted_unknown_experiencer",
    "omitted_uncertain",
    "skipped_other_layers",
    "left_out_unresolved",
)


def final_phenopacket_export(job: Job, ctx: JobContext) -> dict[str, Any]:
    """Phenopackets of the selected final results of a frozen snapshot."""
    from ontotator.exchange.jobs import _audit, build_t1_units, store_file

    frozen = load_frozen_final(job, ctx)
    row, payload = frozen.row, frozen.payload
    built = build_t1_units(
        ctx.db,
        frozen.project,
        frozen.selected_content,
        final_snapshot_id=row["snapshot_id"],
        source_ref_overrides=frozen.overrides,
        round_kinds=payload["round_kinds"],
    )
    # Evidence refers to the findings in the final export's selected bundle.
    bundle_id = f"selected-{row['snapshot_id']}"
    packets = to_packets(
        built.units, built.views, bundle_id=bundle_id, created_at=row["created_at"]
    )
    selections = {
        item["submission_id"]: item for item in payload["state"]["selections"]
    }
    files: dict[str, bytes] = {}
    documents = []
    totals = dict.fromkeys((*ONTOSPAN_COUNTERS, "left_out_unresolved"), 0)
    for index, (sub, packet) in enumerate(
        zip(frozen.selected_content.submissions, packets, strict=True)
    ):
        selection = selections[sub.submission_id]
        record = {
            "case_id": selection["case_id"],
            "language": selection["language"],
            "document_id": packet.document_id,
            "submission_id": sub.submission_id,
            "phenopacket_file": packet_entry(index),
            "phenopacket_id": packet.packet["id"],
            "ontospan_report": asdict(packet.report),
            "left_out_unresolved": packet.left_out_unresolved,
        }
        for name, value in record["ontospan_report"].items():
            totals[name] += value
        totals["left_out_unresolved"] += packet.left_out_unresolved
        files[packet_entry(index)] = _dump(packet.packet)
        files[report_entry(index)] = _dump(record)
        documents.append(record)
    files["report.json"] = _dump(
        {
            "format": FINAL_PHENOPACKET_FORMAT,
            "include_uncertain": False,
            "grouped_by_subject": False,
            "totals": totals,
            "documents": documents,
        }
    )
    files["README.txt"] = _readme(
        payload,
        snapshot_id=row["snapshot_id"],
        snapshot_sha256=row["sha256"],
        snapshot_created_at=row["created_at"],
        bundle_id=bundle_id,
        totals=totals,
    )
    receipt = {
        "format": FINAL_PHENOPACKET_FORMAT,
        "snapshot_id": row["snapshot_id"],
        "snapshot_sha256": row["sha256"],
        "selections": payload["state"]["selections"],
        "omissions": payload["state"]["omissions"],
        "files": {
            name: hashlib.sha256(data).hexdigest() for name, data in files.items()
        },
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            archive.writestr(name, data)
        archive.writestr(
            "receipt.json", json.dumps(receipt, sort_keys=True, ensure_ascii=False)
        )
    digest = store_file(ctx.db, output.getvalue())
    result = {
        "sha256": digest,
        "snapshot_id": row["snapshot_id"],
        "phenopackets": len(packets),
        "totals": totals,
        "omissions": receipt["omissions"],
    }
    _audit(
        ctx.db,
        frozen.actor,
        "project.final_phenopacket_export",
        frozen.project,
        {
            "job_id": job.id,
            "snapshot_id": row["snapshot_id"],
            "artifact_sha256": digest,
        },
    )
    return result
