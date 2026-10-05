from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolate_test_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Isolate ontocurator persistent config to a temporary directory for each test."""
    test_cfg = tmp_path / "ontocurator" / "config.json"
    monkeypatch.setenv("ONTOCURATOR_CONFIG_PATH", str(test_cfg))


@pytest.fixture(autouse=True)
def trust_in_process_test_client(monkeypatch: pytest.MonkeyPatch) -> None:
    """Allow Starlette's TestClient transport (Host: testserver) in tests only."""
    from ontocurator.api import security

    monkeypatch.setattr(security, "ALLOW_TEST_CLIENT_HOST", True)
