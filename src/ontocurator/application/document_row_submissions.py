"""Submissions view of one Documents row (case, language)."""

from typing import Any

from sqlalchemy import Connection


def build_submissions(
    conn: Connection,
    key: str,
    pid: int,
    case_id: str,
    language: str,
    viewer_user_id: int,
) -> dict[str, Any]:
    raise NotImplementedError
