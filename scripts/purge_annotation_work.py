"""Delete every annotation of a project (or of one text) with its work (D4).

    uv run python scripts/purge_annotation_work.py --project KEY \
        [--case CASE --language LANG] --confirm

Runs as the schema owner (ONTOTATOR_MIGRATION_DATABASE_URL and its password,
or ``--database-url``). Deletes the annotate assignments with their rounds,
drafts and submissions, and the consolidations and final results built on
them; translation reviews stay. Irreversible: back up the database first.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence

from sqlalchemy import create_engine, func, select

from ontotator.storage.database import (
    advisory_lock_id,
    connect_args,
    psycopg_url,
)
from ontotator.storage.work_purge import purge_annotation_work


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--project", required=True)
    parser.add_argument("--case")
    parser.add_argument("--language")
    parser.add_argument("--confirm", action="store_true")
    parser.add_argument("--database-url")
    args = parser.parse_args(argv)
    if (args.case is None) != (args.language is None):
        parser.error("--case and --language go together")
    if not args.confirm:
        print("Refused: this deletes annotation work; add --confirm.", file=sys.stderr)
        return 2
    if args.database_url:
        url = psycopg_url(args.database_url)
    else:
        from ontotator.settings import database_url

        url = database_url(prefix="ONTOTATOR_MIGRATION_DATABASE")
    engine = create_engine(url, connect_args=connect_args(url))
    try:
        with engine.begin() as conn:
            conn.execute(
                select(
                    func.pg_advisory_xact_lock(
                        advisory_lock_id("project", args.project)
                    )
                )
            )
            counts = purge_annotation_work(conn, args.project, args.case, args.language)
    finally:
        engine.dispose()
    print(json.dumps({k: v for k, v in counts.items() if v}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
