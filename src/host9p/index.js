import { getHost9pStats, isHost9pDebugEnabled, resetHost9pStats } from "./debug.js";
import { Host9pServer } from "./server.js";
import { Host9pVfs } from "./vfs.js";

/**
 * In-memory virtio-9p backend for v86 `filesystem.handle9p`.
 * Host VFS state is not included in v86 save_state; remount guest /mnt/host after restore if needed.
 *
 * Host paths are the 9p export root (e.g. `/file.txt`); guest sees `/mnt/host/file.txt`.
 */
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
    vfs: {
      put: (path, data) => vfs.put(path, data),
      get: (path) => vfs.get(path),
      list: (path) => vfs.list(path),
      reset: () => vfs.reset(),
    },
    getStats: getHost9pStats,
    resetStats: resetHost9pStats,
    isDebugEnabled: isHost9pDebugEnabled,
  };
}
