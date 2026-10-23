import type { KeyboardEvent } from "react";

/** A link styled as a button also answers Space, as a button does (spec V4); Enter stays the link's own key. */
export function onSpaceActivate(event: KeyboardEvent<HTMLAnchorElement>): void {
  if (event.key !== " ") return;
  event.preventDefault();
  // A held Space clicks once, as a button does.
  if (!event.repeat) event.currentTarget.click();
}
