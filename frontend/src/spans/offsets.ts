/**
 * Unicode codepoint and UTF-16 code unit offset conversions and range validations.
 */

export interface OffsetMaps {
  cpToUtf16: number[];
  utf16ToCp: (number | null)[];
}

const MAP_CACHE_SIZE = 4;
const mapCache = new Map<string, OffsetMaps>();
let buildCount = 0;

/** Number of full offset-map builds performed (for performance regression tests). */
export function getOffsetMapBuildCount(): number {
  return buildCount;
}

/**
 * Returns cached offset maps for `text`, building them at most once per distinct
 * text (small LRU) instead of on every conversion.
 */
export function getOffsetMaps(text: string): OffsetMaps {
  const cached = mapCache.get(text);
  if (cached) {
    mapCache.delete(text);
    mapCache.set(text, cached);
    return cached;
  }
  const maps = buildOffsetMaps(text);
  mapCache.set(text, maps);
  if (mapCache.size > MAP_CACHE_SIZE) {
    const oldest = mapCache.keys().next().value as string;
    mapCache.delete(oldest);
  }
  return maps;
}

export function buildOffsetMaps(text: string): OffsetMaps {
  buildCount += 1;
  let utf16Index = 0;
  let cpIndex = 0;
  const cpToUtf16: number[] = [];
  const utf16ToCp: (number | null)[] = new Array(text.length + 1).fill(null);

  for (const ch of text) {
    cpToUtf16.push(utf16Index);
    utf16ToCp[utf16Index] = cpIndex;
    const codeUnits = ch.length;
    if (codeUnits === 2) {
      // High surrogate is at utf16Index; index + 1 is the low surrogate
      utf16ToCp[utf16Index + 1] = null;
    }
    utf16Index += codeUnits;
    cpIndex += 1;
  }
  cpToUtf16.push(utf16Index);
  utf16ToCp[utf16Index] = cpIndex;

  return { cpToUtf16, utf16ToCp };
}

/**
 * Returns the UTF-16 code-unit index corresponding to a 0-indexed Unicode codepoint index.
 */
export function toUtf16(text: string, codepoint: number): number {
  if (codepoint < 0) {
    throw new Error(`Codepoint index ${codepoint} is out of bounds (negative)`);
  }
  const { cpToUtf16 } = getOffsetMaps(text);
  if (codepoint >= cpToUtf16.length) {
    throw new Error(
      `Codepoint index ${codepoint} is out of bounds (max ${cpToUtf16.length - 1})`,
    );
  }
  return cpToUtf16[codepoint];
}

/**
 * Returns the 0-indexed Unicode codepoint index corresponding to a UTF-16 code unit offset.
 * Throws if the offset falls in the middle of a surrogate pair or is out of bounds.
 */
export function toCodepoint(text: string, utf16: number): number {
  if (utf16 < 0 || utf16 > text.length) {
    throw new Error(
      `UTF-16 index ${utf16} is out of bounds (0..${text.length})`,
    );
  }
  const { utf16ToCp } = getOffsetMaps(text);
  const cp = utf16ToCp[utf16];
  if (cp === null) {
    throw new Error(
      `UTF-16 index ${utf16} bisects a surrogate pair and cannot be converted to a codepoint boundary`,
    );
  }
  return cp;
}

/**
 * Slices a string using 0-indexed codepoint offsets [start, end).
 */
export function sliceByCodepoints(
  text: string,
  start: number,
  end: number,
): string {
  validateCodepointRange(text, start, end);
  const uStart = toUtf16(text, start);
  const uEnd = toUtf16(text, end);
  return text.slice(uStart, uEnd);
}

/**
 * Validates that start and end form a non-inverted range within the text's codepoints.
 */
export function validateCodepointRange(
  text: string,
  start: number,
  end: number,
): void {
  if (start < 0) {
    throw new Error(`Start codepoint ${start} is out of bounds (negative)`);
  }
  if (end < start) {
    throw new Error(
      `Invalid codepoint range: start ${start} is greater than end ${end}`,
    );
  }
  const totalCp = getOffsetMaps(text).cpToUtf16.length - 1;
  if (end > totalCp) {
    throw new Error(
      `End codepoint ${end} is out of bounds for text of length ${totalCp}`,
    );
  }
}

/**
 * Returns the total number of Unicode codepoints in the string.
 */
export function countCodepoints(text: string): number {
  let count = 0;
  for (const _ of text) {
    count++;
  }
  return count;
}
