/** Window event fired after an own action on the Documents page changed rows (the navigation counter reloads). */
export const DOCUMENTS_CHANGED = "documents-changed";

export function notifyDocumentsChanged(): void {
  window.dispatchEvent(new Event(DOCUMENTS_CHANGED));
}
