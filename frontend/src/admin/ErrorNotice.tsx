import { InlineMessage } from "../ui/InlineMessage";
import { errorMessage } from "./errors";

export function ErrorNotice({ error }: { error: unknown }): JSX.Element {
  return <InlineMessage tone="error">{errorMessage(error)}</InlineMessage>;
}
