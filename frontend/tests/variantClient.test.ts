import { afterEach, describe, expect, it, vi } from "vitest";
import type { components } from "../src/api/generated";
import {
  ApiClient, ApiError, AuthError, ConflictError, ValidationError,
  onCsrfRejected, onSessionExpired,
} from "../src/api/client";

type Schemas = components["schemas"];
const project = "study /%?#ü";
const documentId = "EN 1/7 %?#Ω/annotation-versions/own/text";
const caseId = "case /%?#😀";
const refId = 'urn:source/%?#ü:["own","a"]/variant';
const base = `/api/v1/projects/${encodeURIComponent(project)}`;
const doc = `${base}/documents/${encodeURIComponent(documentId)}`;
const time = "2026-10-16T12:00:00Z";
const variant: Schemas["VariantSummary"] = {
  document_id: documentId, case_id: caseId, external_id: "external-1", language: "de",
  version: 2, origin: "correction", derived_from: "old-variant", translation: null,
  translation_status: "accepted", status_reason: null, text_sha256: "a".repeat(64),
  assigned_to_me: false,
};
const detail: Schemas["CaseDetail"] = { case_id: caseId, variants: [variant] };
const text: Schemas["VariantText"] = {
  document_id: documentId, text: "Raw 😀\r\nÜbersetzt", text_sha256: variant.text_sha256,
};
const ref: Schemas["VersionRef"] = { kind: "proposals", id: refId, label: "Tool", created_at: time };
const annotationVersion: Schemas["AnnotationVersion"] = { ref, annotations: [], evidence: [] };
const assignment: Schemas["AssignmentView"] = {
  id: 41, project_key: project, document_id: documentId, user_id: 4, username: "reviewer",
  pseudonym: "own-pseudo", display_name: "Reviewer", task: "translation_review", status: "submitted", created_at: time,
  updated_at: time, revoked_at: null, last_submission_id: "tr-7", external_id: "external-1",
};
const record: Schemas["TranslationReviewRecord"] = {
  id: 7, project_id: 3, document_id: documentId, assignment_id: 41, reviewer_user_id: 4,
  reviewer_pseudonym: "own-pseudo", reviewer_qualification: "Reviewer", reviewer_languages: ["en", "de"],
  decision: "accepted_corrected", clinical_change: false, categories: [], rationale: null,
  machine_text_sha256: "b".repeat(64), proposed_text: text.text, proposed_text_sha256: text.text_sha256,
  status_before: "reviewed", status_after: "accepted", created_variant_id: documentId,
  review_policy: "translation-review/v1", created_at: time,
};
const workspace: Schemas["ReviewWorkspace"] = {
  assignment: { ...assignment }, variant, translation_ancestor: variant, text: text.text,
  source: { variant: { ...variant, document_id: "source", language: "en" }, text: "Original" },
  comparisons: [], failed_checks: [], draft: { text: text.text, form: {}, revision: 3 },
  qualification: "Reviewer", previous_reviews: [record], read_only: true, submitted_record: record,
};
const pending: Schemas["ReanchorItem"] = {
  proposal_set_id: 8, source_ref: { annotation_id: "urn:source", version: "v1" },
  term_id: "HP:1", layer_id: "hpo", reason: "changed_cue",
  old_mentions: [{ source_ref: { evidence_id: "e1", version: "ev1" }, segments: [{ start: 2, end: 3, text: "x" }], cue_segments: [{ start: 0, end: 1, text: "n" }] }],
  old_context: { start: 0, end: 3, text: "n x" }, new_context: { start: 0, end: 1, text: "x" },
  diff: [{ op: "delete", old_start: 0, old_end: 2, new_start: 0, new_end: 0, old_text: "n ", new_text: "" }, { op: "equal", old_start: 2, old_end: 3, new_start: 0, new_end: 1, old_text: "x", new_text: "x" }],
  old_segments: [{ start: 2, end: 3, text: "x" }, { start: 0, end: 1, text: "n" }],
};

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function transport(value: unknown, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response(value, status));
  vi.stubGlobal("fetch", fetch);
  const client = new ApiClient({ baseUrl: "https://same.example" });
  client.setCsrfToken("csrf-review");
  return { client, fetch };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("actual typed variant reads", () => {
  const reads: [string, string, unknown, (client: ApiClient) => Promise<unknown>][] = [
    ["cases", `${base}/cases`, [detail], c => c.listCases(project)],
    ["case", `${base}/cases/${encodeURIComponent(caseId)}`, detail, c => c.getCase(project, caseId)],
    ["metadata", `${doc}/variant`, variant, c => c.getVariantMetadata(project, documentId)],
    ["immutable text", `${doc}/text`, text, c => c.getVariantText(project, documentId)],
    ["offered refs", `${doc}/annotation-versions`, [ref], c => c.listAnnotationVersions(project, documentId)],
    ["exact ref", `${doc}/annotation-versions/proposals/${encodeURIComponent(refId)}`, annotationVersion, c => c.getAnnotationVersion(project, documentId, ref.kind, refId)],
    ["pending", `${doc}/reanchor-items`, [pending], c => c.getReanchorItems(project, documentId)],
    ["assignment metadata", "/api/v1/assignments/41", assignment, c => c.getAssignmentMetadata(41)],
    ["review workspace", "/api/v1/translation-reviews/41", workspace, c => c.openTranslationReview(41)],
    ["review records", `${doc}/translation-reviews`, [record], c => c.listTranslationReviews(project, documentId)],
  ];
  it.each(reads)("reads %s with exact opaque encoding and common transport", async (_name, endpoint, value, invoke) => {
    const { client, fetch } = transport(value);
    expect(await invoke(client)).toEqual(value);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`https://same.example${endpoint}`);
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).has("X-CSRF-Token")).toBe(false);
  });

  it("uses only supported case filters and preserves empty values while omitting absent values", async () => {
    const { client, fetch } = transport([detail]);
    await client.listCases(project, { language: "fr /%", origin: "correction", status: "accepted" });
    expect(fetch.mock.calls[0][0]).toBe(`https://same.example${base}/cases?${new URLSearchParams({ language: "fr /%", origin: "correction", status: "accepted" })}`);
    await client.listCases(project, { language: "", origin: undefined, status: null });
    expect(fetch.mock.calls[1][0]).toBe(`https://same.example${base}/cases?language=`);
    await client.listCases(project, {});
    expect(fetch.mock.calls[2][0]).toBe(`https://same.example${base}/cases`);
  });

  it("adds an actual assignment hint only when supplied", async () => {
    const { client, fetch } = transport([ref]);
    await client.listAnnotationVersions(project, documentId, 41);
    await client.listAnnotationVersions(project, documentId);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `https://same.example${doc}/annotation-versions?assignment=41`,
      `https://same.example${doc}/annotation-versions`,
    ]);
  });
});

describe("translation review writes", () => {
  it("saves raw text, incomplete form and expected revision with CSRF", async () => {
    const { client, fetch } = transport({ revision: 4 } satisfies Schemas["DraftResponse"]);
    const body: Schemas["DraftRequest"] = { expected_revision: 3, text: "😀\r\n e\u0301 ", form: { incomplete: true, nested: { custom: null } } };
    expect(await client.saveTranslationReviewDraft(41, body)).toEqual({ revision: 4 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://same.example/api/v1/translation-reviews/41/draft");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual(body);
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("csrf-review");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(init?.credentials).toBe("same-origin");
  });

  it("submits the exact revision and returns the immutable actual record", async () => {
    const { client, fetch } = transport(record);
    expect(await client.submitTranslationReview(41, 4)).toEqual(record);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://same.example/api/v1/translation-reviews/41/submit");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ expected_revision: 4 });
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("csrf-review");
  });

  it("starts the dedicated authenticated review export without inventing an export kind or body", async () => {
    const result: Schemas["ExportCreated"] = { job_id: 71 };
    const { client, fetch } = transport(result);
    expect(await client.exportTranslationReviews(project)).toEqual(result);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`https://same.example${base}/exports/translation-reviews`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("csrf-review");
  });

  it("keeps annotation assignment open bodyless by default and forwards only an explicit round", async () => {
    const { client, fetch } = transport(null);
    await client.openAssignment(41);
    await client.openAssignment(41, { review_round_target_set_id: "round /%" });
    expect(fetch.mock.calls[0][0]).toBe("https://same.example/api/v1/assignments/41/open");
    expect(fetch.mock.calls[0][1]?.body).toBeUndefined();
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ review_round_target_set_id: "round /%" });
  });
});

describe("new wrappers preserve common transport errors", () => {
  it.each([
    [409, "REVISION_CONFLICT", ConflictError],
    [422, "REVIEW_INVALID", ValidationError],
    [404, "ASSIGNMENT_NOT_FOUND", ApiError],
  ] as const)("retains %i code and structured detail", async (status, code, ErrorType) => {
    const details = { issues: ["RATIONALE_REQUIRED"], expected_revision: 2, current_revision: 3 };
    const { client } = transport({ code, details }, status);
    const error = await client.submitTranslationReview(41, 2).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ErrorType);
    expect(error).toMatchObject({ status, code, details });
  });

  it.each([401, 403] as const)("preserves current-session signal for status %i", async status => {
    const code = status === 401 ? "NOT_AUTHENTICATED" : "CSRF_FAILED";
    const { client } = transport({ code, details: "Session changed" }, status);
    const listener = vi.fn();
    const stop = status === 401 ? onSessionExpired(listener) : onCsrfRejected(listener);
    try {
      await expect(client.saveTranslationReviewDraft(41, { expected_revision: 2, text: "Raw", form: {} })).rejects.toBeInstanceOf(AuthError);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally { stop(); }
  });
});
