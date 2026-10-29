import { onSpaceActivate } from "../ui/spaceActivates";
import { helpHref, type HelpScreen } from "./sections";

/** "Help": the handbook section of this screen in a new tab, so the work here stays open. */
export function HelpLink({ screen }: { screen: HelpScreen }): JSX.Element {
  return <a className="btn btn-quiet btn-sm" href={helpHref(screen)} target="_blank" rel="noopener noreferrer"
    title="Open the handbook section for this screen in a new tab" onKeyDown={onSpaceActivate}>Help</a>;
}
