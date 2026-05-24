/**
 * Export host9p VFS directory tree as .tar.gz with Unix mode and mtime.
 */
import { createTarGzip } from "nanotar";

/** @typedef {import("./index.js").Host9pEntry} Host9pEntry */
/** @typedef {import("./index.js").Host9pVfsApi} Host9pVfsApi */

/**
 * @param {string} path
 */
function normalizeDirPath(path) {
  if (!path || path === "/") {
    return "/";
  }
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * @param {Host9pEntry} entry
 */
function tarAttrs(entry) {
  return {
    mode: entry.mode & 0o7777,
    mtime: entry.mtime,
  };
}

/**
 * @param {Host9pVfsApi} vfs
 * @param {string} dirPath
 * @param {string} namePrefix
 * @returns {{ name: string, data?: Uint8Array, attrs?: { mode: number, mtime: number } }[]}
 */
function collectTarEntries(vfs, dirPath, namePrefix) {
  const normalized = normalizeDirPath(dirPath);
  const stat = vfs.stat(normalized);
  if (!stat || stat.type !== "directory") {
    throw new Error(`Not a directory: ${normalized}`);
  }

  /** @type {{ name: string, data?: Uint8Array, attrs?: { mode: number, mtime: number } }[]} */
  const files = [];

  for (const entry of vfs.listEntries(normalized)) {
    const tarName = namePrefix ? `${namePrefix}/${entry.name}` : entry.name;

    if (entry.type === "directory") {
      files.push({ name: tarName, attrs: tarAttrs(entry) });
      files.push(...collectTarEntries(vfs, entry.path, tarName));
    } else {
      const data = vfs.get(entry.path);
      if (!data) {
        throw new Error(`Failed to read file: ${entry.path}`);
      }
      files.push({ name: tarName, data, attrs: tarAttrs(entry) });
    }
  }

  return files;
}

/**
 * @param {Host9pVfsApi} vfs
 * @param {string} dirPath
 * @returns {Promise<Uint8Array>}
 */
export function exportHost9pTarGz(vfs, dirPath) {
  const files = collectTarEntries(vfs, dirPath, "");
  return createTarGzip(files);
}

/**
 * @param {string} dirPath
 */
export function defaultTarGzFilename(dirPath) {
  const normalized = normalizeDirPath(dirPath);
  if (normalized === "/") {
    return "host-share.tar.gz";
  }
  const slug = normalized
    .slice(1)
    .split("/")
    .map((part) => part.replace(/[^a-zA-Z0-9._-]+/g, "-"))
    .filter(Boolean)
    .join("-");
  return slug ? `host-share-${slug}.tar.gz` : "host-share.tar.gz";
}
