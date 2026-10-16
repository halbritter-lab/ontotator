import type { AssignmentView, ProjectDocumentSummary, Member, ProposalResponse } from "../src/api/client";
export const documents: ProjectDocumentSummary[] = [
  { document_id: "z/doc", case_id: "z/doc", external_id: "z/doc", version: 1, origin: "native", translation_status: null, status_reason: null, language: "en", position: 4, text_length: 10, status: "not_started", assignees: [] },
  { document_id: "a", case_id: "a", external_id: "a", version: 1, origin: "native", translation_status: null, status_reason: null, language: "de", position: 9, text_length: 10, status: "not_started", assignees: [] },
];
export const members: Member[] = [
  { username: "alice", display_name: "Alice", pseudonym: "A", roles: ["annotator"], languages: ["en"] },
  { username: "bob", display_name: "Bob", pseudonym: "B", roles: ["annotator", "adjudicator"], languages: ["en", "de"] },
  { username: "lead", display_name: "Lead", pseudonym: "L", roles: ["lead"], languages: [] },
];
export const assignment: AssignmentView = { id: 3, project_key: "p/key", document_id: "z/doc", user_id: 1, username: "alice", display_name: "Alice", pseudonym: "A", task: "annotate", status: "open", created_at: "2026-10-16T10:00:00Z", updated_at: "2026-10-16T10:00:00Z", revoked_at: null, last_submission_id: null };
export const proposal: ProposalResponse = { rows: [{ document_id: "z/doc", language: "en", username: "alice", display_name: "Alice", load_before: 4 }, { document_id: "z/doc", language: "en", username: "bob", display_name: "Bob", load_before: 2 }], unassignable: [{ document_id: "a", language: "de", reason: "TOO_FEW_READERS", eligible_count: 1 }], seed: 123, per_document: 2, context: { document_ids: ["z/doc", "a"], task: "annotate", per_document: 2, seed: 123, state_sha256: "c".repeat(64) } };
export const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
