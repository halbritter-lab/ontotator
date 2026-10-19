# Translation check explanations: review

Status: draft, awaiting user confirmation.

Source: spec [2026-10-19-editor-carried-review-design.md](../specs/2026-10-19-editor-carried-review-design.md), section 9 and Resolved question 4. The texts are shown in the translation review screen under "Automatic translation checks" for each failed check.

Source file: `frontend/src/translation/labels.ts`
- Labels: `checkLabels` (unknown codes are turned into words by `checkLabel`).
- Explanations: `checkExplanations`; fallback `unknownCheckExplanation`.
- Shared sentences: `checkNoLocation`, `checkDeviationGuidance`.

## Per code

| Code | Label | Explanation | Status | Decision |
|---|---|---|---|---|
| `units_added` | Units added in translation | The translation run's check found a unit of measurement in the translation that it did not find in the source. | draft | |
| `numbers_changed` | Numbers changed in translation | The translation run's check found numbers in the translation that differ from those in the source. | draft | |
| unknown code (fallback) | The code turned into words, for example `glossary_miss` becomes "Glossary miss" | The translation run reported this check as failed. Ontocurator has no description for it; ask the project lead what it checks. | draft | |

## Shared sentences (shown for every failed check)

| Constant | Text | Status | Decision |
|---|---|---|---|
| `checkNoLocation` | This check does not point to a text location. Compare the source and the translation yourself. | draft | |
| `checkDeviationGuidance` | Choose Accepted unchanged and say in the rationale why the difference is correct. If it changes the clinical meaning, choose Query or Rejected with the category Number or unit. | draft | |

## Search for further codes

Ontocurator does not run translation checks itself; it reads `translation.checks[].code` from the imported translation metadata (`src/ontocurator/exchange/variant_plan.py`, `failed_checks`). Searching `src/`, `tests/` and `examples/` (`grep -rn "units_added" src/ tests/ examples/`, plus all `"code"` values next to `"passed"`) found only `units_added` and `numbers_changed` in fixtures. No other code is emitted by Ontocurator, so there is no "new draft" entry. Codes used only in frontend test fixtures (`negation_changed`, `negation-flip_detected`, `numbers`) are synthetic and are covered by the fallback.

If the translation pipeline owners name further codes, add them to `checkLabels` and `checkExplanations` and to the table above.
