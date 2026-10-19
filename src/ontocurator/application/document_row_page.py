"""Rows and pages of the lead's Documents table, built from facts (no SQL)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ontocurator.application.document_rows import RowFacts, RowQuery


def build_page(facts: RowFacts, query: RowQuery) -> dict[str, Any]:
    raise NotImplementedError
