export interface DownloadPayload { blob: Blob; filename: string | null }

function safeFilename(value: string): string | null {
  const basename = value.split(/[\\/]/).at(-1) ?? "";
  const safe = basename.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[<>:"|?*]/g, "_").replace(/^[. ]+|[. ]+$/g, "");
  return safe || null;
}

/** Prefer RFC 5987 UTF-8 filename*, falling back to ordinary filename. */
export function attachmentFilename(header: string | null): string | null {
  let ordinary: string | null = null;
  let extended: string | null = null;
  const parameters = /(?:^|;)\s*(filename\*|filename)\s*=\s*("(?:\\.|[^"])*"|[^;]*)/gi;
  for (const match of (header ?? "").matchAll(parameters)) {
    const raw = match[2].trim();
    const value = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\"/g, '"') : raw;
    if (match[1].toLowerCase() === "filename*") {
      const encoded = /^UTF-8'[^']*'(.*)$/i.exec(value);
      if (encoded) {
        try { extended ??= safeFilename(decodeURIComponent(encoded[1])); } catch { /* Try ordinary filename. */ }
      }
    } else ordinary ??= safeFilename(value);
  }
  return extended ?? ordinary;
}

/** Save an already authenticated payload; this helper performs no network work. */
export function saveDownload({ blob, filename }: DownloadPayload, fallbackName: string): void {
  const url = URL.createObjectURL(blob);
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = document.createElement("a");
    anchor.href = url; anchor.download = safeFilename(filename ?? "") ?? safeFilename(fallbackName) ?? "download";
    anchor.hidden = true; document.body.append(anchor); anchor.click();
  } finally {
    try { anchor?.remove(); } finally { URL.revokeObjectURL(url); }
  }
}
