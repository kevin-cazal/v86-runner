/** @typedef {import("./index.js").Host9pVfsApi} Host9pVfsApi */

/** @type {Host9pVfsApi | null} */
let currentVfs = null;

/**
 * @param {Host9pVfsApi | null | undefined} vfs
 */
export function setHost9pVfs(vfs) {
  currentVfs = vfs ?? null;
}

/** @returns {Host9pVfsApi | null} */
export function getHost9pVfs() {
  return currentVfs;
}
