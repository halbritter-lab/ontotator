"""The invented texts of a practice project (issue 266).

Every text, age and finding is invented; no text describes a real patient.
The bundle is built like ``scripts/make_demo_bundle.py`` builds the demo
bundle: one T1 unit per text, tool proposals only on the text of the task
"from proposals". Its proposals are made to practise each decision: one is
right, one has a defaulted value, one has the wrong term (Edit & Replace), and
one obvious finding ("Die Muskeleigenreflexe fehlen", Areflexia) is left out.

The terms are generic HPO terms: practice is offered only when the server's
HPO release has every one of them, current (not obsolete) and below the
phenotype root.
"""

from __future__ import annotations

import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import ontospan

from ontotator.domain.profiles import TaskProfile
from ontotator.exchange.t1 import Pin, layers_for

PracticeKind = Literal["scratch", "proposals", "translation_review", "consolidation"]

CREATED = datetime(2026, 11, 1, 9, tzinfo=UTC)
ROOT = "HP:0000118"
SEIZURE = "HP:0001250"
STATUS_EPILEPTICUS = "HP:0002133"
HYPOTONIA = "HP:0001252"
AREFLEXIA = "HP:0001284"
HEARING_IMPAIRMENT = "HP:0000365"
SENSORINEURAL = "HP:0000407"
# Every term the texts, proposals and the colleagues' findings use.
TERMS = (
    SEIZURE,
    STATUS_EPILEPTICUS,
    HYPOTONIA,
    AREFLEXIA,
    HEARING_IMPAIRMENT,
    SENSORINEURAL,
)
LANGUAGES = ["de", "en"]
TOOL = {
    "actor_id": "practice-tagger",
    "kind": "tool",
    "name": "Practice phenotype tagger",
    "version": "1.0.0",
    "model": "synthetic-rules",
    "run_id": "practice-1",
}
NOTE = "Invented practice proposal, not a clinical prediction."

SCRATCH_TEXT = (
    "Neurologischer Konsilbrief (erfunden)\n\n"
    "Herr B., 34 Jahre, stellt sich nach einem ersten Krampfanfall vor zwei "
    "Wochen vor. Ein Status epilepticus trat nicht auf. Seit Jahren besteht "
    "eine Schwerhörigkeit auf dem linken Ohr.\n\n"
    "Erfundener Übungstext. Kein echter Patient.\n"
)
PROPOSALS_TEXT = (
    "Kinderneurologischer Arztbrief (erfunden)\n\n"
    "Ein 6-jähriges Mädchen wird zur Abklärung vorgestellt. Seit dem Winter "
    "hatte sie drei Krampfanfälle. Bei der Untersuchung fiel eine "
    "Muskelhypotonie auf. Der Hörtest zeigte eine Innenohrschwerhörigkeit "
    "beidseits. Die Muskeleigenreflexe fehlen an beiden Beinen.\n\n"
    "Erfundener Übungstext. Kein echter Patient.\n"
)
SOURCE_TEXT = (
    "Short discharge note (invented)\n\n"
    "A 52-year-old woman was admitted after a seizure at home. On examination "
    "there was mild hypotonia of the arms. Her hearing was normal.\n\n"
    "Invented practice text. No real patient.\n"
)
# The machine translation has one clinically relevant error: "Beine" (legs)
# for "arms". The reviewer corrects it to "Arme".
TRANSLATION_TEXT = (
    "Kurzer Entlassungsbrief (erfunden)\n\n"
    "Eine 52-jährige Frau wurde nach einem Krampfanfall zu Hause aufgenommen. "
    "Bei der Untersuchung zeigte sich eine leichte Hypotonie der Beine. Ihr "
    "Hörvermögen war normal.\n\n"
    "Erfundener Übungstext. Kein echter Patient.\n"
)
CONSOLIDATION_TEXT = (
    "Ambulanzbrief (erfunden)\n\n"
    "Ein 8-jähriger Junge hatte im letzten Monat zwei Krampfanfälle. Es "
    "besteht eine Muskelhypotonie. Die Reflexe fehlen.\n\n"
    "Erfundener Übungstext. Kein echter Patient.\n"
)

_AXES = {"assertion": "present", "experiencer": "patient", "temporality": "current"}
# (quote, term, axis values, defaulted axes)
PROPOSALS: list[tuple[str, str, dict[str, str], tuple[str, ...]]] = [
    ("drei Krampfanfälle", SEIZURE, _AXES, ()),
    ("Muskelhypotonie", HYPOTONIA, _AXES, ("temporality",)),
    ("Innenohrschwerhörigkeit", HEARING_IMPAIRMENT, _AXES, ()),
]
# The two virtual colleagues of the consolidation task: (quote, term, axes).
COLLEAGUE_FINDINGS: list[list[tuple[str, str, dict[str, str]]]] = [
    [
        ("Krampfanfälle", SEIZURE, _AXES),
        ("Muskelhypotonie", HYPOTONIA, _AXES),
        ("Reflexe fehlen", AREFLEXIA, _AXES),
    ],
    [
        ("Krampfanfälle", SEIZURE, _AXES),
        ("Muskelhypotonie", HYPOTONIA, {**_AXES, "assertion": "absent"}),
    ],
]
COLLEAGUES = ("Virtual colleague A", "Virtual colleague B")


@dataclass(frozen=True)
class PracticeText:
    case_id: str
    language: str
    text: str
    kind: PracticeKind | None
    translation_of: str | None = None
    proposals: bool = False


def texts(consolidation: bool) -> list[PracticeText]:
    """The texts in import order; the consolidation text only when wanted."""
    result = [
        PracticeText("PRACTICE-1", "de", SCRATCH_TEXT, "scratch"),
        PracticeText("PRACTICE-2", "de", PROPOSALS_TEXT, "proposals", proposals=True),
        PracticeText("PRACTICE-3", "en", SOURCE_TEXT, None),
        PracticeText("PRACTICE-3", "de", TRANSLATION_TEXT, "translation_review", "en"),
    ]
    if consolidation:
        result.append(
            PracticeText("PRACTICE-4", "de", CONSOLIDATION_TEXT, "consolidation")
        )
    return result


def span(text: str, quote: str) -> dict[str, Any]:
    start = text.index(quote)
    return {"start": start, "end": start + len(quote), "text": quote}


def _proposal(index: int, text: str, item: tuple[Any, ...]) -> dict[str, Any]:
    quote, term, axes, defaulted = item
    return {
        "annotation_id": f"p{index:02d}",
        "layer_id": "hpo-layer",
        "term_id": term,
        "axes": {
            axis: {
                "value": value,
                "basis": "defaulted" if axis in defaulted else "chosen",
            }
            for axis, value in axes.items()
        },
        "mentions": [{"segments": [span(text, quote)], "cue_segments": []}],
        "provenance": {
            "actor": {"actor_id": TOOL["actor_id"], "kind": "tool"},
            "method": "tool",
            "source_refs": [],
            "notes": [NOTE],
        },
    }


def bundle_bytes(profile: TaskProfile, pin: Pin, consolidation: bool) -> bytes:
    """The practice bundle (ZIP) for a project with this profile and pin."""
    layers = [
        layer.model_dump(mode="json") for layer in layers_for(profile, {"HP": pin})
    ]
    shas: dict[tuple[str, str], str] = {}
    units = []
    for item in texts(consolidation):
        document_id = f"{item.case_id}-{item.language}"
        document = ontospan.make_document(
            document_id, item.language, item.text
        ).model_dump(mode="json")
        document["case_id"] = item.case_id
        shas[(item.case_id, item.language)] = document["text_sha256"]
        if item.translation_of is not None:
            document["variant"] = {
                "version": 1,
                "origin": "machine_translation",
                "derived_from": shas[(item.case_id, item.translation_of)],
            }
            document["translation"] = {
                "provider": "practice-translator",
                "model": "synthetic-rules",
                "run_id": "practice-1",
                "checks": [],
            }
        units.append(
            ontospan.AnnotatedDocument.model_validate(
                {
                    "document": document,
                    "annotation_set": {
                        "annotation_set_id": f"practice-{document_id}",
                        "set_kind": "tool_output",
                        "actors": [TOOL],
                        "created_at": CREATED.isoformat(),
                        "layers": layers,
                        "annotations": [
                            _proposal(index, item.text, proposal)
                            for index, proposal in enumerate(
                                PROPOSALS if item.proposals else [], start=1
                            )
                        ],
                    },
                }
            )
        )
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "practice.zip"
        ontospan.write_bundle(
            path, units, bundle_id="ontotator-practice-v1", created_at=CREATED
        )
        return path.read_bytes()
