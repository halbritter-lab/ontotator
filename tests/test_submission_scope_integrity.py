"""Submission scope metadata cannot contradict its immutable origin/results."""

import io

import pytest
from test_reviews import _setup_review_test_env
from test_scientific_review_integrity import changed_review, submit

from ontocurator.domain.errors import InvalidPackage
from ontocurator.packages.reader import read_package
from ontocurator.packages.writer import PackageWriter


@pytest.mark.parametrize(
    "damage",
    ["mode", "identity", "editable", "reference", "checked", "duplicate-checked"],
)
def test_submission_scope_tampering_is_rejected(tmp_path, damage):
    ctx = _setup_review_test_env(tmp_path)
    key, _, _ = changed_review(ctx)
    result = submit(ctx, key, 2)
    package = ctx["exp_svc"].for_workspace(key)
    submission = package.submissions[result.submission_id]
    assert submission.scope is not None
    if damage == "mode":
        submission.scope.mode = "independent"
    elif damage == "identity":
        submission.scope.scope_id = "forged"
    elif damage == "editable":
        submission.scope.editable_layer_ids = []
    elif damage == "reference":
        submission.scope.reference_layer_ids = ["hpo-layer"]
    elif damage == "checked":
        submission.checked_layer_ids = ["undeclared-layer"]
    else:
        submission.checked_layer_ids = ["hpo-layer", "hpo-layer"]
    stream = io.BytesIO()
    PackageWriter.write_to_stream(package, stream)
    stream.seek(0)
    with pytest.raises(InvalidPackage, match=r"scope|checked"):
        read_package(stream)
