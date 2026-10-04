import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.build_standalone import prepare_portable_bundle


def test_prepare_portable_bundle_creates_zip_and_structure(tmp_path: Path) -> None:
    bundle_dir = tmp_path / "standalone" / "ontocurator"
    bundle_dir.mkdir(parents=True)
    exe_name = "ontocurator.exe" if sys.platform == "win32" else "ontocurator"
    (bundle_dir / exe_name).write_text("fake binary", encoding="utf-8")

    from unittest.mock import patch

    with patch("scripts.build_standalone.DIST_DIR", tmp_path):
        zip_path = prepare_portable_bundle(bundle_dir)
        assert zip_path.is_file()
        assert zip_path.suffix == ".zip"

        with zipfile.ZipFile(zip_path, "r") as z:
            names = set(z.namelist())
            assert (
                f"ontocurator/{exe_name}" in names
                or f"ontocurator\\{exe_name}" in names
            )
            assert any(
                "ontologies/README.txt" in n or "ontologies\\README.txt" in n
                for n in names
            )
            assert any(n.endswith("README.txt") for n in names)
