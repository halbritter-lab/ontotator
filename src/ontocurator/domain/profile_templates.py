"""Consumer-independent starting profiles bound to uploaded ontologies."""

from collections.abc import Callable, Mapping

from ontocurator.domain.axes import AxisDefinition
from ontocurator.domain.profiles import (
    AnnotationTypeDefinition,
    LayerDefinition,
    OntologyDefinition,
    TaskProfile,
)
from ontocurator.ontology.store import OntologyFile


def hpo_phenotype(ontology: OntologyFile) -> TaskProfile:
    """The phenotype profile, using the actual file's immutable identity."""
    return TaskProfile(
        profile_id="hpo-context-example/v1",
        version="1.0.0",
        ontologies=[
            OntologyDefinition(
                ontology_id="HP",
                label="Human Phenotype Ontology",
                release=ontology.release or "",
                sha256=ontology.sha256,
            )
        ],
        layers=[
            LayerDefinition(
                layer_id="hpo-layer",
                label="Phenotypes",
                ontology_id="HP",
                access="editable",
                default_type_id="phenotype",
                annotation_types=[
                    AnnotationTypeDefinition(
                        type_id="phenotype",
                        label="Phenotype",
                        axes=[
                            AxisDefinition(
                                id="assertion",
                                label="Assertion",
                                options=["present", "absent", "uncertain"],
                            ),
                            AxisDefinition(
                                id="experiencer",
                                label="Experiencer",
                                options=["patient", "other"],
                            ),
                            AxisDefinition(
                                id="temporality",
                                label="Temporality",
                                options=["current", "historical"],
                            ),
                        ],
                    )
                ],
            )
        ],
        default_layer_id="hpo-layer",
        preset="hpo-context-example",
    )


PROFILE_TEMPLATES: Mapping[str, Callable[[OntologyFile], TaskProfile]] = {
    "hpo-phenotype": hpo_phenotype,
}
