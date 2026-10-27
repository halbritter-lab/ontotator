"""The real child waiter must select jobs emitted by the production producer."""

from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from browser_server import register_variant_admin_scenario_routes
from fastapi import FastAPI
from sqlalchemy.dialects import postgresql

from ontotator.exchange.reanchor_job import ReanchorPayload, ReviewProducer


def test_review_child_waiter_selects_the_actual_serialized_producer():
    payload = ReanchorPayload(
        project="review-project",
        old_document_id="old /é",
        new_document_id="new /é",
        producer=ReviewProducer(review_id=314),
    ).model_dump(mode="json")
    statements = []

    class QueryCaptured(Exception):
        pass

    class Connection:
        def execute(self, statement):
            statements.append(statement)
            if len(statements) == 1:
                return SimpleNamespace(
                    one_or_none=lambda: SimpleNamespace(
                        document_id=payload["old_document_id"],
                        created_variant_id=payload["new_document_id"],
                    )
                )
            # Stop at the actual polling query; never execute SQL or sleep.
            raise QueryCaptured

    @contextmanager
    def transaction():
        yield Connection()

    app = FastAPI()
    app.state.repo = SimpleNamespace(db=SimpleNamespace(transaction=transaction))
    register_variant_admin_scenario_routes(app)
    endpoint = next(
        route.endpoint
        for route in app.routes
        if getattr(route, "path", None) == "/__test_review_child__"
    )
    with pytest.raises(QueryCaptured):
        endpoint(project=payload["project"], review_id=payload["producer"]["review_id"])
    assert len(statements) == 2
    bindings = statements[1].compile(dialect=postgresql.dialect()).params
    assert payload["producer"]["kind"] in bindings.values()
    assert payload["producer"]["review_id"] in bindings.values()
    assert list(bindings.values()).count(payload["project"]) == 2
