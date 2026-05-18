/**
 * Optional product hook: load a custom single-file VM bundle before raw disk handling.
 * @typedef {{ diskBuffer: ArrayBuffer, label: string, initialStateBuffer?: ArrayBuffer, memorySize?: number }} FileLoadResult
 * @typedef {(file: File, helpers: { readSlice: (start: number, length: number, onProgress?: (pct: number) => void) => Promise<ArrayBuffer> }) => Promise<FileLoadResult | null>} FileLoaderHook
 */

/** @type {FileLoaderHook | null} */
let fileLoaderHook = null;

/** @param {FileLoaderHook | null} hook */
export function setFileLoaderHook(hook) {
  fileLoaderHook = hook;
}

/** @returns {FileLoaderHook | null} */
export function getFileLoaderHook() {
  return fileLoaderHook;
}
