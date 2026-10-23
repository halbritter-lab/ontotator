/**
 * Builders for the text card (U3): a translation row and annotate work items with assignment dates. They compose the shared builders of `fixtures.ts`.
 */
import type { DocumentRowView, RowStagesView } from "../../src/api/client";
import type { CardWorkItem } from "../../src/documents/textCard/cardModel";
import { version, work } from "./fixtures";
import { stagedRow } from "./tableFixtures";

/** case-200 de: a machine translation of the English source, with the given stages. */
export function cardRow(stages: Partial<RowStagesView> = {}, overrides: Partial<DocumentRowView> = {}): DocumentRowView {
  const base = stagedRow("case-200", "de", {
    stages,
    overrides: {
      versions: [version({ document_id: "case-200-de", origin: "machine_translation", derived_from: "case-200-en", chain_name: "Translation", translation_status: "ready_for_review" })],
    },
  });
  return { ...base, ...overrides };
}

/** An annotate work item with an assignment date. */
export function annotateItem(overrides: Partial<CardWorkItem> & Pick<CardWorkItem, "assignment_id">): CardWorkItem {
  return { ...work({ document_id: "case-200-de", ...overrides }), assigned_at: "2026-10-21T08:30:00Z", assigned_by: null, annotation_mode: "proposals", ...overrides };
}
