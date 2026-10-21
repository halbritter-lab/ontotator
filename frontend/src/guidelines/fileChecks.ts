/**
 * Client-side checks of a guideline file before the preview, with the same messages as the
 * server's refusals (`GUIDELINE_FILE_TYPE`, `GUIDELINE_TOO_LARGE`, `GUIDELINE_EMPTY`,
 * `GUIDELINE_ENCODING`). The server stays authoritative; these only save a round trip.
 */
export const GUIDELINE_MAX_BYTES = 262_144;

export const GUIDELINE_FILE_MESSAGES = {
  type: "Upload a .md or .txt file.",
  size: "The file is larger than 256 KB.",
  empty: "The file is empty.",
  encoding: "The file is not UTF-8 text.",
} as const;

export type GuidelineKind = "markdown" | "text";

/** The extension decides the kind (spec G11); `null` for every other extension. */
export function guidelineKindOf(filename: string): GuidelineKind | null {
  const name = filename.toLowerCase();
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
  if (name.endsWith(".txt")) return "text";
  return null;
}

/** Type, size and emptiness from the file's metadata alone; `null` when the file may be read. */
export function checkGuidelineFile(file: File): string | null {
  if (!guidelineKindOf(file.name)) return GUIDELINE_FILE_MESSAGES.type;
  if (file.size === 0) return GUIDELINE_FILE_MESSAGES.empty;
  // The server measures after dropping a UTF-8 BOM; allow those three bytes here.
  if (file.size > GUIDELINE_MAX_BYTES + 3) return GUIDELINE_FILE_MESSAGES.size;
  return null;
}

function readBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsArrayBuffer(file);
  });
}

/** Reads the file for the preview: UTF-8 only, a leading BOM dropped, no NUL bytes, not blank. */
export async function readGuidelineFile(file: File): Promise<{ text: string; kind: GuidelineKind } | { error: string }> {
  const refused = checkGuidelineFile(file);
  if (refused) return { error: refused };
  const kind = guidelineKindOf(file.name)!;
  let bytes = await readBytes(file);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  if (bytes.length > GUIDELINE_MAX_BYTES) return { error: GUIDELINE_FILE_MESSAGES.size };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { error: GUIDELINE_FILE_MESSAGES.encoding };
  }
  if (text.includes("\u0000")) return { error: GUIDELINE_FILE_MESSAGES.encoding };
  if (!text.trim()) return { error: GUIDELINE_FILE_MESSAGES.empty };
  return { text, kind };
}
