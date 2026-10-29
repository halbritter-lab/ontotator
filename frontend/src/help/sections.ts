import { routeHref } from "../app/router";

/**
 * Contextual help: the handbook section of each screen, as chapter and GitHub heading id.
 * tests/helpSections.test.ts fails when a heading here no longer exists in docs/handbook.
 */
export const HELP_SECTIONS = {
  editorScratch: { chapter: "annotator", section: "mark-text-and-add-a-finding" },
  editorProposals: { chapter: "annotator", section: "review-tool-proposals" },
  editorCarried: { chapter: "annotator", section: "review-carried-findings" },
  editorTextChange: { chapter: "annotator", section: "re-create-findings-after-a-text-correction" },
  consolidationEditor: { chapter: "consolidator", section: "work-in-the-full-editor" },
  translationReview: { chapter: "annotator", section: "review-a-translation" },
  consolidation: { chapter: "consolidator", section: "read-the-text-and-walk-the-groups" },
  consolidationReadOnly: { chapter: "lead-results", section: "read-a-submitted-consolidation" },
  documents: { chapter: "lead-documents", section: "the-documents-page" },
} as const satisfies Record<string, { chapter: string; section: string }>;

export type HelpScreen = keyof typeof HELP_SECTIONS;

export const helpHref = (screen: HelpScreen): string => routeHref({ name: "help", ...HELP_SECTIONS[screen] });
