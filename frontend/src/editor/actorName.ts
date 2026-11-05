/**
 * The shown name of an annotation's actor. With hidden annotator names (issue 302)
 * the server sends a consolidator opaque ids for other people's findings:
 * "annotator-a", "annotator-b", … and "annotator" for someone outside the round.
 * They read "Annotator A", "Annotator B", … and "Another annotator", as in the
 * consolidation view. Tools and every other id are shown as they are.
 */
export function actorName(actor: { actor_id: string; kind: string }): string {
  if (actor.kind !== "human") return actor.actor_id;
  if (actor.actor_id === "annotator") return "Another annotator";
  const match = /^annotator-([a-z]+)$/.exec(actor.actor_id);
  return match ? `Annotator ${match[1].toUpperCase()}` : actor.actor_id;
}
