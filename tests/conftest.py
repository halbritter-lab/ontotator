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
