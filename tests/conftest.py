from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolate_test_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Isolate ontocurator persistent config to a temporary directory for each test."""
    test_cfg = tmp_path / "ontocurator" / "config.json"
    monkeypatch.setenv("ONTOCURATOR_CONFIG_PATH", str(test_cfg))
    # Never look at (or offer to import) the real per-user settings file.
    monkeypatch.setenv(
        "ONTOCURATOR_LEGACY_CONFIG_PATH", str(tmp_path / "legacy-none" / "config.json")
    )


@pytest.fixture(autouse=True)
def trust_in_process_test_client(monkeypatch: pytest.MonkeyPatch) -> None:
    """Allow Starlette's TestClient transport (Host: testserver) in tests only."""
    from ontocurator.api import security

    monkeypatch.setattr(security, "ALLOW_TEST_CLIENT_HOST", True)


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
