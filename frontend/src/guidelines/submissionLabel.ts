/**
 * Guideline label of a submitted result (spec "Submitted results"): "Guidelines v2",
 * "Guidelines v2 (current: v3)" when a newer version is in force, "Guidelines v2 (withdrawn)",
 * or "Guidelines: not recorded" without a stamp (imported results, or no version in force at submit).
 * `current` is the version in force, `null` when none is or it is not known.
 */
export function submissionGuidelineLabel(version: number | null | undefined, withdrawn: boolean, current: number | null): string {
  if (version == null) return "Guidelines: not recorded";
  if (withdrawn) return `Guidelines v${version} (withdrawn)`;
  if (current !== null && current > version) return `Guidelines v${version} (current: v${current})`;
  return `Guidelines v${version}`;
}
