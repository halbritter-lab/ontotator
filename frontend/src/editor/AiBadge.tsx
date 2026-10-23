import type { EditorProposal } from "../api/client";
import { useProposalMetadata } from "./ProposalSource";
import type { components } from "../api/generated";

type Provenance = components["schemas"]["Provenance"];

/** "AI" marker for annotations produced by a tool; humans and unknown origins get no marker. */
export function AiBadge({ provenance, source }: { provenance: Provenance | null; source?: EditorProposal }) {
  const { label } = useProposalMetadata(source);
  // Upstream tool metadata never changes the current annotation's authorship.
  const origin = provenance;
  if (origin?.actor.kind !== "tool") return null;
  const description = `AI-generated: ${origin.actor.actor_id}, ${origin.method}`;
  return (
    <span className="badge badge-ai" title={label ?? description} aria-label={label ? `AI-generated: ${label}` : description}>
      AI
    </span>
  );
}
