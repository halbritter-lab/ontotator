**Important — An authorized tree expansion can modify a foreign project.**

Location: [src/ontocurator/authz/scoped.py:290](C:/Users/jan-p/Development/ontocurator/.worktrees/t2c-projects-authorization-audit/src/ontocurator/authz/scoped.py:290), delegating to [storage/repository.py:1684](C:/Users/jan-p/Development/ontocurator/.worktrees/t2c-projects-authorization-audit/src/ontocurator/storage/repository.py:1684) and [storage/repository.py:1709](C:/Users/jan-p/Development/ontocurator/.worktrees/t2c-projects-authorization-audit/src/ontocurator/storage/repository.py:1709).

The scoped method checks permission for the supplied workspace’s project, but the underlying method locks and updates **every row with the event ID**, across all projects.

Concrete scenario:

1. Alice starts an ontology tree walk in project A.
2. An administrator exports that work and imports it into project B, preserving the search-event ID.
3. Alice, who has an annotator role only in A, calls `POST /api/v1/terms/tree/node` to expand a previously shown node.
4. The ownership and role checks pass for A. The subsequent UPDATE also changes B’s copied search-event payload, modifying B’s stored provenance without authorization.

**Suggested fix:** Scope both the locking SELECT and UPDATE to the authorized project. Adjust the import/copy synchronization rules so an authenticated browse operation cannot propagate changes into projects outside its authorization.

**Test gap:** The new scope tests check calls explicitly naming foreign projects; they miss foreign side effects from an allowed call. Moreover, [tests/test_pg_repository.py:555](C:/Users/jan-p/Development/ontocurator/.worktrees/t2c-projects-authorization-audit/tests/test_pg_repository.py:555) explicitly expects propagation across projects. Add an API regression test with copies in A and B, grant Alice access only to A, expand the walk, and assert B remains unchanged.

No other concrete defects were verified in the requested areas. This was a read-only code review; I did not run tests or mutate the database.

**Verdict:** Request changes. The project-scoping boundary still permits a cross-project write.