/** @typedef {"ENOENT" | "EISDIR" | "ENOTDIR" | "ENOTEMPTY" | "EEXIST" | "EINVAL" | "EOPNOTSUPP"} Host9pErrorCode */

/** Linux errno values used on the 9p wire. */
export const HOST9P_ERRNO = {
  ENOENT: 2,
  EINVAL: 22,
  ENOTDIR: 20,
  EISDIR: 21,
  EEXIST: 17,
  ENOTEMPTY: 39,
  EOPNOTSUPP: 95,
};

const CODE_TO_ERRNO = {
  ENOENT: HOST9P_ERRNO.ENOENT,
  EINVAL: HOST9P_ERRNO.EINVAL,
  ENOTDIR: HOST9P_ERRNO.ENOTDIR,
  EISDIR: HOST9P_ERRNO.EISDIR,
  EEXIST: HOST9P_ERRNO.EEXIST,
  ENOTEMPTY: HOST9P_ERRNO.ENOTEMPTY,
  EOPNOTSUPP: HOST9P_ERRNO.EOPNOTSUPP,
};

export class Host9pError extends Error {
  /**
   * @param {Host9pErrorCode} code
   * @param {string} [message]
   */
  constructor(code, message) {
    super(message ?? code);
    this.name = "Host9pError";
    this.code = code;
    this.errno = CODE_TO_ERRNO[code];
  }
}

/**
 * @param {Host9pErrorCode} code
 * @param {string} [message]
 * @returns {never}
 */
export function throwHost9p(code, message) {
  throw new Host9pError(code, message);
}

/**
 * @param {number} rc negative errno from vfs.Unlink
 * @returns {never}
 */
export function throwFromUnlinkRc(rc) {
  switch (rc) {
    case -HOST9P_ERRNO.ENOENT:
      throwHost9p("ENOENT");
      break;
    case -HOST9P_ERRNO.ENOTEMPTY:
      throwHost9p("ENOTEMPTY");
      break;
    case -HOST9P_ERRNO.EINVAL:
      throwHost9p("EINVAL");
      break;
    default:
      throwHost9p("EOPNOTSUPP", `unlink failed (${rc})`);
  }
}
