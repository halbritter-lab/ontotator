"""Open a folder in the operating system's file manager.

Callers pass only fixed, known locations (never paths supplied by a client).
Tests replace ``open_folder`` so that no window is ever opened.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def open_folder(folder: Path) -> None:
    """Show ``folder`` in Explorer / Finder / the desktop's file manager."""
    if not folder.is_dir():
        raise FileNotFoundError(f"Folder not found: {folder}")
    if sys.platform == "win32":
        os.startfile(str(folder))
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(folder)])
    else:
        subprocess.Popen(["xdg-open", str(folder)])
