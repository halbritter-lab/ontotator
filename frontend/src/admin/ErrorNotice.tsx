import { Button } from "../ui/Button";
import { InlineMessage } from "../ui/InlineMessage";
import { errorMessage } from "./errors";

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }): JSX.Element {
  return <InlineMessage tone="error">{errorMessage(error)}{onRetry && <>{" "}<Button size="sm" onClick={onRetry}>Try again</Button></>}</InlineMessage>;
}
