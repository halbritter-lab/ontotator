"""Current results are revisioned within their complete immutable origin."""

from collections.abc import Iterable

from ontotator.domain.errors import DomainError
from ontotator.domain.workspace import Submission


def latest_submissions(submissions: Iterable[Submission]) -> list[Submission]:
    """Select highest revisions per full origin, without comparing clocks or branches.

    Return origins in canonical order. Unequal records at the same origin and
    revision are a conflict, including conflicts in superseded history.
    Consumers must resolve or expose multiple origins explicitly.
    """
    revisions: dict[tuple[str, int], Submission] = {}
    latest: dict[str, Submission] = {}
    for submission in submissions:
        origin = submission.origin_key.model_dump_json()
        revision_key = (origin, submission.draft_revision)
        previous = revisions.get(revision_key)
        if previous is not None and previous != submission:
            raise DomainError(
                "CONFLICTING_SUBMISSION_REVISION",
                {
                    "origin_key": submission.origin_key.model_dump(),
                    "draft_revision": submission.draft_revision,
                },
            )
        revisions[revision_key] = submission
        if (
            origin not in latest
            or latest[origin].draft_revision < submission.draft_revision
        ):
            latest[origin] = submission
    return [latest[origin] for origin in sorted(latest)]
