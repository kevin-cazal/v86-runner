import { P9_MSG_NAMES } from "./constants.js";

/** @type {{ requestsByType: Record<string, number>, errors: number }} */
const stats = {
  requestsByType: {},
  errors: 0,
};

export function isHost9pDebugEnabled() {
  try {
    return localStorage.getItem("host9pDebug") === "1";
  } catch {
    return false;
  }
}

export function getHost9pStats() {
  return {
    requestsByType: { ...stats.requestsByType },
    errors: stats.errors,
  };
}

export function resetHost9pStats() {
  stats.requestsByType = {};
  stats.errors = 0;
}

/**
 * @param {number} msgId
 * @param {number} tag
 * @param {{ path?: string, error?: string, size?: number, count?: number, offset?: number, valid?: number }} [extra]
 */
export function logHost9pRequest(msgId, tag, extra = {}) {
  const name = P9_MSG_NAMES[msgId] ?? `T${msgId}`;
  stats.requestsByType[name] = (stats.requestsByType[name] ?? 0) + 1;
  if (!isHost9pDebugEnabled()) {
    return;
  }
  const parts = [`[host9p] ${name}`, `tag=${tag}`];
  if (extra.path) {
    parts.push(`path=${extra.path}`);
  }
  if (extra.valid !== undefined) {
    parts.push(`valid=0x${extra.valid.toString(16)}`);
  }
  if (extra.size !== undefined) {
    parts.push(`size=${extra.size}`);
  }
  if (extra.offset !== undefined) {
    parts.push(`offset=${extra.offset}`);
  }
  if (extra.count !== undefined) {
    parts.push(`count=${extra.count}`);
  }
  if (extra.error) {
    parts.push(`err=${extra.error}`);
    stats.errors++;
    console.warn(parts.join(" "));
    return;
  }
  // console.debug is hidden unless DevTools shows "Verbose"
  console.log(parts.join(" "));
}

export function logHost9pError(msgId, tag, message) {
  stats.errors++;
  logHost9pRequest(msgId, tag, { error: message });
}
