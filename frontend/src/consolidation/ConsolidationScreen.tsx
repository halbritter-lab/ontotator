/**
 * Consolidation view of one round (acceptance fixes WP-E, U2, U9, U13). Route stub of WP-B: the route
 * `#/projects/{key}/consolidations/{roundId}?group=…` and the "Open consolidation" / flags banner links
 * already lead here; WP-E2a replaces the body with the text and the finding groups.
 */
import { InlineMessage } from "../ui";

export interface ConsolidationScreenProps {
  projectKey: string;
  roundId: string;
  /** Finding group to show first (the flags banner's "Open"). */
  group?: string;
  /** The lead's read of a submitted consolidation (U9). */
  readOnly?: boolean;
}

export function ConsolidationScreen(_props: ConsolidationScreenProps): JSX.Element {
  return <InlineMessage tone="info">Loading consolidation…</InlineMessage>;
}
