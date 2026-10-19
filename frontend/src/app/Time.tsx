import React from "react";
import { formatTime, fullTimestamp, type FormatTimeOptions } from "./submissionLabels";

/** A local time label whose `title` carries the full timestamp with time zone. */
export function Time({ iso, seconds, now }: { iso: string } & FormatTimeOptions): React.ReactElement {
  return <time dateTime={iso} title={fullTimestamp(iso)}>{formatTime(iso, { seconds, now })}</time>;
}
