import type { components } from "../api/generated";

type Provenance = components["schemas"]["Provenance"];

/** "AI" marker for annotations produced by a tool; humans and unknown origins get no marker. */
export function AiBadge({ provenance }: { provenance: Provenance | null }) {
  if (provenance?.actor.kind !== "tool") return null;
  const description = `AI-generated: ${provenance.actor.actor_id} · ${provenance.method}`;
  return (
    <span className="badge badge-ai" title={description} aria-label={description}>
      ✦ AI
    </span>
  );
}
