import os
from pathlib import Path

import pytest

_SHARED_URL = "ontocurator_test_pg_url"
_SHARED_ERROR = "ontocurator_test_pg_error"


class _SharedServer:
    """xdist controller: one PostgreSQL server for every worker (pg_harness).

    Started when the first worker is set up, so serial runs and runs with an
    explicit ``ONTOCURATOR_TEST_PG_URL`` never start it. A start failure is
    handed on as well: only the tests that need PostgreSQL fail, with its cause.
    """

    def __init__(self) -> None:
        self.started: tuple[str | None, str | None] | None = None

    def pytest_configure_node(self, node) -> None:  # type: ignore[no-untyped-def]
        if os.environ.get("ONTOCURATOR_TEST_PG_URL"):
            return
        if self.started is None:
            import pg_harness

            try:
                self.started = (pg_harness.start_shared_server(), None)
            except RuntimeError as exc:
                self.started = (None, str(exc))
        node.workerinput[_SHARED_URL], node.workerinput[_SHARED_ERROR] = self.started


def pytest_configure(config: pytest.Config) -> None:
    workerinput = getattr(config, "workerinput", None)
    if workerinput is not None:
        if _SHARED_URL in workerinput:
            import pg_harness

            pg_harness.use_shared_server(
                workerinput[_SHARED_URL], workerinput[_SHARED_ERROR]
            )
    elif config.pluginmanager.hasplugin("xdist"):
        config.pluginmanager.register(_SharedServer(), "ontocurator-shared-pg")


@pytest.fixture(autouse=True)
def restore_service_source():  # type: ignore[no-untyped-def]
    """A registry built in one test must not serve another test's ontology lookups."""
    from ontocurator.ontology import modifiers

    previous = modifiers._source
    yield
    modifiers.install_service_source(previous)


@pytest.fixture(autouse=True)
def database_per_workspace(monkeypatch: pytest.MonkeyPatch):  # type: ignore[no-untyped-def]
    """Every app and CLI run without an explicit URL gets one database per workspace.

    Engines created during the test are closed afterwards and its databases
    are dropped, so connections and disk space do not accumulate.
    """
    import pg_harness

    from ontocurator import settings
    from ontocurator.storage.database import Database

    monkeypatch.setattr(
        settings,
        "database_url_provider",
        lambda workspace: pg_harness.database_url_for(
            (workspace or Path.cwd()) / "editor.db"
        ),
    )
    created: list[Database] = []
    original_init = Database.__init__

    def tracking_init(self: Database, *args, **kwargs) -> None:  # type: ignore[no-untyped-def]
        original_init(self, *args, **kwargs)
        created.append(self)

    monkeypatch.setattr(Database, "__init__", tracking_init)
    yield
    for db in created:
        db.close()
    pg_harness.reset()


# Modules that test hashing, the supplied-hash policy or rehash-on-login keep
# the production Argon2 parameters; every other test hashes cheaply.
_PRODUCTION_ARGON2_PREFIXES = (
    "test_passwords",
    "test_accounts",
    "test_sessions",
    "test_admin_cli",
)
_CHEAP_ARGON2: dict[str, object] = {}


def _cheap_argon2_values() -> dict[str, object]:
    """Low-cost stand-ins for the hasher state in ``ontocurator.auth.passwords``.

    The parameters (t=1, m=8 MiB, p=1) exist only here, in the test suite;
    the production module has no switch that could select them.
    """
    if not _CHEAP_ARGON2:
        from argon2 import PasswordHasher, Type, extract_parameters

        time_cost, memory_cost, parallelism = 1, 8_192, 1
        hasher = PasswordHasher(
            time_cost=time_cost,
            memory_cost=memory_cost,
            parallelism=parallelism,
            type=Type.ID,
        )
        dummy = hasher.hash(b"ontocurator timing equaliser")
        _CHEAP_ARGON2.update(
            _HASHER=hasher,
            _DUMMY_HASH=dummy,
            _OUR_PARAMETERS=extract_parameters(dummy),
            TIME_COST=time_cost,
            MEMORY_COST=memory_cost,
            PARALLELISM=parallelism,
        )
    return _CHEAP_ARGON2


@pytest.fixture(autouse=True)
def cheap_argon2(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Hash with low Argon2 cost outside the password, account and session tests.

    Hashing, verifying, ``needs_rehash`` and ``assert_policy`` all switch
    together, so hashes made in a test are "ours" and logins do not rehash.
    """
    if request.path.name.startswith(_PRODUCTION_ARGON2_PREFIXES):
        return
    from ontocurator.auth import passwords

    for name, value in _cheap_argon2_values().items():
        monkeypatch.setattr(passwords, name, value)
