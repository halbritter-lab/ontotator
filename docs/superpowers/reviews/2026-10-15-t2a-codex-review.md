Found three issues worth fixing. This was a read-only review of the 15 commits, the plan, implementation notes, and SQLite implementation on main. I did not run tests.

1. **Important — Export can contain annotations whose evidence is missing.**  
   Location: [repository.py:1558](C:/Users/jan-p/Development/ontocurator/.worktrees/t2a-postgres-storage/src/ontotator/storage/repository.py:1558), evidence query at line 1583.

   `export_package()` reads annotations and evidence in separate statements. The engine’s default READ COMMITTED isolation allows each statement to observe a different committed state.

   **Failure scenario:** Export reads a draft annotation referencing evidence version E1. Another request edits that evidence and commits, replacing the draft’s annotation and evidence links with E2. Export then reads evidence and gets E2, excluding E1 unless another proposal or draft references it. The package writer rejects the export with “references missing evidence.” The transaction wrapper does not provide a consistent snapshot.

   **Suggested fix:** Execute the entire export against one REPEATABLE READ snapshot, including resource metadata, with explicit handling when an ambient transaction already exists. Add a concurrency test that commits an evidence edit between the annotation and evidence reads and then passes the exported package through the writer. Existing export tests are sequential.

2. **Important — A caught failure inside an ambient transaction can commit partial work.**  
   Location: [database.py:55](C:/Users/jan-p/Development/ontocurator/.worktrees/t2a-postgres-storage/src/ontotator/storage/database.py:55).

   When a transaction already exists, the context manager simply yields its connection. An exception from the nested operation neither rolls back its writes nor marks the outer transaction as failed.

   **Failure scenario:** A caller opens `db.transaction()`, calls `import_package()`, and catches `InvalidPackage` to continue processing. During import, `_verify_existing_snapshots()` can extend an existing tree walk before detecting conflicting content in a later event or rejecting the existing project’s manifest. Because this is a Python exception, PostgreSQL leaves the transaction usable. The outer context then commits the tree-walk change from the rejected import.

   **Suggested fix:** Mark joined transactions rollback-only when an exception escapes a nested transaction scope, and refuse to commit the outer scope. Alternatively, use savepoints where failed operations are explicitly intended to be recoverable. Add a test that catches the inner exception *inside* the outer context and verifies that rejected-operation writes cannot commit. Current rollback tests let the exception escape the outer context.

3. **Important — Local search-event creation races with imports, bypassing global identity checks.**  
   Location: [repository.py:1377](C:/Users/jan-p/Development/ontocurator/.worktrees/t2a-postgres-storage/src/ontotator/storage/repository.py:1377).

   `save_search_event()` checks global existence without taking the import lock. Imports serialize only against other imports. The database primary key is `(project_id, event_id)`, so it cannot enforce the global invariant described here.

   **Failure scenario:** A local save in project A checks that event E is absent. Concurrently, an import into project B checks E before A commits and supplies different content under E. Both inserts succeed. Random local IDs do not exclude this scenario: imported IDs are supplied externally, and selection IDs are deterministic. Subsequently, an unscoped lookup raises `AMBIGUOUS_SEARCH_EVENT`; for a tree walk, appending candidates can overwrite the other project’s conflicting payload because the update targets every copy of E.

   **Suggested fix:** Serialize existence checking and insertion through a shared event-identity lock used by both local saves and imports, with a consistent lock order. A global event identity table is another option. Add a coordinated local-save-versus-import test; the sequential duplicate-ID test does not cover this race.

The grants and triggers protect existing rows in `annotation_snapshots`, `evidence_snapshots`, and `submissions` under the intended app-role bootstrap. That protection does **not** extend to search events or mutation receipts, which explicitly receive UPDATE and DELETE privileges. I found no direct SQL-injection path in the reviewed production queries.

**Verdict:** Request changes for the transaction and concurrency issues above.