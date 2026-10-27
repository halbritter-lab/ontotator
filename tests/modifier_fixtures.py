"""A separate HPO fixture with the clinical modifier subtree (modifiers plan F0, D-h).

``hp-modifiers.json`` is ``fixtures/hp.json`` plus the modifier terms; the
shared fixtures stay byte-identical. Its subdirectory keeps both files out of
every non-recursive discovery of ``tests/fixtures``.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from t1_fixtures import ADMIN_ACCESS, OPERATOR, hpo_profile

from ontotator.authz.scoped import ScopedRepository
from ontotator.domain.profiles import TaskProfile
from ontotator.exchange.t1 import Pin
from ontotator.ontology.modifiers import install_service_source
from ontotator.ontology.registry import OntologyRegistry
from ontotator.ontology.store import OntologyStore
from ontotator.storage.database import Database

MOD_DIR = Path(__file__).parent / "fixtures" / "modifiers"
MOD_PATH = MOD_DIR / "hp-modifiers.json"
MOD_DE = MOD_DIR / "hp-de.modifiers.babelon.tsv"
MOD_SHA = hashlib.sha256(MOD_PATH.read_bytes()).hexdigest()
MOD_PIN = Pin(sha256=MOD_SHA, allowed_roots=("HP:0000118",), t1_profile="hpo-phenotype")


def modifier_profile() -> TaskProfile:
    """``t1_fixtures.hpo_profile()`` pinned to ``hp-modifiers.json``."""
    profile = hpo_profile()
    return profile.model_copy(
        update={
            "ontologies": [
                o.model_copy(update={"sha256": MOD_SHA}) for o in profile.ontologies
            ]
        }
    )


def create_modifier_project(
    db: Database,
    key: str = "mods",
    registry: OntologyRegistry | None = None,
    pin: Pin = MOD_PIN,
) -> None:
    """Store hp-modifiers.json (and its German file) and create a project
    pinning MOD_PIN; an app's ``registry`` learns the file."""
    store = OntologyStore(db, OntologyRegistry(), db.data_dir)
    store.add(OPERATOR, MOD_DE.name, MOD_DE.read_bytes())
    store.add(OPERATOR, MOD_PATH.name, MOD_PATH.read_bytes())
    if registry is not None:
        registry.register_path(db.blobs.path(MOD_SHA))
    else:
        # No app: modifier terms classify through this registry (D-a).
        install_service_source(store.registry.get_service)
    ScopedRepository(db, ADMIN_ACCESS, OPERATOR).create_project(
        key, "Modifiers", None, modifier_profile(), {"hp": pin}
    )
