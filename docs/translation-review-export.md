# Translation review export v1

The generic UTF-8 JSONL format is `ontotator-translation-review/v1`. Consumer-specific mappings belong in the consumer repository. The export contains one compact JSON object per immutable review, ordered by ascending numeric review ID, followed by LF. A history with no reviews exports zero bytes. No annotation submission is needed.

Request `POST /api/v1/projects/{key}/exports/translation-reviews`; the response is `{ "job_id": ... }`. Poll the existing job endpoint; success returns only `{ "sha256": "...", "reviews": 3 }`. Download the authenticated artifact from `/api/v1/jobs/{id}/download`. Current full-export permission is required at enqueue, worker execution and download, including for the requester. Downloads use `application/x-ndjson` and a server-generated `project-translation-reviews-YYYYMMDDTHHMMSSZ.jsonl` attachment name.

CLI: `ontotator admin export-translation-reviews PROJECT OUT.jsonl [--no-wait]`. Default execution waits, writes the exact artifact and refuses overwrite. `--no-wait` only queues a project-associated job and prints its ID; it creates no local output.

## Record fields

Every record has exactly these keys, in this serialization order:

| Key | Value |
| --- | --- |
| format | `ontotator-translation-review/v1` |
| review_id | Immutable numeric review ID |
| project | Project key |
| case_id | Reviewed variant's actual case ID |
| reviewed_variant | `document_id`, `language`, `version`, `origin`, `text_sha256`, `translation` |
| source_variant | `document_id`, `language`, `version`, `text_sha256` |
| reviewer | Recorded `pseudonym`, `qualification`, `languages` |
| decision | `accepted_unchanged`, `accepted_corrected`, `query`, or `rejected` |
| clinical_change | Recorded boolean |
| categories | Recorded English category codes |
| rationale | Recorded text or explicit null |
| machine_text_sha256 | Exact reviewed baseline hash from the review record |
| proposed_text | Exact immutable proposed text |
| proposed_text_sha256 | SHA-256 of the exact UTF-8 proposed_text |
| created_variant | `document_id`, `version`, `text_sha256`, or explicit null |
| status_before | Recorded reviewed-variant status before this review |
| status_after | Recorded reviewed-variant status after this review |
| review_policy | Recorded review policy |
| reviewed_at | Record timestamp converted to UTC, seconds only: `YYYY-MM-DDTHH:MM:SSZ` |

All `document_id` values in this format are **external** document IDs. Internal storage IDs are not exported. Hashes are lowercase 64-digit hexadecimal SHA-256 strings. Reviewer metadata comes from the immutable review snapshot; later account/name/qualification/language edits do not rewrite it. No user ID, login name, display name, email, ORCID or session identifier is included in the reviewer object.

## Translation ancestry and correction context

`reviewed_variant` identity, language, version, origin and hash always describe the **exact reviewed variant**, including a reviewed correction. Its `translation` field is an **export-context projection**: the original translation-origin ancestor's provider/model/run/recipe/checks. This does not assert that the correction itself owns a translation run or that automatic checks were rerun on the correction.

For EN source → DE translation v1 → DE correction v2 → DE correction v3, a review of v2 exports v2's identity/hash, the DE v1 translation run/checks, and the original EN source as `source_variant`. It does not substitute v1's baseline hash, v2's immediate DE predecessor as the source language, or a later unrelated EN sibling. `machine_text_sha256` and proposed hashes remain those of that exact review record.

Corrections' **stored** and **T1** `translation` fields remain null. The inherited projection exists only in this review JSONL field. A genuinely absent run is null. A run has exactly `provider`, `model`, `run_id`, `recipe`, `checks`; each check has exactly `code`, `passed`, `detail`. Optional values use explicit null and checks retain their recorded order.

`created_variant` identifies only the correction created by that record, using its actual external ID/version/hash. It is explicit null for unchanged/query/rejected reviews. Later corrections or mutable current status never replace historical record values. Missing/corrupt lineage, mismatched baseline/proposed hash or invalid created-variant association refuses export rather than fabricating context.
