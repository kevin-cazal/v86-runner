/**
 * Resolve a path under the Vite public root using `import.meta.env.BASE_URL`
 * (`./` for subpath deploys, or an explicit prefix when set via VITE_BASE).
 *
 * @param {string} path e.g. `v86.wasm`, `assets/seabios.bin`, `bg/zone.png`
 * @returns {string}
 */
export function assetUrl(path) {
  const normalized = String(path).replace(/^\//, "");
  return `${import.meta.env.BASE_URL}${normalized}`;
}
