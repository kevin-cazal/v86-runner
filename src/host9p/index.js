import { getHost9pStats, isHost9pDebugEnabled, resetHost9pStats } from "./debug.js";
import { Host9pError } from "./errors.js";
import { Host9pServer } from "./server.js";
import { Host9pVfs } from "./vfs.js";

/**
 * @typedef {Object} Host9pEntry
 * @property {string} name Basename (for listEntries) or final path segment
 * @property {string} path Normalized absolute path, e.g. "/uploads/foo.txt"
 * @property {"file" | "directory"} type
 * @property {number} size Bytes (0 for directories)
 * @property {number} mode Unix-style mode from the inode
 * @property {number} mtime Last modification time (unix seconds)
 * @property {number} atime Last access time (unix seconds)
 * @property {number} ctime Creation/change time (unix seconds)
 */

/**
 * Host-facing VFS API for the menu file browser:
 * - upload / overwrite: {@link Host9pVfsApi.put}
 * - download: {@link Host9pVfsApi.get}
 * - delete file: {@link Host9pVfsApi.remove}
 * - delete empty directory: {@link Host9pVfsApi.rmdir}
 * - rename / move: {@link Host9pVfsApi.rename}
 * - new folder: {@link Host9pVfsApi.mkdir}
 * - list with metadata: {@link Host9pVfsApi.listEntries}
 *
 * In-memory virtio-9p backend for v86 `filesystem.handle9p`.
 * Host VFS state is not included in v86 save_state; remount guest /mnt/host after restore if needed.
 */

/** @typedef {ReturnType<typeof createHost9pVfsApi>} Host9pVfsApi */

/**
 * @param {Host9pVfs} vfs
 * @returns {Host9pVfsApi}
 */
function createHost9pVfsApi(vfs) {
  return {
    put: (path, data) => vfs.put(path, data),
    get: (path) => vfs.get(path),
    list: (path) => vfs.list(path),
    listEntries: (path) => vfs.listEntries(path),
    exists: (path) => vfs.exists(path),
    stat: (path) => vfs.stat(path),
    mkdir: (path) => vfs.mkdir(path),
    remove: (path) => vfs.remove(path),
    rmdir: (path) => vfs.rmdir(path),
    rename: (oldPath, newPath) => vfs.rename(oldPath, newPath),
    reset: () => vfs.reset(),
  };
}

export function createHost9p() {
  const vfs = new Host9pVfs();
  const server = new Host9pServer(vfs);

  const handle9p = (reqBuf, reply) => {
    try {
      reply(server.handle(reqBuf));
    } catch (e) {
      console.error("[host9p] handler error:", e);
      try {
        const tag = reqBuf[6] | (reqBuf[7] << 8);
        server.SendError(tag, 95);
        reply(server.copyReply());
      } catch {
        /* ignore */
      }
    }
  };

  return {
    handle9p,
    vfs: createHost9pVfsApi(vfs),
    Host9pError,
    getStats: getHost9pStats,
    resetStats: resetHost9pStats,
    isDebugEnabled: isHost9pDebugEnabled,
  };
}

export { Host9pError };
